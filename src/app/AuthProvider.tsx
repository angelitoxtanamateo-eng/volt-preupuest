import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { acceptInvitations } from '../lib/api';
import type { Company, Membership, Role } from '../types';

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  memberships: Membership[];
  company: Company | null;
  role: Role | null;
  isAdmin: boolean;
  joinedByInvite: number;
  setActiveCompany: (id: string) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuera de AuthProvider');
  return v;
}

const KEY = 'volt.activeCompany';
const readActive = (): string | null => {
  try { return localStorage.getItem(KEY); } catch { return null; }
};
const writeActive = (id: string) => {
  try { localStorage.setItem(KEY, id); } catch { /* modo privado: no pasa nada */ }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeId, setActiveId] = useState<string | null>(readActive());
  const [joinedByInvite, setJoined] = useState(0);
  const uid = session?.user.id ?? null;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    // Importante: dentro de este callback NO se llama a otras funciones de supabase (riesgo de bloqueo).
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) {
        setMemberships([]);
        setLoading(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async (userId: string) => {
    try {
      const n = await acceptInvitations().catch(() => 0); // si falla, simplemente no hay invitaciones que aplicar
      setJoined(n);
      const { data, error } = await supabase.from('memberships').select('company_id, role, companies(*)').eq('user_id', userId);
      if (error) throw error;
      setMemberships((data ?? []) as unknown as Membership[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (uid) {
      setLoading(true);
      void load(uid);
    }
  }, [uid, load]);

  const refresh = useCallback(async () => {
    if (uid) await load(uid);
  }, [uid, load]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    qc.clear();
    setMemberships([]);
  }, [qc]);

  const value = useMemo<AuthState>(() => {
    const active = memberships.find((m) => m.company_id === activeId) ?? memberships[0] ?? null;
    return {
      session,
      user: session?.user ?? null,
      loading,
      memberships,
      company: active?.companies ?? null,
      role: active?.role ?? null,
      isAdmin: active?.role === 'admin',
      joinedByInvite,
      setActiveCompany: (id: string) => {
        writeActive(id);
        setActiveId(id);
        qc.clear();
      },
      refresh,
      signOut,
    };
  }, [session, loading, memberships, activeId, joinedByInvite, refresh, signOut, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
