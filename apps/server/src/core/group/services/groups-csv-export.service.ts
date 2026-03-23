import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { jsonArrayFrom } from 'kysely/helpers/postgres';

@Injectable()
export class GroupsCsvExportService {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async exportGroupsCsv(workspaceId: string): Promise<string> {
    const groups = await this.db
      .selectFrom('groups')
      .select(['groups.name', 'groups.description'])
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('groupUsers')
            .innerJoin('users', 'users.id', 'groupUsers.userId')
            .select('users.email')
            .whereRef('groupUsers.groupId', '=', 'groups.id'),
        ).as('members'),
      )
      .where('groups.workspaceId', '=', workspaceId)
      .orderBy('groups.name', 'asc')
      .execute();

    const headers = ['name', 'description', 'members'];

    const rows = groups.map((group) => {
      const memberEmails =
        group.members?.map((m: { email: string }) => m.email).join(';') || '';

      return [
        this.escapeCsvField(group.name),
        this.escapeCsvField(group.description || ''),
        this.escapeCsvField(memberEmails),
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }

  private escapeCsvField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
