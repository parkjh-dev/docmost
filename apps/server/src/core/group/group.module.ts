import { Module } from '@nestjs/common';
import { GroupService } from './services/group.service';
import { GroupController } from './group.controller';
import { GroupUserService } from './services/group-user.service';
import { GroupsCsvExportService } from './services/groups-csv-export.service';
import { GroupsCsvImportService } from './services/groups-csv-import.service';

@Module({
  imports: [],
  controllers: [GroupController],
  providers: [GroupService, GroupUserService, GroupsCsvExportService, GroupsCsvImportService],
  exports: [GroupService, GroupUserService],
})
export class GroupModule {}
