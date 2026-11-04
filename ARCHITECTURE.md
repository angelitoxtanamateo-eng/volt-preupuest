# VOLT Presupuestos Inteligentes: Arquitectura

Documento de diseño (Etapa 0). El esquema SQL completo está en `supabase/migrations/001_schema.sql`.

## 1. Principios

1. **Sin simulaciones.** Todo lo que la interfaz muestra existe y funciona. Lo que no está implementado no aparece en la UI.
2. **La seguridad vive en la base de datos.** El frontend es no confiable: RLS decide quién ve y escribe qué. Los totales se calculan con triggers en Postgres, no en el cliente.
3. **Sin secretos en el frontend.** Solo viajan `VITE_SUPABASE_URL` y la `anon key` (pública por diseño, protegida por RLS). La `service_role` nunca entra al repo ni al bundle.
4. **Personalizable por cliente (white-label).** Logo, colores de acento, nombre y condiciones se guardan por empresa; el código es único.
5. **Móvil primero.** Se diseña para 360 px y se amplía hacia escritorio.

## 2. Stack

| Capa | Elección | Motivo |
|---|---|---|
| UI | React 18 + TypeScript + Vite | Build rápido, tipado estricto |
| Estilos | Tailwind CSS v4 (tokens VOLT) | Consistencia y velocidad |
| Datos | `@supabase/supabase-js` + TanStack Query | Caché, reintentos, estados de error/carga |
| Formularios | Validadores propios en `src/lib/validation.ts` | Reflejan los CHECK de la base; sin dependencias y testeables en Node |
| Rutas | react-router | |
| PDF | `pdf-lib` (carga diferida) | PDF real generado en el dispositivo, sin servidor; se prueba en Node |
| Voz | Web Speech API (`es-AR`) | Nativa del navegador, sin claves ni costos |
| Pruebas | `node:test` + `tsx` (lógica, PDF) y psql contra PostgreSQL real (RLS, backup) | Sin dependencias de prueba pesadas |
| Hosting | Netlify (SPA con `_redirects`) | |
| Backend | Supabase: Postgres, Auth, Storage | |

## 3. Módulos y estructura

```
volt-presupuestos/
├─ supabase/
│  ├─ migrations/001_schema.sql      esquema + RLS + storage
│  ├─ migrations/002_functions_invitations.sql   RPC atómicas + invitaciones
│  └─ tests/                         rls.test.sql (97 pruebas), supabase_stub.sql, run.sh
├─ src/
│  ├─ lib/        supabase.ts, api.ts, money.ts, phone.ts, whatsapp.ts, validation.ts, errors.ts, csv.ts, pdf/, voice/
│  ├─ app/        AuthProvider, Layout, rutas
│  ├─ pages/      Auth, Dashboard, Clientes, Catálogo, Presupuestos (lista/editor/detalle), Ajustes
│  └─ components/ ui.tsx (modal, avisos, campos)
├─ scripts/                         backup.sh, restore.sh, test-backup.sh (pg_dump cifrado)
└─ netlify.toml
```

## 4. Modelo de datos (resumen)

```
auth.users ─┬─ profiles (1:1)
            └─ memberships (company_id, user_id, role: admin|employee)
companies ──┬─ clients
            ├─ catalog_items ── catalog_costs   (costos: SOLO admin)
            └─ quotes ──┬─ quote_items
                        └─ quote_events         (historial, solo por triggers)
```

Decisiones clave:

- **Multiempresa:** toda tabla de negocio lleva `company_id`. Un usuario puede pertenecer a varias empresas; la app trabaja con una activa.
- **Costos separados del precio:** `catalog_costs` es una tabla aparte con RLS solo-admin. Un empleado puede ver el precio de venta pero jamás el costo ni el margen, ni siquiera consultando la API directamente.
- **Numeración correlativa por empresa:** `quotes.number` lo asigna un trigger con bloqueo de fila (`companies.quote_seq`), sin duplicados bajo concurrencia.
- **Totales a prueba de manipulación:** `quote_items.line_total` es columna generada; triggers recalculan `subtotal`, `discount_amount` y `total`.
- **Historial:** `quote_events` registra creación y cambios de estado automáticamente; los eventos de PDF/WhatsApp los inserta la función RPC `log_quote_event`. Nadie puede insertar ni borrar eventos desde el cliente.
- **Dinero:** `numeric(14,2)`. En el cliente se opera en centavos enteros para evitar errores de coma flotante.

### Impuestos, anticipo y saldo (migración 005)

`neto = subtotal - descuento + traslado`; `impuesto = round(neto * impuesto% / 100, 2)`; `total = neto + impuesto`; `saldo = total - anticipo`.
El anticipo es un monto **declarado** por el negocio: la app no cobra ni verifica pagos. No puede superar el total (se verifica al confirmar la transacción).
Los presupuestos cancelados no cuentan en totales ni estadísticas. `duplicate_quote` copia un presupuesto como borrador con la moneda del original.

## 5. Seguridad

| Rol | Puede |
|---|---|
| **admin** | Todo en su empresa: configuración, equipo, catálogo, costos, borrar registros |
| **employee** | Crear/editar clientes y presupuestos, ver catálogo con precios de venta |
| Sin sesión (anon) | Nada: se revocan todos los permisos |

