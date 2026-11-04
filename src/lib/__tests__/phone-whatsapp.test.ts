import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWaNumber, isStorablePhone, normalizeArPhone } from '../phone';
import { buildQuoteMessage, buildWhatsAppUrl, type WaQuote } from '../whatsapp';

test('normalizeArPhone: formatos habituales', () => {
  assert.equal(normalizeArPhone('3585625480'), '5493585625480');
  assert.equal(normalizeArPhone('0358 15-5625480'), '5493585625480');
  assert.equal(normalizeArPhone('358 15 5625480'), '5493585625480');
  assert.equal(normalizeArPhone('+54 9 358 562-5480'), '5493585625480');
  assert.equal(normalizeArPhone('+54 358 5625480'), '5493585625480');
  assert.equal(normalizeArPhone('0054 9 358 5625480'), '5493585625480');
  assert.equal(normalizeArPhone('011 15 4444-5555'), '5491144445555');
  assert.equal(normalizeArPhone('11 4444-5555'), '5491144445555');
  assert.equal(normalizeArPhone('(0351) 15-5123456'), '5493515123456');
});

test('normalizeArPhone: inválidos', () => {
  assert.equal(normalizeArPhone(''), null);
  assert.equal(normalizeArPhone('abc'), null);
  assert.equal(normalizeArPhone('12345'), null);
  assert.equal(normalizeArPhone('123456789012345'), null);
});

test('isStorablePhone coincide con el CHECK de la base', () => {
  assert.equal(isStorablePhone('3585625480'), true);
  assert.equal(isStorablePhone('+54 (358) 562-5480'), true);
  assert.equal(isStorablePhone('12345'), false); // muy corto
  assert.equal(isStorablePhone('358-ABC-5480'), false); // letras
  assert.equal(isStorablePhone('1'.repeat(21)), false);
});

test('formatWaNumber', () => {
  assert.equal(formatWaNumber('5493585625480'), '+54 9 358 562-5480');
  assert.equal(formatWaNumber('5491144445555'), '+54 9 11 4444-5555');
});

const quote: WaQuote = {
  number: 12,
  title: 'Cambio de cañería en cocina',
  companyName: 'Plomería Pérez',
  clientName: 'María López',
  items: [
    { description: 'Caño de 20', quantity: 6, unit: 'm', unitPrice: 1500.5 },
    { description: 'Jornal', quantity: 2, unit: 'jornal', unitPrice: 25000 },
  ],
  subtotal: 59003,
  discountPct: 10,
  discountAmount: 5900.3,
  travelCost: 1500,
  total: 54602.7,
  currency: 'ARS',
  validUntil: '2026-11-18',
  paymentTerms: '50% de anticipo.',
};

test('buildQuoteMessage incluye lo esencial', () => {
  const m = buildQuoteMessage(quote).replace(/[  ]/g, ' ');
  assert.match(m, /^Hola María! Te paso el presupuesto N° 0012 de Plomería Pérez\./);
  assert.match(m, /\*Cambio de cañería en cocina\*/);
  assert.match(m, /• 6 m Caño de 20: \$ 9\.003,00/);
  assert.match(m, /Descuento \(10%\): -\$ 5\.900,30/);
  assert.match(m, /Traslado: \$ 1\.500,00/);
  assert.match(m, /\*TOTAL: \$ 54\.602,70\*/);
  assert.match(m, /Válido hasta el 18\/11\/2026\./);
  assert.match(m, /Condiciones de pago: 50% de anticipo\./);
});

test('buildQuoteMessage sin descuento ni traslado no muestra subtotal', () => {
  const m = buildQuoteMessage({ ...quote, discountAmount: 0, discountPct: 0, travelCost: 0, clientName: null });
  assert.ok(!m.includes('Subtotal'));
  assert.ok(m.startsWith('Hola! '));
});

test('buildQuoteMessage recorta ítems si el mensaje es demasiado largo', () => {
  const items = Array.from({ length: 80 }, (_, i) => ({ description: `Ítem número ${i} con una descripción larga`, quantity: 1, unit: 'u', unitPrice: 1000 }));
  const m = buildQuoteMessage({ ...quote, items });
  assert.ok(encodeURIComponent(m).length <= 1800);
  assert.match(m, /ítem\(s\) más/);
  assert.match(m, /TOTAL/); // el total nunca se pierde
});

test('buildWhatsAppUrl', () => {
  const u = buildWhatsAppUrl('3585625480', 'Hola & chau\n¿ok?');
  assert.equal(u, 'https://wa.me/5493585625480?text=' + encodeURIComponent('Hola & chau\n¿ok?'));
  assert.ok(u.includes('%0A') && u.includes('%26'));
  assert.equal(buildWhatsAppUrl(null, 'x'), 'https://wa.me/?text=x');
  assert.equal(buildWhatsAppUrl('123', 'x'), 'https://wa.me/?text=x'); // teléfono inválido: no inventa destinatario
});
