import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { GroupRepo } from '@docmost/db/repos/group/group.repo';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { executeTx } from '@docmost/db/utils';
import { parse } from 'csv-parse/sync';
import { randomBytes } from 'crypto';

export interface CsvImportOptions {
  stopOnError: boolean;
  deactivateNotInCsv: boolean;
}

export interface CsvImportResult {
  total: number;
  created: number;
  updated: number;
  deactivated: number;
  failed: number;
  errors: Array<{ row: number; email?: string; reason: string }>;
}

interface PreloadedData {
  usersByEmail: Map<string, { id: string; name: string; role: string }>;
  groupsByName: Map<string, { id: string; isDefault: boolean }>;
  groupUserSet: Set<string>; // "userId:groupId"
  defaultGroupId: string | null;
}

@Injectable()
export class MembersCsvImportService {
  private readonly logger = new Logger(MembersCsvImportService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly userRepo: UserRepo,
    private readonly groupRepo: GroupRepo,
    private readonly groupUserRepo: GroupUserRepo,
  ) {}

  async importMembersCsv(
    csvContent: string,
    workspaceId: string,
    actorId: string,
    options: CsvImportOptions,
  ): Promise<CsvImportResult> {
    const records = this.parseCsv(csvContent);
    this.validateHeaders(records);

    const result: CsvImportResult = {
      total: records.length,
      created: 0,
      updated: 0,
      deactivated: 0,
      failed: 0,
      errors: [],
    };

    if (options.stopOnError) {
      await this.processWithRollback(records, workspaceId, actorId, options, result);
    } else {
      await this.processPartial(records, workspaceId, actorId, options, result);
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
    if (!headers.includes('email')) {
      throw new BadRequestException('CSV must contain an "email" column');
    }

    // Reject group CSV uploaded to members import
    if (headers.includes('members') || (headers.includes('description') && !headers.includes('email'))) {
      throw new BadRequestException(
        'Invalid CSV format. This looks like a groups CSV. Please use the groups import instead.',
      );
    }

    // Check for duplicate emails within CSV
    const emails = records.map((r) => r.email?.trim().toLowerCase()).filter(Boolean);
    const duplicates = emails.filter((e, i) => emails.indexOf(e) !== i);
    if (duplicates.length > 0) {
      const unique = [...new Set(duplicates)];
      throw new BadRequestException(
        `Duplicate emails found in CSV: ${unique.join(', ')}`,
      );
    }
  }

  private validateRow(row: Record<string, string>): string | null {
    const email = row.email?.trim();
    if (!email) {
      return 'Email is required';
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return 'Invalid email format';
    }

    const role = row.role?.trim().toLowerCase();
    if (role && !['owner', 'admin', 'member'].includes(role)) {
      return `Invalid role "${role}". Must be: owner, admin, or member`;
    }

    return null;
  }

  /**
   * Preload all users, groups, and group memberships for the workspace
   * to avoid N+1 queries during row processing.
   */
  private async preloadData(workspaceId: string, trx: any): Promise<PreloadedData> {
    const [users, groups, groupUsers] = await Promise.all([
      trx
        .selectFrom('users')
        .select(['id', 'email', 'name', 'role'])
        .where('workspaceId', '=', workspaceId)
        .where('deletedAt', 'is', null)
        .execute(),
      trx
        .selectFrom('groups')
        .select(['id', 'name', 'isDefault'])
        .where('workspaceId', '=', workspaceId)
        .execute(),
      trx
        .selectFrom('groupUsers')
        .select(['userId', 'groupId'])
        .execute(),
    ]);

    const usersByEmail = new Map<string, { id: string; name: string; role: string }>();
    for (const u of users) {
      usersByEmail.set(u.email.toLowerCase(), { id: u.id, name: u.name, role: u.role });
    }

    const groupsByName = new Map<string, { id: string; isDefault: boolean }>();
    let defaultGroupId: string | null = null;
    for (const g of groups) {
      groupsByName.set(g.name.toLowerCase(), { id: g.id, isDefault: g.isDefault });
      if (g.isDefault) defaultGroupId = g.id;
    }

    const groupUserSet = new Set<string>();
    for (const gu of groupUsers) {
      groupUserSet.add(`${gu.userId}:${gu.groupId}`);
    }

    return { usersByEmail, groupsByName, groupUserSet, defaultGroupId };
  }

  private async processWithRollback(
    records: Record<string, string>[],
    workspaceId: string,
    actorId: string,
    options: CsvImportOptions,
    result: CsvImportResult,
  ) {
    for (let i = 0; i < records.length; i++) {
      const error = this.validateRow(records[i]);
      if (error) {
        throw new BadRequestException(
          `Row ${i + 2}: ${error} (email: ${records[i].email || 'empty'})`,
        );
      }
    }

    await executeTx(this.db, async (trx) => {
      const data = await this.preloadData(workspaceId, trx);

      for (let i = 0; i < records.length; i++) {
        await this.processRow(records[i], i + 2, workspaceId, result, trx, data);
        if (result.failed > 0) {
          throw new BadRequestException(
            `Row ${result.errors[0].row}: ${result.errors[0].reason}`,
          );
        }
      }

      if (options.deactivateNotInCsv) {
        await this.deactivateUsersNotInCsv(records, workspaceId, actorId, result, trx);
      }
    });
  }

  private async processPartial(
    records: Record<string, string>[],
    workspaceId: string,
    actorId: string,
    options: CsvImportOptions,
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
          email: records[i].email,
          reason: error,
        });
        continue;
      }

      try {
        await executeTx(this.db, async (trx) => {
          await this.processRow(records[i], i + 2, workspaceId, result, trx, data);
        });
      } catch (err: any) {
        result.failed++;
        result.errors.push({
          row: i + 2,
          email: records[i].email,
          reason: err?.message || 'Unknown error',
        });
      }
    }

    if (options.deactivateNotInCsv) {
      await executeTx(this.db, async (trx) => {
        await this.deactivateUsersNotInCsv(records, workspaceId, actorId, result, trx);
      });
    }
  }

  private async processRow(
    row: Record<string, string>,
    rowNumber: number,
    workspaceId: string,
    result: CsvImportResult,
    trx: any,
    data: PreloadedData,
  ) {
    const email = row.email.trim().toLowerCase();
    const name = row.name?.trim() || email.split('@')[0];
    const role = row.role?.trim().toLowerCase() || 'member';
    const groupNames = row.groups
      ? row.groups
          .split(';')
          .map((g) => g.trim())
          .filter(Boolean)
      : [];

    const existingUser = data.usersByEmail.get(email);

    if (existingUser) {
      // Update existing user
      const updates: Record<string, any> = {};
      if (name && name !== existingUser.name) {
        updates.name = name;
      }
      // Do not change role if user is owner
      if (role && role !== existingUser.role && existingUser.role !== 'owner') {
        updates.role = role;
      }

      if (Object.keys(updates).length > 0) {
        await this.userRepo.updateUser(updates, existingUser.id, workspaceId, trx);
        // Update cache
        if (updates.name) existingUser.name = updates.name;
        if (updates.role) existingUser.role = updates.role;
      }

      // Sync group memberships
      await this.syncUserGroups(existingUser.id, groupNames, trx, data);

      result.updated++;
      return;
    }

    // Create new user
    const password = randomBytes(16).toString('hex');
    const newUser = await this.userRepo.insertUser(
      {
        email,
        name,
        password,
        role,
        workspaceId,
        hasGeneratedPassword: true,
      },
      trx,
    );

    // Update cache with new user
    data.usersByEmail.set(email, { id: newUser.id, name, role });

    // Add to default group
    if (data.defaultGroupId) {
      const key = `${newUser.id}:${data.defaultGroupId}`;
      if (!data.groupUserSet.has(key)) {
        await this.groupUserRepo.insertGroupUser(
          { userId: newUser.id, groupId: data.defaultGroupId },
          trx,
        );
        data.groupUserSet.add(key);
      }
    } else {
      await this.groupUserRepo.addUserToDefaultGroup(newUser.id, workspaceId, trx);
    }

    // Add to specified groups
    await this.syncUserGroups(newUser.id, groupNames, trx, data);

    result.created++;
  }

  private async syncUserGroups(
    userId: string,
    groupNames: string[],
    trx: any,
    data: PreloadedData,
  ) {
    for (const groupName of groupNames) {
      const group = data.groupsByName.get(groupName.toLowerCase());
      if (group && !group.isDefault) {
        const key = `${userId}:${group.id}`;
        if (!data.groupUserSet.has(key)) {
          await this.groupUserRepo.insertGroupUser(
            { userId, groupId: group.id },
            trx,
          );
          data.groupUserSet.add(key);
        }
      }
    }
  }

  private async deactivateUsersNotInCsv(
    records: Record<string, string>[],
    workspaceId: string,
    actorId: string,
    result: CsvImportResult,
    trx: any,
  ) {
    const csvEmails = new Set(
      records.map((r) => r.email.trim().toLowerCase()),
    );

    // Get all active users in workspace
    const allUsers = await trx
      .selectFrom('users')
      .select(['id', 'email', 'role'])
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .where('deactivatedAt', 'is', null)
      .execute();

    for (const user of allUsers) {
      // Skip: current actor, owners, and users in CSV
      if (user.id === actorId) continue;
      if (user.role === 'owner') continue;
      if (csvEmails.has(user.email.toLowerCase())) continue;

      await trx
        .updateTable('users')
        .set({ deactivatedAt: new Date(), updatedAt: new Date() })
        .where('id', '=', user.id)
        .where('workspaceId', '=', workspaceId)
        .execute();

      result.deactivated++;
    }
  }
}
