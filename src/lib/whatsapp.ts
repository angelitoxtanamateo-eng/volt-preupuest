import { formatDateAR } from './dates';
import { formatMoney, formatQuantity, formatQuoteNumber, lineTotalCents, fromCents } from './money';
import { normalizeArPhone } from './phone';

export interface WaQuoteItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

export interface WaQuote {
  number: number;
  title: string;
  companyName: string;
  clientName?: string | null;
  items: WaQuoteItem[];
  subtotal: number;
  discountPct: number;
  discountAmount: number;
  travelCost: number;
  total: number;
  currency: string;
  validUntil: string | null;
  paymentTerms: string | null;
}

/** Largo máximo del texto ya codificado en la URL: algunos clientes cortan enlaces muy largos. */
const MAX_ENCODED = 1800;

function render(q: WaQuote, maxItems: number): string {
  const money = (n: number) => formatMoney(n, q.currency);
  const lines: string[] = [];
  const first = q.clientName?.trim().split(/\s+/)[0];
  lines.push(`Hola${first ? ' ' + first : ''}! Te paso el presupuesto N° ${formatQuoteNumber(q.number)} de ${q.companyName}.`);
  lines.push('');
  if (q.title.trim()) lines.push(`*${q.title.trim()}*`);

  const shown = q.items.slice(0, maxItems);
  for (const it of shown) {
    const line = fromCents(lineTotalCents(it.quantity, it.unitPrice));
    lines.push(`• ${formatQuantity(it.quantity)} ${it.unit} ${it.description}: ${money(line)}`);
  }
  if (q.items.length > shown.length) lines.push(`… y ${q.items.length - shown.length} ítem(s) más (detalle completo en el PDF).`);

  lines.push('');
  if (q.discountAmount > 0 || q.travelCost > 0) lines.push(`Subtotal: ${money(q.subtotal)}`);
  if (q.discountAmount > 0) lines.push(`Descuento (${formatQuantity(q.discountPct)}%): -${money(q.discountAmount)}`);
  if (q.travelCost > 0) lines.push(`Traslado: ${money(q.travelCost)}`);
  lines.push(`*TOTAL: ${money(q.total)}*`);

  if (q.validUntil) {
    lines.push('');
    lines.push(`Válido hasta el ${formatDateAR(q.validUntil)}.`);
  }
  if (q.paymentTerms?.trim()) lines.push(`Condiciones de pago: ${q.paymentTerms.trim()}`);
  lines.push('');
  lines.push('Cualquier duda, avisame.');
  return lines.join('\n');
}

/** Arma el mensaje; si es muy largo, recorta ítems hasta que entre en una URL razonable. */
export function buildQuoteMessage(q: WaQuote, maxItems = 12): string {
  let n = Math.min(maxItems, q.items.length);
  let text = render(q, n);
  while (n > 0 && encodeURIComponent(text).length > MAX_ENCODED) {
    n -= 1;
    text = render(q, n);
  }
  return text;
}

/**
 * URL de wa.me con el mensaje ya escrito. NO envía nada: abre WhatsApp para que la persona toque "Enviar".
 * Si el teléfono no es válido, abre WhatsApp sin destinatario para que elija el contacto.
 */
export function buildWhatsAppUrl(phone: string | null | undefined, text: string): string {
  const wa = phone ? normalizeArPhone(phone) : null;
  return `https://wa.me/${wa ?? ''}?text=${encodeURIComponent(text)}`;
}
