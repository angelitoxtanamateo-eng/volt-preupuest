import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { humanizeError } from '../lib/errors';
import { validateLogin, validatePassword, validateRegister, isValidEmail, type Errors } from '../lib/validation';
import { Field, VoltMark } from '../components/ui';
import { useAuth } from '../app/AuthProvider';

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-b from-volt-100 via-volt-50 to-white p-4">
      <div className="w-full max-w-md">
        <div className="mb-5 flex flex-col items-center text-center">
          <VoltMark size={96} />
          <p className="mt-3 text-3xl font-extrabold tracking-wide text-volt-800">VOLT</p>
          <p className="text-sm font-medium text-volt-700/80">Presupuestos Inteligentes</p>
        </div>
        <div className="card p-6">
          <h1 className="text-xl font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="mb-4 text-slate-500">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const v = validateLogin({ email, password });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword(v.value);
    setBusy(false);
    if (error) setFormError(humanizeError(error));
  }

  return (
    <Shell title="Ingresá a tu cuenta">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" error={errors.email} htmlFor="email">
          <input id="email" className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Contraseña" error={errors.password} htmlFor="password">
          <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {formError && <p className="err" role="alert">{formError}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link className="text-volt-700 underline" to="/recuperar">Olvidé mi contraseña</Link>
        <Link className="text-volt-700 underline" to="/registro">Crear cuenta</Link>
      </div>
    </Shell>
  );
}

export function RegisterPage() {
  const [f, setF] = useState({ fullName: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const v = validateRegister(f);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: v.value.email,
      password: v.value.password,
      options: { data: { full_name: v.value.fullName }, emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) return setFormError(humanizeError(error));
    if (!data.session) setSent(true); // con confirmación de email activada, todavía no hay sesión
  }

  if (sent) {
    return (
      <Shell title="Revisá tu email">
        <p className="text-slate-600">Te enviamos un enlace de confirmación a <b>{f.email}</b>. Tocalo para activar tu cuenta y después ingresá.</p>
        <Link className="btn btn-primary mt-5 w-full" to="/login">Ir a ingresar</Link>
      </Shell>
    );
  }
  return (
    <Shell title="Creá tu cuenta" subtitle="Si te invitaron a una empresa, registrate con el mismo email de la invitación.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Nombre y apellido" error={errors.fullName} htmlFor="fullName"><input id="fullName" className="input" autoComplete="name" value={f.fullName} onChange={set('fullName')} /></Field>
        <Field label="Email" error={errors.email} htmlFor="email"><input id="email" className="input" type="email" autoComplete="email" inputMode="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Contraseña" error={errors.password} hint="Mínimo 8 caracteres." htmlFor="password"><input id="password" className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        <Field label="Repetí la contraseña" error={errors.confirm} htmlFor="confirm"><input id="confirm" className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} /></Field>
        {formError && <p className="err" role="alert">{formError}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Creando…' : 'Crear cuenta'}</button>
      </form>
      <p className="mt-4 text-center text-sm"><Link className="text-volt-700 underline" to="/login">Ya tengo cuenta</Link></p>
    </Shell>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!isValidEmail(email)) return setError('Ingresá un email válido.');
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${window.location.origin}/restablecer` });
    setBusy(false);
    // Mensaje genérico: no revelamos si el email existe.
    if (err && /rate limit|network|fetch/i.test(err.message)) return setError(humanizeError(err));
    setDone(true);
  }

  return (
    <Shell title="Recuperar contraseña">
      {done ? (
        <p className="text-slate-600">Si existe una cuenta con ese email, te enviamos un enlace para elegir una contraseña nueva.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Email" error={error ?? undefined} htmlFor="email"><input id="email" className="input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Enviando…' : 'Enviar enlace'}</button>
        </form>
      )}
      <p className="mt-4 text-center text-sm"><Link className="text-volt-700 underline" to="/login">Volver a ingresar</Link></p>
    </Shell>
  );
}

export function ResetPage() {
  const { session, loading } = useAuth();
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 2500); // da tiempo a que Supabase procese el enlace
    return () => clearTimeout(t);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const pe = validatePassword(pw);
    if (pe) return setError(pe);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    if (err) return setError(humanizeError(err));
    setDone(true);
  }

  return (
    <Shell title="Elegí una contraseña nueva">
      {done ? (
        <>
          <p className="text-slate-600">Listo, tu contraseña se actualizó.</p>
          <Link className="btn btn-primary mt-4 w-full" to="/">Continuar</Link>
        </>
      ) : session ? (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Contraseña nueva" error={error ?? undefined} hint="Mínimo 8 caracteres." htmlFor="pw"><input id="pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <button className="btn btn-primary w-full">Guardar contraseña</button>
        </form>
      ) : loading || !waited ? (
        <p className="text-slate-500">Verificando el enlace…</p>
      ) : (
        <p className="text-slate-600">El enlace no es válido o venció. <Link className="text-volt-700 underline" to="/recuperar">Pedí uno nuevo</Link>.</p>
      )}
    </Shell>
  );
}
