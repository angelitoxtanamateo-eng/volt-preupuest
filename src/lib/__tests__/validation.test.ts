import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidCuit, validateCatalogItem, validateClient, validateCompany, validateInvitation, validateLogin, validatePassword, validateQuote, validateRegister, type QuoteInput } from '../validation';

const ok = <T>(r: { ok: boolean } & Record<string, unknown>): T => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as unknown as { value: T }).value;
};
const errs = (r: { ok: boolean } & Record<string, unknown>) => {
  assert.equal(r.ok, false);
  return (r as unknown as { errors: Record<string, string> }).errors;
};

test('CUIT con dígito verificador', () => {
  assert.equal(isValidCuit('20-12345678-6'), true);
  assert.equal(isValidCuit('30-71234567-1'), true);
  assert.equal(isValidCuit('30-71234567-2'), false); // dígito verificador incorrecto
  assert.equal(isValidCuit('20123456786'), true);
  assert.equal(isValidCuit('2012345678'), false);
  assert.equal(isValidCuit(''), false);
});

test('login y registro', () => {
  assert.equal(ok<{ email: string }>(validateLogin({ email: ' A@B.com ', password: 'x' })).email, 'a@b.com');
  assert.ok(errs(validateLogin({ email: 'nope', password: '' })).email);
  assert.equal(validatePassword('1234567'), 'Usá al menos 8 caracteres.');
  assert.ok(validatePassword('aaaaaaaa'));
  assert.equal(validatePassword('clave-segura-1'), null);
  const e = errs(validateRegister({ fullName: 'J', email: 'x', password: 'abc', confirm: 'abd' }));
  assert.ok(e.fullName && e.email && e.password && e.confirm);
  ok(validateRegister({ fullName: 'Juan Pérez', email: 'j@p.com', password: 'clave-segura-1', confirm: 'clave-segura-1' }));
});

test('cliente: nombre obligatorio y teléfono según el CHECK de la base', () => {
  assert.ok(errs(validateClient({ name: '  ', phone: '', address: '', notes: '' })).name);
  assert.ok(errs(validateClient({ name: 'Ana', phone: 'abc123', address: '', notes: '' })).phone);
  const v = ok<{ name: string; phone: string | null; address: string | null }>(validateClient({ name: ' Ana ', phone: '358 5625480', address: '', notes: '' }));
  assert.deepEqual([v.name, v.phone, v.address], ['Ana', '358 5625480', null]);
});

test('empresa', () => {
  const base = { name: 'Plomería Pérez', phone: '', email: '', address: '', taxId: '', currency: 'ARS', defaultValidityDays: '15', paymentTerms: '50% anticipo' };
  ok(validateCompany(base));
  const e = errs(validateCompany({ ...base, name: 'P', email: 'x', taxId: '123', currency: 'peso', defaultValidityDays: '0' }));
  assert.ok(e.name && e.email && e.taxId && e.currency && e.defaultValidityDays);
  assert.equal(ok<{ tax_id: string | null }>(validateCompany({ ...base, taxId: '20-12345678-6' })).tax_id, '20-12345678-6');
});

test('catálogo: precio y costo', () => {
  const v = ok<{ data: { unit_price: number }; cost: number | null }>(validateCatalogItem({ kind: 'material', name: 'Caño', unit: 'm', unitPrice: '1.500,50', unitCost: '', active: true }));
  assert.equal(v.data.unit_price, 1500.5);
  assert.equal(v.cost, null);
  const e = errs(validateCatalogItem({ kind: 'material', name: '', unit: '', unitPrice: '-3', unitCost: 'x', active: true }));
  assert.ok(e.name && e.unit && e.unitPrice && e.unitCost);
  assert.ok(errs(validateCatalogItem({ kind: 'labor', name: 'a', unit: 'hs', unitPrice: '', unitCost: '', active: true })).unitPrice);
  assert.ok(errs(validateCatalogItem({ kind: 'labor', name: 'a', unit: 'hs', unitPrice: '10,555', unitCost: '', active: true })).unitPrice); // 3 decimales
});

const q: QuoteInput = {
  title: 'Cañería', clientId: 'c1', description: '', discountPct: '10', travelCost: '1.500', paymentTerms: '', issueDate: '2026-11-03', validUntil: '2026-11-18',
  items: [{ kind: 'material', description: 'Caño', quantity: '6', unit: 'm', unitPrice: '1500,50', catalogItemId: null }],
};

test('presupuesto válido produce valores tipados', () => {
  const v = ok<{ quote: { discount_pct: number; travel_cost: number; client_id: string; title: string }; items: { quantity: number; unit_price: number }[] }>(validateQuote(q));
  assert.equal(v.quote.discount_pct, 10);
  assert.equal(v.quote.travel_cost, 1500);
  assert.equal(v.items[0].unit_price, 1500.5);
  assert.equal(ok<{ quote: { title: string } }>(validateQuote({ ...q, title: ' ' })).quote.title, 'Presupuesto');
});

test('presupuesto inválido: reporta cada campo', () => {
  assert.ok(errs(validateQuote({ ...q, items: [] })).items);
  assert.ok(errs(validateQuote({ ...q, discountPct: '101' })).discountPct);
  assert.ok(errs(validateQuote({ ...q, discountPct: '-1' })).discountPct);
  assert.ok(errs(validateQuote({ ...q, travelCost: '-5' })).travelCost);
  assert.ok(errs(validateQuote({ ...q, issueDate: '2026-02-30' })).issueDate);
  assert.ok(errs(validateQuote({ ...q, validUntil: '2026-11-01' })).validUntil);
  const e = errs(validateQuote({ ...q, items: [{ ...q.items[0], description: ' ', quantity: '0', unitPrice: 'x' }] }));
  assert.ok(e['items.0.description'] && e['items.0.quantity'] && e['items.0.unitPrice']);
  assert.ok(errs(validateQuote({ ...q, items: [{ ...q.items[0], quantity: '1,2345' }] }))['items.0.quantity']);
  assert.ok(errs(validateQuote({ ...q, items: [{ ...q.items[0], description: 'x'.repeat(301) }] }))['items.0.description']);
});

test('invitación', () => {
  assert.equal(ok<{ email: string }>(validateInvitation({ email: ' Eva@Acme.com ', role: 'employee' })).email, 'eva@acme.com');
  assert.ok(errs(validateInvitation({ email: 'eva', role: 'employee' })).email);
});
