/**
 * Validaciones de formularios. Reflejan las restricciones (CHECK) de la base de datos para dar
 * mensajes claros antes de enviar; la base igual las vuelve a verificar (la seguridad no depende de esto).
 * Los campos numéricos llegan como texto (lo que escribió la persona) y salen tipados.
 */
import { isIsoDate } from './dates';
import { parseNumberInput } from './money';
import { isStorablePhone } from './phone';

export type Errors = Record<string, string>;
export type Result<T> = { ok: true; value: T } | { ok: false; errors: Errors };

const done = <T>(errors: Errors, value: () => T): Result<T> =>
  Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: value() };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_MONEY = 999_999_999_999; // numeric(14,2)

export const isValidEmail = (s: string) => EMAIL.test(s.trim());

/** CUIT/CUIL con dígito verificador (módulo 11). Solo informativo en VOLT: no hay facturación. */
export function isValidCuit(input: string): boolean {
  const d = input.replace(/\D/g, '');
  if (d.length !== 11) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = w.reduce((a, wi, i) => a + wi * Number(d[i]), 0);
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10) return false;
  return check === Number(d[10]);
}

function money(raw: string, field: string, label: string, errors: Errors, opts: { required?: boolean } = {}): number {
  const t = raw.trim();
  if (!t) {
    if (opts.required) errors[field] = `Ingresá ${label}.`;
    return 0;
  }
  const n = parseNumberInput(t);
  if (n === null) errors[field] = `${label[0].toUpperCase()}${label.slice(1)} no es un número válido.`;
  else if (n < 0) errors[field] = 'No puede ser negativo.';
  else if (n > MAX_MONEY) errors[field] = 'El monto es demasiado grande.';
  else if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) errors[field] = 'Usá como máximo 2 decimales.';
  return n ?? 0;
}

// ---------- Auth ----------
export function validateLogin(i: { email: string; password: string }): Result<{ email: string; password: string }> {
  const e: Errors = {};
  if (!isValidEmail(i.email)) e.email = 'Ingresá un email válido.';
  if (!i.password) e.password = 'Ingresá tu contraseña.';
  return done(e, () => ({ email: i.email.trim().toLowerCase(), password: i.password }));
}

export function validatePassword(p: string): string | null {
  if (p.length < 8) return 'Usá al menos 8 caracteres.';
  if (/^(.)\1+$/.test(p)) return 'Esa contraseña es demasiado simple.';
  return null;
}

export function validateRegister(i: { fullName: string; email: string; password: string; confirm: string }) {
  const e: Errors = {};
  if (i.fullName.trim().length < 2) e.fullName = 'Ingresá tu nombre.';
  if (!isValidEmail(i.email)) e.email = 'Ingresá un email válido.';
  const pe = validatePassword(i.password);
  if (pe) e.password = pe;
  if (i.password !== i.confirm) e.confirm = 'Las contraseñas no coinciden.';
  return done(e, () => ({ fullName: i.fullName.trim(), email: i.email.trim().toLowerCase(), password: i.password }));
}

// ---------- Empresa ----------
export interface CompanyInput {
  name: string;
  phone: string;
  email: string;
  address: string;
  taxId: string;
  currency: string;
  defaultValidityDays: string;
  paymentTerms: string;
}

export function validateCompany(i: CompanyInput) {
  const e: Errors = {};
  const name = i.name.trim();
  if (name.length < 2 || name.length > 120) e.name = 'El nombre debe tener entre 2 y 120 caracteres.';
  if (i.phone.trim() && !isStorablePhone(i.phone.trim())) e.phone = 'Usá solo números, espacios, + ( ) y guiones (6 a 20 caracteres).';
  if (i.email.trim() && !isValidEmail(i.email)) e.email = 'El email no es válido.';
  if (i.taxId.trim() && !isValidCuit(i.taxId)) e.taxId = 'El CUIT no es válido (11 dígitos).';
  if (!/^[A-Z]{3}$/.test(i.currency)) e.currency = 'Elegí una moneda.';
  const days = Number(i.defaultValidityDays);
  if (!Number.isInteger(days) || days < 1 || days > 365) e.defaultValidityDays = 'Ingresá un número de días entre 1 y 365.';
  return done(e, () => ({
    name,
    phone: i.phone.trim() || null,
    email: i.email.trim().toLowerCase() || null,
    address: i.address.trim() || null,
    tax_id: i.taxId.trim() || null,
    currency: i.currency,
    default_validity_days: days,
    payment_terms: i.paymentTerms.trim(),
  }));
}

// ---------- Clientes ----------
export interface ClientInput {
  name: string;
  phone: string;
  address: string;
  notes: string;
}

