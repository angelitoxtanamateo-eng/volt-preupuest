// VOLT Presupuestos · cancela el débito automático (el plan sigue hasta la fecha pagada)
import { admin, asUser, cors, json, mp } from '../_shared/mp.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  try {
    const { company_id } = await req.json()
    const user = asUser(req)
    const { data: u } = await user.auth.getUser()
    if (!u?.user) return json({ error: 'Tenés que iniciar sesión' }, 401)
    const { data: allowed } = await user.rpc('is_admin', { cid: company_id })
    if (!allowed) return json({ error: 'Sin permiso' }, 403)
    const db = admin()
    const { data: cp } = await db.from('company_plans').select('mp_preapproval_id').eq('company_id', company_id).maybeSingle()
    if (!cp?.mp_preapproval_id) return json({ error: 'No tenés débito automático' }, 400)
    await mp(`/preapproval/${cp.mp_preapproval_id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) })
    await db.from('company_plans').update({ mp_status: 'cancelled' }).eq('company_id', company_id)
    await db.from('plan_events').insert({ company_id, actor_id: u.user.id, event: 'mp_cancelled' })
    return json({ ok: true })
  } catch (e) {
    const err = e as Error
    if (err.message === 'MP_NOT_CONFIGURED') return json({ error: 'Mercado Pago no está configurado' }, 503)
    console.error('mp-cancel', err.message)
    return json({ error: err.message }, 500)
  }
})
