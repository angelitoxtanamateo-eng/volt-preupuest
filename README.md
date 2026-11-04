# VOLT Presupuestos Inteligentes

Presupuestos desde el celular, **dictando o escribiendo**, para pequeños negocios e independientes de Argentina.
Marca VOLT · React + TypeScript · Supabase (Postgres, Auth, Storage) · Netlify.

## Qué hace

- **Dictado**: "6 metros de caño de 20, 4 codos, dos jornales, traslado 15 mil" → ítems con cantidades, unidades, precios (dictados o del catálogo), traslado y descuento. **Siempre se revisa y corrige antes de guardar.**
- **Clientes** con historial, **catálogo** con precios, costos y márgenes (los costos solo los ve el administrador).
- **PDF** con logo, cliente, detalle por tipo, totales, condiciones de pago, fecha y vigencia.
- **WhatsApp**: arma el mensaje y abre `wa.me` con el texto escrito; la persona toca "Enviar". Compartir el PDF con la hoja de compartir del celular (donde el navegador lo permite).
- **Multiempresa**: cada negocio con su logo, moneda y condiciones; datos aislados por RLS; roles administrador y empleado; invitaciones por email.
- Panel con totales, estados (borrador, enviado, aceptado, rechazado, vencido), historial por presupuesto, exportación CSV.

**No incluye** (a propósito, requieren integraciones y credenciales reales): facturación ARCA, cobros automáticos, envío automático de WhatsApp. No hay botones que lo aparenten.

## Estado y qué falta verificar (leer antes de vender)

Probado de verdad en esta entrega: base de datos y seguridad (140 pruebas sobre PostgreSQL), lógica de negocio, parser de dictado, PDF, backup y restauración.

**Sin compilar ni ejecutar todavía: la interfaz React** (`src/app`, `src/pages`, `src/components`). Se escribió en un entorno sin acceso al registro de npm, así que solo se pudo chequear sintaxis y tipos con las librerías externas simuladas. Es esperable que `npm run build` muestre algún ajuste menor. Tampoco se probó contra un proyecto Supabase real ni en un celular. Primeros pasos: `npm install && npm run typecheck && npm run build`, y recorrer el flujo completo (registro → empresa → cliente → presupuesto por voz → PDF → WhatsApp) antes de entregarlo a un cliente.

## Empezar

```bash
npm install
cp .env.example .env.local      # completar con TU proyecto Supabase
npm run dev
```

1. Creá un proyecto en Supabase y aplicá `supabase/migrations/001` a `006` en orden, cada archivo en su propia ejecución (SQL Editor). Detalle en [DEPLOY.md](DEPLOY.md).
2. En `.env.local`: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (clave **anon**). La app se niega a arrancar si detecta una clave `service_role`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` / `build` / `preview` | Desarrollo, compilación y vista previa |
| `npm run typecheck` | TypeScript estricto |
| `npm test` | Lógica, parser de dictado, PDF (node:test, sin base) |
| `npm run test:db` | 97 pruebas de RLS/totales/invitaciones contra PostgreSQL (necesita `psql` y un servidor local) |
| `npm run test:backup` | Respalda, restaura en una base vacía y compara |

## Estructura

Ver [ARCHITECTURE.md](ARCHITECTURE.md) (diseño, modelo de datos, seguridad, decisiones y limitaciones).

## Personalizar para cada cliente

Mismo código, datos propios: crear la empresa, subir logo, cargar catálogo y condiciones (Ajustes). Para aislamiento total, un proyecto Supabase y un sitio Netlify por cliente (ver DEPLOY.md). Para cambiar los colores de marca: variables `--color-volt-*` en `src/index.css`.

## Privacidad del dictado

El reconocimiento de voz lo hace el navegador (en Chrome/Edge, el audio se procesa en servidores de Google/Microsoft). VOLT no recibe el audio, solo el texto. Informalo a tus clientes. Siempre existe la alternativa de escribir o de usar el micrófono del teclado del celular.
