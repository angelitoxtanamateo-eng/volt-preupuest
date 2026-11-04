/**
 * Interpreta un presupuesto dictado (o escrito) en español rioplatense.
 *
 * Es un parser DETERMINISTA por reglas (sin IA, sin servicios externos): ejemplo
 *   "Cambio de cañería en cocina, 6 metros de caño de 20, 4 codos, dos jornales y traslado 15 mil"
 * Entiende cantidades, unidades, precios ("a 1500 el metro", "80 mil"), traslado y descuento.
 * NO es infalible: por eso su resultado siempre pasa por una pantalla de revisión antes de guardarse,
 * y todo lo dudoso se marca con `needsReview` y `notes`.
 */
import type { ItemKind } from '../validation';
import { matchCatalog, type CatalogEntry } from './catalogMatch';
import { formatQuantity } from '../money';
import { collapseNumbers, fmtNum, tokenize, type Tok } from './numbers';

export interface ParsedItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  kind: ItemKind;
  catalogItemId: string | null;
  needsReview: boolean;
  notes: string[];
}

export interface ParsedDictation {
  title: string | null;
  items: ParsedItem[];
  travelCost: number;
  discountPct: number;
  warnings: string[];
}

const SPLIT_WORDS = new Set(['y', 'mas', 'ademas', 'tambien', 'luego', 'despues']);
const TRAVEL_WORDS = new Set(['traslado', 'traslados', 'viatico', 'viaticos', 'flete', 'movilidad', 'desplazamiento', 'viaje', 'nafta', 'combustible']);
const LABOR_RE = /mano de obra|jornal|colocacion|instalacion|visita|servicio|arreglo|reparacion|trabajo|oficial|ayudante/;
const TRAIL = new Set(['pesos', 'peso', 'cada', 'uno', 'una', 'el', 'la', 'metro', 'metros', 'unidad', 'hora', 'jornal', 'kilo', 'litro', 'ars']);
const PER_UNIT_TRAIL = new Set(['cada', 'el', 'la']);

const UNIT_WORDS: Record<string, string> = {
  metro: 'm', metros: 'm', mt: 'm', mts: 'm', mtrs: 'm', m: 'm',
  centimetro: 'cm', centimetros: 'cm', cm: 'cm',
  m2: 'm2',
  unidad: 'u', unidades: 'u', u: 'u',
  hora: 'hs', horas: 'hs', hs: 'hs',
  jornal: 'jornal', jornales: 'jornal', jornada: 'jornal', jornadas: 'jornal',
  dia: 'día', dias: 'día',
  kilo: 'kg', kilos: 'kg', kg: 'kg', kgs: 'kg',
  litro: 'l', litros: 'l', lt: 'l', lts: 'l', l: 'l',
  bolsa: 'bolsa', bolsas: 'bolsa', rollo: 'rollo', rollos: 'rollo', barra: 'barra', barras: 'barra',
  caja: 'caja', cajas: 'caja', par: 'par', pares: 'par', paquete: 'paquete', paquetes: 'paquete',
};
const UNIT_LABEL: Record<string, string> = { jornal: 'Jornal', hs: 'Mano de obra (horas)', 'día': 'Día de trabajo' };

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const isWord = (t: Tok | undefined, ...ws: string[]): boolean => !!t && t.t === 'word' && ws.includes(t.n);
const isPriceLike = (t: Tok, next?: Tok): boolean => t.t === 'num' && !t.pct && (t.money || t.v >= 1000 || isWord(next, 'peso', 'pesos'));

function tokText(toks: Tok[]): string {
  return toks
    .map((t) => (t.t === 'num' ? (t.money ? '$' : '') + fmtNum(t.v) : t.raw))
    .join(' ')
    .replace(/\s+([,.;])/g, '$1')
    .trim();
}

function trimConnectors(toks: Tok[]): Tok[] {
  const out = [...toks];
  while (out.length && isWord(out[0], 'de', 'del', 'en', 'con', 'para')) out.shift();
  while (out.length && isWord(out[out.length - 1], 'de', 'del', 'a', 'por', 'el', 'la', 'con', 'en')) out.pop();
  return out;
}

function splitSegments(tokens: Tok[]): Tok[][] {
  const segs: Tok[][] = [[]];
  for (const t of tokens) {
    if (t.t === 'sep' || (t.t === 'word' && SPLIT_WORDS.has(t.n))) segs.push([]);
    else segs[segs.length - 1].push(t);
  }
  return segs.filter((s) => s.length > 0);
}

interface ItemParse {
  item: ParsedItem;
  hadQty: boolean;
  hadPrice: boolean;
  words: number;
}

