import { BadRequestException } from '@nestjs/common';

jest.mock('./workspace-invitation.service', () => ({
  WorkspaceInvitationService: jest.fn(),
}));

import { MembersCsvImportService } from './members-csv-import.service';

describe('MembersCsvImportService', () => {
  let service: MembersCsvImportService;
  let mockDb: any;
  let mockUserRepo: any;
  let mockGroupRepo: any;
  let mockGroupUserRepo: any;

  const workspaceId = 'workspace-1';
  const actor = { id: 'actor-1', name: 'Actor' };
  const hostname = undefined;
  const defaultOptions = { stopOnError: false, deactivateNotInCsv: false, importMode: 'password' as const, initialPassword: 'testpass123' };

  beforeEach(() => {
    mockUserRepo = {
      findByEmail: jest.fn().mockResolvedValue(null),
      insertUser: jest.fn().mockResolvedValue({ id: 'new-user-1' }),
      updateUser: jest.fn().mockResolvedValue(undefined),
    };
    mockGroupRepo = {
      findByName: jest.fn().mockResolvedValue(null),
    };
    mockGroupUserRepo = {
      addUserToDefaultGroup: jest.fn().mockResolvedValue(undefined),
      getGroupUserById: jest.fn().mockResolvedValue(null),
      insertGroupUser: jest.fn().mockResolvedValue(undefined),
    };
    mockDb = {
      transaction: () => ({
        execute: async (fn: any) => fn(mockDb),
      }),
      selectFrom: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue([]),
    };

    const mockInvitationService = {
      sendInvitationMail: jest.fn().mockResolvedValue(undefined),
    };

    service = new MembersCsvImportService(
      mockDb,
      mockUserRepo,
      mockGroupRepo,
      mockGroupUserRepo,
      mockInvitationService as any,
    );
  });

  describe('CSV validation', () => {
    it('should reject empty CSV', async () => {
      const csv = 'email,name,role,groups\n';
      await expect(
        service.importMembersCsv(csv, workspaceId, actor, hostname, defaultOptions),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject CSV without email column', async () => {
      const csv = 'name,role\nAlice,admin\n';
      await expect(
        service.importMembersCsv(csv, workspaceId, actor, hostname, defaultOptions),
      ).rejects.toThrow('CSV must contain an "email" column');
    });

    it('should reject group CSV uploaded to members import (no email column)', async () => {
      const csv = 'name,description,members\nEngineering,team,alice@test.com\n';
      await expect(
        service.importMembersCsv(csv, workspaceId, actor, hostname, defaultOptions),
      ).rejects.toThrow('CSV must contain an "email" column');
    });

    it('should reject group CSV with members column even if email exists', async () => {
      const csv = 'email,name,members\nalice@test.com,Alice,bob@test.com\n';
      await expect(
        service.importMembersCsv(csv, workspaceId, actor, hostname, defaultOptions),
      ).rejects.toThrow('This looks like a groups CSV');
    });

    it('should reject duplicate emails within CSV', async () => {
      const csv = 'email,name,role\nalice@test.com,Alice,admin\nalice@test.com,Alice2,member\n';
      await expect(
        service.importMembersCsv(csv, workspaceId, actor, hostname, defaultOptions),
      ).rejects.toThrow('Duplicate emails found in CSV');
    });

    it('should reject invalid email format', async () => {
      const csv = 'email,name,role\nbad-email,Alice,member\n';
      const result = await service.importMembersCsv(
        csv, workspaceId, actor, hostname, defaultOptions,
      );
      expect(result.failed).toBe(1);
      expect(result.errors[0].reason).toBe('Invalid email format');
    });

    it('should reject invalid role', async () => {
      const csv = 'email,name,role\nalice@test.com,Alice,superadmin\n';
      const result = await service.importMembersCsv(
        csv, workspaceId, actor, hostname, defaultOptions,
      );
      expect(result.failed).toBe(1);
      expect(result.errors[0].reason).toContain('Invalid role');
    });

    it('should reject empty email', async () => {
      const csv = 'email,name,role\n,Alice,member\n';
      const result = await service.importMembersCsv(
        csv, workspaceId, actor, hostname, defaultOptions,
      );
      expect(result.failed).toBe(1);
      expect(result.errors[0].reason).toBe('Email is required');
    });
  });

  describe('CSV parsing', () => {
    it('should handle valid CSV with all columns', async () => {
      const csv = 'email,name,role,groups\nalice@test.com,Alice,admin,Engineering;Design\n';
      const result = await service.importMembersCsv(
        csv, workspaceId, actor, hostname, defaultOptions,
      );
      expect(result.total).toBe(1);
      expect(result.created).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('should handle CSV with only email column', async () => {
      const csv = 'email\nalice@test.com\n';
      const result = await service.importMembersCsv(
        csv, workspaceId, actor, hostname, defaultOptions,
      );
      expect(result.created).toBe(1);
    });

    it('should handle empty groups field', async () => {
      const csv = 'email,name,role,groups\nalice@test.com,Alice,member,\n';
      const result = await service.importMembersCsv(
        csv, workspaceId, actor, hostname, defaultOptions,
      );
      expect(result.created).toBe(1);
    });

    it('should default role to member when empty', async () => {
      const csv = 'email,name,role\nalice@test.com,Alice,\n';
      const result = await service.importMembersCsv(
        csv, workspaceId, actor, hostname, defaultOptions,
      );
      expect(result.created).toBe(1);
      expect(mockUserRepo.insertUser).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'member' }),
        expect.anything(),
      );
    });

    it('should handle UTF-8 BOM', async () => {
      const csv = '\uFEFFemail,name,role\nalice@test.com,Alice,member\n';
      const result = await service.importMembersCsv(
        csv, workspaceId, actor, hostname, defaultOptions,
      );
      expect(result.created).toBe(1);
    });

    it('should handle multiple rows', async () => {
      const csv = [
        'email,name,role',
        'alice@test.com,Alice,admin',
        'bob@test.com,Bob,member',
        'charlie@test.com,Charlie,member',
      ].join('\n');

      const result = await service.importMembersCsv(
        csv, workspaceId, actor, hostname, defaultOptions,
      );
      expect(result.total).toBe(3);
      expect(result.created).toBe(3);
    });
  });

  describe('duplicate handling', () => {
    it('should update existing user instead of skipping', async () => {
      // preloadData returns: users, groups, groupUsers (3 execute calls)
      mockDb.execute
        .mockResolvedValueOnce([{ id: 'existing-1', email: 'alice@test.com', name: 'Old Name', role: 'member' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const csv = 'email,name,role\nalice@test.com,New Name,admin\n';
      const result = await service.importMembersCsv(
        csv, workspaceId, actor, hostname, defaultOptions,
      );
      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);
      expect(mockUserRepo.updateUser).toHaveBeenCalled();
    });

    it('should not change owner role via CSV', async () => {
      mockDb.execute
        .mockResolvedValueOnce([{ id: 'owner-1', email: 'owner@test.com', name: 'Owner', role: 'owner' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const csv = 'email,name,role\nowner@test.com,Owner Updated,member\n';
      const result = await service.importMembersCsv(
        csv, workspaceId, actor, hostname, defaultOptions,
      );
      expect(result.updated).toBe(1);
      // updateUser should be called with name only, not role
      const updateCall = mockUserRepo.updateUser.mock.calls[0];
      expect(updateCall[0]).not.toHaveProperty('role');
    });
  });

  describe('stopOnError', () => {
    it('should throw on first validation error when stopOnError is true', async () => {
      const csv = 'email,name,role\nbad-email,Alice,member\n';
      await expect(
        service.importMembersCsv(csv, workspaceId, actor, hostname, {
          stopOnError: true,
          deactivateNotInCsv: false,
          importMode: 'password',
          initialPassword: 'testpass123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should continue on error when stopOnError is false', async () => {
      const csv = [
        'email,name,role',
        'bad-email,Alice,member',
        'bob@test.com,Bob,member',
      ].join('\n');

      const result = await service.importMembersCsv(
        csv, workspaceId, actor, hostname, defaultOptions,
      );
      expect(result.failed).toBe(1);
      expect(result.created).toBe(1);
    });
  });
});
