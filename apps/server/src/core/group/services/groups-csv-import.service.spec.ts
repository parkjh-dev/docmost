import { BadRequestException } from '@nestjs/common';
import { GroupsCsvImportService } from './groups-csv-import.service';

describe('GroupsCsvImportService', () => {
  let service: GroupsCsvImportService;
  let mockDb: any;
  let mockGroupRepo: any;
  let mockGroupUserRepo: any;
  let mockUserRepo: any;

  const workspaceId = 'workspace-1';
  const userId = 'user-1';

  beforeEach(() => {
    mockGroupRepo = {
      findByName: jest.fn().mockResolvedValue(null),
      insertGroup: jest.fn().mockResolvedValue({ id: 'new-group-1' }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    mockGroupUserRepo = {
      getGroupUserById: jest.fn().mockResolvedValue(null),
      insertGroupUser: jest.fn().mockResolvedValue(undefined),
    };
    mockUserRepo = {
      findByEmail: jest.fn().mockResolvedValue(null),
    };
    mockDb = {
      transaction: () => ({
        execute: async (fn: any) => fn(mockDb),
      }),
    };

    service = new GroupsCsvImportService(
      mockDb,
      mockGroupRepo,
      mockGroupUserRepo,
      mockUserRepo,
    );
  });

  describe('CSV validation', () => {
    it('should reject empty CSV', async () => {
      const csv = 'name,description,members\n';
      await expect(
        service.importGroupsCsv(csv, workspaceId, userId, false),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject CSV without name column', async () => {
      const csv = 'description,members\nteam,alice@test.com\n';
      await expect(
        service.importGroupsCsv(csv, workspaceId, userId, false),
      ).rejects.toThrow('CSV must contain a "name" column');
    });

    it('should reject user CSV uploaded to groups import', async () => {
      const csv = 'email,name,role,groups\nalice@test.com,Alice,admin,Engineering\n';
      await expect(
        service.importGroupsCsv(csv, workspaceId, userId, false),
      ).rejects.toThrow('This looks like a members CSV');
    });

    it('should reject CSV with role column (user CSV detection)', async () => {
      const csv = 'name,role\nEngineering,admin\n';
      await expect(
        service.importGroupsCsv(csv, workspaceId, userId, false),
      ).rejects.toThrow('This looks like a members CSV');
    });

    it('should reject group name shorter than 2 characters', async () => {
      const csv = 'name,description\nA,too short\n';
      const result = await service.importGroupsCsv(
        csv, workspaceId, userId, false,
      );
      expect(result.failed).toBe(1);
      expect(result.errors[0].reason).toContain('between 2 and 100');
    });

    it('should reject empty group name', async () => {
      const csv = 'name,description\n,no name\n';
      const result = await service.importGroupsCsv(
        csv, workspaceId, userId, false,
      );
      expect(result.failed).toBe(1);
      expect(result.errors[0].reason).toBe('Group name is required');
    });
  });

  describe('CSV parsing', () => {
    it('should handle valid CSV with all columns', async () => {
      const csv = 'name,description,members\nEngineering,Dev team,alice@test.com;bob@test.com\n';
      const result = await service.importGroupsCsv(
        csv, workspaceId, userId, false,
      );
      expect(result.total).toBe(1);
      expect(result.created).toBe(1);
    });

    it('should handle CSV with only name column', async () => {
      const csv = 'name\nEngineering\n';
      const result = await service.importGroupsCsv(
        csv, workspaceId, userId, false,
      );
      expect(result.created).toBe(1);
    });

    it('should handle empty members field', async () => {
      const csv = 'name,description,members\nEngineering,Dev team,\n';
      const result = await service.importGroupsCsv(
        csv, workspaceId, userId, false,
      );
      expect(result.created).toBe(1);
    });

    it('should handle empty description', async () => {
      const csv = 'name,description\nEngineering,\n';
      const result = await service.importGroupsCsv(
        csv, workspaceId, userId, false,
      );
      expect(result.created).toBe(1);
    });

    it('should handle multiple rows', async () => {
      const csv = [
        'name,description',
        'Engineering,Dev team',
        'Design,Design team',
        'Marketing,Marketing team',
      ].join('\n');

      const result = await service.importGroupsCsv(
        csv, workspaceId, userId, false,
      );
      expect(result.total).toBe(3);
      expect(result.created).toBe(3);
    });

    it('should handle UTF-8 BOM', async () => {
      const csv = '\uFEFFname,description\nEngineering,Dev team\n';
      const result = await service.importGroupsCsv(
        csv, workspaceId, userId, false,
      );
      expect(result.created).toBe(1);
    });
  });

  describe('duplicate handling', () => {
    it('should update existing group instead of skipping', async () => {
      mockGroupRepo.findByName.mockResolvedValue({
        id: 'existing-1',
        name: 'Engineering',
        isDefault: false,
      });

      const csv = 'name,description\nEngineering,Updated description\n';
      const result = await service.importGroupsCsv(
        csv, workspaceId, userId, false,
      );
      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);
      expect(mockGroupRepo.update).toHaveBeenCalled();
    });

    it('should not update default group description', async () => {
      mockGroupRepo.findByName.mockResolvedValue({
        id: 'default-1',
        name: 'Everyone',
        isDefault: true,
      });

      const csv = 'name,description\nEveryone,New description\n';
      const result = await service.importGroupsCsv(
        csv, workspaceId, userId, false,
      );
      expect(result.updated).toBe(1);
      expect(mockGroupRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('member mapping', () => {
    it('should add existing users as group members', async () => {
      mockUserRepo.findByEmail.mockResolvedValue({ id: 'user-found' });

      const csv = 'name,description,members\nEngineering,team,alice@test.com\n';
      const result = await service.importGroupsCsv(
        csv, workspaceId, userId, false,
      );
      expect(result.created).toBe(1);
      expect(mockGroupUserRepo.insertGroupUser).toHaveBeenCalled();
    });

    it('should skip non-existing users in members', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);

      const csv = 'name,description,members\nEngineering,team,nonexist@test.com\n';
      const result = await service.importGroupsCsv(
        csv, workspaceId, userId, false,
      );
      expect(result.created).toBe(1);
      expect(mockGroupUserRepo.insertGroupUser).not.toHaveBeenCalled();
    });

    it('should handle semicolon-separated multiple members', async () => {
      mockUserRepo.findByEmail
        .mockResolvedValueOnce({ id: 'user-1' })
        .mockResolvedValueOnce({ id: 'user-2' });

      const csv = 'name,description,members\nEngineering,team,a@test.com;b@test.com\n';
      const result = await service.importGroupsCsv(
        csv, workspaceId, userId, false,
      );
      expect(mockGroupUserRepo.insertGroupUser).toHaveBeenCalledTimes(2);
    });
  });

  describe('stopOnError', () => {
    it('should throw on first validation error when stopOnError is true', async () => {
      const csv = 'name,description\n,empty name\n';
      await expect(
        service.importGroupsCsv(csv, workspaceId, userId, true),
      ).rejects.toThrow(BadRequestException);
    });

    it('should continue on error when stopOnError is false', async () => {
      const csv = [
        'name,description',
        ',empty name',
        'ValidGroup,Valid desc',
      ].join('\n');

      const result = await service.importGroupsCsv(
        csv, workspaceId, userId, false,
      );
      expect(result.failed).toBe(1);
      expect(result.created).toBe(1);
    });
  });
});
