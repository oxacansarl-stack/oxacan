import './pg-types';
import dataSource from './data-source';
import { contextSecret } from '../common/tenant/context-signature';
import { RetentionService } from '../modules/admin/retention.service';

/**
 * Applies the data retention policy (PRD §25, see modules/admin/retention.policy.ts) once and
 * exits: a Railway cron service runs it daily with
 *   node apps/api/dist/config/run-retention.js
 * Connected as the schema owner (DB_MIGRATION_*, like run-migrations); every table forces RLS,
 * so the run sets the signed system context (bypass on) with SET LOCAL inside its transaction.
 *
 * Options: --dry-run (count only, change nothing), --company <uuid> (one company only).
 * Exit code 1 on failure (the transaction is rolled back: nothing is half-applied).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv: string[]): { dryRun: boolean; companyId?: string } {
  let dryRun = false;
  let companyId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--company') companyId = argv[++i];
    else if (arg.startsWith('--company=')) companyId = arg.slice('--company='.length);
    else throw new Error(`Unknown argument ${arg} (expected --dry-run, --company <uuid>)`);
  }
  if (companyId !== undefined && !UUID_RE.test(companyId)) throw new Error('--company must be a UUID');
  return { dryRun, companyId: companyId?.toLowerCase() };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  contextSecret(); // fail before connecting without a signing key
  await dataSource.initialize();
  try {
    const report = await new RetentionService(dataSource).run(options);
    for (const rule of report.rules) {
      console.log(`${report.dryRun ? '[dry run] ' : ''}${rule.key}: ${rule.affected}`);
    }
    // One JSON line for log-based alerting / history.
    console.log(JSON.stringify({ retention: { ...report, protectedTables: undefined } }));
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  // TypeORM errors carry the failed query and its parameters; print only the message.
  console.error(`retention failed: ${err instanceof Error ? err.message : String(err)}`);
  try {
    // Reported when SENTRY_DSN is set (the cron service shares the API's variables).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/node');
    if (process.env.SENTRY_DSN) {
      Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development' });
      Sentry.captureException(err);
      Sentry.flush(5000).finally(() => process.exit(1));
      return;
    }
  } catch {
    /* fall through */
  }
  process.exit(1);
});
