/**
 * Teléfonos argentinos. Se guardan tal como los escribe la persona (la base solo admite
 * dígitos, espacios, +, paréntesis y guiones) y se normalizan al formato internacional de WhatsApp.
 */

/** Coincide con el CHECK de la base: ^[0-9+() -]{6,20}$ */
export function isStorablePhone(s: string): boolean {
  return /^[0-9+() -]{6,20}$/.test(s);
}

/**
 * Convierte cualquier forma habitual a "549" + área + número (formato wa.me), o null si no se puede.
 *  "3585625480"            -> "5493585625480"
 *  "0358 15-5625480"       -> "5493585625480"
 *  "+54 9 358 562-5480"    -> "5493585625480"
 *  "011 15 4444-5555"      -> "5491144445555"
 * WhatsApp trabaja con celulares, por eso siempre se antepone "549". Devuelve null si no tiene 10 dígitos nacionales.
 */
export function normalizeArPhone(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);

  let hadCountry = false;
  if (d.startsWith('54') && d.length >= 12) {
    d = d.slice(2);
    hadCountry = true;
  }
  if (d.startsWith('0')) d = d.slice(1); // prefijo troncal
  if (hadCountry && d.startsWith('9') && d.length === 11) d = d.slice(1); // el 9 de celular ya viene en +54 9

  // Quita el "15" de celulares escrito entre el código de área y el número (12 dígitos => 10)
  if (d.length === 12) {
    for (const areaLen of [2, 3, 4]) {
      if (d.slice(areaLen, areaLen + 2) === '15') {
        d = d.slice(0, areaLen) + d.slice(areaLen + 2);
        break;
      }
    }
  }
  if (d.length !== 10) return null;
  return `549${d}`;
}

/**
 * "5493585625480" -> "+54 9 358 562-5480" (solo para mostrar).
 * El código de área puede tener 2, 3 o 4 dígitos; sin una tabla completa se asume 2 para "11" (AMBA) y 3 para el resto.
 */
export function formatWaNumber(wa: string): string {
  const m = /^549(\d{10})$/.exec(wa);
  if (!m) return `+${wa}`;
  const n = m[1];
  if (n.startsWith('11')) return `+54 9 11 ${n.slice(2, 6)}-${n.slice(6)}`;
  return `+54 9 ${n.slice(0, 3)} ${n.slice(3, 6)}-${n.slice(6)}`;
}
