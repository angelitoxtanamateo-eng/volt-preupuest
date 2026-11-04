import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { logoUrl } from '../lib/api';
import { VoltMark } from '../components/ui';
import { useAuth } from './AuthProvider';

function Icon({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const NAV = [
  { to: '/', label: 'Inicio', d: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10', end: true },
  { to: '/presupuestos', label: 'Presupuestos', d: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5', end: false },
  { to: '/clientes', label: 'Clientes', d: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-3A3.5 3.5 0 0 0 6 17.5V19M11 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 8.5a2.5 2.5 0 0 1 0 5', end: false },
  { to: '/catalogo', label: 'Catálogo', d: 'M4 7.5 12 4l8 3.5-8 3.5zM4 12l8 3.5 8-3.5M4 16.5 12 20l8-3.5', end: false },
  { to: '/ajustes', label: 'Ajustes', d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z', end: false },
];

export function Layout() {
  const { company, memberships, setActiveCompany, role } = useAuth();
  const logo = useQuery({ queryKey: ['logo', company?.id, company?.logo_path], queryFn: () => logoUrl(company?.logo_path ?? null), enabled: !!company, staleTime: 50 * 60 * 1000 });

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-2xl px-3.5 py-3 font-semibold transition ${isActive ? 'bg-white/90 text-volt-800 shadow-sm' : 'text-volt-100 hover:bg-white/10'}`;

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-64 shrink-0 flex-col bg-linear-to-b from-volt-800 to-volt-900 p-4 md:flex">
        <div className="mb-6 flex items-center gap-3 text-white">
          <VoltMark size={40} />
          <div className="leading-tight">
            <p className="font-extrabold tracking-wide">VOLT</p>
            <p className="text-xs text-volt-300">Presupuestos Inteligentes</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1" aria-label="Principal">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={link}>
              <Icon d={n.d} />
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col pb-28 md:pb-0">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-volt-100/70 bg-white/80 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-volt-900 backdrop-blur-md">
          <span className="md:hidden"><VoltMark size={36} /></span>
          {logo.data && <img src={logo.data} alt="" className="h-9 w-9 rounded-xl border border-volt-100 bg-white object-contain" />}
          <div className="min-w-0 flex-1">
            {memberships.length > 1 ? (
              <select aria-label="Empresa activa" className="max-w-full truncate rounded-lg bg-transparent font-extrabold" value={company?.id} onChange={(e) => setActiveCompany(e.target.value)}>
                {memberships.map((m) => (
                  <option key={m.company_id} value={m.company_id} className="text-volt-900">{m.companies.name}</option>
                ))}
              </select>
            ) : (
              <p className="truncate font-extrabold">{company?.name}</p>
            )}
            <p className="text-xs text-slate-500">{role === 'admin' ? 'Administrador' : 'Empleado'}</p>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-5 rounded-3xl border border-white bg-white/90 p-1.5 shadow-[0_10px_40px_-10px_rgba(31,77,154,0.35)] backdrop-blur-md mb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Principal">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `flex flex-col items-center gap-0.5 rounded-2xl py-2 text-[11px] font-semibold transition ${isActive ? 'bg-volt-100 text-volt-700' : 'text-slate-500'}`}>
            <Icon d={n.d} />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
