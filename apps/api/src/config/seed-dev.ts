import { sign } from 'jsonwebtoken';
import dataSource from './data-source';

const COMPANY_ID = 'd0000000-0000-4000-8000-000000000001';

const USERS = [
  { id: 'd0000000-0000-4000-8000-000000000011', authId: 'd0000000-0000-4000-8000-000000000021', email: 'admin@demo-bau.ch', first: 'Anna', last: 'Admin', role: 'ADMIN' },
  { id: 'd0000000-0000-4000-8000-000000000012', authId: 'd0000000-0000-4000-8000-000000000022', email: 'pm@demo-bau.ch', first: 'Peter', last: 'Projekt', role: 'PROJECT_MANAGER' },
  { id: 'd0000000-0000-4000-8000-000000000013', authId: 'd0000000-0000-4000-8000-000000000023', email: 'chef@demo-bau.ch', first: 'Luca', last: 'Chef', role: 'TEAM_LEADER' },
  { id: 'd0000000-0000-4000-8000-000000000014', authId: 'd0000000-0000-4000-8000-000000000024', email: 'worker@demo-bau.ch', first: 'Marco', last: 'Maurer', role: 'WORKER' },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data in production.');
  }
  await dataSource.initialize();
  await dataSource.transaction(async (m) => {
    await m.query(`SELECT set_config('app.rls_bypass', 'on', true)`);
    await m.query(
      `INSERT INTO company (id, name, legal_name, city, canton, vat_number)
       VALUES ($1, 'Demo Bau AG', 'Demo Bau AG', 'Lausanne', 'VD', 'CHE-000.000.000 TVA')
       ON CONFLICT (id) DO NOTHING`,
      [COMPANY_ID],
    );
    for (const u of USERS) {
      await m.query(
        `INSERT INTO app_user (id, company_id, supabase_auth_id, email, first_name, last_name, role, licence_tier)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'saas')
         ON CONFLICT (supabase_auth_id) DO NOTHING`,
        [u.id, COMPANY_ID, u.authId, u.email, u.first, u.last, u.role],
      );
    }
  });
  await dataSource.destroy();

  console.log('Seeded company "Demo Bau AG" with one user per role.');
  console.log('Dev tokens (12h). In the browser console on the web app run:');
  for (const u of USERS) {
    const token = sign({ sub: u.authId }, process.env.JWT_SECRET!, { expiresIn: '12h' });
    console.log(`\n# ${u.role} (${u.email})\nlocalStorage.setItem('oxacan_token', '${token}')`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
