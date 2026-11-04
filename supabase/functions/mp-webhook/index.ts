// VOLT Presupuestos · notificaciones de Mercado Pago (llegan reenviadas desde el webhook de VOLT Turnos
// o directo). Nunca confiamos en el cuerpo: se vuelve a consultar a Mercado Pago con nuestro token.
import { admin, mp } from '../_shared/mp.ts'

const ok = () => new Response('ok', { status: 200 })

async function handlePreapproval(id: string) {
  const pre = await mp(`/preapproval/${id}`)
  const ref: string = pre.external_reference ?? ''
  if (!ref.startsWith('vp:')) return 'ignore'
  const [, companyId, plan] = ref.split(':')
  const db = admin()
  const { data: cp } = await db.from('company_plans').select('*').eq('company_id', companyId).maybeSingle()
  if (!cp) return 'ignore'
  if (pre.status === 'authorized') {
    if (cp.mp_preapproval_id && cp.mp_preapproval_id !== id && cp.mp_status === 'authorized') {
      try { await mp(`/preapproval/${cp.mp_preapproval_id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) }) } catch (e) { console.error('cancel old', (e as Error).message) }
    }
    await db.from('company_plans').update({ mp_preapproval_id: id, mp_status: 'authorized', mp_plan: plan, mp_payer_email: pre.payer_email ?? cp.mp_payer_email }).eq('company_id', companyId)
    if (cp.mp_status !== 'authorized') await db.from('plan_events').insert({ company_id: companyId, actor_id: null, event: 'mp_authorized', to_plan: plan })
  } else if (id === cp.mp_preapproval_id) {
    await db.from('company_plans').update({ mp_status: pre.status === 'cancelled' ? 'cancelled' : pre.status === 'paused' ? 'paused' : 'pending' }).eq('company_id', companyId)
  }
  return 'done'
}

async function handleAuthorizedPayment(id: string) {
  const ap = await mp(`/authorized_payments/${id}`)
  const pre = await mp(`/preapproval/${ap.preapproval_id}`)
  const ref: string = pre.external_reference ?? ''
  if (!ref.startsWith('vp:')) return 'ignore'
  const [, companyId, plan] = ref.split(':')
  const paymentOk = ap.payment?.status === 'approved' || (ap.status === 'processed' && !ap.payment?.status)
  if (!paymentOk || !ap.payment?.id) return 'pending'
  const { error } = await admin().rpc('mp_apply_payment', { p_company: companyId, p_plan: plan, p_payment_id: String(ap.payment.id), p_amount: Number(ap.transaction_amount) })
  if (error) throw new Error(error.message)
  return 'paid'
}

Deno.serve(async (req) => {
  if (req.method === 'GET') return ok()
  const raw = await req.text()
  let body: any = {}
  try { body = raw ? JSON.parse(raw) : {} } catch { /* vacío */ }
  const url = new URL(req.url)
  const type = String(body.type ?? body.topic ?? url.searchParams.get('type') ?? url.searchParams.get('topic') ?? '')
  const id = String(body.data?.id ?? url.searchParams.get('data.id') ?? url.searchParams.get('id') ?? '')
  if (!id) return ok()
  try {
    let r = 'ignore'
    if (type.includes('preapproval')) r = await handlePreapproval(id)
    else if (type.includes('authorized_payment')) r = await handleAuthorizedPayment(id)
    console.log('mp-webhook', type, id, r)
    return ok()
  } catch (e) {
    const err = e as Error
    if (err.message === 'MP_NOT_CONFIGURED') return ok()
    console.error('mp-webhook error', type, id, err.message)
    return new Response('error', { status: 500 })
  }
})
