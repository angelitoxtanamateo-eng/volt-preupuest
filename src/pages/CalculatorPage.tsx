import { useState } from 'react';
import { formatMoney, parseNumberInput } from '../lib/money';
import { priceForMargin, priceForMarkup, profitFromPrice } from '../lib/quoteMath';
import { Field, PageHeader } from '../components/ui';
import { useAuth } from '../app/AuthProvider';

/**
 * Calculadora de rentabilidad. Todo se calcula en el dispositivo con los números que se escriben acá:
 * no lee ni guarda nada de la base (los costos de tu catálogo son privados del administrador).
 */
export function CalculatorPage() {
  const { company } = useAuth();
  const [cost, setCost] = useState('');
  const [margin, setMargin] = useState('30');
  const [markup, setMarkup] = useState('30');
  const [price, setPrice] = useState('');
  const money = (n: number) => formatMoney(n, company!.currency);

  const c = parseNumberInput(cost);
  const m = parseNumberInput(margin);
  const k = parseNumberInput(markup);
  const p = parseNumberInput(price);
  const costOk = c !== null && c >= 0;

  const byMargin = costOk && m !== null ? priceForMargin(c, m) : null;
  const byMarkup = costOk && k !== null ? priceForMarkup(c, k) : null;
  const real = costOk && p !== null && p >= 0 ? profitFromPrice(c, p) : null;
  const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`);

  return (
    <>
      <PageHeader title="Calculadora de ganancia" subtitle="Cuánto cobrar para ganar lo que querés" />
      <section className="card mb-4 space-y-4 p-4">
        <Field label="Tu costo" htmlFor="k-cost" hint="Lo que te cuesta a vos (materiales, mano de obra, etc.)">
          <input id="k-cost" className="input" inputMode="decimal" placeholder="100.000" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
        {cost.trim() && !costOk && <p className="err">El costo no es un número válido.</p>}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-3 p-4">
          <h2 className="font-bold">Por margen sobre ventas</h2>
          <p className="text-sm text-slate-500">El margen es la parte del precio de venta que te queda de ganancia.</p>
          <Field label="Margen deseado (%)" htmlFor="k-m"><input id="k-m" className="input" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} /></Field>
          {byMargin !== null ? (
            <dl className="space-y-1 rounded-2xl bg-volt-50 p-3">
              <div className="flex justify-between text-xl font-extrabold"><dt>Precio de venta</dt><dd>{money(byMargin)}</dd></div>
              <div className="flex justify-between"><dt>Ganancia</dt><dd>{money(byMargin - (c ?? 0))}</dd></div>
            </dl>
          ) : <p className="text-sm text-slate-500">{m !== null && m >= 100 ? 'El margen tiene que ser menor al 100 %.' : 'Ingresá el costo y el margen.'}</p>}
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="font-bold">Por recargo sobre el costo</h2>
          <p className="text-sm text-slate-500">El recargo se suma al costo: con 30 % pasás de 100 a 130.</p>
          <Field label="Recargo (%)" htmlFor="k-k"><input id="k-k" className="input" inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} /></Field>
          {byMarkup !== null ? (
            <dl className="space-y-1 rounded-2xl bg-volt-50 p-3">
              <div className="flex justify-between text-xl font-extrabold"><dt>Precio de venta</dt><dd>{money(byMarkup)}</dd></div>
              <div className="flex justify-between"><dt>Ganancia</dt><dd>{money(byMarkup - (c ?? 0))}</dd></div>
              <div className="flex justify-between text-slate-600"><dt>Margen real sobre ventas</dt><dd>{pct(profitFromPrice(c ?? 0, byMarkup).marginPct)}</dd></div>
            </dl>
          ) : <p className="text-sm text-slate-500">Ingresá el costo y el recargo.</p>}
        </section>
      </div>

      <section className="card mt-4 space-y-3 p-4">
        <h2 className="font-bold">Ya tengo un precio: ¿cuánto gano?</h2>
        <Field label="Precio de venta" htmlFor="k-p"><input id="k-p" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="130.000" /></Field>
        {real ? (
          <dl className="space-y-1 rounded-2xl bg-volt-50 p-3">
            <div className="flex justify-between text-xl font-extrabold"><dt>Ganancia</dt><dd className={real.profit < 0 ? 'text-red-600' : ''}>{money(real.profit)}</dd></div>
            <div className="flex justify-between"><dt>Margen sobre ventas</dt><dd>{pct(real.marginPct)}</dd></div>
            <div className="flex justify-between"><dt>Recargo sobre costo</dt><dd>{pct(real.markupPct)}</dd></div>
          </dl>
        ) : <p className="text-sm text-slate-500">Ingresá el costo y el precio.</p>}
      </section>
      <p className="mt-3 text-sm text-slate-500">Estos cálculos no incluyen impuestos ni comisiones de cobro. Los números que escribís acá no se guardan.</p>
    </>
  );
}
