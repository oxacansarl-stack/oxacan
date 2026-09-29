// ============================================================
// OXACAN E2E Test Setup
// ============================================================
// In a real environment, this would initialise a test database,
// run migrations, and seed the company/user fixtures.
// For now it exports deterministic UUIDs used by the test suite.

export const TEST_COMPANY_ID = '00000000-0000-0000-0000-000000000001';
export const TEST_USER_ID = '00000000-0000-0000-0000-000000000002';
export const TEST_ADMIN_USER_ID = '00000000-0000-0000-0000-000000000003';

// Base URL for the NestJS test server
export const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';

// Helper: build Authorization header (JWT would come from auth endpoint)
export function authHeader(token = 'test-jwt-token'): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

// Helper: generate a deterministic UUID from a seed number
export function testUUID(seed: number): string {
  const hex = seed.toString(16).padStart(12, '0');
  return `00000000-0000-0000-0000-${hex}`;
}
