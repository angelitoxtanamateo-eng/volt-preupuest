import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listQuotes, quoteStats, recentClients } from '../lib/api';
import { formatMoney } from '../lib/money';
import { todayIso } from '../lib/dates';
import { effectiveStatus } from '../lib/status';
import { Empty, ErrorBox, PageHeader, Spinner, StatusBadge } from '../components/ui';
import { useAuth } from '../app/AuthProvider';

function Kpi({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold ${accent ?? ''}`}>{value}</p>
    </div>
  );
}

export function DashboardPage() {
  const { company } = useAuth();
  const cid = company!.id;
  const stats = useQuery({ queryKey: ['stats', cid], queryFn: () => quoteStats(cid) });
  const quotes = useQuery({ queryKey: ['quotes', cid, 'recent'], queryFn: () => listQuotes(cid, 5) });
  const clients = useQuery({ queryKey: ['clients', cid, 'recent'], queryFn: () => recentClients(cid, 5) });

  if (stats.isLoading) return <Spinner />;
  if (stats.error) return <ErrorBox error={stats.error} onRetry={() => void stats.refetch()} />;

  const rows = stats.data ?? [];
  const sum = (k: 'total_quotes' | 'accepted' | 'pending' | 'rejected' | 'expired') => rows.reduce((a, r) => a + Number(r[k]), 0);
  const mine = rows.find((r) => r.currency === company!.currency);
  const money = (n: number) => formatMoney(n, company!.currency);
  const otherCurrencies = rows.filter((r) => r.currency !== company!.currency).map((r) => r.currency);

  return (
    <>
      <PageHeader
        title="Inicio"
        subtitle="Resumen de tus presupuestos"
        actions={
          <>
            <Link className="btn btn-accent" to="/presupuestos/nuevo?voz=1">🎙 Dictar presupuesto</Link>
            <Link className="btn btn-primary" to="/presupuestos/nuevo">+ Nuevo</Link>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Presupuestos" value={sum('total_quotes')} />
        <Kpi label="Aceptados" value={sum('accepted')} accent="text-emerald-700" />
        <Kpi label="Pendientes" value={sum('pending')} accent="text-volt-700" />
        <Kpi label="Rechazados / vencidos" value={`${sum('rejected')} / ${sum('expired')}`} accent="text-red-700" />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Kpi label="Total presupuestado" value={money(Number(mine?.total_amount ?? 0))} />
        <Kpi label="Total aceptado" value={money(Number(mine?.accepted_amount ?? 0))} accent="text-emerald-700" />
      </div>
      {otherCurrencies.length > 0 && (
        <p className="mt-2 text-sm text-slate-500">Los montos muestran solo {company!.currency}. Tenés presupuestos en otra moneda ({otherCurrencies.join(', ')}) que no se suman acá.</p>
      )}

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <section>
          <h2 className="mb-2 text-lg font-bold">Últimos presupuestos</h2>
          {quotes.isLoading ? <Spinner /> : quotes.error ? <ErrorBox error={quotes.error} /> : quotes.data?.length ? (
            <ul className="card divide-y divide-slate-100">
              {quotes.data.map((q) => (
                <li key={q.id}>
                  <Link to={`/presupuestos/${q.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-volt-50">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">N° {String(q.number).padStart(4, '0')} · {q.title}</p>
                      <p className="truncate text-sm text-slate-500">{q.clients?.name ?? 'Sin cliente'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{formatMoney(q.total, q.currency)}</p>
                      <StatusBadge status={effectiveStatus(q.status, q.valid_until, todayIso())} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <Empty title="Todavía no hay presupuestos" hint="Creá el primero dictándolo o escribiéndolo." />}
        </section>
        <section>
          <h2 className="mb-2 text-lg font-bold">Clientes recientes</h2>
          {clients.isLoading ? <Spinner /> : clients.error ? <ErrorBox error={clients.error} /> : clients.data?.length ? (
            <ul className="card divide-y divide-slate-100">
              {clients.data.map((c) => (
                <li key={c.id}>
                  <Link to={`/clientes/${c.id}`} className="block p-3 hover:bg-volt-50">
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-sm text-slate-500">{c.phone ?? 'Sin teléfono'}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <Empty title="Todavía no hay clientes" action={<Link className="btn btn-primary" to="/clientes">Agregar cliente</Link>} />}
        </section>
      </div>
    </>
  );
}
