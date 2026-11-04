/**
 * Planes de VOLT Presupuestos y cobro por Mercado Pago.
 *
 * El link de Mercado Pago es GENERAL: no identifica qué plan compró cada empresa ni le avisa a la app.
 * Por eso la app solo REGISTRA una solicitud (pendiente de verificación) y un administrador de VOLT
 * activa el plan a mano después de comprobar el pago en su cuenta. Nada acá confirma pagos.
 *
 * Los límites y precios se repiten en la base (migración 006, que es la que los hace cumplir).
 */

export type PlanCode = 'free' | 'emprendedor' | 'pro';
export type PaidPlan = Exclude<PlanCode, 'free'>;

/** Link oficial de pago de VOLT Soluciones Digitales. */
export const MP_LINK = 'https://link.mercadopago.com.ar/voltsd';

export interface PlanInfo {
  code: PlanCode;
  name: string;
  /** Precio mensual en pesos argentinos (0 = gratis). Siempre ARS, sin importar la moneda de la empresa. */
  priceArs: number;
  /** Presupuestos por mes; null = ilimitado. */
  limit: number | null;
  features: string[];
}

export const PLANS: Record<PlanCode, PlanInfo> = {
  free: { code: 'free', name: 'Free', priceArs: 0, limit: 10, features: ['Hasta 10 presupuestos por mes', 'Dictado por voz, PDF y WhatsApp', 'Clientes y catálogo'] },
  emprendedor: { code: 'emprendedor', name: 'Emprendedor', priceArs: 9990, limit: 30, features: ['Hasta 30 presupuestos por mes', 'Todo lo del plan Free'] },
  pro: { code: 'pro', name: 'Pro', priceArs: 19990, limit: null, features: ['Presupuestos ilimitados', 'Todo lo del plan Free'] },
};

export const PAID_PLANS: PaidPlan[] = ['emprendedor', 'pro'];

/** "$9.990" (formato argentino, sin decimales). */
export function formatPlanPrice(code: PlanCode): string {
  const n = PLANS[code].priceArs;
  return n === 0 ? '$0' : `$${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n)}`;
}

/** Texto del botón de contratación: "Contratar Emprendedor — $9.990/mes". */
export function hireLabel(code: PaidPlan, renew = false): string {
  return `${renew ? 'Renovar' : 'Contratar'} ${PLANS[code].name} — ${formatPlanPrice(code)}/mes`;
}

/** Lo que devuelve la función my_plan_usage de la base. */
export interface PlanUsage {
  plan: PlanCode;
  effective_plan: PlanCode;
  quote_limit: number | null;
  used: number;
  expires_at: string | null;
  requested_plan: PaidPlan | null;
  requested_at: string | null;
  payment_reference: string | null;
}

export interface UsageState {
  remaining: number | null;
  atLimit: boolean;
  nearLimit: boolean;
}

export function usageState(u: Pick<PlanUsage, 'quote_limit' | 'used'>): UsageState {
  if (u.quote_limit === null) return { remaining: null, atLimit: false, nearLimit: false };
  const remaining = Math.max(0, u.quote_limit - u.used);
  return { remaining, atLimit: remaining === 0, nearLimit: remaining > 0 && remaining <= Math.max(1, Math.floor(u.quote_limit * 0.2)) };
}

/** true si el plan pago ya venció (la base lo trata como Free). */
export function isExpired(u: Pick<PlanUsage, 'plan' | 'effective_plan'>): boolean {
  return u.plan !== 'free' && u.effective_plan === 'free';
}

/** Identificador corto de la cuenta para que VOLT ubique el pago: "VOLT-1A2B3C4D". */
export function accountCode(companyId: string): string {
  return `VOLT-${companyId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** Referencia de pago opcional: máximo 80 caracteres (igual que la base). */
export function validatePaymentReference(raw: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const t = raw.trim();
  if (t.length > 80) return { ok: false, error: 'La referencia es demasiado larga (máximo 80 caracteres).' };
  return { ok: true, value: t || null };
}

export const PENDING_MESSAGE = {
  title: '¡Gracias por elegir VOLT! ⚡',
  body: 'Tu pago está pendiente de verificación.',
  detail: 'Una vez confirmado, activaremos tu plan y podrás disfrutar de todas sus funcionalidades.',
};
