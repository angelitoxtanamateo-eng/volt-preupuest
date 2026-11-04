/** Fechas "YYYY-MM-DD" tratadas como fecha civil (sin zonas horarias). */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: string): boolean {
  const m = ISO.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function addDays(iso: string, days: number): string {
  const m = ISO.exec(iso);
  if (!m) throw new Error(`Fecha inválida: ${iso}`);
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return dt.toISOString().slice(0, 10);
}

/** "2026-11-03" -> "03/11/2026" */
export function formatDateAR(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = ISO.exec(iso.slice(0, 10));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Fecha de hoy en la zona horaria del dispositivo, como "YYYY-MM-DD". */
export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
