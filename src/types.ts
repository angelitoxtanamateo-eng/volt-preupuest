import type { QuoteStatus } from './lib/status';
import type { ItemKind } from './lib/validation';

export type Role = 'admin' | 'employee';

export interface Company {
  id: string;
  name: string;
  logo_path: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_id: string | null;
  currency: string;
  default_validity_days: number;
  payment_terms: string;
}

export interface Membership {
  company_id: string;
  role: Role;
  companies: Company;
}

export interface Client {
  id: string;
  company_id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
}

export interface CatalogItem {
  id: string;
  company_id: string;
  kind: ItemKind;
  name: string;
  unit: string;
  unit_price: number;
  active: boolean;
}

export interface QuoteRow {
  id: string;
  company_id: string;
  number: number;
  client_id: string | null;
  title: string;
  description: string | null;
  status: QuoteStatus;
  currency: string;
  subtotal: number;
  discount_pct: number;
  discount_amount: number;
  travel_cost: number;
  total: number;
  payment_terms: string | null;
  issue_date: string;
  valid_until: string | null;
  created_at: string;
  clients?: { name: string } | null;
}

export interface QuoteItemRow {
  id: string;
  catalog_item_id: string | null;
  kind: ItemKind;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
  position: number;
}

export interface QuoteEvent {
  id: number;
  event: string;
  detail: Record<string, unknown>;
  created_at: string;
  actor_id: string | null;
}

export interface QuoteStatsRow {
  company_id: string;
  currency: string;
  total_quotes: number;
  accepted: number;
  pending: number;
  rejected: number;
  expired: number;
  total_amount: number;
  accepted_amount: number;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  created_at: string;
  expires_at: string;
}

export interface TeamMember {
  user_id: string;
  role: Role;
  full_name: string | null;
  email: string | null;
}
