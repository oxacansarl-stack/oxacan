import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  CompanyId,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ExpenseService } from './expense.service';

@Controller('expenses')
export class ExpenseController {
  constructor(private readonly service: ExpenseService) {}

  @Get()
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async findAll(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.findAll(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      userId,
      projectId,
      status,
      category,
      dateFrom,
      dateTo,
    });
  }

  @Get('summary/project/:projectId')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async getProjectExpenseSummary(
    @CompanyId() companyId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.service.getProjectExpenseSummary(companyId, projectId);
  }

  @Get(':id')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async findById(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById(companyId, id);
  }

  @Post()
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async create(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      projectId?: string;
      taskId?: string;
      date: string;
      category: string;
      description: string;
      amountCents: number;
      receiptUrl?: string;
      isBillable?: boolean;
    },
  ) {
    return this.service.create(companyId, user.id, body);
  }

  @Put(':id')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async update(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      projectId?: string;
      taskId?: string;
      date?: string;
      category?: string;
      description?: string;
      amountCents?: number;
      receiptUrl?: string;
      isBillable?: boolean;
    },
  ) {
    return this.service.update(companyId, id, body);
  }

  @Delete(':id')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async delete(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.delete(companyId, id);
    return { deleted: true };
  }

  @Post('submit')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async submitForApproval(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: { expenseIds: string[] },
  ) {
    return this.service.submitForApproval(companyId, user.id, body.expenseIds);
  }

  @Post('approve')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER')
  async approveExpenses(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: { expenseIds: string[] },
  ) {
    return this.service.approveExpenses(companyId, user.id, body.expenseIds);
  }

  @Post('reject')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER')
  async rejectExpenses(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: { expenseIds: string[]; reason: string },
  ) {
    return this.service.rejectExpenses(companyId, user.id, body.expenseIds, body.reason);
  }
}
