import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { cancelAutoDebit, cancelPlanRequest, myPlanUsage, requestPlan, startAutoDebit } from '../lib/api';
import { formatDateAR } from '../lib/dates';
import { humanizeError } from '../lib/errors';
import {
  accountCode, formatPlanPrice, isExpired, MP_LINK, PAID_PLANS, PENDING_MESSAGE, PLANS, usageState, validatePaymentReference,
  type PaidPlan, type PlanUsage,
} from '../lib/plans';
import { ErrorBox, Field, Modal, PageHeader, Spinner, useToast } from '../components/ui';
import { useAuth } from '../app/AuthProvider';

function PendingBox({ usage, code, onVolver }: { usage: PlanUsage; code: string; onVolver?: () => void }) {
  if (!usage.requested_plan) return null;
  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-900" role="status">
      <p className="text-lg font-extrabold">{PENDING_MESSAGE.title}</p>
      <p className="mt-1 font-semibold">{PENDING_MESSAGE.body}</p>
      <p className="mt-1 text-sm">{PENDING_MESSAGE.detail}</p>
      <dl className="mt-3 space-y-1 rounded-2xl bg-white/70 p-3 text-sm text-slate-700">
        <div className="flex justify-between gap-3"><dt>Estado de la suscripción</dt><dd className="font-bold text-amber-800">Pendiente de verificación</dd></div>
        <div className="flex justify-between gap-3"><dt>Plan solicitado</dt><dd className="font-bold">{PLANS[usage.requested_plan].name} · {formatPlanPrice(usage.requested_plan)}/mes</dd></div>
        <div className="flex justify-between gap-3"><dt>Identificador de tu cuenta</dt><dd className="font-mono font-bold">{code}</dd></div>
        {usage.payment_reference && <div className="flex justify-between gap-3"><dt>Tu referencia de pago</dt><dd className="font-bold">{usage.payment_reference}</dd></div>}
      </dl>
      {onVolver && <button className="btn btn-primary mt-4 w-full" onClick={onVolver}>Volver a VOLT</button>}
    </div>
  );
}

