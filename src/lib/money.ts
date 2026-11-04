/** Dinero: todo cálculo se hace en CENTAVOS enteros para evitar errores de coma flotante. */

export const toCents = (amount: number): number => Math.round((amount + Number.EPSILON * Math.sign(amount)) * 100);
export const fromCents = (cents: number): number => cents / 100;

/** round(cantidad * precio, 2) igual que la columna generada `line_total` de la base, en centavos. */
export function lineTotalCents(quantity: number, unitPrice: number): number {
  const qtyMilli = Math.round(quantity * 1000); // numeric(12,3)
  const priceCents = toCents(unitPrice); // numeric(14,2)
  return Math.round((qtyMilli * priceCents) / 1000);
}

/** Formatea con la moneda de la empresa (ARS => "$ 1.500,50"). */
export function formatMoney(amount: number, currency = 'ARS', locale = 'es-AR'): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Formatea cantidades: 6 -> "6", 2.5 -> "2,5", 0.333 -> "0,333". */
export function formatQuantity(q: number, locale = 'es-AR'): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(q);
}

/**
 * Interpreta lo que el usuario escribe en un campo numérico, con convención argentina:
 * "1.500,50" -> 1500.5 | "1500.5" -> 1500.5 | "3.500" -> 3500 | "15,5" -> 15.5 | "$ 2.000" -> 2000.
 * Devuelve null si no es un número válido.
 */
export function parseNumberInput(text: string): number | null {
  const t = text.replace(/[$\s]/g, '').replace(/%$/, '');
  if (!/^-?\d+(?:[.,]\d+)*$/.test(t)) return null;
  const neg = t.startsWith('-');
  const body = neg ? t.slice(1) : t;
  const hasDot = body.includes('.');
  const hasComma = body.includes(',');
  let normalized: string;
  if (hasDot && hasComma) {
    const dec = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    normalized = body.split(thou).join('').replace(dec, '.');
  } else if (hasComma) {
    normalized = (body.match(/,/g) ?? []).length === 1 ? body.replace(',', '.') : body.split(',').join('');
  } else if (hasDot) {
    normalized = /^\d{1,3}(\.\d{3})+$/.test(body) ? body.split('.').join('') : body;
  } else {
    normalized = body;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/** 12 -> "0012" (número de presupuesto como se muestra en el PDF y en WhatsApp). */
export const formatQuoteNumber = (n: number): string => String(n).padStart(4, '0');
