import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountCode, formatPlanPrice, hireLabel, isExpired, MP_LINK, PENDING_MESSAGE, PLANS, usageState, validatePaymentReference, type PlanUsage,
} from '../plans';
import { humanizeError } from '../errors';

test('precios, límites y link oficial exactamente como se definieron', () => {
  assert.equal(MP_LINK, 'https://link.mercadopago.com.ar/voltsd');
  assert.equal(PLANS.free.priceArs, 0);
  assert.equal(PLANS.free.limit, 10);
  assert.equal(PLANS.emprendedor.priceArs, 9990);
  assert.equal(PLANS.emprendedor.limit, 30);
  assert.equal(PLANS.pro.priceArs, 19990);
  assert.equal(PLANS.pro.limit, null);
});

test('textos de los botones de contratación', () => {
  assert.equal(formatPlanPrice('emprendedor'), '$9.990');
  assert.equal(formatPlanPrice('pro'), '$19.990');
  assert.equal(formatPlanPrice('free'), '$0');
  assert.equal(hireLabel('emprendedor'), 'Contratar Emprendedor — $9.990/mes');
  assert.equal(hireLabel('pro'), 'Contratar Pro — $19.990/mes');
  assert.equal(hireLabel('pro', true), 'Renovar Pro — $19.990/mes');
});

test('mensaje de pago pendiente, tal como se pidió', () => {
  assert.equal(PENDING_MESSAGE.title, '¡Gracias por elegir VOLT! ⚡');
  assert.equal(PENDING_MESSAGE.body, 'Tu pago está pendiente de verificación.');
  assert.equal(PENDING_MESSAGE.detail, 'Una vez confirmado, activaremos tu plan y podrás disfrutar de todas sus funcionalidades.');
});

test('uso del mes: restante, límite alcanzado y cerca del límite', () => {
  assert.deepEqual(usageState({ quote_limit: 10, used: 3 }), { remaining: 7, atLimit: false, nearLimit: false });
  assert.deepEqual(usageState({ quote_limit: 10, used: 8 }), { remaining: 2, atLimit: false, nearLimit: true });
  assert.deepEqual(usageState({ quote_limit: 10, used: 10 }), { remaining: 0, atLimit: true, nearLimit: false });
  assert.equal(usageState({ quote_limit: 10, used: 14 }).remaining, 0);
  assert.deepEqual(usageState({ quote_limit: null, used: 500 }), { remaining: null, atLimit: false, nearLimit: false });
});

test('plan vencido se detecta (la base lo trata como Free)', () => {
  const base: Pick<PlanUsage, 'plan' | 'effective_plan'> = { plan: 'pro', effective_plan: 'free' };
  assert.equal(isExpired(base), true);
  assert.equal(isExpired({ plan: 'pro', effective_plan: 'pro' }), false);
  assert.equal(isExpired({ plan: 'free', effective_plan: 'free' }), false);
});

test('identificador de cuenta y referencia de pago', () => {
  assert.equal(accountCode('1a2b3c4d-1111-2222-3333-444455556666'), 'VOLT-1A2B3C4D');
  assert.deepEqual(validatePaymentReference('  Op 123 '), { ok: true, value: 'Op 123' });
  assert.deepEqual(validatePaymentReference('   '), { ok: true, value: null });
  assert.equal(validatePaymentReference('x'.repeat(81)).ok, false);
  assert.equal(validatePaymentReference('x'.repeat(80)).ok, true);
});

test('los mensajes de la base sobre planes se muestran tal cual', () => {
  assert.match(humanizeError({ message: 'Llegaste al límite de 10 presupuestos de este mes en el plan Free. Pasate a un plan superior para seguir creando.' }), /^Llegaste al límite/);
  assert.equal(humanizeError({ message: 'Solo un administrador de la empresa puede solicitar un plan' }), 'Solo un administrador de la empresa puede solicitar un plan');
  assert.equal(humanizeError({ message: 'Indicá una fecha de vencimiento de hoy en adelante' }), 'Indicá una fecha de vencimiento de hoy en adelante');
});