export function PlanPage() {
  const { company, isAdmin, user } = useAuth();
  const cid = company!.id;
  const code = accountCode(cid);
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const usage = useQuery({ queryKey: ['plan', cid], queryFn: () => myPlanUsage(cid) });

  const [selected, setSelected] = useState<PaidPlan | null>(null);
  const [reference, setReference] = useState('');
  const [refError, setRefError] = useState<string | null>(null);
  const [step, setStep] = useState<'resumen' | 'enviado'>('resumen');
  const [auto, setAuto] = useState<PaidPlan | null>(null);
  const [payerEmail, setPayerEmail] = useState('');
  const returned = new URLSearchParams(window.location.search).get('mp') === 'ok';

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['plan', cid] });
  };

  const request = useMutation({
    mutationFn: async () => {
      const v = validatePaymentReference(reference);
      if (!v.ok) {
        setRefError(v.error);
        throw new Error('__validation__');
      }
      setRefError(null);
      await requestPlan(cid, selected as PaidPlan, v.value);
    },
    onSuccess: () => {
      refresh();
      // Se abre el link oficial. Abrirlo NO confirma ningún pago: el plan se activa cuando VOLT lo verifica.
      window.open(MP_LINK, '_blank', 'noopener,noreferrer');
      setStep('enviado');
    },
    onError: (e) => {
      if (!(e instanceof Error && e.message === '__validation__')) toast(humanizeError(e), 'error');
    },
  });

  const cancel = useMutation({
    mutationFn: () => cancelPlanRequest(cid),
    onSuccess: () => {
      refresh();
      toast('Solicitud cancelada');
    },
    onError: (e) => toast(humanizeError(e), 'error'),
  });

  // Al volver de Mercado Pago esperamos la confirmación del servidor unos segundos
  useEffect(() => {
    if (!returned) return;
    let n = 0;
    const iv = setInterval(() => { n++; refresh(); if (n >= 10) clearInterval(iv); }, 3000);
    return () => clearInterval(iv);
  }, [returned]); // eslint-disable-line react-hooks/exhaustive-deps

  const subscribe = useMutation({
    mutationFn: async () => {
      const email = payerEmail.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Ingresá un email válido');
      return startAutoDebit(cid, auto as PaidPlan, email);
    },
    onSuccess: (url) => { window.location.href = url; },
    onError: (e) => toast(humanizeError(e), 'error'),
  });

  const stopAuto = useMutation({
    mutationFn: () => cancelAutoDebit(cid),
    onSuccess: () => { refresh(); toast('Débito automático cancelado'); },
    onError: (e) => toast(humanizeError(e), 'error'),
  });

  function openAuto(plan: PaidPlan) {
    setAuto(plan);
    setPayerEmail(user?.email ?? '');
  }

  function open(plan: PaidPlan) {
    setSelected(plan);
    setReference('');
    setRefError(null);
    setStep('resumen');
  }
  function close() {
    setSelected(null);
    setStep('resumen');
  }

  if (usage.isLoading) return <Spinner />;
  if (usage.error || !usage.data) return <ErrorBox error={usage.error ?? 'No se pudo cargar el plan.'} onRetry={() => void usage.refetch()} />;
  const u = usage.data;
  const st = usageState(u);
  const current = PLANS[u.effective_plan];
  const expired = isExpired(u);
  const pct = u.quote_limit ? Math.min(100, Math.round((u.used / u.quote_limit) * 100)) : 0;

  return (
    <>
      <PageHeader title="Mi plan" subtitle={company!.name} />

      <section className="card mb-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-500">Plan actual</p>
            <p className="text-2xl font-extrabold tracking-tight">{current.name}</p>
            {u.effective_plan !== 'free' && u.expires_at && <p className="text-sm text-slate-500">Activo hasta el {formatDateAR(u.expires_at)}</p>}
            {expired && <p className="mt-1 text-sm font-semibold text-amber-700">Tu plan {PLANS[u.plan].name} venció el {formatDateAR(u.expires_at)}. Volviste al plan Free.</p>}
          </div>
          <span className="rounded-full bg-volt-100 px-3 py-1 text-sm font-bold text-volt-700">{formatPlanPrice(u.effective_plan)}/mes</span>
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-sm">
            <span>Presupuestos este mes</span>
            <span className="font-bold">{u.used}{u.quote_limit !== null ? ` de ${u.quote_limit}` : ' (sin límite)'}</span>
          </div>
          {u.quote_limit !== null && (
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-volt-100" role="progressbar" aria-valuenow={u.used} aria-valuemin={0} aria-valuemax={u.quote_limit}>
              <div className={`h-full rounded-full ${st.atLimit ? 'bg-red-500' : st.nearLimit ? 'bg-amber-400' : 'bg-volt-500'}`} style={{ width: `${pct}%` }} />
            </div>
          )}
          {st.atLimit && <p className="mt-2 text-sm font-semibold text-red-600">Llegaste al límite del mes. Elegí un plan superior para seguir creando presupuestos.</p>}
          {st.nearLimit && <p className="mt-2 text-sm text-amber-700">Te quedan {st.remaining} presupuesto(s) este mes.</p>}
        </div>
      </section>

      {u.mp_status === 'authorized' ? (
        <div className="mb-4 flex flex-col gap-3 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 sm:flex-row sm:items-center" role="status">
          <div className="flex-1">
            <p className="text-lg font-extrabold">Débito automático activo ⚡</p>
            <p className="text-sm">Plan {u.mp_plan ? PLANS[u.mp_plan].name : ''}: se cobra solo cada mes con Mercado Pago y se renueva sin que hagas nada.</p>
          </div>
          {isAdmin && <button className="btn btn-ghost" disabled={stopAuto.isPending} onClick={() => { if (confirm('¿Cancelar el débito automático? Tu plan sigue activo hasta la fecha ya pagada.')) stopAuto.mutate(); }}>{stopAuto.isPending ? 'Cancelando…' : 'Cancelar débito'}</button>}
        </div>
      ) : returned && u.mp_status === 'pending' ? (
        <div className="mb-4 rounded-3xl border border-volt-200 bg-volt-50 p-5" role="status">
          <p className="font-extrabold">Confirmando con Mercado Pago…</p>
          <p className="text-sm text-slate-600">Apenas se apruebe el cobro, tu plan se activa solo.</p>
        </div>
      ) : null}

      {u.requested_plan && (
        <div className="mb-4 space-y-3">
          <PendingBox usage={u} code={code} />
          {isAdmin && <button className="btn btn-ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{cancel.isPending ? 'Cancelando…' : 'Cancelar solicitud'}</button>}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {(['free', ...PAID_PLANS] as const).map((code2) => {
          const p = PLANS[code2];
          const active = u.effective_plan === code2;
          return (
            <section key={code2} className={`card flex flex-col p-5 ${active ? 'ring-2 ring-volt-400' : ''}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-extrabold">{p.name}</h2>
                {active && <span className="rounded-full bg-volt-100 px-2.5 py-0.5 text-xs font-bold text-volt-700">Plan actual</span>}
              </div>
              <p className="mt-1 text-3xl font-extrabold tracking-tight">{formatPlanPrice(code2)}<span className="text-base font-medium text-slate-500"> ARS/mes</span></p>
              <ul className="mt-3 flex-1 space-y-1.5 text-sm text-slate-600">
                {p.features.map((f) => <li key={f} className="flex gap-2"><span className="text-volt-500" aria-hidden="true">✓</span>{f}</li>)}
              </ul>
              {code2 !== 'free' && (
                u.mp_status === 'authorized' && u.mp_plan === code2 ? (
                  <p className="mt-4 rounded-2xl bg-emerald-50 py-3 text-center text-sm font-bold text-emerald-700">Débito automático activo</p>
                ) : (
                  <>
                    <button className="btn btn-accent mt-4 w-full" disabled={!isAdmin} onClick={() => openAuto(code2)}>
                      {u.mp_status === 'authorized' ? `Cambiar a ${p.name}` : `Suscribirme — ${formatPlanPrice(code2)}/mes`}
                    </button>
                    <button className="mt-2 text-xs text-slate-500 underline disabled:no-underline disabled:opacity-50" disabled={!isAdmin} onClick={() => open(code2)}>
                      {active ? 'Renovar pagando una vez con link' : 'Prefiero pagar una vez con link'}
                    </button>
                  </>
                )
              )}
            </section>
          );
        })}
      </div>
      {!isAdmin && <p className="mt-3 text-sm text-slate-500">Solo un administrador de la empresa puede contratar un plan.</p>}
      <p className="mt-4 text-sm text-slate-500">
        Con la suscripción, Mercado Pago cobra cada mes y tu plan se activa al instante. Si pagás una vez con el link, se activa cuando VOLT verifica el pago.
        Presupuestos sin valor fiscal; VOLT no emite facturas por este medio.
      </p>

      {auto && (
        <Modal title={`Suscribirme a ${PLANS[auto].name}`} onClose={() => setAuto(null)}>
          <div className="space-y-4">
            <dl className="rounded-2xl bg-volt-50 p-4 text-center">
              <dt className="text-sm text-slate-500">Débito automático mensual</dt>
              <dd className="text-3xl font-extrabold">{formatPlanPrice(auto)}<span className="text-base font-medium text-slate-500"> ARS/mes</span></dd>
            </dl>
            <ul className="space-y-1.5 text-sm text-slate-600">
              <li>✓ Tu plan se activa apenas Mercado Pago aprueba el cobro.</li>
              <li>✓ Se cobra solo cada mes, con tarjeta o dinero en Mercado Pago.</li>
              <li>✓ Lo cancelás cuando quieras desde esta pantalla.</li>
            </ul>
            <Field label="Email de tu cuenta de Mercado Pago" htmlFor="mp-email" hint="Tiene que ser el mismo con el que vas a pagar.">
              <input id="mp-email" type="email" className="input" value={payerEmail} onChange={(e) => setPayerEmail(e.target.value)} />
            </Field>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button className="btn btn-ghost" onClick={() => setAuto(null)}>Cancelar</button>
              <button className="btn btn-accent" disabled={subscribe.isPending} onClick={() => subscribe.mutate()}>{subscribe.isPending ? 'Conectando…' : 'Continuar en Mercado Pago'}</button>
            </div>
          </div>
        </Modal>
      )}

      {selected && (
        <Modal title={step === 'resumen' ? `Contratar plan ${PLANS[selected].name}` : 'Solicitud registrada'} onClose={close}>
          {step === 'resumen' ? (
            <div className="space-y-4">
              <dl className="space-y-1.5 rounded-2xl bg-volt-50 p-4">
                <div className="flex justify-between"><dt>Plan</dt><dd className="font-bold">{PLANS[selected].name}</dd></div>
                <div className="flex justify-between"><dt>Incluye</dt><dd className="text-right font-bold">{PLANS[selected].limit === null ? 'Presupuestos ilimitados' : `Hasta ${PLANS[selected].limit} presupuestos por mes`}</dd></div>
                <div className="flex justify-between border-t border-volt-300 pt-2 text-xl font-extrabold"><dt>Precio</dt><dd>{formatPlanPrice(selected)} ARS/mes</dd></div>
              </dl>
              <p className="text-sm text-slate-600">El pago se realizará mediante <b>Mercado Pago</b>, en una pestaña nueva. Pagá el monto exacto del plan.</p>
              <div className="rounded-2xl border border-volt-100 p-3 text-sm text-slate-600">
                <p>Identificador de tu cuenta: <b className="font-mono">{code}</b></p>
                <p className="mt-1">Si Mercado Pago te permite escribir un mensaje o nota, poné ese identificador: nos ayuda a ubicar tu pago.</p>
              </div>
              <Field label="Número de operación o nombre de quien paga (opcional)" error={refError ?? undefined} htmlFor="pay-ref" hint="Podés agregarlo ahora o después, desde esta misma pantalla.">
                <input id="pay-ref" className="input" maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
              <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">Abrir Mercado Pago <b>no activa</b> el plan. Se activa cuando VOLT verifique tu pago.</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button className="btn btn-ghost" onClick={close}>Cancelar</button>
                <button className="btn btn-accent" disabled={request.isPending} onClick={() => request.mutate()}>{request.isPending ? 'Registrando…' : 'Ir a Mercado Pago'}</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <PendingBox usage={{ ...u, requested_plan: selected, payment_reference: validatePaymentReference(reference).ok ? (reference.trim() || null) : null }} code={code} onVolver={() => { close(); nav('/'); }} />
              <p className="text-sm text-slate-500">Si no se te abrió Mercado Pago, <a className="font-semibold text-volt-700 underline" href={MP_LINK} target="_blank" rel="noopener noreferrer">tocá acá</a>.</p>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
