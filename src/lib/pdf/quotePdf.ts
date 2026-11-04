/**
 * Generador del PDF del presupuesto (pdf-lib): corre en el navegador, sin servidor.
 * Es un PRESUPUESTO, no una factura: el pie lo aclara.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { formatDateAR } from '../dates';
import { fromCents, formatMoney, formatQuantity, formatQuoteNumber, lineTotalCents } from '../money';

export interface PdfItem {
  kind: 'material' | 'labor' | 'other';
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

export interface QuotePdfData {
  company: { name: string; phone?: string | null; email?: string | null; address?: string | null; taxId?: string | null };
  /** Logo ya convertido a PNG o JPG (la app lo normaliza al subirlo). */
  logo?: { bytes: Uint8Array; type: 'png' | 'jpg' } | null;
  client?: { name: string; phone?: string | null; address?: string | null } | null;
  quote: {
    number: number;
    title: string;
    description?: string | null;
    issueDate: string;
    validUntil?: string | null;
    currency: string;
    paymentTerms?: string | null;
    items: PdfItem[];
    subtotal: number;
    discountPct: number;
    discountAmount: number;
    travelCost: number;
    total: number;
  };
}

const NAVY = rgb(0.043, 0.122, 0.294); // #0B1F4B
const CYAN = rgb(0.055, 0.647, 0.914); // #0EA5E9
const GRAY = rgb(0.4, 0.45, 0.52);
const LIGHT = rgb(0.94, 0.97, 1);
const LINE = rgb(0.85, 0.89, 0.94);

const W = 595.28;
const H = 841.89;
const M = 40;
const BOTTOM = 60;

