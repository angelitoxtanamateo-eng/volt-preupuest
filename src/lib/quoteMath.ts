import { fromCents, lineTotalCents, toCents } from './money';

export interface MathItem {
  quantity: number;
  unitPrice: number;
}

export interface Totals {
  subtotal: number;
  discountAmount: number;
  travelCost: number;
  /** Subtotal - descuento + traslado: la base sobre la que se calcula el impuesto. */
  net: number;
  taxAmount: number;
  total: number;
  advance: number;
  /** Total - anticipo. Si el anticipo supera el total queda negativo (la base no deja guardarlo). */
  balance: number;
}

/**
 * Misma fórmula que la base de datos (trigger quotes_calc_totals):
 *   descuento = round(subtotal * pct / 100, 2)
 *   neto      = subtotal - descuento + traslado
 *   impuesto  = round(neto * impuesto% / 100, 2)
 *   total     = neto + impuesto;   saldo = total - anticipo
 * Se usa SOLO para mostrar el total mientras se edita; el valor que cuenta es el que calcula la base.
 */
export function computeTotals(items: MathItem[], discountPct: number, travelCost: number, taxPct = 0, advance = 0): Totals {
  const subtotalCents = items.reduce((acc, it) => acc + lineTotalCents(it.quantity, it.unitPrice), 0);
  const discountCents = Math.round((subtotalCents * Math.round(discountPct * 100)) / 10000); // numeric(5,2)
  const travelCents = toCents(travelCost);
  const netCents = subtotalCents - discountCents + travelCents;
  const taxCents = Math.round((netCents * Math.round(taxPct * 100)) / 10000);
  const totalCents = netCents + taxCents;
  const advanceCents = toCents(advance);
  return {
    subtotal: fromCents(subtotalCents),
    discountAmount: fromCents(discountCents),
    travelCost: fromCents(travelCents),
    net: fromCents(netCents),
    taxAmount: fromCents(taxCents),
    total: fromCents(totalCents),
    advance: fromCents(advanceCents),
    balance: fromCents(totalCents - advanceCents),
  };
}

/** Margen sobre el precio de venta, en %. null si no hay precio. */
export function marginPct(unitPrice: number, unitCost: number): number | null {
  if (!(unitPrice > 0)) return null;
  return Math.round(((unitPrice - unitCost) / unitPrice) * 1000) / 10;
}

/**
 * Rentabilidad. Dos conceptos que se confunden seguido:
 *  - MARGEN sobre ventas: ganancia / precio de venta.   precio = costo / (1 - margen)
 *  - RECARGO sobre costo (markup): ganancia / costo.    precio = costo * (1 + recargo)
 * Con costo $100.000: margen 30% => precio $142.857,14 (ganancia 30% del precio); recargo 30% => precio $130.000 (margen real 23,08%).
 */
export interface Profit {
  cost: number;
  price: number;
  profit: number;
  /** Ganancia / precio, en %. null si el precio es 0. */
  marginPct: number | null;
  /** Ganancia / costo, en %. null si el costo es 0. */
  markupPct: number | null;
}

export function profitFromPrice(cost: number, price: number): Profit {
  const c = toCents(cost);
  const p = toCents(price);
  return {
    cost: fromCents(c),
    price: fromCents(p),
    profit: fromCents(p - c),
    marginPct: p > 0 ? Math.round(((p - c) / p) * 10000) / 100 : null,
    markupPct: c > 0 ? Math.round(((p - c) / c) * 10000) / 100 : null,
  };
}

/** Precio que deja el MARGEN deseado sobre ventas (0 <= margen < 100). null si no es posible. */
export function priceForMargin(cost: number, marginPctWanted: number): number | null {
  if (!(cost >= 0) || !(marginPctWanted >= 0) || marginPctWanted >= 100) return null;
  return fromCents(Math.round(toCents(cost) / (1 - marginPctWanted / 100)));
}

/** Precio que aplica un RECARGO sobre el costo. null si no es posible. */
export function priceForMarkup(cost: number, markupPctWanted: number): number | null {
  if (!(cost >= 0) || !(markupPctWanted >= 0)) return null;
  return fromCents(Math.round((toCents(cost) * (100 + markupPctWanted)) / 100));
}
