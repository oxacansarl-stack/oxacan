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
import {
  ALL_ROLES,
  OFFICE_ROLES,
  Roles,
  SITE_LEAD_ROLES,
} from '../../common/decorators/roles.decorator';
import { ExpenseService } from './expense.service';
import { ScopeUser, parsePaging } from './access-scope.service';
import {
  CreateExpenseDto,
  ExpenseIdsDto,
  RejectExpensesDto,
  UpdateExpenseDto,
} from './dto/expense.dto';

const OPTIONAL_UUID = new ParseUUIDPipe({ optional: true });

@Controller('expenses')
export class ExpenseController {
  constructor(private readonly service: ExpenseService) {}

  @Get()
  @Roles(...ALL_ROLES)
  async findAll(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId', OPTIONAL_UUID) userId?: string,
    @Query('projectId', OPTIONAL_UUID) projectId?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.findAll(
      { ...user, companyId },
      { ...parsePaging(page, limit), userId, projectId, status, category, dateFrom, dateTo },
    );
  }

  @Get('summary/project/:projectId')
  @Roles(...OFFICE_ROLES)
  async getProjectExpenseSummary(
    @CompanyId() companyId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.service.getProjectExpenseSummary(companyId, projectId);
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  async findById(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById({ ...user, companyId }, id);
  }

  /** The owner is always the caller (from the token), never the body. */
  @Post()
  @Roles(...ALL_ROLES)
  async create(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Body() body: CreateExpenseDto,
  ) {
    return this.service.create(companyId, user.id, body);
  }

  @Put(':id')
  @Roles(...ALL_ROLES)
  async update(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateExpenseDto,
  ) {
    return this.service.update({ ...user, companyId }, id, body);
  }

  @Delete(':id')
  @Roles(...ALL_ROLES)
  async delete(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.delete({ ...user, companyId }, id);
    return { deleted: true };
  }

  @Post('submit')
  @Roles(...ALL_ROLES)
  async submitForApproval(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Body() body: ExpenseIdsDto,
  ) {
    return this.service.submitForApproval(companyId, user.id, body.expenseIds);
  }

  @Post('approve')
  @Roles(...SITE_LEAD_ROLES)
  async approveExpenses(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Body() body: ExpenseIdsDto,
  ) {
    return this.service.approveExpenses({ ...user, companyId }, body.expenseIds);
  }

  @Post('reject')
  @Roles(...SITE_LEAD_ROLES)
  async rejectExpenses(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Body() body: RejectExpensesDto,
  ) {
    return this.service.rejectExpenses({ ...user, companyId }, body.expenseIds, body.reason);
  }
}
