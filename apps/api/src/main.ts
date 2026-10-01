import 'reflect-metadata';
import './config/pg-types';
import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { json } from 'express';
import { AppModule } from './app.module';
import { paginationQuery } from './common/middleware/pagination-query.middleware';
import { requestContext } from './common/middleware/request-context.middleware';
import { deferBody } from './common/middleware/deferred-body.middleware';
import { TRUSTED_PROXIES } from './common/middleware/trust-proxy';

async function bootstrap() {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
    });
  }

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  // req.ip (the anonymous rate-limit key) is the address Railway's edge saw: X-Forwarded-For is
  // read right to left through the trusted infrastructure hops only (edge → Caddy → API); see
  // trust-proxy.ts for the reasoning. Tests run the same policy: their client connects over
  // loopback, so a test can still pick its own anonymous bucket with X-Forwarded-For (J8).
  app.getHttpAdapter().getInstance().set('trust proxy', TRUSTED_PROXIES);

  app.enableCors({
    origin: process.env.WEB_URL?.split(',') ?? true,
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  });

  // Before helmet and every body parser, so each response (body-parser errors included) carries
  // X-Request-Id and is logged. CORS preflights, answered above, are not.
  app.use(requestContext);
  app.use(helmet());
  app.use(paginationQuery);

  // A soumission can hold thousands of lines; only the import route gets a larger body limit, and
  // only once the request is authenticated: the body is left unread here (Nest's 100 kb parser
  // then skips it) and DeferredBodyInterceptor parses it after the guards. The other large
  // uploads already read their bodies in the handler, after the guards: the multipart PDF import
  // (FileInterceptor) and the raw plan file (POST /plans/:id/file, 25 MiB).
  app.use('/catalogue/import', deferBody('application/json', json({ limit: '10mb' })));
  // Bank statements (camt.053 / CSV sent as JSON { content }) can be large too.
  app.use('/accounting/reconciliation/statements', deferBody('application/json', json({ limit: '10mb' })));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.PORT || 3001;
  await app.listen(port);
  Logger.log(`OXACAN API running on port ${port}`, 'Bootstrap');
}

bootstrap();
