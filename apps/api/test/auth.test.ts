import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateKeyPair, importJWK, SignJWT, KeyLike } from 'jose';
import jwt from 'jsonwebtoken';
import { apiClient, tokenFor, USER_A, MOCK_SUPABASE_URL, MOCK_SUPABASE_KEY_FILE } from './setup';

let supabaseKey: KeyLike | Uint8Array;
let foreignKey: KeyLike;

function supabaseToken(overrides: { iss?: string; aud?: string; sub?: string; exp?: string } = {}, key = supabaseKey) {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setSubject(overrides.sub ?? USER_A.authId)
    .setIssuer(overrides.iss ?? `${MOCK_SUPABASE_URL}/auth/v1`)
    .setAudience(overrides.aud ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? '5m')
    .sign(key);
}

async function status(token: string) {
  return (await apiClient(token).get('/auth/profile')).status;
}

beforeAll(async () => {
  supabaseKey = await importJWK(JSON.parse(readFileSync(MOCK_SUPABASE_KEY_FILE, 'utf8')), 'ES256');
  foreignKey = (await generateKeyPair('ES256')).privateKey;
});

describe('Authentication', () => {
  it('accepts a Supabase ES256 session token verified via JWKS', async () => {
    const res = await apiClient(await supabaseToken()).get('/auth/profile');
    expect(res.status).toBe(200);
    expect(res.data.id).toBe(USER_A.id);
  });

  it('rejects Supabase tokens with the wrong issuer, audience, signer or expiry', async () => {
    expect(await status(await supabaseToken({ iss: 'https://evil.example/auth/v1' }))).toBe(401);
    expect(await status(await supabaseToken({ aud: 'anon' }))).toBe(401);
    expect(await status(await supabaseToken({}, foreignKey))).toBe(401);
    expect(await status(await supabaseToken({ exp: '-1m' }))).toBe(401);
  });

  it('rejects a valid token for a user unknown to OXACAN', async () => {
    expect(await status(await supabaseToken({ sub: '12345678-1234-4234-8234-123456789012' }))).toBe(401);
  });

  it('accepts dev HS256 tokens only when signed with JWT_SECRET', async () => {
    expect(await status(tokenFor(USER_A.authId))).toBe(200);
    expect(await status(jwt.sign({ sub: USER_A.authId }, 'wrong-secret'))).toBe(401);
  });

  it('rejects unsigned tokens and malformed subjects', async () => {
    const unsigned =
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') +
      '.' +
      Buffer.from(JSON.stringify({ sub: USER_A.authId })).toString('base64url') +
      '.';
    expect(await status(unsigned)).toBe(401);
    expect(await status(jwt.sign({ sub: "x' OR 1=1" }, process.env.JWT_SECRET!))).toBe(401);
    expect(await status('not-a-jwt')).toBe(401);
  });
});
