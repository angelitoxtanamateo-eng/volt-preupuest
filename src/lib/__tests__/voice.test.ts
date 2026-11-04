import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapseNumbers, readNumber, tokenize } from '../voice/numbers';
import { matchCatalog, significantTokens, type CatalogEntry } from '../voice/catalogMatch';
import { parseDictation } from '../voice/parser';

/** Lee un número escrito/dictado completo; devuelve su valor. */
const num = (text: string): number | null => {
  const r = readNumber(tokenize(text), 0);
  return r ? r.v : null;
};

test('números en palabras', () => {
  assert.equal(num('cero'), 0);
  assert.equal(num('quince'), 15);
  assert.equal(num('veintiún'), 21);
  assert.equal(num('treinta y cinco'), 35);
  assert.equal(num('noventa y nueve'), 99);
  assert.equal(num('cien'), 100);
  assert.equal(num('ciento veinte'), 120);
  assert.equal(num('doscientos cincuenta y seis'), 256);
  assert.equal(num('mil'), 1000);
  assert.equal(num('dos mil quinientos'), 2500);
  assert.equal(num('quince mil'), 15000);
  assert.equal(num('ciento veinte mil trescientos'), 120300);
  assert.equal(num('un millón'), 1_000_000);
  assert.equal(num('dos millones quinientos mil'), 2_500_000);
  assert.equal(num('tres y medio'), 3.5);
});

test('números en dígitos y mixtos', () => {
  assert.equal(num('15.000'), 15000);
  assert.equal(num('1.500,50'), 1500.5);
  assert.equal(num('$8500'), 8500);
  assert.equal(num('$ 8.500'), 8500);
  assert.equal(num('15 mil'), 15000);
  assert.equal(num('2 mil quinientos'), 2500);
  assert.equal(num('2,5'), 2.5);
  assert.equal(num('4 y medio'), 4.5);
});

test('lo que NO es un número', () => {
  assert.equal(num('caño'), null);
  assert.equal(num('un termotanque'), null); // "un" es artículo
  assert.equal(num('una llave'), null);
  assert.equal(num('y'), null);
  assert.equal(num(''), null);
});

test('"por ciento" no se confunde con el número 100', () => {
  const t = collapseNumbers(tokenize('diez por ciento'));
  assert.deepEqual(t.map((x) => (x.t === 'num' ? x.v : (x as { n: string }).n)), [10, 'por', 'ciento']);
});

test('tokenizer: porcentaje, separadores y símbolos', () => {
  const t = tokenize('10% de descuento; $ 5.000, ok!');
  assert.equal(t[0].t, 'num');
  assert.equal((t[0] as { pct: boolean }).pct, true);
  assert.ok(t.some((x) => x.t === 'sep'));
});

// ---------------- Parser ----------------

test('ejemplo de referencia del diseño (dígitos)', () => {
  const r = parseDictation('Cambio de cañería en cocina, 6 metros de caño de 20, 4 codos, dos jornales, traslado 15 mil');
  assert.equal(r.title, 'Cambio de cañería en cocina');
  assert.equal(r.travelCost, 15000);
  assert.deepEqual(
    r.items.map((i) => [i.quantity, i.unit, i.description, i.kind]),
    [
      [6, 'm', 'Caño de 20', 'material'],
      [4, 'u', 'Codos', 'material'],
      [2, 'jornal', 'Jornal', 'labor'],
    ],
  );
  assert.ok(r.items.every((i) => i.needsReview && i.unitPrice === 0), 'sin precios dictados ni catálogo: todo para revisar');
});

test('el mismo ejemplo hablado con palabras', () => {
  const r = parseDictation('seis metros de caño de veinte, cuatro codos, dos jornales y traslado quince mil');
  assert.equal(r.title, null);
  assert.equal(r.travelCost, 15000);
  assert.deepEqual(r.items.map((i) => [i.quantity, i.description]), [[6, 'Caño de 20'], [4, 'Codos'], [2, 'Jornal']]);
});

test('precios por unidad ("a ... cada una") y global ("mano de obra 80 mil")', () => {
  const r = parseDictation('3 llaves de paso a 4500 cada una, mano de obra 80 mil, diez por ciento de descuento');
  assert.equal(r.discountPct, 10);
  assert.deepEqual(r.items.map((i) => [i.quantity, i.unitPrice, i.kind, i.needsReview]), [
    [3, 4500, 'material', false],
    [1, 80000, 'labor', false],
  ]);
});

test('precio sin "cada uno" con cantidad > 1: se toma como total de la línea y se avisa', () => {
  const r = parseDictation('2 jornales 80 mil');
  assert.equal(r.items[0].unitPrice, 40000);
  assert.match(r.items[0].notes.join(' '), /total de la línea/);
});

test('"a 1500 el metro" es precio unitario', () => {
  const r = parseDictation('6 metros de cable a 1500 el metro');
  assert.deepEqual([r.items[0].quantity, r.items[0].unit, r.items[0].unitPrice, r.items[0].description], [6, 'm', 1500, 'Cable']);
});

test('precio con $ y c/u', () => {
  const r = parseDictation('4 codos $2.500 c/u');
  assert.deepEqual([r.items[0].quantity, r.items[0].unitPrice], [4, 2500]);
});

