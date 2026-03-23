import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { jsonArrayFrom } from 'kysely/helpers/postgres';

@Injectable()
export class MembersCsvExportService {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async exportMembersCsv(
    workspaceId: string,
    includeGroups: boolean,
  ): Promise<string> {
    let query = this.db
      .selectFrom('users')
      .select(['users.email', 'users.name', 'users.role', 'users.deactivatedAt'])
      .where('users.workspaceId', '=', workspaceId)
      .where('users.deletedAt', 'is', null)
      .orderBy('users.name', 'asc');

    if (includeGroups) {
      query = query.select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('groupUsers')
            .innerJoin('groups', 'groups.id', 'groupUsers.groupId')
            .select('groups.name')
            .whereRef('groupUsers.userId', '=', 'users.id'),
        ).as('groups'),
      );
    }

    const users = await query.execute();

    const headers = includeGroups
      ? ['email', 'name', 'role', 'groups', 'status']
      : ['email', 'name', 'role', 'status'];

    const rows = users.map((user) => {
      const status = user.deactivatedAt ? 'deactivated' : 'active';
      const fields = [
        this.escapeCsvField(user.email),
        this.escapeCsvField(user.name || ''),
        user.role || 'member',
      ];

      if (includeGroups) {
        const groupNames = (user as any).groups
          ?.map((g: { name: string }) => g.name)
          .join(';') || '';
        fields.push(this.escapeCsvField(groupNames));
      }

      fields.push(status);
      return fields.join(',');
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