- `is_member()` / `is_admin()` son `security definer` con `search_path` fijo para evitar recursión en RLS.
- Ni `company_id` ni `number` de un presupuesto pueden modificarse (trigger de protección). Los ítems heredan `company_id` del presupuesto, así que un cliente malicioso no puede colarse en otra empresa.
- No se puede dejar una empresa sin administradores.
- Logos en un bucket **privado** (`company-assets`), carpeta por `company_id`, solo PNG/JPG/WebP hasta 2 MB. Se sirven con URL firmadas.
- **Invitar empleados sin `service_role`:** el admin registra el email en `invitations`. Cuando esa persona inicia sesión con ese email **ya confirmado**, la app llama a `accept_invitations()` (SECURITY DEFINER) y queda unida con el rol indicado. No hace falta una Edge Function ni ninguna clave privada. Un email sin confirmar no puede reclamar invitaciones (probado).
- Auth: email + contraseña con confirmación de correo, mínimo 8 caracteres, recuperación de clave. Se activa la protección contra contraseñas filtradas desde el panel de Supabase.
- Cabeceras en Netlify: CSP restrictiva, `X-Frame-Options`, `Referrer-Policy`.

## 6. Flujo de presupuesto por voz

1. El usuario toca el micrófono y dicta: *"Cambio de cañería en cocina, 6 metros de caño de 20, 4 codos, dos jornales, traslado 15 mil"*.
2. Web Speech API (`lang: es-AR`) devuelve la transcripción, que se muestra y se puede editar a mano.
3. Un **parser determinista** en el navegador extrae ítems con cantidades, unidades y traslado (números en palabras y formatos como "15 mil"). Cada ítem se cruza con el catálogo para sugerir el precio.
4. Pantalla de **revisión obligatoria**: tabla editable, con los ítems dudosos marcados. Nada se guarda sin que el usuario lo confirme.
5. Se calculan subtotal, descuento, traslado y total; se guarda como borrador.

Limitaciones que se declaran, no se ocultan:

- La dictación depende del navegador (muy buena en Chrome/Android; en iOS Safari es limitada). Siempre hay entrada de texto y se puede usar el micrófono del teclado del celular.
- El parser por reglas no entiende frases arbitrarias; por eso existe la pantalla de corrección. Una mejora opcional posterior es interpretar el texto con un modelo de lenguaje desde una Edge Function (la clave quedaría en el servidor), que requiere una cuenta y credenciales reales y no se incluye por defecto.

## 7. PDF y WhatsApp

- **PDF:** se genera en el dispositivo con logo, datos de la empresa y del cliente, detalle por tipo (materiales / mano de obra / otros), descuento, traslado, total, condiciones de pago, fecha y vigencia. Es un presupuesto, **no una factura**: no tiene valor fiscal.
- **WhatsApp:** no hay envío automático. La app arma el mensaje y abre `https://wa.me/<teléfono>?text=...` para que el usuario lo envíe. Para el PDF se usa la Web Share API con archivos (`navigator.canShare`) donde esté disponible; si no, se descarga y se adjunta a mano.
- Los teléfonos se normalizan al formato internacional argentino (`+54 9 ...`).

## 8. Copias de seguridad

- **Plan Pro de Supabase:** copias diarias automáticas, y PITR como complemento opcional. En el plan gratuito **no hay backups gestionados**.
- **Independiente del plan:** `scripts/backup.sh` ejecuta `pg_dump` cifrado y lo guarda fuera de Supabase, programado con GitHub Actions. Requiere configurar los secretos (`DATABASE_URL`, clave de cifrado) en el repositorio del cliente, nunca en el frontend.
- Exportación por empresa a CSV desde la app (Ajustes > Datos), para que cada negocio se lleve sus datos.
- Se documenta un procedimiento de restauración y se prueba una vez antes de la entrega.

## 9. Pruebas

- **Base de datos (PostgreSQL real, `npm run test:db`):** 97 pruebas. Aislamiento entre empresas, empleado sin acceso a costos, FKs compuestas, numeración correlativa sin huecos, totales recalculados aunque el cliente los falsifique, atomicidad de `save_quote`, invitaciones, historial, estadísticas, Storage.
- **Lógica (`npm test`):** dinero y totales (idénticos a la base), teléfonos AR, mensaje de WhatsApp, validaciones, CSV, errores, estados, números hablados, parser de dictado, cruce con catálogo, PDF (válido, paginado, resistente a datos hostiles), guardia contra `service_role`.
- **Backups (`npm run test:backup`):** respalda, restaura en una base vacía y compara datos y políticas RLS; verifica clave incorrecta, falta de `--yes` y archivos alterados.
- **Pendiente:** pruebas automáticas de componentes React (requieren instalar el stack de UI).

## 10. Estado por etapas

| Etapa | Contenido | Estado |
|---|---|---|
| 0 | Arquitectura + esquema SQL con RLS | Hecho y probado en PostgreSQL |
| 1 | Auth, alta de empresa, layout móvil, tema VOLT | Código escrito; falta compilar y probar con Supabase real |
| 2 | Clientes y catálogo (costos solo admin) | Código escrito; falta compilar |
| 3 | Presupuestos, totales, estados, voz con corrección | Lógica probada; pantallas sin compilar |
| 4 | PDF y WhatsApp | PDF y mensaje probados; botones sin compilar |
| 5 | Panel, equipo e invitaciones, CSV | Base probada; pantallas sin compilar |
| 6 | Backups, Netlify, CI | Backup/restauración probados; Netlify sin desplegar |

## 11. Personalización por cliente

Para vender VOLT a un negocio nuevo: crear la empresa, subir el logo, cargar el catálogo y las condiciones de pago. Un cliente que quiera datos totalmente aislados puede tener su propio proyecto Supabase (mismo código, otras variables de entorno en Netlify). Ver `DEPLOY.md`.

## 12. Fuera de alcance (a propósito)

Facturación ARCA, cobros automáticos y envío automático de WhatsApp. Cada uno requiere una integración real y credenciales propias del cliente; hasta entonces no hay botones ni pantallas que lo aparenten.
