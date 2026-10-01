import dataSource from './data-source';
import { syncContextKey } from './context-key';
import { contextSecret } from '../common/tenant/context-signature';

async function main() {
  contextSecret(); // fail before migrating, see predeploy.ts
  await dataSource.initialize();
  const applied = await dataSource.runMigrations({ transaction: 'each' });
  for (const m of applied) console.log(`applied ${m.name}`);
  if (applied.length === 0) console.log('no pending migrations');
  await syncContextKey(dataSource);
  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
