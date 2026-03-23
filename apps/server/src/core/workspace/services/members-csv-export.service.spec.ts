import { MembersCsvExportService } from './members-csv-export.service';

describe('MembersCsvExportService', () => {
  let service: MembersCsvExportService;
  let mockDb: any;

  const workspaceId = 'workspace-1';

  beforeEach(() => {
    mockDb = createMockQueryBuilder([]);
    service = new MembersCsvExportService(mockDb);
  });

  function createMockQueryBuilder(data: any[]) {
    const builder: any = {
      selectFrom: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(data),
    };
    return builder;
  }

  describe('CSV format', () => {
    it('should generate correct headers with groups', async () => {
      mockDb.execute.mockResolvedValue([]);
      const csv = await service.exportMembersCsv(workspaceId, true);
      expect(csv).toBe('email,name,role,groups,status');
    });

    it('should generate correct headers without groups', async () => {
      mockDb.execute.mockResolvedValue([]);
      const csv = await service.exportMembersCsv(workspaceId, false);
      expect(csv).toBe('email,name,role,status');
    });

    it('should show active status for non-deactivated users', async () => {
      mockDb.execute.mockResolvedValue([
        { email: 'alice@test.com', name: 'Alice', role: 'admin', deactivatedAt: null },
      ]);
      const csv = await service.exportMembersCsv(workspaceId, false);
      expect(csv).toContain('active');
      expect(csv).not.toContain('deactivated');
    });

    it('should show deactivated status', async () => {
      mockDb.execute.mockResolvedValue([
        { email: 'bob@test.com', name: 'Bob', role: 'member', deactivatedAt: new Date() },
      ]);
      const csv = await service.exportMembersCsv(workspaceId, false);
      expect(csv).toContain('deactivated');
    });

    it('should join group names with semicolon', async () => {
      mockDb.execute.mockResolvedValue([
        {
          email: 'alice@test.com',
          name: 'Alice',
          role: 'admin',
          deactivatedAt: null,
          groups: [{ name: 'Engineering' }, { name: 'Design' }],
        },
      ]);
      const csv = await service.exportMembersCsv(workspaceId, true);
      expect(csv).toContain('Engineering;Design');
    });

    it('should escape fields containing commas', async () => {
      mockDb.execute.mockResolvedValue([
        { email: 'alice@test.com', name: 'Smith, Alice', role: 'member', deactivatedAt: null },
      ]);
      const csv = await service.exportMembersCsv(workspaceId, false);
      expect(csv).toContain('"Smith, Alice"');
    });

    it('should escape fields containing double quotes', async () => {
      mockDb.execute.mockResolvedValue([
        { email: 'alice@test.com', name: 'Alice "A" Smith', role: 'member', deactivatedAt: null },
      ]);
      const csv = await service.exportMembersCsv(workspaceId, false);
      expect(csv).toContain('"Alice ""A"" Smith"');
    });

    it('should handle empty name', async () => {
      mockDb.execute.mockResolvedValue([
        { email: 'alice@test.com', name: null, role: 'member', deactivatedAt: null },
      ]);
      const csv = await service.exportMembersCsv(workspaceId, false);
      const lines = csv.split('\n');
      expect(lines[1]).toBe('alice@test.com,,member,active');
    });
  });
});