test('"un" es artículo, no cantidad escondida en la descripción', () => {
  const r = parseDictation('cambio de un termotanque, 1 termotanque a 350 mil, instalación 60 mil');
  assert.equal(r.title, 'Cambio de un termotanque');
  assert.deepEqual(r.items.map((i) => [i.description, i.quantity, i.unitPrice, i.kind]), [
    ['Termotanque', 1, 350000, 'material'],
    ['Instalación', 1, 60000, 'labor'],
  ]);
});

test('cantidades fraccionarias y unidades', () => {
  const r = parseDictation('medio metro de caño a 2000, tres y medio kilos de soldadura a 6000, 2 metros cuadrados de cerámica a 12 mil, 3 horas de trabajo a 10 mil');
  assert.deepEqual(r.items.map((i) => [i.quantity, i.unit, i.unitPrice]), [
    [0.5, 'm', 2000],
    [3.5, 'kg', 6000],
    [2, 'm2', 12000],
    [3, 'hs', 10000],
  ]);
  assert.equal(r.items[3].kind, 'labor');
  assert.equal(r.items[3].description, 'Trabajo');
});

test('traslado sin monto y descuento en pesos generan advertencias', () => {
  const r = parseDictation('2 codos a 500, traslado, descuento de 5 mil pesos');
  assert.equal(r.travelCost, 0);
  assert.equal(r.discountPct, 0);
  assert.equal(r.warnings.length, 2);
});

test('descuento en % y variantes de traslado', () => {
  assert.equal(parseDictation('1 canilla a 9000, descuento del 5%').discountPct, 5);
  assert.equal(parseDictation('1 canilla a 9000, 15 por ciento de descuento').discountPct, 15);
  assert.equal(parseDictation('1 canilla a 9000 y viáticos $3.000').travelCost, 3000);
  assert.equal(parseDictation('1 canilla a 9000 más flete veinte mil').travelCost, 20000);
});

test('texto vacío, basura y símbolos no rompen nada', () => {
  assert.deepEqual(parseDictation('').items, []);
  assert.equal(parseDictation('   ').warnings.length, 1);
  assert.equal(parseDictation('¿¡?!;;,,,').items.length, 0);
  assert.equal(parseDictation('...').items.length, 0);
  assert.doesNotThrow(() => parseDictation('<script>alert(1)</script> 3 x 4 $$$ %%% 99999999999999999999'));
  assert.doesNotThrow(() => parseDictation('a '.repeat(5000)));
});

test('sin ningún ítem reconocible, avisa', () => {
  const r = parseDictation('y, más');
  assert.equal(r.items.length, 0);
  assert.match(r.warnings[0], /ningún ítem/);
});

test('una sola frase sin cantidad ni precio queda como ítem para revisar (no se pierde)', () => {
  const r = parseDictation('reparación de pérdida en el baño');
  assert.equal(r.title, null);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].needsReview, true);
  assert.equal(r.items[0].kind, 'labor');
});

// ---------------- Catálogo ----------------

const catalog: CatalogEntry[] = [
  { id: 'c1', name: 'Caño termofusión 20', unit: 'm', unitPrice: 1500, kind: 'material' },
  { id: 'c2', name: 'Caño termofusión 25', unit: 'm', unitPrice: 2100, kind: 'material' },
  { id: 'c3', name: 'Codo termofusión 20', unit: 'u', unitPrice: 800, kind: 'material' },
  { id: 'c4', name: 'Jornal oficial plomero', unit: 'jornal', unitPrice: 45000, kind: 'labor' },
];

test('tokens significativos: sin acentos, singular, sin conectores', () => {
  assert.deepEqual(significantTokens('Caños de 20 mm'), ['cano', '20', 'mm']);
  assert.deepEqual(significantTokens('Válvulas esféricas'), ['valvula', 'esferica']);
});

test('matchCatalog respeta los números (20 ≠ 25) y no inventa coincidencias', () => {
  assert.equal(matchCatalog('Caño termofusión 20', catalog)?.id, 'c1');
  assert.equal(matchCatalog('caño termofusión de 25', catalog)?.id, 'c2');
  assert.equal(matchCatalog('Caño de 40', catalog), null);
  assert.equal(matchCatalog('Termotanque', catalog), null);
  assert.equal(matchCatalog('20', catalog), null); // solo números: nunca
  assert.equal(matchCatalog('', catalog), null);
  assert.equal(matchCatalog('codos termofusión 20', catalog)?.id, 'c3');
});

test('el parser toma el precio y la unidad del catálogo cuando no se dicen', () => {
  const r = parseDictation('6 metros de caño termofusión 20, 4 codos termofusión 20, 2 jornales de oficial plomero', catalog);
  assert.deepEqual(r.items.map((i) => [i.catalogItemId, i.description, i.quantity, i.unitPrice, i.needsReview]), [
    ['c1', 'Caño termofusión 20', 6, 1500, false],
    ['c3', 'Codo termofusión 20', 4, 800, false],
    ['c4', 'Jornal oficial plomero', 2, 45000, false],
  ]);
});

test('si se dicta un precio, gana sobre el del catálogo', () => {
  const r = parseDictation('6 metros de caño termofusión 20 a 1800 el metro', catalog);
  assert.equal(r.items[0].catalogItemId, 'c1');
  assert.equal(r.items[0].unitPrice, 1800);
});
