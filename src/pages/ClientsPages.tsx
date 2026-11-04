import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteClient, getClient, listClients, quotesOfClient, saveClient } from '../lib/api';
import { humanizeError } from '../lib/errors';
import { formatMoney } from '../lib/money';
import { todayIso, formatDateAR } from '../lib/dates';
import { effectiveStatus } from '../lib/status';
import { validateClient, type Errors } from '../lib/validation';
import { Confirm, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, StatusBadge, useToast } from '../components/ui';
import { useAuth } from '../app/AuthProvider';
import type { Client } from '../types';

function ClientForm({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const { company } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: client?.name ?? '', phone: client?.phone ?? '', address: client?.address ?? '', notes: client?.notes ?? '' });
  const [errors, setErrors] = useState<Errors>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      const v = validateClient(f);
      if (!v.ok) {
        setErrors(v.errors);
        throw new Error('__validation__');
      }
      setErrors({});
      await saveClient(company!.id, client?.id ?? null, v.value);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['clients'] });
      toast(client ? 'Cliente actualizado' : 'Cliente creado');
      onClose();
    },
    onError: (e) => e instanceof Error && e.message === '__validation__' ? undefined : toast(humanizeError(e), 'error'),
  });

  return (
    <Modal title={client ? 'Editar cliente' : 'Nuevo cliente'} onClose={onClose}>
      <form className="space-y-4" noValidate onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Nombre" error={errors.name} htmlFor="cn"><input id="cn" className="input" value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Teléfono / WhatsApp" error={errors.phone} hint="Ej: 358 5625480 (con código de área, sin 0 ni 15)" htmlFor="cp"><input id="cp" className="input" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Dirección" htmlFor="ca"><input id="ca" className="input" value={f.address} onChange={set('address')} /></Field>
        <Field label="Notas" htmlFor="cno"><textarea id="cno" className="input" rows={2} value={f.notes} onChange={set('notes')} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ClientsPage() {
  const { company } = useAuth();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Client | 'new' | null>(null);
  const clients = useQuery({ queryKey: ['clients', company!.id], queryFn: () => listClients(company!.id) });
  const term = q.trim().toLowerCase();
  const rows = (clients.data ?? []).filter((c) => !term || c.name.toLowerCase().includes(term) || (c.phone ?? '').includes(term));

  return (
    <>
      <PageHeader title="Clientes" actions={<button className="btn btn-primary" onClick={() => setEditing('new')}>+ Nuevo cliente</button>} />
      <input className="input mb-4" placeholder="Buscar por nombre o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar clientes" />
      {clients.isLoading ? <Spinner /> : clients.error ? <ErrorBox error={clients.error} onRetry={() => void clients.refetch()} /> : rows.length ? (
        <ul className="card divide-y divide-slate-100">
          {rows.map((c) => (
            <li key={c.id}>
              <Link to={`/clientes/${c.id}`} className="block p-3 hover:bg-volt-50">
                <p className="font-semibold">{c.name}</p>
                <p className="text-sm text-slate-500">{[c.phone, c.address].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</p>
              </Link>
            </li>
          ))}
        </ul>
      ) : <Empty title={term ? 'Sin resultados' : 'Todavía no hay clientes'} hint={term ? undefined : 'Cargá tu primer cliente para asociarlo a presupuestos.'} />}
      {editing && <ClientForm client={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const client = useQuery({ queryKey: ['client', id], queryFn: () => getClient(id) });
  const quotes = useQuery({ queryKey: ['quotes', 'client', id], queryFn: () => quotesOfClient(id) });
  const del = useMutation({
    mutationFn: () => deleteClient(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['clients'] }); toast('Cliente eliminado'); nav('/clientes'); },
    onError: (e) => toast(humanizeError(e), 'error'),
  });

  if (client.isLoading) return <Spinner />;
  if (client.error || !client.data) return <ErrorBox error={client.error ?? 'No se encontró el cliente.'} />;
  const c = client.data;

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={[c.phone, c.address].filter(Boolean).join(' · ')}
        actions={
          <>
            <Link className="btn btn-accent" to={`/presupuestos/nuevo?cliente=${c.id}`}>+ Presupuesto</Link>
            <button className="btn btn-ghost" onClick={() => setEditing(true)}>Editar</button>
            {isAdmin && <button className="btn btn-danger" onClick={() => setConfirm(true)}>Eliminar</button>}
          </>
        }
      />
      {c.notes && <p className="card mb-4 p-3 text-slate-600">{c.notes}</p>}
      <h2 className="mb-2 text-lg font-bold">Historial de presupuestos</h2>
      {quotes.isLoading ? <Spinner /> : quotes.error ? <ErrorBox error={quotes.error} /> : quotes.data?.length ? (
        <ul className="card divide-y divide-slate-100">
          {quotes.data.map((q) => (
            <li key={q.id}>
              <Link to={`/presupuestos/${q.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-volt-50">
                <div>
                  <p className="font-semibold">N° {String(q.number).padStart(4, '0')} · {q.title}</p>
                  <p className="text-sm text-slate-500">{formatDateAR(q.issue_date)}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{formatMoney(q.total, q.currency)}</p>
                  <StatusBadge status={effectiveStatus(q.status, q.valid_until, todayIso())} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : <Empty title="Este cliente todavía no tiene presupuestos" />}
      {editing && <ClientForm client={c} onClose={() => { setEditing(false); void client.refetch(); }} />}
      {confirm && <Confirm title="Eliminar cliente" message="Sus presupuestos se conservan, pero quedan sin cliente asociado. No se puede deshacer." onConfirm={() => del.mutate()} onCancel={() => setConfirm(false)} />}
    </>
  );
}
