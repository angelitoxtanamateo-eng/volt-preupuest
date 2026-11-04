import type { ItemKind } from '../validation';
import { norm } from './numbers';

export interface CatalogEntry {
  id: string;
  name: string;
  unit: string;
  unitPrice: number;
  kind: ItemKind;
}

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'con', 'para', 'un', 'una', 'por', 'a']);

/** "Caños de 20 mm" -> ["cano", "20", "mm"] (sin acentos, singular, sin conectores). */
export function significantTokens(text: string): string[] {
  return norm(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 3 && t.endsWith('es') && !/\d/.test(t) ? t.slice(0, -2) : t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
}

/**
 * Busca el ítem del catálogo que mejor coincide con una descripción dictada.
 * Exige que al menos el 60% de las palabras dictadas estén en el nombre del ítem (los números cuentan:
 * "caño de 20" NO coincide con "Caño 25"). Devuelve null si no hay coincidencia confiable.
 */
export function matchCatalog(description: string, catalog: CatalogEntry[]): CatalogEntry | null {
  const q = significantTokens(description);
  if (q.length === 0 || !q.some((t) => !/^\d+$/.test(t))) return null;
  let best: { entry: CatalogEntry; score: number; tie: number } | null = null;
  for (const entry of catalog) {
    const toks = new Set(significantTokens(entry.name));
    const hits = q.filter((t) => toks.has(t)).length;
    const score = hits / q.length;
    if (score < 0.6) continue;
    const tie = hits / Math.max(toks.size, 1); // cubre más del nombre del ítem = mejor
    if (!best || score > best.score || (score === best.score && tie > best.tie)) best = { entry, score, tie };
  }
  return best?.entry ?? null;
}
