import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeFilename } from '../download';

test('safeFilename', () => {
  assert.equal(safeFilename('Presupuesto 0012 - María López'), 'Presupuesto-0012-Maria-Lopez');
  assert.equal(safeFilename('../../etc/passwd'), 'etc-passwd');
  assert.equal(safeFilename('???'), 'archivo');
  assert.ok(safeFilename('x'.repeat(200)).length <= 60);
});
