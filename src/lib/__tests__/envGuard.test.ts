import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSupabaseEnv } from '../envGuard';

const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.firma`;
const URL = 'https://abcd1234.supabase.co';

test('acepta la clave anon', () => assert.equal(checkSupabaseEnv(URL, jwt('anon')).ok, true));
test('rechaza la clave service_role (JWT y formato nuevo)', () => {
  const r = checkSupabaseEnv(URL, jwt('service_role'));
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /SECRETA/);
  assert.equal(checkSupabaseEnv(URL, 'sb_secret_abc').ok, false);
});
test('faltantes y URL rara', () => {
  assert.equal(checkSupabaseEnv(undefined, jwt('anon')).ok, false);
  assert.equal(checkSupabaseEnv(URL, undefined).ok, false);
  assert.equal(checkSupabaseEnv('https://evil.example.com', jwt('anon')).ok, false);
  assert.equal(checkSupabaseEnv('http://localhost:54321', jwt('anon')).ok, true);
});
test('clave con formato raro no rompe', () => assert.equal(checkSupabaseEnv(URL, 'sb_publishable_xxx').ok, true));
