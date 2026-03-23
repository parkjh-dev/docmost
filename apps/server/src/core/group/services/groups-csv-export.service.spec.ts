import { GroupsCsvExportService } from './groups-csv-export.service';

describe('GroupsCsvExportService', () => {
  let service: GroupsCsvExportService;
  let mockDb: any;

  const workspaceId = 'workspace-1';

  beforeEach(() => {
    mockDb = {
      selectFrom: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue([]),
    };
    service = new GroupsCsvExportService(mockDb);
  });

  describe('CSV format', () => {
    it('should generate correct headers', async () => {
      const csv = await service.exportGroupsCsv(workspaceId);
      expect(csv).toBe('name,description,members');
    });

    it('should format group with members', async () => {
      mockDb.execute.mockResolvedValue([
        {
          name: 'Engineering',
          description: 'Dev team',
          members: [{ email: 'alice@test.com' }, { email: 'bob@test.com' }],
        },
      ]);
      const csv = await service.exportGroupsCsv(workspaceId);
      expect(csv).toContain('Engineering,Dev team,alice@test.com;bob@test.com');
    });

    it('should handle group with no members', async () => {
      mockDb.execute.mockResolvedValue([
        { name: 'Empty Group', description: 'No members', members: [] },
      ]);
      const csv = await service.exportGroupsCsv(workspaceId);
      expect(csv).toContain('Empty Group,No members,');
    });

    it('should handle null description', async () => {
      mockDb.execute.mockResolvedValue([
        { name: 'Engineering', description: null, members: [] },
      ]);
      const csv = await service.exportGroupsCsv(workspaceId);
      const lines = csv.split('\n');
      expect(lines[1]).toBe('Engineering,,');
    });

    it('should escape description containing commas', async () => {
      mockDb.execute.mockResolvedValue([
        { name: 'Dev', description: 'Backend, Frontend', members: [] },
      ]);
      const csv = await service.exportGroupsCsv(workspaceId);
      expect(csv).toContain('"Backend, Frontend"');
    });

    it('should handle multiple groups', async () => {
      mockDb.execute.mockResolvedValue([
        { name: 'Design', description: 'Design team', members: [] },
        { name: 'Engineering', description: 'Dev team', members: [] },
      ]);
      const csv = await service.exportGroupsCsv(workspaceId);
      const lines = csv.split('\n');
      expect(lines.length).toBe(3); // header + 2 rows
    });
  });
});
