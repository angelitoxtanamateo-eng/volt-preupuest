/**
 * Acceso a datos. Toda la seguridad real la imponen las políticas RLS de la base:
 * estas funciones solo piden datos y traducen errores.
 */
import { supabase } from './supabase';
import type { QuoteStatus } from './status';
import type { PaidPlan, PlanCode, PlanUsage } from './plans';
import type {
  CatalogItem, Client, Company, Invitation, QuoteEvent, QuoteItemRow, QuoteMonthStatsRow, QuoteRow, QuoteStatsRow, Role, TeamMember,
} from '../types';

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

// ---------- Clientes ----------
export async function listClients(companyId: string): Promise<Client[]> {
  return unwrap(await supabase.from('clients').select('*').eq('company_id', companyId).order('name'));
}
export async function recentClients(companyId: string, n = 5): Promise<Client[]> {
  return unwrap(await supabase.from('clients').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(n));
}
export async function getClient(id: string): Promise<Client> {
  return unwrap(await supabase.from('clients').select('*').eq('id', id).single());
}
export async function saveClient(companyId: string, id: string | null, v: { name: string; phone: string | null; address: string | null; notes: string | null }): Promise<void> {
  const res = id
    ? await supabase.from('clients').update(v).eq('id', id)
    : await supabase.from('clients').insert({ ...v, company_id: companyId });
  if (res.error) throw res.error;
}
export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from('clients').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Catálogo ----------
export async function listCatalog(companyId: string): Promise<CatalogItem[]> {
  return unwrap(await supabase.from('catalog_items').select('*').eq('company_id', companyId).order('name'));
}
/** La RLS devuelve filas SOLO a administradores; para un empleado el resultado es siempre vacío. */
export async function listCosts(companyId: string): Promise<Record<string, number>> {
  const rows = unwrap<{ catalog_item_id: string; unit_cost: number }[]>(
    await supabase.from('catalog_costs').select('catalog_item_id, unit_cost').eq('company_id', companyId),
  );
  return Object.fromEntries(rows.map((r) => [r.catalog_item_id, Number(r.unit_cost)]));
}
export async function saveCatalogItem(companyId: string, id: string | null, data: Record<string, unknown>, cost: number | null): Promise<void> {
  const { error } = await supabase.rpc('save_catalog_item', { p_company: companyId, p_id: id, p_data: data, p_cost: cost });
  if (error) throw error;
}
export async function deleteCatalogItem(id: string): Promise<void> {
  const { error } = await supabase.from('catalog_items').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Presupuestos ----------
export async function listQuotes(companyId: string, limit?: number): Promise<QuoteRow[]> {
  let q = supabase.from('quotes').select('*, clients(name)').eq('company_id', companyId).order('number', { ascending: false });
  if (limit) q = q.limit(limit);
  return unwrap(await q);
}
export async function quotesOfClient(clientId: string): Promise<QuoteRow[]> {
  return unwrap(await supabase.from('quotes').select('*').eq('client_id', clientId).order('number', { ascending: false }));
}
export interface QuoteFull {
  quote: QuoteRow;
  items: QuoteItemRow[];
  client: Client | null;
  events: QuoteEvent[];
}
export async function getQuoteFull(id: string): Promise<QuoteFull> {
  const quote = unwrap<QuoteRow>(await supabase.from('quotes').select('*').eq('id', id).single());
  const [items, events, client] = await Promise.all([
    supabase.from('quote_items').select('*').eq('quote_id', id).order('position'),
    supabase.from('quote_events').select('*').eq('quote_id', id).order('created_at', { ascending: false }),
    quote.client_id ? supabase.from('clients').select('*').eq('id', quote.client_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  return { quote, items: unwrap(items), events: unwrap(events), client: unwrap(client as { data: Client | null; error: unknown }) };
}
export async function saveQuote(companyId: string, id: string | null, quote: Record<string, unknown>, items: Record<string, unknown>[]): Promise<string> {
  const { data, error } = await supabase.rpc('save_quote', { p_company: companyId, p_id: id, p_quote: quote, p_items: items });
  if (error) throw error;
  return data as string;
}
export async function duplicateQuote(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('duplicate_quote', { p_id: id });
  if (error) throw error;
  return data as string;
}
export async function setQuoteStatus(id: string, status: QuoteStatus): Promise<void> {
  const { error } = await supabase.from('quotes').update({ status }).eq('id', id);
  if (error) throw error;
}
export async function deleteQuote(id: string): Promise<void> {
  const { error } = await supabase.from('quotes').delete().eq('id', id);
  if (error) throw error;
}
export async function logQuoteEvent(quoteId: string, event: 'pdf_generated' | 'whatsapp_prepared', detail: Record<string, unknown> = {}): Promise<void> {
  // El historial es informativo: si falla no debe impedir abrir WhatsApp ni descargar el PDF.
  await supabase.rpc('log_quote_event', { p_quote: quoteId, p_event: event, p_detail: detail });
}
// ---------- Planes y administración de la plataforma ----------
export async function myPlanUsage(companyId: string): Promise<PlanUsage> {
  const { data, error } = await supabase.rpc('my_plan_usage', { p_company: companyId });
  if (error) throw error;
  return data as PlanUsage;
}
export async function requestPlan(companyId: string, plan: PaidPlan, reference: string | null): Promise<void> {
  const { error } = await supabase.rpc('request_plan', { p_company: companyId, p_plan: plan, p_reference: reference });
  if (error) throw error;
}
export async function cancelPlanRequest(companyId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_plan_request', { p_company: companyId });
  if (error) throw error;
}
export async function isPlatformAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_platform_admin');
  if (error) throw error;
  return data === true;
}
export interface AdminCompanyRow {
  company_id: string;
  company_name: string;
  created_at: string;
  plan: PlanCode;
  effective_plan: PlanCode;
  plan_expires_at: string | null;
  requested_plan: PaidPlan | null;
  requested_at: string | null;
  payment_reference: string | null;
  activated_at: string | null;
  used: number;
  admin_emails: string | null;
}
export async function adminListCompanies(): Promise<AdminCompanyRow[]> {
  const { data, error } = await supabase.rpc('admin_list_companies');
  if (error) throw error;
  return (data ?? []) as AdminCompanyRow[];
}
export async function adminSetPlan(companyId: string, plan: PlanCode, expires: string | null): Promise<void> {
  const { error } = await supabase.rpc('admin_set_plan', { p_company: companyId, p_plan: plan, p_expires: expires });
  if (error) throw error;
}

export async function quoteStats(companyId: string): Promise<QuoteStatsRow[]> {
  return unwrap(await supabase.from('quote_stats').select('*').eq('company_id', companyId));
}
export async function quoteMonthStats(companyId: string): Promise<QuoteMonthStatsRow[]> {
  return unwrap(await supabase.from('quote_stats_month').select('*').eq('company_id', companyId));
}

// ---------- Empresa ----------
export async function createCompany(name: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_company', { p_name: name });
  if (error) throw error;
  return data as string;
}
export async function updateCompany(id: string, v: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('companies').update(v).eq('id', id);
  if (error) throw error;
}
export async function uploadLogo(company: Company, png: Blob): Promise<void> {
  const path = `${company.id}/logo.png`;
  const up = await supabase.storage.from('company-assets').upload(path, png, { upsert: true, contentType: 'image/png', cacheControl: '3600' });
  if (up.error) throw up.error;
  await updateCompany(company.id, { logo_path: path });
}
export async function removeLogo(company: Company): Promise<void> {
  if (company.logo_path) await supabase.storage.from('company-assets').remove([company.logo_path]);
  await updateCompany(company.id, { logo_path: null });
}
/** URL firmada temporal (el bucket es privado). */
export async function logoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from('company-assets').createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
export async function logoBytes(path: string | null): Promise<Uint8Array | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from('company-assets').download(path);
  return data ? new Uint8Array(await data.arrayBuffer()) : null;
}

// ---------- Equipo ----------
export async function listTeam(companyId: string): Promise<TeamMember[]> {
  const ms = unwrap<{ user_id: string; role: Role }[]>(await supabase.from('memberships').select('user_id, role').eq('company_id', companyId));
  const ids = ms.map((m) => m.user_id);
  const ps = ids.length ? unwrap<{ id: string; full_name: string | null; email: string | null }[]>(await supabase.from('profiles').select('id, full_name, email').in('id', ids)) : [];
  return ms.map((m) => {
    const p = ps.find((x) => x.id === m.user_id);
    return { user_id: m.user_id, role: m.role, full_name: p?.full_name ?? null, email: p?.email ?? null };
  });
}
export async function setMemberRole(companyId: string, userId: string, role: Role): Promise<void> {
  const { error } = await supabase.from('memberships').update({ role }).eq('company_id', companyId).eq('user_id', userId);
  if (error) throw error;
}
export async function removeMember(companyId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('memberships').delete().eq('company_id', companyId).eq('user_id', userId);
  if (error) throw error;
}
export async function listInvitations(companyId: string): Promise<Invitation[]> {
  return unwrap(await supabase.from('invitations').select('id, email, role, created_at, expires_at').eq('company_id', companyId).order('created_at', { ascending: false }));
}
export async function createInvitation(companyId: string, email: string, role: Role): Promise<void> {
  const { error } = await supabase.from('invitations').upsert({ company_id: companyId, email, role }, { onConflict: 'company_id,email' });
  if (error) throw error;
}
export async function deleteInvitation(id: string): Promise<void> {
  const { error } = await supabase.from('invitations').delete().eq('id', id);
  if (error) throw error;
}
export async function acceptInvitations(): Promise<number> {
  const { data, error } = await supabase.rpc('accept_invitations');
  if (error) throw error;
  return (data as number) ?? 0;
}
