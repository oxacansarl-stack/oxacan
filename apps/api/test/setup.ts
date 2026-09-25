import { execSync } from 'node:child_process';
export default function setup() {
  const url = process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:5432/oxacan_test?schema=public';
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-12';
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { stdio: 'ignore', env: { ...process.env, DATABASE_URL: url } });
}
