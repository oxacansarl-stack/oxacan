import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { Public } from '../../common/decorators/public.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @Public()
  @SkipEnvelope()
  async check() {
    const db = await this.checkDatabase();
    const storage = await this.checkStorage();

    return {
      status: db.ok && storage.ok ? 'healthy' : 'degraded',
      version: '0.1.0',
      uptime: process.uptime(),
      checks: { db, storage },
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<{
    ok: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  private async checkStorage(): Promise<{
    ok: boolean;
    latencyMs: number;
  }> {
    const supabaseUrl = this.config.get('SUPABASE_URL');
    const serviceKey = this.config.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      return { ok: true, latencyMs: 0 };
    }

    const start = Date.now();
    try {
      const supabase = createClient(supabaseUrl, serviceKey);
      await supabase.storage.listBuckets();
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }
}
