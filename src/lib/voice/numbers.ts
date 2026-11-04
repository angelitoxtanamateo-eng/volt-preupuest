/**
 * Tokenizador y lector de números para texto dictado en español (es-AR).
 * Entiende dígitos ("15.000", "1.500,50", "$8500") y palabras ("quince mil", "treinta y cinco",
 * "dos mil quinientos", "tres y medio", "un millón").
 */
import { parseNumberInput } from '../money';

export type Tok =
  | { t: 'num'; v: number; raw: string; money: boolean; pct: boolean }
  | { t: 'word'; raw: string; n: string }
  | { t: 'sep'; raw: string };

/** Minúsculas y sin acentos (solo para comparar; el texto mostrado conserva sus acentos). */
export const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const UNITS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22,
  veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};
const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600,
  setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};
const ARTICLES = new Set(['un', 'uno', 'una']);
const isUnit1to9 = (n: string) => n in UNITS && UNITS[n] >= 1 && UNITS[n] <= 9;

export function tokenize(text: string): Tok[] {
  const src = text
    .replace(/\bc\/u\b/gi, 'cada uno')
    .replace(/m²/gi, 'm2')
    .replace(/\s+/g, ' ');
  const re = /(\$\s*)?\d+(?:[.,]\d+)*(\s*%)?|\p{L}+|[,;.!?¿¡]|\S/gu;
  const out: Tok[] = [];
  for (const m of src.matchAll(re)) {
    const raw = m[0];
    if (/\d/.test(raw)) {
      const v = parseNumberInput(raw.replace(/[$%\s]/g, ''));
      if (v === null) continue;
      out.push({ t: 'num', v, raw: raw.trim(), money: raw.includes('$'), pct: raw.includes('%') });
    } else if (/^\p{L}+$/u.test(raw)) {
      out.push({ t: 'word', raw, n: norm(raw) });
    } else if (/^[,;.!?¿¡]$/.test(raw)) {
      out.push({ t: 'sep', raw });
    }
    // cualquier otro símbolo suelto se ignora
  }
  return out;
}

interface Read {
  v: number;
  next: number;
  raw: string;
  money: boolean;
  pct: boolean;
}

/** Lee un número que empieza en `start` (dígitos y/o palabras). null si ahí no hay número. */
export function readNumber(tokens: Tok[], start: number): Read | null {
  let total = 0;
  let current = 0;
  let last: 'none' | 'hundred' | 'tens' | 'unit' | 'mil' | 'digits' = 'none';
  let j = start;
  let money = false;
  let pct = false;
  const raws: string[] = [];
  const prev = start > 0 ? tokens[start - 1] : undefined;
  const afterPor = prev?.t === 'word' && prev.n === 'por'; // "diez por ciento": "ciento" NO es 100

  while (j < tokens.length) {
    const tk = tokens[j];
    if (tk.t === 'num') {
      if (last !== 'none') break;
      current = tk.v;
      last = 'digits';
      money = tk.money;
      pct = tk.pct;
      raws.push(tk.raw);
      j++;
      if (pct) break;
      continue;
    }
    if (tk.t !== 'word') break;
    const n = tk.n;
    const nextN = tokens[j + 1]?.t === 'word' ? (tokens[j + 1] as { n: string }).n : '';

    if (n === 'mil' && (last === 'digits' ? current > 0 && current < 1000 : last !== 'mil')) {
      total += (current || 1) * 1000;
      current = 0;
      last = 'mil';
    } else if ((n === 'millon' || n === 'millones') && last !== 'none') {
      total = (total + current) * 1_000_000;
      current = 0;
      last = 'mil';
    } else if ((n === 'millon' || n === 'millones') && last === 'none') {
      total = 1_000_000;
      last = 'mil';
    } else if (n in HUNDREDS && (last === 'none' || last === 'mil') && !(n === 'ciento' && j === start && afterPor)) {
      current += HUNDREDS[n];
      last = 'hundred';
    } else if (n in TENS && (last === 'none' || last === 'mil' || last === 'hundred')) {
      current += TENS[n];
      last = 'tens';
    } else if (n in UNITS && (last === 'none' || last === 'mil' || last === 'hundred')) {
      // "un/una/uno" solos son artículos ("un termotanque"): solo cuentan como número si van antes de "mil"/"millón"
      if (ARTICLES.has(n) && last === 'none' && !(nextN === 'mil' || nextN === 'millon' || nextN === 'millones')) break;
      current += UNITS[n];
      last = 'unit';
    } else if (n === 'y' && last === 'tens' && isUnit1to9(nextN)) {
      raws.push(tk.raw);
      j++;
      current += UNITS[nextN];
      raws.push((tokens[j] as { raw: string }).raw);
      j++;
      last = 'unit';
      continue;
    } else {
      break;
    }
    raws.push(tk.raw);
    j++;
  }
  if (last === 'none') return null;

  let v = total + current;
  // "tres y medio", "dos metros y medio" (el "y medio" se pega al número anterior)
  const a = tokens[j];
  const b = tokens[j + 1];
  if (a?.t === 'word' && a.n === 'y' && b?.t === 'word' && (b.n === 'medio' || b.n === 'media')) {
    v += 0.5;
    raws.push(a.raw, b.raw);
    j += 2;
  }
  return { v, next: j, raw: raws.join(' '), money, pct };
}

/** Reemplaza cada secuencia numérica (en dígitos o palabras) por un único token numérico. */
export function collapseNumbers(tokens: Tok[]): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < tokens.length) {
    const r = readNumber(tokens, i);
    if (r) {
      out.push({ t: 'num', v: r.v, raw: r.raw, money: r.money, pct: r.pct });
      i = r.next;
    } else {
      out.push(tokens[i]);
      i++;
    }
  }
  return out;
}

/** Texto de un número para mostrar en descripciones: 20 -> "20", 2.5 -> "2,5". */
export const fmtNum = (v: number): string => String(v).replace('.', ',');
