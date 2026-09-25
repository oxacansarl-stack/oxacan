import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CatalogueService } from './catalogue.service';
import { CurrentUser, Roles } from '../auth/jwt-auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import type { JwtPayload } from '../auth/auth.types';

const Import = z.object({
  csv: z.string().min(1),
  mapping: z.object({ code: z.string(), label: z.string(), unit: z.string(), material: z.string().optional(), labour: z.string().optional(), subcontract: z.string().optional(), unitPrice: z.string().optional(), chapter: z.string().optional(), delimiter: z.enum([',', ';', '\t']).optional(), decimal: z.enum(['.', ',']).optional() }),
});
const Composed = z.object({ code: z.string().min(1), label: z.string().min(1), unit: z.string().min(1), components: z.array(z.object({ catalogueCode: z.string(), quantity: z.number().positive() })).min(1) });

@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly svc: CatalogueService) {}
  @Roles('DIRIGEANT', 'CHEF_PROJET') @Post('import')
  import(@CurrentUser() u: JwtPayload, @Body(new ZodPipe(Import)) b: z.infer<typeof Import>) { return this.svc.import(u.tenantId, b.csv, b.mapping); }
  @Get() list(@CurrentUser() u: JwtPayload, @Query('q') q?: string, @Query('chapter') chapter?: string) { return this.svc.list(u.tenantId, q, chapter); }
  @Roles('DIRIGEANT', 'CHEF_PROJET') @Post('composed')
  composed(@CurrentUser() u: JwtPayload, @Body(new ZodPipe(Composed)) b: z.infer<typeof Composed>) { return this.svc.createComposed(u.tenantId, b); }
  @Get('composed/:id/cost') cost(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.composedCost(u.tenantId, id); }
}
