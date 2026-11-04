import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, formatQuantity, formatQuoteNumber, lineTotalCents, parseNumberInput, toCents } from '../money';
import { computeTotals, marginPct } from '../quoteMath';

const clean = (s: string) => s.replace(/[  ]/g, ' ');

test('toCents redondea sin errores de coma flotante', () => {
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents(1.005), 101);
  assert.equal(toCents(19.99), 1999);
  assert.equal(toCents(0), 0);
});

test('lineTotalCents replica round(cantidad*precio, 2) de la base', () => {
  assert.equal(lineTotalCents(6, 1500.5), 900300);
  assert.equal(lineTotalCents(2, 25000), 5000000);
  assert.equal(lineTotalCents(0.333, 100), 3330);
  assert.equal(lineTotalCents(3, 0.1), 30);
  assert.equal(lineTotalCents(1.5, 999.99), 150000 - 2 + 1 - 0); // 1499.985 -> 1499.99 (redondeo half-up)
});

test('formatMoney (es-AR)', () => {
  assert.equal(clean(formatMoney(1500.5)), '$ 1.500,50');
  assert.equal(clean(formatMoney(0)), '$ 0,00');
  assert.match(clean(formatMoney(1234.5, 'USD')), /1\.234,50/);
  assert.equal(clean(formatMoney(10, 'ZZ')), 'ZZ 10.00'); // moneda inválida no rompe
});

test('formatQuantity y formatQuoteNumber', () => {
  assert.equal(formatQuantity(6), '6');
  assert.equal(formatQuantity(2.5), '2,5');
  assert.equal(formatQuoteNumber(12), '0012');
  assert.equal(formatQuoteNumber(12345), '12345');
});

test('parseNumberInput con convención argentina', () => {
  assert.equal(parseNumberInput('1.500,50'), 1500.5);
  assert.equal(parseNumberInput('1500.5'), 1500.5);
  assert.equal(parseNumberInput('3.500'), 3500);
  assert.equal(parseNumberInput('15,5'), 15.5);
  assert.equal(parseNumberInput('$ 2.000'), 2000);
  assert.equal(parseNumberInput('1,234,567'), 1234567);
  assert.equal(parseNumberInput('-5'), -5);
  assert.equal(parseNumberInput('10%'), 10);
  assert.equal(parseNumberInput('abc'), null);
  assert.equal(parseNumberInput(''), null);
  assert.equal(parseNumberInput('1.2.3x'), null);
});

test('computeTotals coincide con los valores verificados en la base (59003.00 / 5900.30 / 54602.70)', () => {
  const t = computeTotals([{ quantity: 6, unitPrice: 1500.5 }, { quantity: 2, unitPrice: 25000 }], 10, 1500);
  assert.deepEqual(t, { subtotal: 59003, discountAmount: 5900.3, travelCost: 1500, total: 54602.7 });
});

test('computeTotals: casos borde', () => {
  assert.deepEqual(computeTotals([], 0, 0), { subtotal: 0, discountAmount: 0, travelCost: 0, total: 0 });
  assert.equal(computeTotals([{ quantity: 1, unitPrice: 100 }], 100, 0).total, 0);
  assert.equal(computeTotals([{ quantity: 3, unitPrice: 0.1 }], 0, 0).total, 0.3);
  assert.equal(computeTotals([{ quantity: 1, unitPrice: 333.33 }], 12.5, 0).discountAmount, 41.67); // 41.66625 -> 41.67
});

test('marginPct', () => {
  assert.equal(marginPct(1500, 900), 40);
  assert.equal(marginPct(0, 10), null);
  assert.equal(marginPct(100, 120), -20);
});
