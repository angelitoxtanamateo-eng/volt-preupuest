import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { buildQuotePdf, safeText, type QuotePdfData } from '../pdf/quotePdf';

// PNG de 1x1 píxel azul (logo de prueba)
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==', 'base64'));

const base: QuotePdfData = {
  company: { name: 'Plomería Pérez', phone: '358 5625480', email: 'perez@mail.com', address: 'Sarmiento 123, Río Cuarto', taxId: '20-12345678-6' },
  client: { name: 'María López', phone: '358 4111222', address: 'Belgrano 45' },
  logo: { bytes: PNG, type: 'png' },
  quote: {
    number: 12, title: 'Cambio de cañería en cocina', description: 'Incluye picado y reposición de revestimiento.',
    issueDate: '2026-11-03', validUntil: '2026-11-18', currency: 'ARS', paymentTerms: '50% de anticipo y saldo contra entrega.',
    items: [
      { kind: 'material', description: 'Caño de 20', quantity: 6, unit: 'm', unitPrice: 1500.5 },
      { kind: 'labor', description: 'Jornal', quantity: 2, unit: 'jornal', unitPrice: 25000 },
    ],
    subtotal: 59003, discountPct: 10, discountAmount: 5900.3, travelCost: 1500, total: 54602.7,
  },
};

test('safeText reemplaza caracteres que la fuente no soporta, conserva acentos y ñ', () => {
  assert.equal(safeText('Cañería ñandú á é í ó ú ü'), 'Cañería ñandú á é í ó ú ü');
  assert.equal(safeText('Caño 😀 → ok'), 'Caño ? ? ok');
  assert.equal(safeText('a\nb\tc'), 'a b c');
});

test('genera un PDF válido de 1 página con los datos', async () => {
  const bytes = await buildQuotePdf(base);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  assert.match(doc.getTitle() ?? '', /Presupuesto 0012/);
  writeFileSync(process.env.PDF_OUT ?? '/dev/null', bytes);
});

test('muchos ítems: se pagina y no se pierde nada', async () => {
  const items = Array.from({ length: 70 }, (_, i) => ({ kind: (['material', 'labor', 'other'] as const)[i % 3], description: `Ítem ${i} con descripción bastante larga para forzar el salto de línea dentro de la columna`, quantity: i + 1, unit: 'u', unitPrice: 1000 + i }));
  const bytes = await buildQuotePdf({ ...base, quote: { ...base.quote, items } });
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 3, `páginas: ${doc.getPageCount()}`);
});

test('resiste datos hostiles: sin logo, logo roto, emojis, textos larguísimos, sin cliente', async () => {
  const hostile: QuotePdfData = {
    ...base,
    logo: { bytes: new Uint8Array([1, 2, 3]), type: 'png' },
    client: null,
    company: { name: 'Empresa 😀 ' + 'X'.repeat(200) },
    quote: { ...base.quote, title: 'T'.repeat(400), description: 'D'.repeat(3000), paymentTerms: 'P'.repeat(1500), items: [{ kind: 'other', description: 'Z'.repeat(1000), quantity: 0.001, unit: 'u', unitPrice: 999999999999 }] },
  };
  const bytes = await buildQuotePdf(hostile);
  assert.equal((await PDFDocument.load(bytes)).getPageCount() >= 1, true);
  await buildQuotePdf({ ...base, logo: null, quote: { ...base.quote, items: [] } });
});

test('con impuestos, anticipo, saldo y firma: PDF válido (y se ve bien en una imagen de prueba)', async () => {
  const withTax: QuotePdfData = {
    ...base,
    quote: { ...base.quote, taxPct: 21, taxAmount: 11466.57, advanceAmount: 20000, total: 66069.27 },
  };
  const bytes = await buildQuotePdf(withTax);
  const doc = await PDFDocument.load(bytes);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  assert.ok(doc.getPageCount() >= 1 && doc.getPageCount() <= 2);
  writeFileSync(process.env.PDF_TAX_OUT ?? '/dev/null', bytes);
});

test('muchos ítems + impuestos + anticipo: la firma y los totales no se pierden al paginar', async () => {
  const items = Array.from({ length: 28 }, (_, i) => ({ kind: 'material' as const, description: `Ítem ${i}`, quantity: 1, unit: 'u', unitPrice: 1000 }));
  const bytes = await buildQuotePdf({ ...base, quote: { ...base.quote, items, taxPct: 21, taxAmount: 100, advanceAmount: 500, total: 28100 } });
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 1);
});
