import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createInvitation, deleteInvitation, listCatalog, listClients, listCosts, listInvitations, listQuotes, listTeam, logoUrl, removeLogo, removeMember, setMemberRole, updateCompany, uploadLogo } from '../lib/api';
import { toCsv } from '../lib/csv';
import { downloadBlob } from '../lib/download';
import { humanizeError } from '../lib/errors';
import { imageFileToPng } from '../lib/logo';
import { supabase } from '../lib/supabase';
import { validateCompany, validateInvitation, validatePassword, type Errors } from '../lib/validation';
import { Confirm, ErrorBox, Field, PageHeader, Spinner, useToast } from '../components/ui';
import { useAuth } from '../app/AuthProvider';
import type { Role } from '../types';

type Tab = 'empresa' | 'equipo' | 'datos' | 'cuenta';
const CURRENCIES = [['ARS', 'Peso argentino (ARS)'], ['USD', 'Dólar (USD)'], ['EUR', 'Euro (EUR)'], ['UYU', 'Peso uruguayo (UYU)'], ['CLP', 'Peso chileno (CLP)'], ['BRL', 'Real (BRL)']];

function CompanyTab() {
  const { company, isAdmin, refresh } = useAuth();
  const c = company!;
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ name: c.name, phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '', taxId: c.tax_id ?? '', currency: c.currency, defaultValidityDays: String(c.default_validity_days), defaultTaxPct: Number(c.default_tax_pct) ? String(Number(c.default_tax_pct)).replace('.', ',') : '', paymentTerms: c.payment_terms });
  const [errors, setErrors] = useState<Errors>({});
  const logo = useQuery({ queryKey: ['logo', c.id, c.logo_path], queryFn: () => logoUrl(c.logo_path) });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      const v = validateCompany(f);
      if (!v.ok) { setErrors(v.errors); throw new Error('__validation__'); }
      setErrors({});
      await updateCompany(c.id, v.value);
    },
    onSuccess: async () => { await refresh(); toast('Datos guardados'); },
    onError: (e) => (e instanceof Error && e.message === '__validation__' ? undefined : toast(humanizeError(e), 'error')),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => uploadLogo(c, await imageFileToPng(file)),
    onSuccess: async () => { await refresh(); void qc.invalidateQueries({ queryKey: ['logo'] }); toast('Logo actualizado'); },
    onError: (e) => toast(humanizeError(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: () => removeLogo(c),
    onSuccess: async () => { await refresh(); void qc.invalidateQueries({ queryKey: ['logo'] }); toast('Logo eliminado'); },
    onError: (e) => toast(humanizeError(e), 'error'),
  });

  return (
    <div className="space-y-5">
      <section className="card flex flex-wrap items-center gap-4 p-4">
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
          {logo.data ? <img src={logo.data} alt={`Logo de ${c.name}`} className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-slate-400">Sin logo</span>}
        </div>
        {isAdmin ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-500">Aparece en el PDF de tus presupuestos. PNG, JPG o WebP.</p>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload.mutate(file); e.target.value = ''; }} />
            <div className="flex gap-2">
              <button className="btn btn-ghost" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>{upload.isPending ? 'Subiendo…' : c.logo_path ? 'Cambiar logo' : 'Subir logo'}</button>
              {c.logo_path && <button className="btn btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>Quitar</button>}
            </div>
          </div>
        ) : <p className="text-sm text-slate-500">Solo un administrador puede cambiar el logo.</p>}
      </section>

      <form className="card space-y-4 p-4" noValidate onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <fieldset disabled={!isAdmin} className="space-y-4">
          <Field label="Nombre del negocio" error={errors.name} htmlFor="s-n"><input id="s-n" className="input" value={f.name} onChange={set('name')} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Teléfono" error={errors.phone} htmlFor="s-p"><input id="s-p" className="input" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
            <Field label="Email" error={errors.email} htmlFor="s-e"><input id="s-e" className="input" type="email" value={f.email} onChange={set('email')} /></Field>
          </div>
          <Field label="Dirección" htmlFor="s-a"><input id="s-a" className="input" value={f.address} onChange={set('address')} /></Field>
          <Field label="CUIT (opcional)" error={errors.taxId} hint="Solo se muestra en el PDF. VOLT no emite facturas." htmlFor="s-t"><input id="s-t" className="input" inputMode="numeric" value={f.taxId} onChange={set('taxId')} placeholder="20-12345678-6" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Moneda" error={errors.currency} hint="Se aplica a los presupuestos nuevos." htmlFor="s-c">
              <select id="s-c" className="input" value={f.currency} onChange={set('currency')}>{CURRENCIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </Field>
            <Field label="Vigencia por defecto (días)" error={errors.defaultValidityDays} htmlFor="s-v"><input id="s-v" className="input" inputMode="numeric" value={f.defaultValidityDays} onChange={set('defaultValidityDays')} /></Field>
          </div>
          <Field label="Impuesto por defecto (%)" error={errors.defaultTaxPct} hint="Se propone en cada presupuesto nuevo (ej.: 21 para IVA). Dejalo vacío si no aplicás impuestos." htmlFor="s-tx"><input id="s-tx" className="input" inputMode="decimal" value={f.defaultTaxPct} onChange={set('defaultTaxPct')} placeholder="0" /></Field>
          <Field label="Condiciones de pago por defecto" htmlFor="s-pt"><textarea id="s-pt" className="input" rows={2} value={f.paymentTerms} onChange={set('paymentTerms')} /></Field>
        </fieldset>
        {isAdmin && <button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Guardando…' : 'Guardar cambios'}</button>}
      </form>
    </div>
  );
}

function TeamTab() {
  const { company, isAdmin, user } = useAuth();
  const cid = company!.id;
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('employee');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [toRemove, setToRemove] = useState<{ id: string; name: string } | null>(null);
  const team = useQuery({ queryKey: ['team', cid], queryFn: () => listTeam(cid) });
  const invites = useQuery({ queryKey: ['invites', cid], queryFn: () => listInvitations(cid), enabled: isAdmin });
  const refreshAll = () => { void qc.invalidateQueries({ queryKey: ['team'] }); void qc.invalidateQueries({ queryKey: ['invites'] }); };

  const invite = useMutation({
    mutationFn: async () => {
      const v = validateInvitation({ email, role });
      if (!v.ok) { setEmailError(v.errors.email); throw new Error('__validation__'); }
      setEmailError(undefined);
      await createInvitation(cid, v.value.email, v.value.role);
    },
    onSuccess: () => { setEmail(''); refreshAll(); toast('Invitación creada'); },
    onError: (e) => (e instanceof Error && e.message === '__validation__' ? undefined : toast(humanizeError(e), 'error')),
  });
  const changeRole = useMutation({ mutationFn: (a: { id: string; role: Role }) => setMemberRole(cid, a.id, a.role), onSuccess: refreshAll, onError: (e) => { toast(humanizeError(e), 'error'); refreshAll(); } });
  const remove = useMutation({ mutationFn: (id: string) => removeMember(cid, id), onSuccess: () => { refreshAll(); setToRemove(null); toast('Integrante quitado'); }, onError: (e) => toast(humanizeError(e), 'error') });
  const revoke = useMutation({ mutationFn: (id: string) => deleteInvitation(id), onSuccess: refreshAll, onError: (e) => toast(humanizeError(e), 'error') });

  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-lg font-bold">Integrantes</h2>
        {team.isLoading ? <Spinner /> : team.error ? <ErrorBox error={team.error} /> : (
          <ul className="card divide-y divide-slate-100">
            {team.data?.map((m) => {
              const me = m.user_id === user?.id;
              const name = m.full_name ?? m.email ?? 'Sin nombre';
              return (
                <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="min-w-0"><p className="truncate font-semibold">{name}{me && ' (vos)'}</p><p className="truncate text-sm text-slate-500">{m.email}</p></div>
                  {isAdmin && !me ? (
                    <div className="flex items-center gap-2">
                      <select className="input w-auto" value={m.role} aria-label={`Rol de ${name}`} onChange={(e) => changeRole.mutate({ id: m.user_id, role: e.target.value as Role })}>
                        <option value="employee">Empleado</option><option value="admin">Administrador</option>
                      </select>
                      <button className="btn btn-danger min-h-9 px-3" onClick={() => setToRemove({ id: m.user_id, name })} aria-label={`Quitar a ${name}`}>✕</button>
                    </div>
                  ) : <span className="text-sm font-semibold text-slate-600">{m.role === 'admin' ? 'Administrador' : 'Empleado'}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {isAdmin && (
        <section className="card space-y-3 p-4">
          <h2 className="text-lg font-bold">Invitar a alguien</h2>
          <p className="text-sm text-slate-500">Cargá su email. Cuando se registre (o ingrese) con ese mismo email ya confirmado, entra automáticamente a tu empresa con el rol elegido. Avisale por WhatsApp.</p>
          <form className="flex flex-wrap items-start gap-2" noValidate onSubmit={(e: FormEvent) => { e.preventDefault(); invite.mutate(); }}>
            <div className="min-w-[14rem] flex-1"><Field label="Email" error={emailError} htmlFor="inv"><input id="inv" className="input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field></div>
            <div><Field label="Rol" htmlFor="inv-r"><select id="inv-r" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="employee">Empleado</option><option value="admin">Administrador</option></select></Field></div>
            <button className="btn btn-primary mt-6" disabled={invite.isPending}>Invitar</button>
          </form>
          {invites.data && invites.data.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {invites.data.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                  <span className="truncate">{i.email} · {i.role === 'admin' ? 'Administrador' : 'Empleado'} · pendiente</span>
                  <button className="btn btn-ghost min-h-9 px-3" onClick={() => revoke.mutate(i.id)}>Cancelar</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {toRemove && <Confirm title="Quitar integrante" message={`${toRemove.name} deja de tener acceso a esta empresa.`} confirmLabel="Quitar" onConfirm={() => remove.mutate(toRemove.id)} onCancel={() => setToRemove(null)} />}
    </div>
  );
}

function DataTab() {
  const { company, isAdmin } = useAuth();
  const cid = company!.id;
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(name: string, fn: () => Promise<{ csv: string; file: string }>) {
    setBusy(name);
    try {
      const { csv, file } = await fn();
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), file);
    } catch (e) {
      toast(humanizeError(e), 'error');
    } finally {
      setBusy(null);
    }
  }
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-4">
        <h2 className="text-lg font-bold">Exportar tus datos (CSV)</h2>
        <p className="text-sm text-slate-500">Archivos que abrís con Excel o Google Sheets. Es tu copia propia, además de los backups del sistema.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost" disabled={busy !== null} onClick={() => void run('c', async () => ({ file: `clientes-${stamp}.csv`, csv: toCsv(await listClients(cid), [{ header: 'Nombre', value: (r) => r.name }, { header: 'Teléfono', value: (r) => r.phone }, { header: 'Dirección', value: (r) => r.address }, { header: 'Notas', value: (r) => r.notes }]) }))}>Clientes</button>
          <button className="btn btn-ghost" disabled={busy !== null} onClick={() => void run('q', async () => ({ file: `presupuestos-${stamp}.csv`, csv: toCsv(await listQuotes(cid), [{ header: 'Número', value: (r) => r.number }, { header: 'Fecha', value: (r) => r.issue_date }, { header: 'Cliente', value: (r) => r.clients?.name }, { header: 'Título', value: (r) => r.title }, { header: 'Estado', value: (r) => r.status }, { header: 'Moneda', value: (r) => r.currency }, { header: 'Subtotal', value: (r) => Number(r.subtotal) }, { header: 'Descuento', value: (r) => Number(r.discount_amount) }, { header: 'Traslado', value: (r) => Number(r.travel_cost) }, { header: 'Total', value: (r) => Number(r.total) }, { header: 'Vigencia', value: (r) => r.valid_until }]) }))}>Presupuestos</button>
          <button className="btn btn-ghost" disabled={busy !== null} onClick={() => void run('k', async () => { const [items, costs] = await Promise.all([listCatalog(cid), isAdmin ? listCosts(cid) : Promise.resolve({} as Record<string, number>)]); const cols = [{ header: 'Tipo', value: (r: (typeof items)[number]) => r.kind }, { header: 'Nombre', value: (r: (typeof items)[number]) => r.name }, { header: 'Unidad', value: (r: (typeof items)[number]) => r.unit }, { header: 'Precio', value: (r: (typeof items)[number]) => Number(r.unit_price) }, ...(isAdmin ? [{ header: 'Costo', value: (r: (typeof items)[number]) => costs[r.id] }] : [])]; return { file: `catalogo-${stamp}.csv`, csv: toCsv(items, cols) }; })}>Catálogo</button>
        </div>
      </section>
      <section className="card space-y-2 p-4 text-sm text-slate-600">
        <h2 className="text-lg font-bold text-volt-900">Copias de seguridad</h2>
        <p>Tus datos viven en una base de datos real. Las copias automáticas dependen del plan de Supabase del proyecto y del procedimiento de respaldo que configure quien administra el sistema (ver <code>DEPLOY.md</code>).</p>
      </section>
    </div>
  );
}

function AccountTab() {
  const { user, signOut } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | undefined>();
  async function change(e: FormEvent) {
    e.preventDefault();
    const pe = validatePassword(pw);
    if (pe) return setError(pe);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    if (err) return setError(humanizeError(err));
    setPw(''); setError(undefined); toast('Contraseña actualizada');
  }
  return (
    <div className="space-y-4">
      <section className="card p-4"><p className="text-sm text-slate-500">Sesión iniciada como</p><p className="font-bold">{user?.email}</p></section>
      <form className="card space-y-3 p-4" onSubmit={change} noValidate>
        <Field label="Contraseña nueva" error={error} hint="Mínimo 8 caracteres." htmlFor="np"><input id="np" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <button className="btn btn-primary">Cambiar contraseña</button>
      </form>
      <button className="btn btn-danger" onClick={() => void signOut()}>Cerrar sesión</button>
    </div>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('empresa');
  const tabs: [Tab, string][] = [['empresa', 'Empresa'], ['equipo', 'Equipo'], ['datos', 'Datos'], ['cuenta', 'Mi cuenta']];
  return (
    <>
      <PageHeader title="Ajustes" />
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${tab === k ? 'bg-volt-700 text-white shadow-sm' : 'bg-white text-slate-600 border border-volt-100'}`}>{l}</button>)}
      </div>
      {tab === 'empresa' && <CompanyTab />}
      {tab === 'equipo' && <TeamTab />}
      {tab === 'datos' && <DataTab />}
      {tab === 'cuenta' && <AccountTab />}
    </>
  );
}
