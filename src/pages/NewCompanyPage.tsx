import { useState, type FormEvent } from 'react';
import { createCompany } from '../lib/api';
import { humanizeError } from '../lib/errors';
import { Field, VoltMark } from '../components/ui';
import { useAuth } from '../app/AuthProvider';

/** Se muestra cuando la persona todavía no pertenece a ninguna empresa. */
export function NewCompanyPage() {
  const { refresh, signOut, user } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 2 || n.length > 120) return setError('El nombre debe tener entre 2 y 120 caracteres.');
    setBusy(true);
    setError(null);
    try {
      await createCompany(n);
      await refresh();
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-b from-volt-900 to-volt-950 p-4">
      <div className="card w-full max-w-md p-6">
        <VoltMark size={40} />
        <h1 className="mt-3 text-xl font-bold">Creá tu empresa</h1>
        <p className="mb-4 text-slate-500">Es el nombre que va a aparecer en tus presupuestos. Después podés cargar logo, teléfono y condiciones.</p>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Nombre del negocio" error={error ?? undefined} htmlFor="company"><input id="company" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Plomería Pérez" /></Field>
          <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Creando…' : 'Crear empresa'}</button>
        </form>
        <div className="mt-5 rounded-xl bg-volt-50 p-3 text-sm text-slate-600">
          ¿Te invitaron a una empresa? Ingresá con el email <b>{user?.email}</b> invitado y confirmado; si el administrador ya te invitó, tocá:
          <button className="btn btn-ghost mt-2 w-full" onClick={() => void refresh()}>Revisar invitaciones</button>
        </div>
        <button className="mt-4 w-full text-center text-sm text-slate-500 underline" onClick={() => void signOut()}>Salir</button>
      </div>
    </div>
  );
}
