import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Public() @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'ok', version: '0.1.0', time: new Date().toISOString() };
  }
}
