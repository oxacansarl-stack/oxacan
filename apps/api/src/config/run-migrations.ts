import dataSource from './data-source';

async function main() {
  await dataSource.initialize();
  const applied = await dataSource.runMigrations({ transaction: 'each' });
  for (const m of applied) console.log(`applied ${m.name}`);
  if (applied.length === 0) console.log('no pending migrations');
  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
