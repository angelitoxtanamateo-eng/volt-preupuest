// Utilidades compartidas: Mercado Pago (solo servidor) + Supabase con service_role
import { createClient } from 'jsr:@supabase/supabase-js@2'

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

export const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

/** Cliente con la sesión del usuario que llama (respeta RLS) */
export const asUser = (req: Request) =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  })

export const APP_URL = () => Deno.env.get('APP_URL') ?? 'https://voltpresupuestos.netlify.app'

export async function mp(path: string, init: RequestInit = {}) {
  const token = Deno.env.get('MP_ACCESS_TOKEN')
  if (!token) throw new Error('MP_NOT_CONFIGURED')
  const res = await fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!res.ok) {
    const msg = data?.message || data?.error || `Mercado Pago respondió ${res.status}`
    const err = new Error(msg) as Error & { status?: number; detail?: unknown }
    err.status = res.status; err.detail = data
    throw err
  }
  return data
}