function parseItemSegment(seg: Tok[], catalog: CatalogEntry[]): ItemParse | null {
  const notes: string[] = [];
  let i = 0;
  let qty: number | null = null;
  let unit: string | null = null;
  let price: number | null = null;
  let priceIsUnit = false;

  const first = seg[0];
  if (first.t === 'num' && !first.money && !first.pct && !isPriceLike(first, seg[1])) {
    qty = first.v;
    i = 1;
  } else if (isWord(first, 'un', 'una', 'uno')) {
    qty = 1;
    i = 1;
  } else if (isWord(first, 'medio', 'media')) {
    qty = 0.5;
    i = 1;
  } else if (first.t === 'num' && isPriceLike(first, seg[1])) {
    price = first.v;
    i = 1;
    if (isWord(seg[i], 'peso', 'pesos')) i++;
  }

  if (qty !== null) {
    const w = seg[i];
    if (w?.t === 'word') {
      if (w.n === 'metros' || w.n === 'metro') {
        const nx = seg[i + 1];
        if (isWord(nx, 'cuadrado', 'cuadrados')) {
          unit = 'm2';
          i += 2;
        } else {
          unit = 'm';
          i += 1;
        }
      } else if (w.n in UNIT_WORDS) {
        unit = UNIT_WORDS[w.n];
        i += 1;
      }
    }
  }
  while (isWord(seg[i], 'de', 'del', 'por', 'en')) i++;

  let rest = seg.slice(i);

  // Precio dentro del resto: "a 1500 el metro", "por 12 mil", "80 mil"
  if (price === null) {
    for (let k = rest.length - 1; k >= 0; k--) {
      const t = rest[k];
      if (t.t !== 'num' || t.pct) continue;
      const prev = rest[k - 1];
      let start = -1;
      if (isWord(prev, 'a', 'x')) {
        start = k - 1;
        priceIsUnit = true;
      } else if (isWord(prev, 'por') && isPriceLike(t, rest[k + 1])) {
        start = k - 1;
      } else if (isPriceLike(t, rest[k + 1])) {
        start = k;
      }
      if (start < 0) continue;
      price = t.v;
      let end = k + 1;
      let consumed = 0;
      while (end < rest.length && consumed < 3 && rest[end].t === 'word' && TRAIL.has((rest[end] as { n: string }).n)) {
        if (PER_UNIT_TRAIL.has((rest[end] as { n: string }).n)) priceIsUnit = true;
        end++;
        consumed++;
      }
      rest = [...rest.slice(0, start), ...rest.slice(end)];
      break;
    }
  }

  const descToks = trimConnectors(rest);
  let description = tokText(descToks);
  const hadDescription = description.length > 0;
  const hadQty = qty !== null;
  const hadPrice = price !== null;

  if (!hadDescription && unit && UNIT_LABEL[unit]) description = UNIT_LABEL[unit];
  else if (hadDescription && unit && UNIT_LABEL[unit] && !LABOR_RE.test(description.toLowerCase())) description = `${UNIT_LABEL[unit]} de ${description}`;
  if (!description) return null;
  description = cap(description);

  const finalQty = qty ?? 1;
  let kind: ItemKind = unit === 'hs' || unit === 'jornal' || unit === 'día' || LABOR_RE.test(description.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')) ? 'labor' : 'material';
  let unitPrice = 0;
  let catalogItemId: string | null = null;

  if (price !== null) {
    if (!priceIsUnit && finalQty > 1) {
      unitPrice = Math.round((price / finalQty) * 100) / 100;
      notes.push(`Dijiste ${formatQuantity(price)} sin "cada uno": se tomó como total de la línea (${formatQuantity(unitPrice)} por unidad). Revisalo.`);
    } else {
      unitPrice = price;
    }
  }

  const match = matchCatalog(description, catalog);
  if (match) {
    catalogItemId = match.id;
    description = match.name;
    kind = match.kind;
    if (!unit) unit = match.unit;
    if (price === null) {
      unitPrice = match.unitPrice;
      notes.push('Precio tomado de tu catálogo.');
    }
  }
  const needsReview = unitPrice <= 0 || (!hadQty && !hadPrice);
  if (unitPrice <= 0) notes.push('Falta el precio: completalo.');
  if (!hadQty && !hadPrice) notes.push('No se dijo cantidad: se asumió 1.');

  return {
    item: {
      description,
      quantity: finalQty,
      unit: unit ?? 'u',
      unitPrice,
      kind,
      catalogItemId,
      needsReview,
      notes,
    },
    hadQty,
    hadPrice,
    words: descToks.length,
  };
}

export function parseDictation(text: string, catalog: CatalogEntry[] = []): ParsedDictation {
  const result: ParsedDictation = { title: null, items: [], travelCost: 0, discountPct: 0, warnings: [] };
  if (!text.trim()) {
    result.warnings.push('No hay texto para interpretar.');
    return result;
  }
  const segments = splitSegments(collapseNumbers(tokenize(text)));
  const parsed: ItemParse[] = [];

  for (const seg of segments) {
    // Descuento: "10 por ciento de descuento", "descuento del 5%"
    if (seg.some((t) => isWord(t, 'descuento', 'off', 'bonificacion'))) {
      const idx = seg.findIndex((t) => t.t === 'num');
      const t = idx >= 0 ? (seg[idx] as Extract<Tok, { t: 'num' }>) : null;
      if (t && t.v > 0 && t.v <= 100 && !t.money) result.discountPct = t.v;
      else result.warnings.push('No pude interpretar el descuento (se carga como porcentaje, por ejemplo "10 por ciento de descuento").');
      continue;
    }
    // Traslado / flete / viáticos
    if (seg.some((t) => t.t === 'word' && TRAVEL_WORDS.has(t.n))) {
      const t = seg.find((x): x is Extract<Tok, { t: 'num' }> => x.t === 'num');
      if (t && t.v > 0) result.travelCost = t.v;
      else result.warnings.push('Mencionaste el traslado pero no un monto: cargalo a mano.');
      continue;
    }
    const p = parseItemSegment(seg, catalog);
    if (p) parsed.push(p);
  }

  // Primera frase sin cantidad ni precio, seguida de ítems concretos => es el título del trabajo
  if (parsed.length > 1 && !parsed[0].hadQty && !parsed[0].hadPrice && parsed[0].words >= 2 && parsed.slice(1).some((p) => p.hadQty || p.hadPrice)) {
    result.title = parsed[0].item.description;
    parsed.shift();
  }
  result.items = parsed.map((p) => p.item);
  if (result.items.length === 0) result.warnings.push('No se detectó ningún ítem. Probá con algo como "6 metros de caño a 1500, 2 jornales a 40 mil".');
  return result;
}
