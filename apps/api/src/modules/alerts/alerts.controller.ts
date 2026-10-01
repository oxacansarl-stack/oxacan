import { Controller, HttpCode, Post } from '@nestjs/common';
import { CompanyId } from '../../common/decorators/current-user.decorator';
import { ADMIN_ONLY, Roles } from '../../common/decorators/roles.decorator';
import { AlertsService } from './alerts.service';

@Controller('alerts')
@Roles(...ADMIN_ONLY)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  /**
   * Runs the daily financial checks now, for the caller's company only (manual trigger / testing).
   * Safe to repeat: alerts already sent are not sent again.
   */
  @Post('run')
  @HttpCode(200)
  async run(@CompanyId() companyId: string) {
    return this.alerts.runForCompany(companyId);
  }
}
