import { fromCents, lineTotalCents, toCents } from './money';

export interface MathItem {
  quantity: number;
  unitPrice: number;
}

export interface Totals {
  subtotal: number;
  discountAmount: number;
  travelCost: number;
  total: number;
}

/**
 * Misma fórmula que la base de datos (trigger quotes_calc_totals):
 *   discount = round(subtotal * pct / 100, 2);  total = subtotal - discount + traslado
 * Se usa SOLO para mostrar el total mientras se edita; el valor que cuenta es el que calcula la base.
 */
export function computeTotals(items: MathItem[], discountPct: number, travelCost: number): Totals {
  const subtotalCents = items.reduce((acc, it) => acc + lineTotalCents(it.quantity, it.unitPrice), 0);
  const pctHundredths = Math.round(discountPct * 100); // numeric(5,2)
  const discountCents = Math.round((subtotalCents * pctHundredths) / 10000);
  const travelCents = toCents(travelCost);
  return {
    subtotal: fromCents(subtotalCents),
    discountAmount: fromCents(discountCents),
    travelCost: fromCents(travelCents),
    total: fromCents(subtotalCents - discountCents + travelCents),
  };
}

/** Margen sobre el precio de venta, en %. null si no hay precio. */
export function marginPct(unitPrice: number, unitCost: number): number | null {
  if (!(unitPrice > 0)) return null;
  return Math.round(((unitPrice - unitCost) / unitPrice) * 1000) / 10;
}
