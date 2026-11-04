/** Normaliza un logo a PNG de hasta 512 px: el bucket solo admite PNG/JPG y el PDF solo embebe PNG/JPG. */
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_INPUT = 5 * 1024 * 1024;

export async function imageFileToPng(file: File, maxSize = 512): Promise<Blob> {
  if (!ALLOWED.includes(file.type)) throw new Error('Usá una imagen PNG, JPG o WebP.');
  if (file.size > MAX_INPUT) throw new Error('La imagen pesa más de 5 MB.');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Tu navegador no pudo procesar la imagen.');
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('No se pudo convertir la imagen.');
  if (blob.size > 2 * 1024 * 1024) throw new Error('El logo sigue pesando más de 2 MB. Probá con uno más simple.');
  return blob;
}
