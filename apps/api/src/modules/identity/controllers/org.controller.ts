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
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../auth-context';
import { Authenticated, CurrentUser, RequirePermission } from '../decorators/access.decorators';
import {
  AuditPageDto,
  AuditQueryDto,
  BranchDto,
  BranchListDto,
  CreateBranchDto,
  CreateSettingDto,
  CreateWarehouseDto,
  SettingEntryDto,
  SettingListDto,
  UpdateBranchDto,
  UpdateWarehouseDto,
  WarehouseDto,
  WarehouseListDto,
  WarehouseListQueryDto,
} from '../dto/org.dto';
import { AuditQueryService } from '../services/audit-query.service';
import { type Branch, OrgService, type Warehouse } from '../services/org.service';
import { type SettingEntry, SettingsService } from '../services/settings.service';

const toBranchDto = (row: Branch): BranchDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
  branchNo: row.branchNo,
  districtCode: row.districtCode,
  address: row.address,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toWarehouseDto = (row: Warehouse): WarehouseDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
  kind: row.kind,
  branchId: row.branchId,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toSettingEntryDto = (entry: SettingEntry): SettingEntryDto => ({
  id: entry.id,
  key: entry.key,
  value: entry.value,
  effectiveFrom: entry.effectiveFrom,
  createdBy: entry.createdBy,
  createdAt: entry.createdAt.toISOString(),
});

/** Branches and warehouses: every staff member reads them; changes need identity.org.manage. */
@ApiTags('org')
@Controller()
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get('branches')
  @Authenticated()
  @ApiOkResponse({ type: BranchListDto })
  async branches(): Promise<BranchListDto> {
    return { data: (await this.org.listBranches()).map(toBranchDto), nextCursor: null };
  }

  @Post('branches')
  @RequirePermission('identity.org.manage')
  @ApiCreatedResponse({ type: BranchDto })
  async createBranch(
    @CurrentUser() actor: AuthContext,
    @Body() body: CreateBranchDto,
  ): Promise<BranchDto> {
    return toBranchDto(await this.org.createBranch(actor, body));
  }

  @Patch('branches/:id')
  @RequirePermission('identity.org.manage')
  @ApiOkResponse({ type: BranchDto })
  async updateBranch(
    @CurrentUser() actor: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateBranchDto,
  ): Promise<BranchDto> {
    return toBranchDto(await this.org.updateBranch(actor, id, body));
  }

  @Get('warehouses')
  @Authenticated()
  @ApiOkResponse({ type: WarehouseListDto })
  async warehouses(@Query() query: WarehouseListQueryDto): Promise<WarehouseListDto> {
    return { data: (await this.org.listWarehouses(query)).map(toWarehouseDto), nextCursor: null };
  }

  @Post('warehouses')
  @RequirePermission('identity.org.manage')
  @ApiCreatedResponse({ type: WarehouseDto })
  async createWarehouse(
    @CurrentUser() actor: AuthContext,
    @Body() body: CreateWarehouseDto,
  ): Promise<WarehouseDto> {
    return toWarehouseDto(await this.org.createWarehouse(actor, body));
  }

  @Patch('warehouses/:id')
  @RequirePermission('identity.org.manage')
  @ApiOkResponse({ type: WarehouseDto })
  async updateWarehouse(
    @CurrentUser() actor: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateWarehouseDto,
  ): Promise<WarehouseDto> {
    return toWarehouseDto(await this.org.updateWarehouse(actor, id, body));
  }
}

/** Effective-dated settings (SPEC §5.1): VAT, city tax, payer flags, session length. */
@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermission('identity.settings.read')
  @ApiOkResponse({ type: SettingListDto })
  async list(): Promise<SettingListDto> {
    const views = await this.settings.list();
    return {
      data: views.map((view) => ({
        key: view.key,
        current: view.current,
        entries: view.entries.map(toSettingEntryDto),
      })),
      nextCursor: null,
    };
  }

  @Post()
  @RequirePermission('identity.settings.manage')
  @ApiCreatedResponse({ type: SettingEntryDto })
  async create(
    @CurrentUser() actor: AuthContext,
    @Body() body: CreateSettingDto,
  ): Promise<SettingEntryDto> {
    return toSettingEntryDto(await this.settings.create(actor, body));
  }

  @Delete(':id')
  @RequirePermission('identity.settings.manage')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() actor: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.settings.remove(actor, id);
  }
}

/** The audit trail, newest first (SPEC §5.1). */
@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @RequirePermission('identity.audit.read')
  @ApiOkResponse({ type: AuditPageDto })
  async list(@Query() query: AuditQueryDto): Promise<AuditPageDto> {
    const page = await this.audit.list(query);
    return {
      data: page.data.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
      nextCursor: page.nextCursor,
    };
  }
}
