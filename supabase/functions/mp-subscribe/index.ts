// VOLT Presupuestos · crea el débito automático mensual y devuelve el link de Mercado Pago para autorizarlo
import { admin, APP_URL, asUser, cors, json, mp } from '../_shared/mp.ts'

const NAMES: Record<string, string> = { emprendedor: 'Emprendedor', pro: 'Pro' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  try {
    const { company_id, plan, payer_email } = await req.json()
    if (!company_id || !NAMES[plan]) return json({ error: 'Plan no válido' }, 400)

    const user = asUser(req)
    const { data: u } = await user.auth.getUser()
    if (!u?.user) return json({ error: 'Tenés que iniciar sesión' }, 401)
    const { data: allowed } = await user.rpc('is_admin', { cid: company_id })
    if (!allowed) return json({ error: 'Solo un administrador de la empresa puede contratar un plan' }, 403)

    const db = admin()
    const [{ data: company }, { data: cp }, { data: price }] = await Promise.all([
      db.from('companies').select('id, name').eq('id', company_id).maybeSingle(),
      db.from('company_plans').select('*').eq('company_id', company_id).maybeSingle(),
      db.rpc('plan_price_ars', { p: plan }),
    ])
    if (!company || !price) return json({ error: 'Plan no disponible' }, 400)
    if (cp?.mp_status === 'authorized' && cp?.mp_plan === plan) return json({ error: 'Ya tenés el débito automático activo en este plan' }, 409)

    const email = String(payer_email || u.user.email || '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Ingresá el email de tu cuenta de Mercado Pago' }, 400)

    // Si ya tiene días pagos del mismo plan, el débito arranca cuando vencen
    const today = new Date().toISOString().slice(0, 10)
    const paidUntil = cp?.plan === plan && cp?.plan_expires_at && cp.plan_expires_at > today ? `${cp.plan_expires_at}T12:00:00-03:00` : null

    const pre = await mp('/preapproval', {
      method: 'POST',
      body: JSON.stringify({
        reason: `VOLT Presupuestos ${NAMES[plan]} · ${company.name}`.slice(0, 120),
        external_reference: `vp:${company_id}:${plan}`,
        payer_email: email,
        back_url: `${APP_URL()}/plan?mp=ok`,
        status: 'pending',
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: Number(price),
          currency_id: 'ARS',
          ...(paidUntil ? { start_date: new Date(paidUntil).toISOString() } : {}),
        },
      }),
    })

    await db.from('company_plans').upsert({ company_id }, { onConflict: 'company_id', ignoreDuplicates: true })
    if (cp?.mp_status !== 'authorized') {
      await db.from('company_plans').update({ mp_preapproval_id: pre.id, mp_status: 'pending', mp_plan: plan, mp_payer_email: email }).eq('company_id', company_id)
    }
    return json({ init_point: pre.init_point, id: pre.id })
  } catch (e) {
    const err = e as Error & { status?: number }
    if (err.message === 'MP_NOT_CONFIGURED') return json({ error: 'El débito automático todavía no está habilitado. Usá el pago con link.' }, 503)
    console.error('mp-subscribe', err.message, (err as any).detail)
    return json({ error: err.message || 'No se pudo crear el débito' }, err.status && err.status < 500 ? 400 : 500)
  }
})
