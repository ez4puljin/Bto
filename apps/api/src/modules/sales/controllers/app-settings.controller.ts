import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import { Public } from '../../../common/auth/public.decorator';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import { AppBrandingDto, AppSettingsDto, AppSettingsRequestDto } from '../dto/app-settings.dto';
import {
  APP_SETTINGS_MANAGE,
  type AppSettings,
  AppSettingsService,
} from '../services/app-settings.service';
import { SalesRepShopService } from '../services/sales-rep-shop.service';

/**
 * The apps' settings (ADR-0127), the «Апп» pages' server: the assortment segment, the home's fixed
 * sections, the minimum order, the name and colour, which warehouses' stock each app counts and
 * how «Bto300» shows it (ADR-0173). Read and changed by the home's keepers
 * (`customer.home.manage`, ADR-0127 #5; the write is checked in the service too). `branding` is public: the
 * apps' sign-in screens show it before a token exists.
 */
@ApiTags('sales')
@Controller('app-settings')
export class AppSettingsController {
  constructor(
    private readonly settings: AppSettingsService,
    private readonly shop: SalesRepShopService,
  ) {}

  @Get()
  @RequirePermission(APP_SETTINGS_MANAGE)
  @ApiOkResponse({ type: AppSettingsDto })
  async get(): Promise<AppSettingsDto> {
    return this.dto(await this.settings.current());
  }

  @Put()
  @RequirePermission(APP_SETTINGS_MANAGE)
  @ApiOkResponse({ type: AppSettingsDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Body() body: AppSettingsRequestDto,
  ): Promise<AppSettingsDto> {
    return this.dto(
      await this.settings.update(ctx, {
        assortmentSegmentId: body.assortmentSegmentId ?? null,
        homeSections: {
          PROMOTIONS: body.homeSections.PROMOTIONS,
          DISCOUNTS: body.homeSections.DISCOUNTS,
          NEW: body.homeSections.NEW,
        },
        minOrderAmount: body.minOrderAmount ? new Decimal(body.minOrderAmount) : null,
        appName: body.appName ?? null,
        appColor: body.appColor ?? null,
        ...(body.stockWarehouses
          ? {
              stockWarehouses: {
                CUSTOMER: body.stockWarehouses.customer,
                STAFF: body.stockWarehouses.staff,
              },
            }
          : {}),
        ...(body.customerStockDisplay ? { customerStockDisplay: body.customerStockDisplay } : {}),
      }),
    );
  }

  @Get('branding')
  @Public()
  @ApiOkResponse({ type: AppBrandingDto })
  async branding(): Promise<AppBrandingDto> {
    const settings = await this.settings.current();
    return { appName: settings.appName, appColor: settings.appColor };
  }

  private async dto(settings: AppSettings): Promise<AppSettingsDto> {
    const assortment = await this.settings.assortment(settings);
    return {
      assortmentSegmentId: settings.assortmentSegmentId,
      assortment,
      shopProductCount: (await this.shop.index(await this.shop.customerScope())).length,
      homeSections: settings.homeSections,
      minOrderAmount: settings.minOrderAmount?.toFixed(0) ?? null,
      appName: settings.appName,
      appColor: settings.appColor,
      stockWarehouses: {
        customer: settings.stockWarehouses.CUSTOMER,
        staff: settings.stockWarehouses.STAFF,
      },
      customerStockDisplay: settings.customerStockDisplay,
      updatedAt: settings.updatedAt?.toISOString() ?? null,
    };
  }
}
