/** Exportación CSV (copia de datos por empresa). Abre bien en Excel (BOM UTF-8, separador ;). */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

/** Evita inyección de fórmulas: una celda que empieza con = + - @ se prefija con apóstrofo. */
export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(';');
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(';'));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}
