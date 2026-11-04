import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, formatDateAR, isIsoDate, todayIso } from '../dates';
import { csvCell, toCsv } from '../csv';
import { humanizeError } from '../errors';
import { effectiveStatus, STATUS_ACTIONS } from '../status';

test('fechas civiles', () => {
  assert.equal(addDays('2026-11-03', 15), '2026-11-18');
  assert.equal(addDays('2026-12-25', 10), '2027-01-04');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(formatDateAR('2026-11-03'), '03/11/2026');
  assert.equal(formatDateAR(null), '');
  assert.equal(isIsoDate('2026-02-29'), false);
  assert.equal(isIsoDate('2028-02-29'), true);
  assert.equal(todayIso(new Date(2026, 10, 3, 23, 59)), '2026-11-03');
  assert.throws(() => addDays('mañana', 1));
});

test('CSV: escapes, separador y protección contra fórmulas', () => {
  assert.equal(csvCell('hola; "mundo"'), '"hola; ""mundo"""');
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell(1500.5), '1500,5');
  assert.equal(csvCell(-5), '-5'); // un número negativo NO es una fórmula
  assert.equal(csvCell(null), '');
  const csv = toCsv([{ a: 'x', b: 2 }], [{ header: 'A', value: (r) => r.a }, { header: 'B', value: (r) => r.b }]);
  assert.equal(csv, '﻿A;B\r\nx;2\r\n');
});

test('errores traducidos al español', () => {
  assert.match(humanizeError({ message: 'Invalid login credentials' }), /incorrectos/);
  assert.match(humanizeError(new TypeError('Failed to fetch')), /conexión/);
  assert.match(humanizeError({ code: '42501', message: 'new row violates row-level security policy' }), /permiso/);
  assert.match(humanizeError({ code: '23505', message: 'duplicate key' }), /Ya existe/);
  assert.equal(humanizeError({ message: 'La empresa debe conservar al menos un administrador' }), 'La empresa debe conservar al menos un administrador');
  assert.match(humanizeError(null), /inesperado/);
  assert.match(humanizeError({ message: 'algo raro' }), /algo raro/);
});

test('estado efectivo: enviado + vigencia vencida = vencido', () => {
  assert.equal(effectiveStatus('sent', '2026-11-01', '2026-11-03'), 'expired');
  assert.equal(effectiveStatus('sent', '2026-11-03', '2026-11-03'), 'sent');
  assert.equal(effectiveStatus('accepted', '2026-01-01', '2026-11-03'), 'accepted');
  assert.equal(effectiveStatus('draft', null, '2026-11-03'), 'draft');
  assert.ok(STATUS_ACTIONS.draft.includes('sent'));
});
