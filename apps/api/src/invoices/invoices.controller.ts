import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { InvoicesService } from './invoices.service';
import { CurrentUser, Roles } from '../auth/jwt-auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import type { JwtPayload } from '../auth/auth.types';

const Create = z.object({ kind: z.enum(['ACOMPTE', 'ONE_SHOT', 'FINALE']), totalExclVat: z.number().int().positive(), vatRate: z.number().min(0).max(100), dueDays: z.number().int().positive().optional() });
const FromSituation = z.object({ situationId: z.string().uuid(), dueDays: z.number().int().positive().optional() });

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly svc: InvoicesService) {}
  @Get() list(@CurrentUser() u: JwtPayload) { return this.svc.list(u.tenantId); }
  @Get('portfolio') portfolio(@CurrentUser() u: JwtPayload) { return this.svc.portfolio(u.tenantId); }
  @Roles('DIRIGEANT', 'CHEF_PROJET') @Post() create(@CurrentUser() u: JwtPayload, @Body(new ZodPipe(Create)) b: z.infer<typeof Create>) { return this.svc.create(u.tenantId, b); }
  @Roles('DIRIGEANT', 'CHEF_PROJET') @Post('from-situation') fromSituation(@CurrentUser() u: JwtPayload, @Body(new ZodPipe(FromSituation)) b: z.infer<typeof FromSituation>) { return this.svc.fromSituation(u.tenantId, b.situationId, b.dueDays); }
  @Roles('DIRIGEANT') @Post(':id/credit-note') credit(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.creditNote(u.tenantId, id); }
  @Roles('DIRIGEANT', 'CHEF_PROJET') @Post(':id/paid') paid(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.markPaid(u.tenantId, id); }
}
