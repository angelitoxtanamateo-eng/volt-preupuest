import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listQuotes, quoteMonthStats, quoteStats, recentClients } from '../lib/api';
import { formatMoney } from '../lib/money';
import { todayIso } from '../lib/dates';
import { effectiveStatus } from '../lib/status';
import { Empty, ErrorBox, PageHeader, Spinner, StatusBadge } from '../components/ui';
import { useAuth } from '../app/AuthProvider';

function Kpi({ label, value, accent, hint }: { label: string; value: string | number; accent?: string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold tracking-tight ${accent ?? ''}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

const SHORTCUTS = [
  { to: '/presupuestos/nuevo?voz=1', label: 'Dictar presupuesto', d: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM5 11a7 7 0 0 0 14 0M12 18v3' },
  { to: '/presupuestos/nuevo', label: 'Nuevo presupuesto', d: 'M12 5v14M5 12h14' },
  { to: '/clientes', label: 'Clientes', d: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-3A3.5 3.5 0 0 0 6 17.5V19M11 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z' },
  { to: '/presupuestos', label: 'Historial', d: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5' },
  { to: '/calculadora', label: 'Calculadora', d: 'M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01' },
  { to: '/ajustes', label: 'Configuración', d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z' },
];

export function DashboardPage() {
  const { company } = useAuth();
  const cid = company!.id;
  const stats = useQuery({ queryKey: ['stats', cid], queryFn: () => quoteStats(cid) });
  const month = useQuery({ queryKey: ['stats', 'month', cid], queryFn: () => quoteMonthStats(cid) });
  const quotes = useQuery({ queryKey: ['quotes', cid, 'recent'], queryFn: () => listQuotes(cid, 5) });
  const clients = useQuery({ queryKey: ['clients', cid, 'recent'], queryFn: () => recentClients(cid, 5) });

  if (stats.isLoading) return <Spinner />;
  if (stats.error) return <ErrorBox error={stats.error} onRetry={() => void stats.refetch()} />;

  const rows = stats.data ?? [];
  const mine = rows.find((r) => r.currency === company!.currency);
  const mineMonth = (month.data ?? []).find((r) => r.currency === company!.currency);
  const money = (n: number) => formatMoney(n, company!.currency);
  const otherCurrencies = rows.filter((r) => r.currency !== company!.currency).map((r) => r.currency);
  const submitted = Number(mineMonth?.submitted ?? 0);
  const conversion = submitted > 0 ? `${Math.round((Number(mineMonth?.accepted ?? 0) / submitted) * 100)} %` : '—';
  const monthName = new Date().toLocaleDateString('es-AR', { month: 'long' });

  return (
    <>
      <PageHeader title="Inicio" subtitle={`Resumen de ${monthName}`} />

      <div className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {SHORTCUTS.map((x) => (
          <Link key={x.to} to={x.to} className="card flex flex-col items-center gap-1.5 p-3 text-center text-xs font-semibold text-volt-800 transition hover:-translate-y-0.5 hover:shadow-md">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-volt-100 text-volt-700">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={x.d} /></svg>
            </span>
            {x.label}
          </Link>
        ))}
      </div>

      {month.isLoading ? <Spinner /> : month.error ? <ErrorBox error={month.error} onRetry={() => void month.refetch()} /> : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Kpi label="Presupuestos del mes" value={Number(mineMonth?.total_quotes ?? 0)} />
          <Kpi label="Monto presupuestado" value={money(Number(mineMonth?.total_amount ?? 0))} />
          <Kpi label="Aceptados" value={Number(mineMonth?.accepted ?? 0)} accent="text-emerald-700" />
          <Kpi label="Pendientes" value={Number(mineMonth?.pending ?? 0)} accent="text-volt-700" />
          <Kpi label="Tasa de conversión" value={conversion} hint="Aceptados sobre los enviados del mes" />
          <Kpi label="Ingresos estimados" value={money(Number(mineMonth?.accepted_amount ?? 0))} accent="text-emerald-700" hint="Suma de los aceptados del mes" />
        </div>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Kpi label="Saldo de presupuestos aceptados" value={money(Number(mine?.accepted_balance ?? 0))} hint="Total menos anticipo declarado. La app no verifica pagos." />
        <Kpi label="Histórico" value={`${Number(mine?.total_quotes ?? 0)} presupuestos`} hint={`${money(Number(mine?.total_amount ?? 0))} presupuestado · ${Number(mine?.accepted ?? 0)} aceptados · ${Number(mine?.rejected ?? 0)} rechazados · ${Number(mine?.expired ?? 0)} vencidos`} />
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
