import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { adminListCompanies, adminSetPlan, isPlatformAdmin, type AdminCompanyRow } from '../lib/api';
import { addDays, formatDateAR, isIsoDate, todayIso } from '../lib/dates';
import { humanizeError } from '../lib/errors';
import { accountCode, formatPlanPrice, PLANS, type PlanCode } from '../lib/plans';
import { Confirm, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, useToast } from '../components/ui';

type Filter = 'pendientes' | 'todas';

function PlanModal({ row, onClose }: { row: AdminCompanyRow; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [plan, setPlan] = useState<PlanCode>(row.requested_plan ?? (row.plan === 'free' ? 'emprendedor' : row.plan));
  const [expires, setExpires] = useState(row.plan !== 'free' && row.plan_expires_at && row.plan_expires_at >= todayIso() ? row.plan_expires_at : addDays(todayIso(), 30));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (plan !== 'free' && (!isIsoDate(expires) || expires < todayIso())) {
        setError('Indicá una fecha de vencimiento válida, de hoy en adelante.');
        throw new Error('__validation__');
      }
      setError(null);
      await adminSetPlan(row.company_id, plan, plan === 'free' ? null : expires);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-companies'] });
      toast(plan === 'free' ? 'La empresa volvió a Free' : `Plan ${PLANS[plan].name} activado`);
      onClose();
    },
    onError: (e) => {
      if (!(e instanceof Error && e.message === '__validation__')) toast(humanizeError(e), 'error');
    },
  });

  return (
    <Modal title={`Plan de ${row.company_name}`} onClose={onClose}>
      <div className="space-y-4">
        {row.requested_plan && (
          <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
            Solicitó <b>{PLANS[row.requested_plan].name}</b> ({formatPlanPrice(row.requested_plan)}/mes). Activá el plan <b>solo después de comprobar el pago</b> en tu cuenta de Mercado Pago.
            {row.payment_reference && <> Referencia que escribió: <b>{row.payment_reference}</b>.</>}
          </p>
        )}
        <Field label="Plan" htmlFor="ad-plan">
          <select id="ad-plan" className="input" value={plan} onChange={(e) => setPlan(e.target.value as PlanCode)}>
            {(['free', 'emprendedor', 'pro'] as const).map((p) => <option key={p} value={p}>{PLANS[p].name} — {formatPlanPrice(p)}/mes</option>)}
          </select>
        </Field>
        {plan !== 'free' && (
          <Field label="Vence el" error={error ?? undefined} htmlFor="ad-exp" hint="Pasada esta fecha, la empresa vuelve a comportarse como Free.">
            <input id="ad-exp" className="input" type="date" min={todayIso()} value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Guardando…' : plan === 'free' ? 'Dejar en Free' : 'Activar plan'}</button>
        </div>
      </div>
    </Modal>
  );
}

function CompanyCard({ row, onEdit, onFree }: { row: AdminCompanyRow; onEdit: () => void; onFree: () => void }) {
  const eff = PLANS[row.effective_plan];
  const expired = row.plan !== 'free' && row.effective_plan === 'free';
  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-lg font-extrabold">{row.company_name}</p>
          <p className="truncate text-sm text-slate-500">{row.admin_emails || 'Sin administrador'}</p>
          <p className="text-xs text-slate-400">Identificador: <span className="font-mono">{accountCode(row.company_id)}</span> · alta {formatDateAR(row.created_at)}</p>
        </div>
        <span className="rounded-full bg-volt-100 px-3 py-1 text-sm font-bold text-volt-700">{eff.name}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-slate-500">Estado</dt>
        <dd className="font-semibold">{row.requested_plan ? <span className="text-amber-700">Pendiente de verificación</span> : expired ? <span className="text-red-600">Plan vencido</span> : 'Activo'}</dd>
        {row.requested_plan && (<><dt className="text-slate-500">Plan solicitado</dt><dd className="font-semibold">{PLANS[row.requested_plan].name} · {formatPlanPrice(row.requested_plan)}/mes</dd><dt className="text-slate-500">Solicitado el</dt><dd>{formatDateAR(row.requested_at)}</dd></>)}
        {row.requested_plan && row.payment_reference && (<><dt className="text-slate-500">Referencia de pago</dt><dd className="break-words font-semibold">{row.payment_reference}</dd></>)}
        {row.plan !== 'free' && (<><dt className="text-slate-500">{expired ? 'Venció el' : 'Vence el'}</dt><dd>{formatDateAR(row.plan_expires_at)}</dd></>)}
        <dt className="text-slate-500">Presupuestos este mes</dt>
        <dd>{row.used}{eff.limit !== null ? ` de ${eff.limit}` : ''}</dd>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={onEdit}>{row.requested_plan ? 'Activar plan' : 'Cambiar plan'}</button>
        {row.plan !== 'free' && <button className="btn btn-danger" onClick={onFree}>Volver a Free</button>}
      </div>
    </li>
  );
}

