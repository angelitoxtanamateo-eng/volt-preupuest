import { createClient } from '@supabase/supabase-js';
import { checkSupabaseEnv } from './envGuard';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Si la configuración es inválida (o peligrosa) la app muestra el motivo y NO crea un cliente real. */
export const envCheck = checkSupabaseEnv(url, key);

export const supabase = createClient(
  envCheck.ok ? (url as string) : 'http://localhost:54321',
  envCheck.ok ? (key as string) : 'sin-configurar',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
