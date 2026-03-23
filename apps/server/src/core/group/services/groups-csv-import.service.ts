import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { GroupRepo } from '@docmost/db/repos/group/group.repo';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { executeTx } from '@docmost/db/utils';
import { parse } from 'csv-parse/sync';

export interface CsvImportResult {
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ row: number; name?: string; reason: string }>;
}

interface PreloadedData {
  groupsByName: Map<string, { id: string; isDefault: boolean }>;
  usersByEmail: Map<string, string>; // email -> userId
  groupUserSet: Set<string>; // "userId:groupId"
}

@Injectable()
export class GroupsCsvImportService {
  private readonly logger = new Logger(GroupsCsvImportService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly groupRepo: GroupRepo,
    private readonly groupUserRepo: GroupUserRepo,
    private readonly userRepo: UserRepo,
  ) {}

  async importGroupsCsv(
    csvContent: string,
    workspaceId: string,
    userId: string,
    stopOnError: boolean,
  ): Promise<CsvImportResult> {
    const records = this.parseCsv(csvContent);
    this.validateHeaders(records);

    const result: CsvImportResult = {
      total: records.length,
      created: 0,
      updated: 0,
      failed: 0,
      errors: [],
    };

    if (stopOnError) {
      await this.processWithRollback(records, workspaceId, userId, result);
    } else {
      await this.processPartial(records, workspaceId, userId, result);
    }

    return result;
  }

  private parseCsv(csvContent: string): Record<string, string>[] {
    try {
      return parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });
    } catch {
      throw new BadRequestException('Invalid CSV format');
    }
  }

  private validateHeaders(records: Record<string, string>[]) {
    if (records.length === 0) {
      throw new BadRequestException('CSV file is empty');
    }

    const headers = Object.keys(records[0]);
    if (!headers.includes('name')) {
      throw new BadRequestException('CSV must contain a "name" column');
    }

    // Reject user CSV uploaded to groups import
    if (headers.includes('email') || headers.includes('role')) {
      throw new BadRequestException(
        'Invalid CSV format. This looks like a members CSV. Please use the members import instead.',
      );
    }
  }

  private validateRow(row: Record<string, string>): string | null {
    const name = row.name?.trim();
    if (!name) {
      return 'Group name is required';
    }
    if (name.length < 2 || name.length > 100) {
      return 'Group name must be between 2 and 100 characters';
    }
    return null;
  }

  /**
   * Preload all groups, users, and group memberships for the workspace
   * to avoid N+1 queries during row processing.
   */
  private async preloadData(workspaceId: string, trx: any): Promise<PreloadedData> {
    const [groups, users, groupUsers] = await Promise.all([
      trx
        .selectFrom('groups')
        .select(['id', 'name', 'isDefault'])
        .where('workspaceId', '=', workspaceId)
        .execute(),
      trx
        .selectFrom('users')
        .select(['id', 'email'])
        .where('workspaceId', '=', workspaceId)
        .where('deletedAt', 'is', null)
        .execute(),
      trx
        .selectFrom('groupUsers')
        .select(['userId', 'groupId'])
        .execute(),
    ]);

    const groupsByName = new Map<string, { id: string; isDefault: boolean }>();
    for (const g of groups) {
      groupsByName.set(g.name.toLowerCase(), { id: g.id, isDefault: g.isDefault });
    }

    const usersByEmail = new Map<string, string>();
    for (const u of users) {
      usersByEmail.set(u.email.toLowerCase(), u.id);
    }

    const groupUserSet = new Set<string>();
    for (const gu of groupUsers) {
      groupUserSet.add(`${gu.userId}:${gu.groupId}`);
    }

    return { groupsByName, usersByEmail, groupUserSet };
  }

  private async processWithRollback(
    records: Record<string, string>[],
    workspaceId: string,
    userId: string,
    result: CsvImportResult,
  ) {
    for (let i = 0; i < records.length; i++) {
      const error = this.validateRow(records[i]);
      if (error) {
        throw new BadRequestException(
          `Row ${i + 2}: ${error} (name: ${records[i].name || 'empty'})`,
        );
      }
    }

    await executeTx(this.db, async (trx) => {
      const data = await this.preloadData(workspaceId, trx);

      for (let i = 0; i < records.length; i++) {
        await this.processRow(records[i], i + 2, workspaceId, userId, result, trx, data);
        if (result.failed > 0) {
          throw new BadRequestException(
            `Row ${result.errors[0].row}: ${result.errors[0].reason}`,
          );
        }
      }
    });
  }

  private async processPartial(
    records: Record<string, string>[],
    workspaceId: string,
    userId: string,
    result: CsvImportResult,
  ) {
    // Preload once outside individual transactions
    const data = await this.preloadData(workspaceId, this.db);

    for (let i = 0; i < records.length; i++) {
      const error = this.validateRow(records[i]);
      if (error) {
        result.failed++;
        result.errors.push({
          row: i + 2,
          name: records[i].name,
          reason: error,
        });
        continue;
      }

      try {
        await executeTx(this.db, async (trx) => {
          await this.processRow(records[i], i + 2, workspaceId, userId, result, trx, data);
        });
      } catch (err: any) {
        result.failed++;
        result.errors.push({
          row: i + 2,
          name: records[i].name,
          reason: err?.message || 'Unknown error',
        });
      }
    }
  }

  private async processRow(
    row: Record<string, string>,
    rowNumber: number,
    workspaceId: string,
    userId: string,
    result: CsvImportResult,
    trx: any,
    data: PreloadedData,
  ) {
    const name = row.name.trim();
    const description = row.description?.trim() || null;
    const memberEmails = row.members
      ? row.members
          .split(';')
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean)
      : [];

    const existingGroup = data.groupsByName.get(name.toLowerCase());

    if (existingGroup) {
      // Update existing group (skip default group)
      if (!existingGroup.isDefault && description !== undefined) {
        await trx
          .updateTable('groups')
          .set({ description, updatedAt: new Date() })
          .where('id', '=', existingGroup.id)
          .where('workspaceId', '=', workspaceId)
          .execute();
      }

      // Sync members
      await this.syncGroupMembers(existingGroup.id, memberEmails, trx, data);

      result.updated++;
      return;
    }

    // Create new group
    const newGroup = await this.groupRepo.insertGroup(
      {
        name,
        description,
        creatorId: userId,
        workspaceId,
        isDefault: false,
      },
      trx,
    );

    // Update cache with new group
    data.groupsByName.set(name.toLowerCase(), { id: newGroup.id, isDefault: false });

    // Add members
    await this.syncGroupMembers(newGroup.id, memberEmails, trx, data);

    result.created++;
  }

  private async syncGroupMembers(
    groupId: string,
    memberEmails: string[],
    trx: any,
    data: PreloadedData,
  ) {
    for (const email of memberEmails) {
      const userId = data.usersByEmail.get(email);
      if (userId) {
        const key = `${userId}:${groupId}`;
        if (!data.groupUserSet.has(key)) {
          await this.groupUserRepo.insertGroupUser(
            { userId, groupId },
            trx,
          );
          data.groupUserSet.add(key);
        }
      }
    }
  }
}
