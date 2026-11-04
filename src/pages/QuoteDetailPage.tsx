import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteQuote, duplicateQuote, getQuoteFull, logoBytes, logQuoteEvent, setQuoteStatus, type QuoteFull } from '../lib/api';
import { downloadBlob, safeFilename } from '../lib/download';
import { formatDateAR, todayIso } from '../lib/dates';
import { humanizeError } from '../lib/errors';
import { formatMoney, formatQuantity, formatQuoteNumber } from '../lib/money';
import { normalizeArPhone } from '../lib/phone';
import { effectiveStatus, STATUS_ACTIONS, STATUS_LABEL, type QuoteStatus } from '../lib/status';
import { KIND_LABEL } from '../lib/validation';
import { buildQuoteMessage, buildWhatsAppUrl } from '../lib/whatsapp';
import { Confirm, ErrorBox, PageHeader, Spinner, StatusBadge, useToast } from '../components/ui';
import { useAuth } from '../app/AuthProvider';
import type { Company } from '../types';

const EVENT_LABEL: Record<string, string> = {
  created: 'Presupuesto creado',
  status_changed: 'Cambio de estado',
  pdf_generated: 'PDF generado',
  whatsapp_prepared: 'Mensaje de WhatsApp preparado',
};

async function makePdf(full: QuoteFull, company: Company): Promise<Blob> {
  const { buildQuotePdf } = await import('../lib/pdf/quotePdf'); // carga diferida: el PDF no pesa en el inicio
  const logo = await logoBytes(company.logo_path).catch(() => null);
  const { quote, items, client } = full;
  const bytes = await buildQuotePdf({
    company: { name: company.name, phone: company.phone, email: company.email, address: company.address, taxId: company.tax_id },
    logo: logo ? { bytes: logo, type: 'png' } : null, // los logos se guardan siempre como PNG
    client: client ? { name: client.name, phone: client.phone, address: client.address } : null,
    quote: {
      number: quote.number, title: quote.title, description: quote.description, issueDate: quote.issue_date, validUntil: quote.valid_until,
      currency: quote.currency, paymentTerms: quote.payment_terms,
      items: items.map((i) => ({ kind: i.kind, description: i.description, quantity: Number(i.quantity), unit: i.unit, unitPrice: Number(i.unit_price) })),
      subtotal: Number(quote.subtotal), discountPct: Number(quote.discount_pct), discountAmount: Number(quote.discount_amount),
      travelCost: Number(quote.travel_cost), taxPct: Number(quote.tax_pct), taxAmount: Number(quote.tax_amount),
      advanceAmount: Number(quote.advance_amount), total: Number(quote.total),
    },
  });
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}

