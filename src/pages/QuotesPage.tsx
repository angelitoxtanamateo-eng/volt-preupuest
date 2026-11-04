import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listQuotes } from '../lib/api';
import { formatMoney, formatQuoteNumber } from '../lib/money';
import { formatDateAR, todayIso } from '../lib/dates';
import { effectiveStatus, STATUS_LABEL, type QuoteStatus } from '../lib/status';
import { Empty, ErrorBox, PageHeader, Spinner, StatusBadge } from '../components/ui';
import { useAuth } from '../app/AuthProvider';

const FILTERS: (QuoteStatus | 'all')[] = ['all', 'draft', 'sent', 'accepted', 'rejected', 'expired'];

export function QuotesPage() {
  const { company } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<QuoteStatus | 'all'>('all');
  const quotes = useQuery({ queryKey: ['quotes', company!.id], queryFn: () => listQuotes(company!.id) });
  const today = todayIso();
  const term = q.trim().toLowerCase();
  const rows = (quotes.data ?? [])
    .map((x) => ({ ...x, eff: effectiveStatus(x.status, x.valid_until, today) }))
    .filter((x) => (status === 'all' || x.eff === status) && (!term || x.title.toLowerCase().includes(term) || (x.clients?.name ?? '').toLowerCase().includes(term) || formatQuoteNumber(x.number).includes(term)));

  return (
    <>
      <PageHeader
        title="Presupuestos"
        actions={
          <>
            <Link className="btn btn-accent" to="/presupuestos/nuevo?voz=1">🎙 Dictar</Link>
            <Link className="btn btn-primary" to="/presupuestos/nuevo">+ Nuevo</Link>
          </>
        }
      />
      <input className="input mb-3" placeholder="Buscar por cliente, título o número…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar presupuestos" />
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filtrar por estado">
        {FILTERS.map((f) => (
          <button key={f} role="tab" aria-selected={status === f} onClick={() => setStatus(f)} className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${status === f ? 'bg-volt-900 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>
            {f === 'all' ? 'Todos' : STATUS_LABEL[f]}
          </button>
        ))}
      </div>
      {quotes.isLoading ? <Spinner /> : quotes.error ? <ErrorBox error={quotes.error} onRetry={() => void quotes.refetch()} /> : rows.length ? (
        <ul className="card divide-y divide-slate-100">
          {rows.map((x) => (
            <li key={x.id}>
              <Link to={`/presupuestos/${x.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-volt-50">
                <div className="min-w-0">
                  <p className="truncate font-semibold">N° {formatQuoteNumber(x.number)} · {x.title}</p>
                  <p className="truncate text-sm text-slate-500">{x.clients?.name ?? 'Sin cliente'} · {formatDateAR(x.issue_date)}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{formatMoney(x.total, x.currency)}</p>
                  <StatusBadge status={x.eff} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : <Empty title={term || status !== 'all' ? 'Sin resultados' : 'Todavía no hay presupuestos'} hint="Podés dictar el trabajo y revisarlo antes de guardar." action={<Link className="btn btn-accent" to="/presupuestos/nuevo?voz=1">🎙 Dictar el primero</Link>} />}
    </>
  );
}
