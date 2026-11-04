import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getQuoteFull, listCatalog, listClients, saveQuote } from '../lib/api';
import { addDays, todayIso } from '../lib/dates';
import { humanizeError } from '../lib/errors';
import { formatMoney, lineTotalCents, fromCents, parseNumberInput } from '../lib/money';
import { computeTotals } from '../lib/quoteMath';
import { useSpeech } from '../lib/speech';
import { KIND_LABEL, validateQuote, type Errors, type ItemKind, type QuoteItemInput } from '../lib/validation';
import { parseDictation } from '../lib/voice/parser';
import type { CatalogEntry } from '../lib/voice/catalogMatch';
import { ErrorBox, Field, PageHeader, Spinner, useToast } from '../components/ui';
import { useAuth } from '../app/AuthProvider';

interface ItemState extends QuoteItemInput {
  key: string;
  needsReview: boolean;
  notes: string[];
}

const newKey = () => Math.random().toString(36).slice(2);
const num = (n: number) => String(n).replace('.', ',');
const blankItem = (): ItemState => ({ key: newKey(), kind: 'material', description: '', quantity: '1', unit: 'u', unitPrice: '', catalogItemId: null, needsReview: false, notes: [] });

export function QuoteEditorPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const [params] = useSearchParams();
  const { company } = useAuth();
  const cid = company!.id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const today = todayIso();
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState(params.get('cliente') ?? '');
  const [description, setDescription] = useState('');
  const [discountPct, setDiscountPct] = useState('');
  const [travelCost, setTravelCost] = useState('');
  const [paymentTerms, setPaymentTerms] = useState(company!.payment_terms);
  const [issueDate, setIssueDate] = useState(today);
  const [validUntil, setValidUntil] = useState(addDays(today, company!.default_validity_days));
  const [items, setItems] = useState<ItemState[]>(editing ? [] : [blankItem()]);
  const [errors, setErrors] = useState<Errors>({});
  const [loaded, setLoaded] = useState(!editing);

  // Dictado
  const [showVoice, setShowVoice] = useState(params.get('voz') === '1');
  const [dictation, setDictation] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const speech = useSpeech((t) => setDictation((d) => (d ? `${d}, ${t}` : t)));

  const clients = useQuery({ queryKey: ['clients', cid], queryFn: () => listClients(cid) });
  const catalog = useQuery({ queryKey: ['catalog', cid], queryFn: () => listCatalog(cid) });
  const existing = useQuery({ queryKey: ['quote', id], queryFn: () => getQuoteFull(id as string), enabled: editing });

  useEffect(() => {
    if (!existing.data || loaded) return;
    const { quote, items: rows } = existing.data;
    setTitle(quote.title);
    setClientId(quote.client_id ?? '');
    setDescription(quote.description ?? '');
    setDiscountPct(Number(quote.discount_pct) ? num(Number(quote.discount_pct)) : '');
    setTravelCost(Number(quote.travel_cost) ? num(Number(quote.travel_cost)) : '');
    setPaymentTerms(quote.payment_terms ?? '');
    setIssueDate(quote.issue_date);
    setValidUntil(quote.valid_until ?? '');
    setItems(rows.map((r) => ({ key: newKey(), kind: r.kind, description: r.description, quantity: num(Number(r.quantity)), unit: r.unit, unitPrice: num(Number(r.unit_price)), catalogItemId: r.catalog_item_id, needsReview: false, notes: [] })));
    setLoaded(true);
  }, [existing.data, loaded]);

  const activeCatalog = useMemo(() => (catalog.data ?? []).filter((c) => c.active), [catalog.data]);
  const entries: CatalogEntry[] = useMemo(() => activeCatalog.map((c) => ({ id: c.id, name: c.name, unit: c.unit, unitPrice: Number(c.unit_price), kind: c.kind })), [activeCatalog]);

  const totals = computeTotals(
    items.map((i) => ({ quantity: parseNumberInput(i.quantity) ?? 0, unitPrice: parseNumberInput(i.unitPrice) ?? 0 })),
    parseNumberInput(discountPct) ?? 0,
    parseNumberInput(travelCost) ?? 0,
  );
  const money = (n: number) => formatMoney(n, company!.currency);

  const patchItem = (key: string, p: Partial<ItemState>) => setItems((s) => s.map((i) => (i.key === key ? { ...i, ...p, needsReview: p.needsReview ?? false } : i)));

  function interpret() {
    const r = parseDictation(dictation, entries);
    setWarnings(r.warnings);
    if (r.items.length) {
      const added: ItemState[] = r.items.map((i) => ({
        key: newKey(), kind: i.kind, description: i.description, quantity: num(i.quantity), unit: i.unit,
        unitPrice: i.unitPrice ? num(i.unitPrice) : '', catalogItemId: i.catalogItemId, needsReview: i.needsReview, notes: i.notes,
      }));
      // si lo único que hay es el ítem en blanco inicial, se reemplaza
      setItems((s) => (s.length === 1 && !s[0].description.trim() && !s[0].unitPrice.trim() ? added : [...s, ...added]));
    }
    if (r.travelCost > 0) setTravelCost(num(r.travelCost));
    if (r.discountPct > 0) setDiscountPct(num(r.discountPct));
    if (r.title && !title.trim()) setTitle(r.title);
    if (!description.trim()) setDescription(dictation);
    if (r.items.length) toast('Revisá los ítems antes de guardar');
  }

  const save = useMutation({
    mutationFn: async () => {
      const v = validateQuote({ title, clientId, description, discountPct, travelCost, paymentTerms, issueDate, validUntil, items });
      if (!v.ok) {
        setErrors(v.errors);
        throw new Error('__validation__');
      }
      setErrors({});
      return saveQuote(cid, id ?? null, v.value.quote, v.value.items);
    },
    onSuccess: (qid) => {
      void qc.invalidateQueries({ queryKey: ['quotes'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
      void qc.invalidateQueries({ queryKey: ['quote', qid] });
      toast('Presupuesto guardado');
      nav(`/presupuestos/${qid}`);
    },
    onError: (e) => (e instanceof Error && e.message === '__validation__' ? toast('Revisá los campos marcados', 'error') : toast(humanizeError(e), 'error')),
  });

  if (editing && existing.isLoading) return <Spinner />;
  if (editing && existing.error) return <ErrorBox error={existing.error} />;

  return (
    <>
      <PageHeader title={editing ? 'Editar presupuesto' : 'Nuevo presupuesto'} subtitle={editing ? undefined : 'Nada se guarda hasta que toques "Guardar"'} actions={<Link className="btn btn-ghost" to={editing ? `/presupuestos/${id}` : '/presupuestos'}>Cancelar</Link>} />

      {/* ---------- Dictado ---------- */}
      <section className="card mb-5 border-volt-300 bg-volt-50 p-4">
        <button className="flex w-full items-center justify-between text-left font-bold" onClick={() => setShowVoice((s) => !s)} aria-expanded={showVoice}>
          <span>🎙 Dictar o escribir el trabajo</span>
          <span aria-hidden="true">{showVoice ? '▲' : '▼'}</span>
        </button>
        {showVoice && (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-slate-600">Ejemplo: <i>"Cambio de cañería en cocina, 6 metros de caño de 20, 4 codos, dos jornales, traslado 15 mil"</i>. Si decís el precio ("a 1500 el metro") se usa; si no, se toma de tu catálogo.</p>
            <textarea className="input" rows={4} value={dictation} onChange={(e) => setDictation(e.target.value)} placeholder="Tocá el micrófono y hablá, o escribí acá…" aria-label="Texto del trabajo" />
            {speech.listening && speech.interim && <p className="text-sm italic text-slate-500">{speech.interim}…</p>}
            {speech.error && <p className="err" role="alert">{speech.error}</p>}
            {!speech.supported && <p className="text-sm text-amber-700">Este navegador no ofrece dictado. Escribí el texto o usá el micrófono del teclado de tu celular. Chrome en Android funciona muy bien.</p>}
            <div className="flex flex-wrap gap-2">
              {speech.supported && (
                <button type="button" className={`btn ${speech.listening ? 'bg-red-600 text-white' : 'btn-accent'}`} onClick={speech.listening ? speech.stop : speech.start}>
                  {speech.listening ? '■ Detener' : '🎙 Hablar'}
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={interpret} disabled={!dictation.trim()}>Interpretar y cargar ítems</button>
              {dictation && <button type="button" className="btn btn-ghost" onClick={() => { setDictation(''); setWarnings([]); }}>Borrar texto</button>}
            </div>
            {warnings.length > 0 && (
              <ul className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="status">
                {warnings.map((w) => <li key={w}>⚠ {w}</li>)}
              </ul>
            )}
            <p className="text-xs text-slate-500">El dictado lo procesa el servicio de voz de tu navegador (en Chrome, Google). Interpretamos el texto con reglas simples, por eso siempre tenés que revisar los ítems.</p>
          </div>
        )}
      </section>

      {/* ---------- Datos generales ---------- */}
      <section className="card mb-5 space-y-4 p-4">
        <Field label="Título del trabajo" error={errors.title} htmlFor="t"><input id="t" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Cambio de cañería en cocina" /></Field>
        <Field label="Cliente" htmlFor="cl" hint={clients.data?.length === 0 ? 'Todavía no tenés clientes: cargalos en la sección Clientes.' : undefined}>
          <select id="cl" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Sin cliente</option>
            {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Descripción / detalle (opcional)" htmlFor="d"><textarea id="d" className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </section>

      {/* ---------- Ítems ---------- */}
      <section className="mb-5">
        <h2 className="mb-2 text-lg font-bold">Ítems</h2>
        {errors.items && <p className="err mb-2" role="alert">{errors.items}</p>}
        <ul className="space-y-3">
          {items.map((it, idx) => {
            const k = `items.${idx}`;
            const line = fromCents(lineTotalCents(parseNumberInput(it.quantity) ?? 0, parseNumberInput(it.unitPrice) ?? 0));
            return (
              <li key={it.key} className={`card space-y-3 p-3 ${it.needsReview ? 'ring-2 ring-amber-400' : ''}`}>
                {it.notes.length > 0 && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">⚠ {it.notes.join(' ')}</p>}
                <Field label="Descripción" error={errors[`${k}.description`]}><input className="input" value={it.description} onChange={(e) => patchItem(it.key, { description: e.target.value })} aria-label={`Descripción del ítem ${idx + 1}`} /></Field>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Cantidad" error={errors[`${k}.quantity`]}><input className="input" inputMode="decimal" value={it.quantity} onChange={(e) => patchItem(it.key, { quantity: e.target.value })} /></Field>
                  <Field label="Unidad"><input className="input" value={it.unit} onChange={(e) => patchItem(it.key, { unit: e.target.value })} /></Field>
                  <Field label="Precio unit." error={errors[`${k}.unitPrice`]}><input className="input" inputMode="decimal" value={it.unitPrice} onChange={(e) => patchItem(it.key, { unitPrice: e.target.value })} /></Field>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <select className="input w-auto" value={it.kind} onChange={(e) => patchItem(it.key, { kind: e.target.value as ItemKind })} aria-label="Tipo de ítem">
                    {(Object.keys(KIND_LABEL) as ItemKind[]).map((x) => <option key={x} value={x}>{KIND_LABEL[x]}</option>)}
                  </select>
                  <p className="font-bold">Subtotal: {money(line)}</p>
                  <button type="button" className="btn btn-danger min-h-9 px-3" onClick={() => setItems((s) => s.filter((x) => x.key !== it.key))} aria-label={`Quitar ítem ${idx + 1}`}>🗑</button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setItems((s) => [...s, blankItem()])}>+ Ítem en blanco</button>
          {activeCatalog.length > 0 && (
            <select className="input w-auto" value="" aria-label="Agregar del catálogo" onChange={(e) => {
              const c = activeCatalog.find((x) => x.id === e.target.value);
              if (c) setItems((s) => [...s.filter((x) => x.description.trim() || x.unitPrice.trim()), { key: newKey(), kind: c.kind, description: c.name, quantity: '1', unit: c.unit, unitPrice: num(Number(c.unit_price)), catalogItemId: c.id, needsReview: false, notes: [] }]);
            }}>
              <option value="">+ Agregar del catálogo…</option>
              {activeCatalog.map((c) => <option key={c.id} value={c.id}>{c.name} — {money(Number(c.unit_price))}</option>)}
            </select>
          )}
        </div>
      </section>

      {/* ---------- Totales y condiciones ---------- */}
      <section className="card mb-5 space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Descuento (%)" error={errors.discountPct} htmlFor="dp"><input id="dp" className="input" inputMode="decimal" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} placeholder="0" /></Field>
          <Field label="Traslado" error={errors.travelCost} htmlFor="tc"><input id="tc" className="input" inputMode="decimal" value={travelCost} onChange={(e) => setTravelCost(e.target.value)} placeholder="0" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha" error={errors.issueDate} htmlFor="id"><input id="id" className="input" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></Field>
          <Field label="Válido hasta" error={errors.validUntil} htmlFor="vu"><input id="vu" className="input" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
        </div>
        <Field label="Condiciones de pago" htmlFor="pt"><textarea id="pt" className="input" rows={2} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} /></Field>
        <dl className="space-y-1 rounded-xl bg-volt-50 p-3">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(totals.subtotal)}</dd></div>
          {totals.discountAmount > 0 && <div className="flex justify-between"><dt>Descuento</dt><dd>-{money(totals.discountAmount)}</dd></div>}
          {totals.travelCost > 0 && <div className="flex justify-between"><dt>Traslado</dt><dd>{money(totals.travelCost)}</dd></div>}
          <div className="flex justify-between border-t border-volt-300 pt-2 text-xl font-extrabold"><dt>Total</dt><dd>{money(totals.total)}</dd></div>
        </dl>
      </section>

      <div className="sticky bottom-20 z-20 flex justify-end md:bottom-4">
        <button className="btn btn-primary shadow-lg" disabled={save.isPending || !loaded} onClick={() => save.mutate()}>{save.isPending ? 'Guardando…' : 'Guardar presupuesto'}</button>
      </div>
    </>
  );
}
