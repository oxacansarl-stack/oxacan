import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { join } from 'path';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { CompanyContextGuard } from './common/guards/company-context.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
import { RlsContextMiddleware } from './common/middleware/rls-context.middleware';
import { TenantConnectionHook } from './common/tenant/tenant-connection.hook';
import { DeferredBodyInterceptor } from './common/interceptors/deferred-body.interceptor';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

import { AuthModule } from './modules/auth/auth.module';
import { CompanyModule } from './modules/company/company.module';
import { HealthModule } from './modules/health/health.module';
import { AdminModule } from './modules/admin/admin.module';
import { PlansModule } from './modules/plans/plans.module';
import { CatalogueModule } from './modules/catalogue/catalogue.module';
import { CrmModule } from './modules/crm/crm.module';
import { OffersModule } from './modules/offers/offers.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TimekeepingModule } from './modules/timekeeping/timekeeping.module';
import { HrModule } from './modules/hr/hr.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { InvoicingModule } from './modules/invoicing/invoicing.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { PortalModule } from './modules/portal/portal.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { AlertsModule } from './modules/alerts/alerts.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, '../../../.env'),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DB_HOST'),
        port: parseInt(config.get<string>('DB_PORT', '5432'), 10),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        ssl: config.get<string>('DB_HOST') !== 'localhost'
          ? { rejectUnauthorized: false }
          : false,
        namingStrategy: new SnakeNamingStrategy(),
        autoLoadEntities: true,
        synchronize: false,
        logging: config.get<string>('NODE_ENV') === 'development',
        retryAttempts: 3,
        retryDelay: 3000,
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    ScheduleModule.forRoot(),
    AuthModule,
    CompanyModule,
    HealthModule,
    AdminModule,
    CatalogueModule,
    CrmModule,
    PlansModule,
    OffersModule,
    ContractsModule,
    ProjectsModule,
    TimekeepingModule,
    HrModule,
    ProcurementModule,
    MeetingsModule,
    InvoicingModule,
    AccountingModule,
    SubscriptionModule,
    PortalModule,
    NotificationsModule,
    DocumentsModule,
    AlertsModule,
  ],
  providers: [
    TenantConnectionHook,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CompanyContextGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    // Global interceptors nest in this order (first = outermost). The deferred body (large
    // imports, parsed only after the guards) comes first so the others see it. Idempotency must
    // wrap the envelope so it stores and replays the exact body the client receives.
    { provide: APP_INTERCEPTOR, useClass: DeferredBodyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RlsContextMiddleware).forRoutes('*');
  }
}