/** Las fuentes estándar solo codifican WinAnsi: lo demás (emojis, flechas) se reemplaza para no romper el PDF. */
export function safeText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF€‘’“”–—•…]/gu, '?');
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of safeText(text).split(/ {2,}|\n/)) {
    let line = '';
    for (const word of para.split(' ')) {
      // palabra más larga que el ancho: se corta
      let w = word;
      while (font.widthOfTextAtSize(w, size) > maxWidth) {
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxWidth) cut--;
        if (line) { lines.push(line); line = ''; }
        lines.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) line = test;
      else { if (line) lines.push(line); line = w; }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

const KIND_TITLE = { material: 'Materiales', labor: 'Mano de obra', other: 'Otros conceptos' } as const;

export async function buildQuotePdf(data: QuotePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(safeText(`Presupuesto ${formatQuoteNumber(data.quote.number)} - ${data.company.name}`));
  doc.setProducer('VOLT Presupuestos Inteligentes');
  doc.setCreator('VOLT Presupuestos Inteligentes');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const money = (n: number) => safeText(formatMoney(n, data.quote.currency)).replace(/[  ]/g, ' ');

  let logo: PDFImage | null = null;
  if (data.logo) {
    try {
      logo = data.logo.type === 'png' ? await doc.embedPng(data.logo.bytes) : await doc.embedJpg(data.logo.bytes);
    } catch {
      logo = null; // un logo dañado no impide generar el presupuesto
    }
  }

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const text = (t: string, x: number, yy: number, size: number, f: PDFFont = font, color = NAVY) =>
    page.drawText(safeText(t), { x, y: yy, size, font: f, color });
  const right = (t: string, xr: number, yy: number, size: number, f: PDFFont = font, color = NAVY) =>
    text(t, xr - f.widthOfTextAtSize(safeText(t), size), yy, size, f, color);

  // Columnas de la tabla
  const colQty = M + 300; // derecha de "Cant."
  const colUnit = M + 322;
  const colPrice = M + 430; // derecha de "P. unit."
  const colTotal = W - M; // derecha de "Subtotal"
  const descWidth = 285;

  const newPage = (continued: boolean) => {
    page = doc.addPage([W, H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: NAVY });
    page.drawRectangle({ x: 0, y: H - 11, width: W, height: 3, color: CYAN });
    y = H - 40;
    if (continued) {
      text(`${data.company.name} - Presupuesto N° ${formatQuoteNumber(data.quote.number)} (continuación)`, M, y, 9, bold, GRAY);
      y -= 24;
    }
  };

  const tableHeader = () => {
    page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 18, color: NAVY });
    text('Descripción', M + 6, y, 9, bold, rgb(1, 1, 1));
    right('Cant.', colQty, y, 9, bold, rgb(1, 1, 1));
    text('Unidad', colUnit, y, 9, bold, rgb(1, 1, 1));
    right('P. unit.', colPrice, y, 9, bold, rgb(1, 1, 1));
    right('Subtotal', colTotal - 6, y, 9, bold, rgb(1, 1, 1));
    y -= 22;
  };

  const ensure = (needed: number) => {
    if (y - needed < BOTTOM) {
      newPage(true);
      tableHeader();
    }
  };

  // ---------- Encabezado ----------
  newPage(false);
  let headX = M;
  if (logo) {
    const maxH = 56;
    const maxW = 120;
    const s = Math.min(maxW / logo.width, maxH / logo.height, 1);
    page.drawImage(logo, { x: M, y: y - logo.height * s + 8, width: logo.width * s, height: logo.height * s });
    headX = M + logo.width * s + 14;
  }
  text(data.company.name, headX, y, 16, bold);
  let hy = y - 15;
  const meta = [data.company.address, data.company.phone && `Tel: ${data.company.phone}`, data.company.email, data.company.taxId && `CUIT: ${data.company.taxId}`].filter(Boolean) as string[];
  for (const m of meta) {
    text(m, headX, hy, 9, font, GRAY);
    hy -= 12;
  }
  right('PRESUPUESTO', W - M, y, 11, bold, CYAN);
  right(`N° ${formatQuoteNumber(data.quote.number)}`, W - M, y - 18, 16, bold);
  right(`Fecha: ${formatDateAR(data.quote.issueDate)}`, W - M, y - 33, 9, font, GRAY);
  if (data.quote.validUntil) right(`Válido hasta: ${formatDateAR(data.quote.validUntil)}`, W - M, y - 45, 9, bold, NAVY);
  y = Math.min(hy, y - 62) - 8;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: LINE });
  y -= 22;

  // ---------- Cliente y trabajo ----------
  if (data.client) {
    text('CLIENTE', M, y, 8, bold, CYAN);
    y -= 14;
    text(data.client.name, M, y, 11, bold);
    y -= 13;
    for (const l of [data.client.phone && `Tel: ${data.client.phone}`, data.client.address].filter(Boolean) as string[]) {
      text(l, M, y, 9, font, GRAY);
      y -= 12;
    }
    y -= 8;
  }
  text('TRABAJO', M, y, 8, bold, CYAN);
  y -= 15;
  for (const l of wrap(data.quote.title, bold, 12, W - 2 * M)) {
    text(l, M, y, 12, bold);
    y -= 15;
  }
  if (data.quote.description) {
    for (const l of wrap(data.quote.description, font, 9, W - 2 * M).slice(0, 6)) {
      text(l, M, y, 9, font, GRAY);
      y -= 12;
    }
  }
  y -= 12;

  // ---------- Detalle por tipo ----------
  tableHeader();
  for (const kind of ['material', 'labor', 'other'] as const) {
    const items = data.quote.items.filter((i) => i.kind === kind);
    if (!items.length) continue;
    ensure(40);
    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 15, color: LIGHT });
    text(KIND_TITLE[kind], M + 6, y, 9, bold, NAVY);
    y -= 19;
    let kindCents = 0;
    for (const it of items) {
      const lines = wrap(it.description, font, 9.5, descWidth);
      ensure(lines.length * 12 + 8);
      const lc = lineTotalCents(it.quantity, it.unitPrice);
      kindCents += lc;
      lines.forEach((l, idx) => text(l, M + 6, y - idx * 12, 9.5));
      right(formatQuantity(it.quantity), colQty, y, 9.5);
      text(it.unit, colUnit, y, 9.5, font, GRAY);
      right(money(it.unitPrice), colPrice, y, 9.5);
      right(money(fromCents(lc)), colTotal - 6, y, 9.5);
      y -= lines.length * 12;
      page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.4, color: LINE });
      y -= 6;
    }
    right(`Subtotal ${KIND_TITLE[kind].toLowerCase()}: ${money(fromCents(kindCents))}`, colTotal - 6, y, 9, bold, GRAY);
    y -= 20;
  }

  // ---------- Totales ----------
  ensure(110);
  const tx = W - M - 210;
  const row = (label: string, value: string) => {
    text(label, tx, y, 10, font, GRAY);
    right(value, colTotal - 6, y, 10);
    y -= 16;
  };
  row('Subtotal', money(data.quote.subtotal));
  if (data.quote.discountAmount > 0) row(`Descuento (${formatQuantity(data.quote.discountPct)}%)`, `-${money(data.quote.discountAmount)}`);
  if (data.quote.travelCost > 0) row('Traslado', money(data.quote.travelCost));
  y -= 18; // deja aire para que la caja del total no pise la última fila
  page.drawRectangle({ x: tx - 8, y: y - 8, width: 218 + 8, height: 28, color: NAVY });
  text('TOTAL', tx, y + 2, 12, bold, rgb(1, 1, 1));
  right(money(data.quote.total), colTotal - 6, y + 2, 13, bold, rgb(1, 1, 1));
  y -= 40;

  // ---------- Condiciones ----------
  if (data.quote.paymentTerms?.trim()) {
    const lines = wrap(data.quote.paymentTerms, font, 9.5, W - 2 * M);
    ensure(lines.length * 12 + 24);
    text('CONDICIONES DE PAGO', M, y, 8, bold, CYAN);
    y -= 14;
    for (const l of lines) {
      text(l, M, y, 9.5);
      y -= 12;
    }
  }

  // ---------- Pie en todas las páginas ----------
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 44 }, end: { x: W - M, y: 44 }, thickness: 0.5, color: LINE });
    p.drawText(safeText('Presupuesto sin valor fiscal: no constituye una factura.'), { x: M, y: 30, size: 8, font, color: GRAY });
    const pg = `Página ${i + 1} de ${pages.length}`;
    p.drawText(pg, { x: W - M - font.widthOfTextAtSize(pg, 8), y: 30, size: 8, font, color: GRAY });
    p.drawText('Generado con VOLT Presupuestos Inteligentes', { x: M, y: 19, size: 7, font, color: GRAY });
  });

  return doc.save();
}