export function validateClient(i: ClientInput) {
  const e: Errors = {};
  const name = i.name.trim();
  if (!name) e.name = 'Ingresá el nombre del cliente.';
  else if (name.length > 120) e.name = 'El nombre es demasiado largo (máximo 120).';
  const phone = i.phone.trim();
  if (phone && !isStorablePhone(phone)) e.phone = 'Usá solo números, espacios, + ( ) y guiones (6 a 20 caracteres).';
  return done(e, () => ({ name, phone: phone || null, address: i.address.trim() || null, notes: i.notes.trim() || null }));
}

// ---------- Catálogo ----------
export type ItemKind = 'material' | 'labor' | 'other';
export const KIND_LABEL: Record<ItemKind, string> = { material: 'Material', labor: 'Mano de obra', other: 'Otro' };

export interface CatalogInput {
  kind: ItemKind;
  name: string;
  unit: string;
  unitPrice: string;
  unitCost: string; // vacío = sin costo cargado
  active: boolean;
}

export function validateCatalogItem(i: CatalogInput) {
  const e: Errors = {};
  const name = i.name.trim();
  if (!name) e.name = 'Ingresá el nombre.';
  else if (name.length > 160) e.name = 'El nombre es demasiado largo (máximo 160).';
  if (!i.unit.trim()) e.unit = 'Ingresá la unidad (u, m, hs...).';
  const price = money(i.unitPrice, 'unitPrice', 'el precio', e, { required: true });
  const hasCost = i.unitCost.trim() !== '';
  const cost = hasCost ? money(i.unitCost, 'unitCost', 'el costo', e) : null;
  return done(e, () => ({
    data: { kind: i.kind, name, unit: i.unit.trim(), unit_price: price, active: i.active },
    cost,
  }));
}

// ---------- Presupuesto ----------
export interface QuoteItemInput {
  kind: ItemKind;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  catalogItemId: string | null;
}

export interface QuoteInput {
  title: string;
  clientId: string;
  description: string;
  discountPct: string;
  travelCost: string;
  paymentTerms: string;
  issueDate: string;
  validUntil: string;
  items: QuoteItemInput[];
}

export function validateQuote(i: QuoteInput) {
  const e: Errors = {};
  if (i.title.trim().length > 150) e.title = 'El título es demasiado largo (máximo 150).';
  if (!isIsoDate(i.issueDate)) e.issueDate = 'Fecha inválida.';
  if (i.validUntil && !isIsoDate(i.validUntil)) e.validUntil = 'Fecha inválida.';
  else if (i.validUntil && isIsoDate(i.issueDate) && i.validUntil < i.issueDate) e.validUntil = 'La vigencia no puede ser anterior a la fecha del presupuesto.';

  let discount = 0;
  if (i.discountPct.trim()) {
    const d = parseNumberInput(i.discountPct);
    if (d === null || d < 0 || d > 100) e.discountPct = 'El descuento debe estar entre 0 y 100.';
    else if (Math.abs(d * 100 - Math.round(d * 100)) > 1e-6) e.discountPct = 'Usá como máximo 2 decimales.';
    else discount = d;
  }
  const travel = money(i.travelCost, 'travelCost', 'el traslado', e);

  if (i.items.length === 0) e.items = 'Agregá al menos un ítem.';
  const items = i.items.map((it, idx) => {
    const k = `items.${idx}`;
    const description = it.description.trim();
    if (!description) e[`${k}.description`] = 'Falta la descripción.';
    else if (description.length > 300) e[`${k}.description`] = 'Máximo 300 caracteres.';
    const q = parseNumberInput(it.quantity);
    if (q === null || q <= 0) e[`${k}.quantity`] = 'La cantidad debe ser mayor a 0.';
    else if (q > 999_999_999) e[`${k}.quantity`] = 'Cantidad demasiado grande.';
    else if (Math.abs(q * 1000 - Math.round(q * 1000)) > 1e-6) e[`${k}.quantity`] = 'Usá como máximo 3 decimales.';
    const price = money(it.unitPrice, `${k}.unitPrice`, 'el precio', e, { required: true });
    return {
      kind: it.kind,
      description,
      quantity: q ?? 0,
      unit: it.unit.trim() || 'u',
      unit_price: price,
      catalog_item_id: it.catalogItemId,
    };
  });

  return done(e, () => ({
    quote: {
      title: i.title.trim() || 'Presupuesto',
      client_id: i.clientId || null,
      description: i.description.trim() || null,
      discount_pct: discount,
      travel_cost: travel,
      payment_terms: i.paymentTerms.trim() || null,
      issue_date: i.issueDate,
      valid_until: i.validUntil || null,
    },
    items,
  }));
}

// ---------- Invitaciones ----------
export function validateInvitation(i: { email: string; role: 'admin' | 'employee' }) {
  const e: Errors = {};
  if (!isValidEmail(i.email)) e.email = 'Ingresá un email válido.';
  return done(e, () => ({ email: i.email.trim().toLowerCase(), role: i.role }));
}
