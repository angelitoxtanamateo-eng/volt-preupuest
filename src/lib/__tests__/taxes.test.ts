import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, priceForMargin, priceForMarkup, profitFromPrice } from '../quoteMath';
import { validateQuote, type QuoteInput } from '../validation';
import { buildQuoteMessage, type WaQuote } from '../whatsapp';
import { STATUS_ACTIONS, STATUS_LABEL, effectiveStatus } from '../status';

// Mismos valores que verificó la base de datos (supabase/tests/rls.test.sql): 3001.50 / 300.15 / 672.28 / 3873.63
test('impuestos, igual que la base: 21% sobre (subtotal - descuento + traslado)', () => {
  const t = computeTotals([{ quantity: 3, unitPrice: 1000.5 }], 10, 500, 21, 1000);
  assert.equal(t.subtotal, 3001.5);
  assert.equal(t.discountAmount, 300.15);
  assert.equal(t.net, 3201.35);
  assert.equal(t.taxAmount, 672.28); // 672.2835 -> 672.28
  assert.equal(t.total, 3873.63);
  assert.equal(t.advance, 1000);
  assert.equal(t.balance, 2873.63);
});

test('sin impuesto el total no cambia; anticipo mayor al total deja saldo negativo (la UI lo rechaza)', () => {
  assert.equal(computeTotals([{ quantity: 1, unitPrice: 1000 }], 0, 0, 0).total, 1000);
  assert.equal(computeTotals([{ quantity: 1, unitPrice: 1000 }], 0, 0, 0, 1500).balance, -500);
  assert.equal(computeTotals([{ quantity: 1, unitPrice: 1000 }], 0, 0, 21).total, 1210);
});

test('margen sobre ventas vs recargo sobre costo (no son lo mismo)', () => {
  assert.equal(priceForMarkup(100000, 30), 130000); // recargo 30%: 100.000 -> 130.000
  assert.equal(priceForMargin(100000, 30), 142857.14); // margen 30%: la ganancia es el 30% del PRECIO
  const real = profitFromPrice(100000, 130000);
  assert.equal(real.profit, 30000);
  assert.equal(real.marginPct, 23.08); // con recargo 30% el margen real es 23,08%
  assert.equal(real.markupPct, 30);
  assert.equal(profitFromPrice(100000, 142857.14).marginPct, 30);
});

test('rentabilidad: casos límite', () => {
  assert.equal(priceForMargin(100, 100), null);
  assert.equal(priceForMargin(100, -5), null);
  assert.equal(priceForMarkup(100, -5), null);
  assert.equal(priceForMargin(0, 30), 0);
  assert.equal(profitFromPrice(100, 0).marginPct, null);
  assert.equal(profitFromPrice(0, 100).markupPct, null);
  assert.equal(profitFromPrice(150, 100).profit, -50);
});

const q: QuoteInput = {
  title: 'Con IVA', clientId: '', description: '', discountPct: '10', travelCost: '500', taxPct: '21', advance: '1.000', paymentTerms: '', issueDate: '2026-11-03', validUntil: '',
  items: [{ kind: 'material', description: 'Caño', quantity: '3', unit: 'm', unitPrice: '1000,50', catalogItemId: null }],
};

test('validación de impuesto y anticipo', () => {
  const ok = validateQuote(q);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.quote.tax_pct, 21);
    assert.equal(ok.value.quote.advance_amount, 1000);
  }
  const bad = (x: Partial<QuoteInput>) => { const r = validateQuote({ ...q, ...x }); return r.ok ? {} : r.errors; };
  assert.ok(bad({ taxPct: '101' }).taxPct);
  assert.ok(bad({ taxPct: '-1' }).taxPct);
  assert.ok(bad({ taxPct: '21,555' }).taxPct);
  assert.ok(bad({ advance: '-5' }).advance);
  assert.ok(bad({ advance: '99999' }).advance, 'el anticipo no puede superar el total (3873,63)');
  assert.equal(bad({ advance: '3873,63' }).advance, undefined, 'igual al total es válido');
  assert.equal(validateQuote({ ...q, taxPct: '', advance: '' }).ok, true, 'vacío = 0');
});

const wa: WaQuote = {
  number: 7, title: 'Con IVA', companyName: 'Acme', clientName: 'Ana Pérez', items: [{ description: 'Caño', quantity: 3, unit: 'm', unitPrice: 1000.5 }],
  subtotal: 3001.5, discountPct: 10, discountAmount: 300.15, travelCost: 500, taxPct: 21, taxAmount: 672.28, advanceAmount: 1000, total: 3873.63,
  currency: 'ARS', validUntil: null, paymentTerms: null,
};

test('mensaje de WhatsApp con impuestos, anticipo y saldo', () => {
  const m = buildQuoteMessage(wa);
  assert.match(m, /Impuestos \(21%\)/);
  assert.match(m, /Anticipo/);
  assert.match(m, /Saldo/);
  const plain = buildQuoteMessage({ ...wa, taxPct: undefined, taxAmount: undefined, advanceAmount: undefined });
  assert.doesNotMatch(plain, /Impuestos|Anticipo|Saldo/);
});

test('estado cancelado', () => {
  assert.equal(STATUS_LABEL.cancelled, 'Cancelado');
  assert.ok(STATUS_ACTIONS.draft.includes('cancelled'));
  assert.deepEqual(STATUS_ACTIONS.cancelled, ['draft']);
  assert.equal(effectiveStatus('cancelled', '2020-01-01', '2026-11-03'), 'cancelled');
});
