import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import { CompanyId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ADMIN_ONLY, Roles } from '../../common/decorators/roles.decorator';
import { BankReconciliationService } from './bank-reconciliation.service';
import { ImportBankStatementDto, MatchBankLineDto } from './dto/accounting.dto';
import { parsePaging } from './accounting.controller';

function optionalUuid(name: string, value?: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!isUUID(value)) throw new BadRequestException(`${name} must be a UUID`);
  return value;
}

/** PRD §16.2 "Rapprochement": bank statement import and payment matching. ADMIN only, like accounting. */
@Controller('accounting/reconciliation')
export class BankReconciliationController {
  constructor(private readonly service: BankReconciliationService) {}

  /**
   * Imports a statement: { content, format?: 'camt053' | 'csv', filename? }. camt.053 XML with a
   * DOCTYPE or entity declaration is refused. The same file twice is a 422; lines already imported
   * from an overlapping statement are skipped (duplicateLines).
   */
  @Post('statements')
  @Roles(...ADMIN_ONLY)
  async importStatement(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: ImportBankStatementDto,
    @Req() req: Request,
  ) {
    const result = await this.service.importStatement(companyId, user.id, body);
    // The audit log records request.body: keep the statement's metadata, not its transactions.
    req.body = {
      format: result.statement.format,
      filename: body.filename ?? null,
      sha256: createHash('sha256').update(body.content, 'utf8').digest('hex'),
      sizeChars: body.content.length,
      importedLines: result.importedLines,
    };
    return result;
  }

  @Get('statements')
  @Roles(...ADMIN_ONLY)
  async listStatements(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = parsePaging(page, limit);
    return this.service.listStatements(companyId, p.page, p.limit);
  }

  @Get('statements/:id')
  @Roles(...ADMIN_ONLY)
  async getStatement(@CompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getStatement(companyId, id);
  }

  /** Suggested matches for the unmatched incoming lines; ?statementId= limits to one statement. */
  @Get('suggestions')
  @Roles(...ADMIN_ONLY)
  async suggestions(@CompanyId() companyId: string, @Query('statementId') statementId?: string) {
    return this.service.suggestions(companyId, optionalUuid('statementId', statementId));
  }

  /** Unmatched bank lines, unconfirmed bank-transfer payments and open invoices. */
  @Get('unmatched')
  @Roles(...ADMIN_ONLY)
  async unmatched(@CompanyId() companyId: string, @Query('statementId') statementId?: string) {
    return this.service.unmatched(companyId, optionalUuid('statementId', statementId));
  }

  /** Confirms a match: { paymentId } links a recorded payment, { invoiceId } records the payment. */
  @Post('lines/:id/match')
  @Roles(...ADMIN_ONLY)
  async match(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MatchBankLineDto,
  ) {
    return this.service.match(companyId, user.id, id, body);
  }

  @Post('lines/:id/unmatch')
  @Roles(...ADMIN_ONLY)
  async unmatch(@CompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.unmatch(companyId, id);
  }

  @Post('lines/:id/ignore')
  @Roles(...ADMIN_ONLY)
  async ignore(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.ignore(companyId, user.id, id);
  }
}
