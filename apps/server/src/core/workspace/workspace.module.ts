import { Module } from '@nestjs/common';
import { WorkspaceService } from './services/workspace.service';
import { WorkspaceController } from './controllers/workspace.controller';
import { SpaceModule } from '../space/space.module';
import { WorkspaceInvitationService } from './services/workspace-invitation.service';
import { MembersCsvExportService } from './services/members-csv-export.service';
import { TokenModule } from '../auth/token.module';

@Module({
  imports: [SpaceModule, TokenModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService, WorkspaceInvitationService, MembersCsvExportService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
