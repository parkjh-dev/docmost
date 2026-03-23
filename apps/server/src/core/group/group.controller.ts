import {
  BadRequestException,
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { GroupService } from './services/group.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { GroupUserService } from './services/group-user.service';
import { GroupIdDto } from './dto/group-id.dto';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { AddGroupUserDto } from './dto/add-group-user.dto';
import { RemoveGroupUserDto } from './dto/remove-group-user.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { GroupsCsvExportService } from './services/groups-csv-export.service';
import { GroupsCsvImportService } from './services/groups-csv-import.service';
import { FastifyReply } from 'fastify';
import { FileInterceptor } from '../../common/interceptors/file.interceptor';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../casl/interfaces/workspace-ability.type';

@UseGuards(JwtAuthGuard)
@Controller('groups')
export class GroupController {
  constructor(
    private readonly groupService: GroupService,
    private readonly groupUserService: GroupUserService,
    private readonly groupsCsvExportService: GroupsCsvExportService,
    private readonly groupsCsvImportService: GroupsCsvImportService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('/')
  getWorkspaceGroups(
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Group)) {
      throw new ForbiddenException();
    }

    return this.groupService.getWorkspaceGroups(workspace.id, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/info')
  getGroup(
    @Body() groupIdDto: GroupIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Group)) {
      throw new ForbiddenException();
    }
    return this.groupService.getGroupInfo(groupIdDto.groupId, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('export')
  async exportGroupsCsv(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Res() res: FastifyReply,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Group)
    ) {
      throw new ForbiddenException();
    }

    const csv = await this.groupsCsvExportService.exportGroupsCsv(workspace.id);

    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const fileName = `groups_${timestamp}.csv`;
    res.headers({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });

    res.send(csv);
  }

  @UseInterceptors(FileInterceptor)
  @HttpCode(HttpStatus.OK)
  @Post('import')
  async importGroupsCsv(
    @Req() req: any,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Group)
    ) {
      throw new ForbiddenException();
    }

    const file = await req.file({
      limits: { fileSize: 10 * 1024 * 1024, fields: 4, files: 1 },
    });

    if (!file) {
      throw new BadRequestException('Failed to upload file');
    }

    if (!file.filename.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('Only CSV files are supported');
    }

    const buffer = await file.toBuffer();
    const csvContent = buffer.toString('utf-8');

    const stopOnError = file.fields?.stopOnError?.value === 'true';

    return this.groupsCsvImportService.importGroupsCsv(
      csvContent,
      workspace.id,
      user.id,
      stopOnError,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  createGroup(
    @Body() createGroupDto: CreateGroupDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Group)
    ) {
      throw new ForbiddenException();
    }
    return this.groupService.createGroup(user, workspace.id, createGroupDto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  updateGroup(
    @Body() updateGroupDto: UpdateGroupDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Group)
    ) {
      throw new ForbiddenException();
    }

    return this.groupService.updateGroup(workspace.id, updateGroupDto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('members')
  getGroupMembers(
    @Body() groupIdDto: GroupIdDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Group)) {
      throw new ForbiddenException();
    }

    return this.groupUserService.getGroupUsers(
      groupIdDto.groupId,
      workspace.id,
      pagination,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/add')
  addGroupMember(
    @Body() addGroupUserDto: AddGroupUserDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Group)
    ) {
      throw new ForbiddenException();
    }

    return this.groupUserService.addUsersToGroupBatch(
      addGroupUserDto.userIds,
      addGroupUserDto.groupId,
      workspace.id,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/remove')
  removeGroupMember(
    @Body() removeGroupUserDto: RemoveGroupUserDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Group)
    ) {
      throw new ForbiddenException();
    }

    return this.groupUserService.removeUserFromGroup(
      removeGroupUserDto.userId,
      removeGroupUserDto.groupId,
      workspace.id,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  deleteGroup(
    @Body() groupIdDto: GroupIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Group)
    ) {
      throw new ForbiddenException();
    }
    return this.groupService.deleteGroup(groupIdDto.groupId, workspace.id);
  }
}