/** Panel de administración de VOLT. Solo lo ve un administrador de plataforma (la base lo vuelve a verificar en cada operación). */
export function AdminPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('pendientes');
  const [editing, setEditing] = useState<AdminCompanyRow | null>(null);
  const [toFree, setToFree] = useState<AdminCompanyRow | null>(null);
  const [q, setQ] = useState('');

  const me = useQuery({ queryKey: ['platform-admin'], queryFn: isPlatformAdmin, staleTime: 5 * 60 * 1000 });
  const list = useQuery({ queryKey: ['admin-companies'], queryFn: adminListCompanies, enabled: me.data === true });
  const free = useMutation({
    mutationFn: (r: AdminCompanyRow) => adminSetPlan(r.company_id, 'free', null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-companies'] });
      toast('La empresa volvió a Free');
      setToFree(null);
    },
    onError: (e) => toast(humanizeError(e), 'error'),
  });

  if (me.isLoading) return <Spinner />;
  if (me.data !== true) return <Navigate to="/" replace />;

  const rows = list.data ?? [];
  const term = q.trim().toLowerCase();
  const shown = rows.filter((r) => (filter === 'todas' || r.requested_plan !== null) && (!term || r.company_name.toLowerCase().includes(term) || (r.admin_emails ?? '').toLowerCase().includes(term) || accountCode(r.company_id).toLowerCase().includes(term)));
  const pending = rows.filter((r) => r.requested_plan !== null).length;

  return (
    <>
      <PageHeader title="Administración VOLT" subtitle="Verificá los pagos en Mercado Pago y activá los planes" />
      <input className="input mb-3" placeholder="Buscar por empresa, email o identificador…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar empresas" />
      <div className="mb-4 flex gap-2" role="tablist">
        {(['pendientes', 'todas'] as const).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${filter === f ? 'bg-volt-700 text-white shadow-sm' : 'bg-white text-slate-600 border border-volt-100'}`}>
            {f === 'pendientes' ? `Solicitudes (${pending})` : `Todas las empresas (${rows.length})`}
          </button>
        ))}
      </div>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} onRetry={() => void list.refetch()} /> : shown.length ? (
        <ul className="space-y-3">
          {shown.map((r) => <CompanyCard key={r.company_id} row={r} onEdit={() => setEditing(r)} onFree={() => setToFree(r)} />)}
        </ul>
      ) : <Empty title={filter === 'pendientes' ? 'No hay solicitudes pendientes' : 'Sin resultados'} hint="Cuando una empresa solicite un plan pago, aparece acá." />}
      {editing && <PlanModal row={editing} onClose={() => setEditing(null)} />}
      {toFree && <Confirm title="Volver a Free" message={`${toFree.company_name} pasa al plan Free (10 presupuestos por mes). Sus datos no se borran.`} confirmLabel="Volver a Free" onConfirm={() => free.mutate(toFree)} onCancel={() => setToFree(null)} />}
    </>
  );
}
