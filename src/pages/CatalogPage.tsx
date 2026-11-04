import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteCatalogItem, listCatalog, listCosts, saveCatalogItem } from '../lib/api';
import { humanizeError } from '../lib/errors';
import { formatMoney, parseNumberInput } from '../lib/money';
import { marginPct } from '../lib/quoteMath';
import { KIND_LABEL, validateCatalogItem, type Errors, type ItemKind } from '../lib/validation';
import { Confirm, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, useToast } from '../components/ui';
import { useAuth } from '../app/AuthProvider';
import type { CatalogItem } from '../types';

function ItemForm({ item, cost, onClose }: { item: CatalogItem | null; cost: number | undefined; onClose: () => void }) {
  const { company } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    kind: (item?.kind ?? 'material') as ItemKind,
    name: item?.name ?? '',
    unit: item?.unit ?? 'u',
    unitPrice: item ? String(item.unit_price).replace('.', ',') : '',
    unitCost: cost !== undefined ? String(cost).replace('.', ',') : '',
    active: item?.active ?? true,
  });
  const [errors, setErrors] = useState<Errors>({});
  const set = (k: 'name' | 'unit' | 'unitPrice' | 'unitCost') => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const price = parseNumberInput(f.unitPrice);
  const costN = f.unitCost.trim() ? parseNumberInput(f.unitCost) : null;
  const margin = price !== null && costN !== null ? marginPct(price, costN) : null;

  const save = useMutation({
    mutationFn: async () => {
      const v = validateCatalogItem(f);
      if (!v.ok) {
        setErrors(v.errors);
        throw new Error('__validation__');
      }
      setErrors({});
      await saveCatalogItem(company!.id, item?.id ?? null, v.value.data, v.value.cost);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalog'] });
      toast('Catálogo actualizado');
      onClose();
    },
    onError: (e) => e instanceof Error && e.message === '__validation__' ? undefined : toast(humanizeError(e), 'error'),
  });

  return (
    <Modal title={item ? 'Editar ítem' : 'Nuevo ítem'} onClose={onClose}>
      <form className="space-y-4" noValidate onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Tipo" htmlFor="ik">
          <select id="ik" className="input" value={f.kind} onChange={(e) => setF((s) => ({ ...s, kind: e.target.value as ItemKind }))}>
            {(Object.keys(KIND_LABEL) as ItemKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Nombre" error={errors.name} htmlFor="in"><input id="in" className="input" value={f.name} onChange={set('name')} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unidad" error={errors.unit} hint="u, m, m2, hs, kg…" htmlFor="iu"><input id="iu" className="input" value={f.unit} onChange={set('unit')} /></Field>
          <Field label="Precio de venta" error={errors.unitPrice} htmlFor="ip"><input id="ip" className="input" inputMode="decimal" value={f.unitPrice} onChange={set('unitPrice')} /></Field>
        </div>
        <Field label="Costo (solo lo ven los administradores)" error={errors.unitCost} hint={margin !== null ? `Margen: ${String(margin).replace('.', ',')}%` : 'Opcional. Sirve para calcular tu margen.'} htmlFor="ic">
          <input id="ic" className="input" inputMode="decimal" value={f.unitCost} onChange={set('unitCost')} />
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF((s) => ({ ...s, active: e.target.checked }))} /> Activo (aparece al armar presupuestos)</label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function CatalogPage() {
  const { company, isAdmin } = useAuth();
  const cid = company!.id;
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<ItemKind | 'all'>('all');
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<CatalogItem | null>(null);
  const items = useQuery({ queryKey: ['catalog', cid], queryFn: () => listCatalog(cid) });
  const costs = useQuery({ queryKey: ['catalog-costs', cid], queryFn: () => listCosts(cid), enabled: isAdmin });
  const del = useMutation({
    mutationFn: (id: string) => deleteCatalogItem(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['catalog'] }); void qc.invalidateQueries({ queryKey: ['catalog-costs'] }); toast('Ítem eliminado'); setToDelete(null); },
    onError: (e) => toast(humanizeError(e), 'error'),
  });

  const term = q.trim().toLowerCase();
  const rows = (items.data ?? []).filter((i) => (kind === 'all' || i.kind === kind) && (!term || i.name.toLowerCase().includes(term)));
  const money = (n: number) => formatMoney(n, company!.currency);

  return (
    <>
      <PageHeader
        title="Catálogo"
        subtitle={isAdmin ? 'Servicios y materiales con precio de venta, costo y margen' : 'Servicios y materiales con su precio de venta'}
        actions={isAdmin ? <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Nuevo ítem</button> : undefined}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input flex-1" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar en el catálogo" />
        <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value as ItemKind | 'all')} aria-label="Filtrar por tipo">
          <option value="all">Todos</option>
          {(Object.keys(KIND_LABEL) as ItemKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </div>
      {items.isLoading ? <Spinner /> : items.error ? <ErrorBox error={items.error} onRetry={() => void items.refetch()} /> : rows.length ? (
        <ul className="card divide-y divide-slate-100">
          {rows.map((i) => {
            const cost = costs.data?.[i.id];
            const m = cost !== undefined ? marginPct(i.unit_price, cost) : null;
            return (
              <li key={i.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className={`truncate font-semibold ${i.active ? '' : 'text-slate-400 line-through'}`}>{i.name}</p>
                  <p className="text-sm text-slate-500">{KIND_LABEL[i.kind]} · por {i.unit}{isAdmin && cost !== undefined ? ` · costo ${money(cost)}${m !== null ? ` · margen ${String(m).replace('.', ',')}%` : ''}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="font-bold">{money(i.unit_price)}</p>
                  {isAdmin && (
                    <>
                      <button className="btn btn-ghost min-h-9 px-3" onClick={() => setEditing(i)} aria-label={`Editar ${i.name}`}>✎</button>
                      <button className="btn btn-danger min-h-9 px-3" onClick={() => setToDelete(i)} aria-label={`Eliminar ${i.name}`}>🗑</button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : <Empty title={term || kind !== 'all' ? 'Sin resultados' : 'El catálogo está vacío'} hint={isAdmin ? 'Cargá tus servicios y materiales habituales: el dictado por voz usa estos precios.' : 'Un administrador tiene que cargarlo.'} />}
      {editing && <ItemForm item={editing === 'new' ? null : editing} cost={editing === 'new' ? undefined : costs.data?.[editing.id]} onClose={() => setEditing(null)} />}
      {toDelete && <Confirm title="Eliminar ítem" message={`"${toDelete.name}" se quita del catálogo. Los presupuestos ya hechos no cambian.`} onConfirm={() => del.mutate(toDelete.id)} onCancel={() => setToDelete(null)} />}
    </>
  );
}
