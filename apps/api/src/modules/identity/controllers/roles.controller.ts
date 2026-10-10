import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../auth-context';
import { CurrentUser, RequirePermission } from '../decorators/access.decorators';
import {
  CreateRoleDto,
  PermissionListDto,
  RoleDto,
  RoleListDto,
  UpdateRoleDto,
} from '../dto/roles.dto';
import { RolesService } from '../services/roles.service';

/** System roles (read-only) and admin-built custom roles (ADR-0027 #5). */
@ApiTags('roles')
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermission('identity.users.read')
  @ApiOkResponse({ type: PermissionListDto })
  permissions(): PermissionListDto {
    return { data: this.roles.catalog(), nextCursor: null };
  }

  @Get('roles')
  @RequirePermission('identity.users.read')
  @ApiOkResponse({ type: RoleListDto })
  async list(): Promise<RoleListDto> {
    return { data: await this.roles.list(), nextCursor: null };
  }

  @Post('roles')
  @RequirePermission('identity.roles.manage')
  @ApiCreatedResponse({ type: RoleDto })
  create(@CurrentUser() actor: AuthContext, @Body() body: CreateRoleDto): Promise<RoleDto> {
    return this.roles.create(actor, body);
  }

  @Patch('roles/:id')
  @RequirePermission('identity.roles.manage')
  @ApiOkResponse({ type: RoleDto })
  update(
    @CurrentUser() actor: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateRoleDto,
  ): Promise<RoleDto> {
    return this.roles.update(actor, id, body);
  }

  @Delete('roles/:id')
  @RequirePermission('identity.roles.manage')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() actor: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.roles.remove(actor, id);
  }
}
