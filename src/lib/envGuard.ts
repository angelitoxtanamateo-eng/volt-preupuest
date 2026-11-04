/** Defensa contra el error más grave de un frontend con Supabase: publicar la clave service_role. */

function jwtRole(token: string): string | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

export type EnvCheck = { ok: true } | { ok: false; reason: string };

export function checkSupabaseEnv(url: string | undefined, key: string | undefined): EnvCheck {
  if (!url || !key) {
    return { ok: false, reason: 'Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Copiá .env.example a .env.local y completalo.' };
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url)) {
    return { ok: false, reason: 'VITE_SUPABASE_URL no parece una URL de Supabase (https://<proyecto>.supabase.co).' };
  }
  const role = jwtRole(key);
  if (role === 'service_role' || key.startsWith('sb_secret_')) {
    return { ok: false, reason: 'PELIGRO: configuraste una clave SECRETA (service_role) en el frontend. Usá la clave "anon" y rotá la que expusiste.' };
  }
  return { ok: true };
}
