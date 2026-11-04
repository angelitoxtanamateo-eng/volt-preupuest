export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'cancelled';

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: 'Borrador',
  sent: 'Enviado',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
  expired: 'Vencido',
  cancelled: 'Cancelado',
};

/** Un presupuesto "enviado" con la vigencia ya vencida se muestra como vencido (igual criterio que la vista quote_stats). */
export function effectiveStatus(status: QuoteStatus, validUntil: string | null, today: string): QuoteStatus {
  if (status === 'sent' && validUntil && validUntil < today) return 'expired';
  return status;
}

/** Transiciones que ofrece la interfaz (la base no las restringe: el equipo puede corregir errores). */
export const STATUS_ACTIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ['sent', 'accepted', 'rejected', 'cancelled'],
  sent: ['accepted', 'rejected', 'draft', 'cancelled'],
  accepted: ['sent', 'cancelled'],
  rejected: ['sent', 'draft', 'cancelled'],
  expired: ['sent', 'rejected', 'cancelled'],
  cancelled: ['draft'],
};
