import { Module } from '@nestjs/common';
import { GroupService } from './services/group.service';
import { GroupController } from './group.controller';
import { GroupUserService } from './services/group-user.service';
import { GroupsCsvExportService } from './services/groups-csv-export.service';

@Module({
  imports: [],
  controllers: [GroupController],
  providers: [GroupService, GroupUserService, GroupsCsvExportService],
  exports: [GroupService, GroupUserService],
})
export class GroupModule {}