function canShareFiles(): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([], 'x.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

export function QuoteDetailPage() {
  const { id = '' } = useParams();
  const { company, isAdmin } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<'pdf' | 'share' | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const full = useQuery({ queryKey: ['quote', id], queryFn: () => getQuoteFull(id) });

  const status = useMutation({
    mutationFn: (s: QuoteStatus) => setQuoteStatus(id, s),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quote', id] });
      void qc.invalidateQueries({ queryKey: ['quotes'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
      toast('Estado actualizado');
    },
    onError: (e) => toast(humanizeError(e), 'error'),
  });
  const dup = useMutation({
    mutationFn: () => duplicateQuote(id),
    onSuccess: (newId) => {
      void qc.invalidateQueries({ queryKey: ['quotes'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
      void qc.invalidateQueries({ queryKey: ['plan'] });
      toast('Presupuesto duplicado como borrador');
      nav(`/presupuestos/${newId}`);
    },
    onError: (e) => toast(humanizeError(e), 'error'),
  });
  const del = useMutation({
    mutationFn: () => deleteQuote(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quotes'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
      toast('Presupuesto eliminado');
      nav('/presupuestos');
    },
    onError: (e) => toast(humanizeError(e), 'error'),
  });

  if (full.isLoading) return <Spinner />;
  if (full.error || !full.data) return <ErrorBox error={full.error ?? 'No se encontró el presupuesto.'} onRetry={() => void full.refetch()} />;
  const data = full.data;
  const { quote, items, client, events } = data;
  const co = company!;
  const money = (n: number) => formatMoney(n, quote.currency);
  const eff = effectiveStatus(quote.status, quote.valid_until, todayIso());
  const fileName = `Presupuesto-${formatQuoteNumber(quote.number)}-${safeFilename(client?.name ?? quote.title)}.pdf`;
  const waTarget = client?.phone ? normalizeArPhone(client.phone) : null;

  const waText = () => buildQuoteMessage({
    number: quote.number, title: quote.title, companyName: co.name, clientName: client?.name,
    items: items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unit: i.unit, unitPrice: Number(i.unit_price) })),
    subtotal: Number(quote.subtotal), discountPct: Number(quote.discount_pct), discountAmount: Number(quote.discount_amount),
    travelCost: Number(quote.travel_cost), taxPct: Number(quote.tax_pct), taxAmount: Number(quote.tax_amount), advanceAmount: Number(quote.advance_amount),
    total: Number(quote.total), currency: quote.currency, validUntil: quote.valid_until, paymentTerms: quote.payment_terms,
  });

  async function download() {
    setBusy('pdf');
    try {
      downloadBlob(await makePdf(data, co), fileName);
      void logQuoteEvent(id, 'pdf_generated', { via: 'descarga' }).then(() => full.refetch());
    } catch (e) {
      toast(humanizeError(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function sharePdf() {
    setBusy('share');
    try {
      const file = new File([await makePdf(data, co)], fileName, { type: 'application/pdf' });
      await navigator.share({ files: [file], title: `Presupuesto ${formatQuoteNumber(quote.number)}`, text: waText() });
      void logQuoteEvent(id, 'pdf_generated', { via: 'compartir' }).then(() => full.refetch());
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toast(humanizeError(e), 'error'); // cancelar no es un error
    } finally {
      setBusy(null);
    }
  }

  /** Abre WhatsApp con el mensaje escrito. NO envía nada: la persona toca "Enviar". */
  function openWhatsApp() {
    window.open(buildWhatsAppUrl(client?.phone, waText()), '_blank', 'noopener,noreferrer');
    void logQuoteEvent(id, 'whatsapp_prepared', { con_destinatario: Boolean(waTarget) }).then(() => full.refetch());
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(waText());
      toast('Mensaje copiado');
    } catch {
      toast('No se pudo copiar. Usá el botón de WhatsApp.', 'error');
    }
  }

  return (
    <>
      <PageHeader
        title={`N° ${formatQuoteNumber(quote.number)} · ${quote.title}`}
        subtitle={`${client?.name ?? 'Sin cliente'} · ${formatDateAR(quote.issue_date)}${quote.valid_until ? ` · válido hasta ${formatDateAR(quote.valid_until)}` : ''}`}
        actions={<><StatusBadge status={eff} /><Link className="btn btn-ghost" to={`/presupuestos/${id}/editar`}>Editar</Link><button className="btn btn-ghost" disabled={dup.isPending} onClick={() => dup.mutate()}>{dup.isPending ? 'Duplicando…' : 'Duplicar'}</button></>}
      />

      <section className="card mb-4 space-y-2 p-4">
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => void download()} disabled={busy !== null}>{busy === 'pdf' ? 'Generando…' : '⬇ Descargar PDF'}</button>
          {canShareFiles() && <button className="btn btn-ghost" onClick={() => void sharePdf()} disabled={busy !== null}>{busy === 'share' ? 'Preparando…' : '↗ Compartir PDF'}</button>}
          <button className="btn btn-accent" onClick={openWhatsApp}>💬 Abrir WhatsApp con el mensaje</button>
          <button className="btn btn-ghost" onClick={() => void copyMessage()}>Copiar mensaje</button>
        </div>
        <p className="text-sm text-slate-500">
          {waTarget ? 'WhatsApp se abre con el mensaje ya escrito para que lo envíes vos. Para adjuntar el PDF, descargalo o compartilo y adjuntalo en el chat.' : client?.phone ? 'El teléfono del cliente no tiene un formato válido para WhatsApp: se abrirá sin destinatario para que elijas el contacto.' : 'El cliente no tiene teléfono: se abrirá WhatsApp para que elijas el contacto.'}
        </p>
      </section>

      <section className="card mb-4 overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {items.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="font-semibold">{i.description}</p>
                <p className="text-sm text-slate-500">{KIND_LABEL[i.kind]} · {formatQuantity(Number(i.quantity))} {i.unit} × {money(Number(i.unit_price))}</p>
              </div>
              <p className="font-bold">{money(Number(i.line_total))}</p>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 bg-volt-50 p-3">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(Number(quote.subtotal))}</dd></div>
          {Number(quote.discount_amount) > 0 && <div className="flex justify-between"><dt>Descuento ({formatQuantity(Number(quote.discount_pct))}%)</dt><dd>-{money(Number(quote.discount_amount))}</dd></div>}
          {Number(quote.travel_cost) > 0 && <div className="flex justify-between"><dt>Traslado</dt><dd>{money(Number(quote.travel_cost))}</dd></div>}
          {Number(quote.tax_amount) > 0 && <div className="flex justify-between"><dt>Impuestos ({formatQuantity(Number(quote.tax_pct))}%)</dt><dd>{money(Number(quote.tax_amount))}</dd></div>}
          <div className="flex justify-between border-t border-volt-300 pt-2 text-xl font-extrabold"><dt>Total</dt><dd>{money(Number(quote.total))}</dd></div>
          {Number(quote.advance_amount) > 0 && (
            <>
              <div className="flex justify-between text-slate-600"><dt>Anticipo</dt><dd>-{money(Number(quote.advance_amount))}</dd></div>
              <div className="flex justify-between font-bold"><dt>Saldo pendiente</dt><dd>{money(Number(quote.total) - Number(quote.advance_amount))}</dd></div>
            </>
          )}
        </dl>
      </section>

      {quote.payment_terms && <p className="card mb-4 p-3 text-slate-600"><b>Condiciones de pago:</b> {quote.payment_terms}</p>}

      <section className="card mb-4 p-4">
        <h2 className="mb-2 font-bold">Estado</h2>
        <div className="flex flex-wrap gap-2">
          {STATUS_ACTIONS[quote.status].map((s) => (
            <button key={s} className="btn btn-ghost" disabled={status.isPending} onClick={() => status.mutate(s)}>Marcar como {STATUS_LABEL[s].toLowerCase()}</button>
          ))}
        </div>
      </section>

      <section className="card mb-4 p-4">
        <h2 className="mb-2 font-bold">Historial</h2>
        <ul className="space-y-1 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex justify-between gap-3">
              <span>
                {EVENT_LABEL[e.event] ?? e.event}
                {e.event === 'status_changed' && ` (${STATUS_LABEL[e.detail.from as QuoteStatus] ?? '?'} → ${STATUS_LABEL[e.detail.to as QuoteStatus] ?? '?'})`}
              </span>
              <span className="whitespace-nowrap text-slate-500">{new Date(e.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</span>
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && <button className="btn btn-danger" onClick={() => setConfirmDel(true)}>Eliminar presupuesto</button>}
      {confirmDel && <Confirm title="Eliminar presupuesto" message="Se borra el presupuesto con sus ítems y su historial. No se puede deshacer." onConfirm={() => del.mutate()} onCancel={() => setConfirmDel(false)} />}
    </>
  );
}
