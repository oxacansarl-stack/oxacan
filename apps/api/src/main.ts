import 'reflect-metadata';
import './config/pg-types';
import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { json, NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { paginationQuery } from './common/middleware/pagination-query.middleware';

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

  app.enableCors({
    origin: process.env.WEB_URL?.split(',') ?? true,
    credentials: true,
  });

  app.use(helmet());
  app.use(paginationQuery);

  // A soumission can hold thousands of lines; only the import route gets a larger body limit
  // (registered before Nest's own 100 kb parser, which then skips the already-parsed body).
  // Wrapped so the layer is not named "jsonParser": Nest would take it for its own global parser
  // and not register one for the other routes.
  const importJson = json({ limit: '10mb' });
  app.use('/catalogue/import', (req: Request, res: Response, next: NextFunction) => importJson(req, res, next));

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
