import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { OffersService } from './offers.service';
import { CurrentUser, Roles } from '../auth/jwt-auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import type { JwtPayload } from '../auth/auth.types';

const Line = z.object({ kind: z.enum(['CATALOGUE', 'COMPOSED', 'CUSTOM']), code: z.string().min(1), label: z.string().optional(), unit: z.string().optional(), quantity: z.number().nonnegative(), material: z.number().int().nonnegative().optional(), labour: z.number().int().nonnegative().optional(), subcontract: z.number().int().nonnegative().optional(), factorOverride: z.number().positive().optional(), excluded: z.boolean().optional() });
const OfferSchema = z.object({ clientName: z.string().min(1), title: z.string().min(1), sellFactor: z.number().positive().optional(), vatRate: z.number().min(0).max(100).optional(), discountPercent: z.number().min(0).max(100).optional(),
  zones: z.array(z.object({ label: z.string().min(1), cfcs: z.array(z.object({ code: z.string(), label: z.string(), chapters: z.array(z.object({ code: z.string(), label: z.string(), lines: z.array(Line) })) })) })).min(1) });
const Status = z.object({ status: z.enum(['PREPARATION', 'ENVOYEE', 'NEGOCIATION', 'ADJUGEE', 'PERDUE']) });

@Controller('offers')
export class OffersController {
  constructor(private readonly svc: OffersService) {}
  @Roles('DIRIGEANT', 'CHEF_PROJET') @Post() create(@CurrentUser() u: JwtPayload, @Body(new ZodPipe(OfferSchema)) b: z.infer<typeof OfferSchema>) { return this.svc.create(u.tenantId, b); }
  @Get() list(@CurrentUser() u: JwtPayload) { return this.svc.list(u.tenantId); }
  @Get(':id') get(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.get(u.tenantId, id); }
  @Get(':id/totals') totals(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.compute(u.tenantId, id); }
  @Roles('DIRIGEANT', 'CHEF_PROJET') @Patch(':id/status') status(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body(new ZodPipe(Status)) b: z.infer<typeof Status>) { return this.svc.setStatus(u.tenantId, id, b.status); }
}
