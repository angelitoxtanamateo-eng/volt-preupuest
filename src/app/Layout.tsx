import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { logoUrl } from '../lib/api';
import { VoltMark } from '../components/ui';
import { useAuth } from './AuthProvider';

const NAV = [
  { to: '/', label: 'Inicio', icon: '⌂', end: true },
  { to: '/presupuestos', label: 'Presupuestos', icon: '▤', end: false },
  { to: '/clientes', label: 'Clientes', icon: '☺', end: false },
  { to: '/catalogo', label: 'Catálogo', icon: '☰', end: false },
  { to: '/ajustes', label: 'Ajustes', icon: '⚙', end: false },
];

export function Layout() {
  const { company, memberships, setActiveCompany, role } = useAuth();
  const logo = useQuery({ queryKey: ['logo', company?.id, company?.logo_path], queryFn: () => logoUrl(company?.logo_path ?? null), enabled: !!company, staleTime: 50 * 60 * 1000 });

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium ${isActive ? 'bg-volt-500/15 text-white' : 'text-volt-100 hover:bg-white/10'}`;

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-64 shrink-0 flex-col bg-volt-900 p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 text-white">
          <VoltMark />
          <div className="leading-tight">
            <p className="font-extrabold tracking-wide">VOLT</p>
            <p className="text-xs text-volt-300">Presupuestos Inteligentes</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1" aria-label="Principal">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={link}>
              <span aria-hidden="true">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col pb-20 md:pb-0">
        <header className="sticky top-0 z-30 flex items-center gap-3 bg-volt-900 px-4 py-3 text-white shadow md:bg-white md:text-volt-900">
          <span className="md:hidden"><VoltMark size={26} /></span>
          {logo.data && <img src={logo.data} alt="" className="h-8 w-8 rounded object-contain bg-white" />}
          <div className="min-w-0 flex-1">
            {memberships.length > 1 ? (
              <select aria-label="Empresa activa" className="max-w-full truncate rounded-lg bg-transparent font-bold" value={company?.id} onChange={(e) => setActiveCompany(e.target.value)}>
                {memberships.map((m) => (
                  <option key={m.company_id} value={m.company_id} className="text-volt-900">{m.companies.name}</option>
                ))}
              </select>
            ) : (
              <p className="truncate font-bold">{company?.name}</p>
            )}
            <p className="text-xs opacity-70">{role === 'admin' ? 'Administrador' : 'Empleado'}</p>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Principal">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${isActive ? 'text-volt-500' : 'text-slate-500'}`}>
            <span className="text-lg" aria-hidden="true">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
