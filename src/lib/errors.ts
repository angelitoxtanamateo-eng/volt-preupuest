/** Traduce errores de Supabase/PostgREST/Postgres/red a mensajes claros en español rioplatense. */

interface ErrLike {
  message?: string;
  code?: string;
  status?: number;
  details?: string;
}

export function humanizeError(e: unknown): string {
  if (e == null) return 'Ocurrió un error inesperado.';
  const err: ErrLike = typeof e === 'string' ? { message: e } : (e as ErrLike);
  const msg = (err.message ?? '').toString();
  const m = msg.toLowerCase();

  // Red
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed') || m.includes('network request failed')) {
    return 'No hay conexión con el servidor. Revisá tu internet e intentá de nuevo.';
  }
  // Auth
  if (m.includes('invalid login credentials')) return 'Email o contraseña incorrectos.';
  if (m.includes('email not confirmed')) return 'Todavía no confirmaste tu email. Revisá tu bandeja de entrada.';
  if (m.includes('user already registered')) return 'Ya existe una cuenta con ese email. Probá iniciar sesión.';
  if (m.includes('password should be at least') || m.includes('weak_password') || m.includes('weak password')) {
    return 'La contraseña es muy débil o corta. Usá al menos 8 caracteres.';
  }
  if (m.includes('rate limit') || err.status === 429) return 'Demasiados intentos. Esperá unos minutos y volvé a probar.';
  if (m.includes('jwt expired') || m.includes('invalid jwt')) return 'Tu sesión venció. Iniciá sesión de nuevo.';

  // Postgres / RLS
  if (err.code === '42501' || m.includes('row-level security') || m.includes('permission denied')) {
    return 'No tenés permiso para hacer esto.';
  }
  if (err.code === '23505' || m.includes('duplicate key')) return 'Ya existe un registro igual.';
  if (err.code === '23503' || m.includes('foreign key')) return 'Ese dato está relacionado con otros registros y no se puede usar o borrar así.';
  if (err.code === '23514' || m.includes('check constraint')) return 'Alguno de los valores no es válido. Revisá los datos.';
  if (err.code === '23502' || m.includes('null value')) return 'Falta completar un dato obligatorio.';

  // Mensajes propios de las funciones de la base (ya están en español)
  if (/^(sin acceso|solo un administrador|la empresa debe|presupuesto inexistente|ítem inexistente|evento no permitido|no autenticado)/i.test(msg)) {
    return msg;
  }
  if (msg.includes('Storage') || m.includes('mime type') || m.includes('exceeded the maximum')) {
    return 'No se pudo subir el archivo. Usá una imagen PNG o JPG de hasta 2 MB.';
  }
  return msg ? `Ocurrió un error: ${msg}` : 'Ocurrió un error inesperado.';
}
