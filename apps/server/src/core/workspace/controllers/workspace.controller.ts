import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { WorkspaceService } from '../services/workspace.service';
import { UpdateWorkspaceDto } from '../dto/update-workspace.dto';
import { UpdateWorkspaceUserRoleDto } from '../dto/update-workspace-user-role.dto';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { WorkspaceInvitationService } from '../services/workspace-invitation.service';
import { Public } from '../../../common/decorators/public.decorator';
import {
  AcceptInviteDto,
  InvitationIdDto,
  InviteUserDto,
  RevokeInviteDto,
} from '../dto/invitation.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import WorkspaceAbilityFactory from '../../casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../../casl/interfaces/workspace-ability.type';
import { FastifyReply } from 'fastify';
import { MembersCsvExportService } from '../services/members-csv-export.service';
import { MembersCsvImportService } from '../services/members-csv-import.service';
import { FileInterceptor } from '../../../common/interceptors/file.interceptor';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { LicenseCheckService } from '../../../integrations/environment/license-check.service';
import { CheckHostnameDto } from '../dto/check-hostname.dto';
import { RemoveWorkspaceUserDto } from '../dto/remove-workspace-user.dto';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';

@UseGuards(JwtAuthGuard)
@Controller('workspace')
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceInvitationService: WorkspaceInvitationService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly membersCsvExportService: MembersCsvExportService,
    private readonly membersCsvImportService: MembersCsvImportService,
    private environmentService: EnvironmentService,
    private licenseCheckService: LicenseCheckService,
  ) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('/public')
  async getWorkspacePublicInfo(@Req() req: any) {
    return this.workspaceService.getWorkspacePublicData(req.raw.workspaceId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/info')
  async getWorkspace(@AuthWorkspace() workspace: Workspace) {
    return this.workspaceService.getWorkspaceInfo(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('entitlements')
  async getEntitlements(@AuthWorkspace() workspace: Workspace) {
    let { licenseKey } = workspace;
    const { plan } = workspace;

    if (!licenseKey) {
      licenseKey = await this.workspaceRepo.findLicenseKeyById(workspace.id);
    }

    return {
      cloud: this.environmentService.isCloud(),
      tier: this.licenseCheckService.resolveTier(licenseKey, plan),
      features: this.licenseCheckService.resolveFeatures(licenseKey, plan),
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async updateWorkspace(
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() dto: UpdateWorkspaceDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)
    ) {
      throw new ForbiddenException();
    }

    const updatedWorkspace = await this.workspaceService.update(
      workspace.id,
      dto,
    );

    if (
      dto.hostname &&
      dto.hostname === updatedWorkspace.hostname &&
      workspace.hostname !== updatedWorkspace.hostname
    ) {
      // log user out of old hostname
      res.clearCookie('authToken');
    }

    return updatedWorkspace;
  }

  @HttpCode(HttpStatus.OK)
  @Post('members')
  async getWorkspaceMembers(
    @Body()
    pagination: PaginationOptions,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Member)) {
      throw new ForbiddenException();
    }

    return this.workspaceService.getWorkspaceUsers(workspace.id, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/export')
  async exportMembersCsv(
    @Body() body: { includeGroups?: boolean },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Res() res: FastifyReply,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }

    const csv = await this.membersCsvExportService.exportMembersCsv(
      workspace.id,
      body.includeGroups ?? true,
    );

    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const fileName = `members_${timestamp}.csv`;
    res.headers({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });

    res.send(csv);
  }

  @UseInterceptors(FileInterceptor)
  @HttpCode(HttpStatus.OK)
  @Post('members/import')
  async importMembersCsv(
    @Req() req: any,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
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
    const deactivateNotInCsv = file.fields?.deactivateNotInCsv?.value === 'true';
    const importMode = file.fields?.importMode?.value === 'password' ? 'password' : 'invitation';
    const initialPassword = file.fields?.initialPassword?.value || undefined;

    return this.membersCsvImportService.importMembersCsv(
      csvContent,
      workspace.id,
      { id: user.id, name: user.name },
      workspace.hostname,
      { stopOnError, deactivateNotInCsv, importMode, initialPassword },
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/deactivate')
  async deactivateWorkspaceMember(
    @Body() dto: RemoveWorkspaceUserDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }
    await this.workspaceService.deactivateUser(user, dto.userId, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/activate')
  async activateWorkspaceMember(
    @Body() dto: RemoveWorkspaceUserDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }
    await this.workspaceService.activateUser(user, dto.userId, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/delete')
  async deleteWorkspaceMember(
    @Body() dto: RemoveWorkspaceUserDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }
    await this.workspaceService.deleteUser(user, dto.userId, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/change-role')
  async updateWorkspaceMemberRole(
    @Body() workspaceUserRoleDto: UpdateWorkspaceUserRoleDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }

    return this.workspaceService.updateWorkspaceUserRole(
      user,
      workspaceUserRoleDto,
      workspace.id,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('invites')
  async getInvitations(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body()
    pagination: PaginationOptions,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Member)) {
      throw new ForbiddenException();
    }

    return this.workspaceInvitationService.getInvitations(
      workspace.id,
      pagination,
    );
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('invites/info')
  async getInvitationById(
    @Body() dto: InvitationIdDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.workspaceInvitationService.getInvitationById(
      dto.invitationId,
      workspace,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('invites/create')
  async inviteUser(
    @Body() inviteUserDto: InviteUserDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }

    return this.workspaceInvitationService.createInvitation(
      inviteUserDto,
      workspace,
      user,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('invites/resend')
  async resendInvite(
    @Body() revokeInviteDto: RevokeInviteDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }

    return this.workspaceInvitationService.resendInvitation(
      revokeInviteDto.invitationId,
      workspace,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('invites/revoke')
  async revokeInvite(
    @Body() revokeInviteDto: RevokeInviteDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }

    return this.workspaceInvitationService.revokeInvitation(
      revokeInviteDto.invitationId,
      workspace.id,
    );
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('invites/accept')
  async acceptInvite(
    @Body() acceptInviteDto: AcceptInviteDto,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const result = await this.workspaceInvitationService.acceptInvitation(
      acceptInviteDto,
      workspace,
    );

    if (result.requiresLogin) {
      return {
        requiresLogin: true,
      };
    }

    res.setCookie('authToken', result.authToken, {
      httpOnly: true,
      path: '/',
      expires: this.environmentService.getCookieExpiresIn(),
      secure: this.environmentService.isHttps(),
    });

    return {
      requiresLogin: false,
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('/check-hostname')
  async checkHostname(@Body() checkHostnameDto: CheckHostnameDto) {
    return this.workspaceService.checkHostname(checkHostnameDto.hostname);
  }

  @HttpCode(HttpStatus.OK)
  @Post('invites/link')
  async getInviteLink(
    @Body() inviteDto: InvitationIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (this.environmentService.isCloud()) {
      throw new ForbiddenException();
    }

    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }
    const inviteLink =
      await this.workspaceInvitationService.getInvitationLinkById(
        inviteDto.invitationId,
        workspace,
      );

    return { inviteLink };
  }
}
