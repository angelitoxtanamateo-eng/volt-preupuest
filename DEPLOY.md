# Puesta en producción

## 1. Supabase

1. Crear el proyecto (región cercana: São Paulo).
2. **SQL Editor**: ejecutar `supabase/migrations/001_schema.sql` y después `002_functions_invitations.sql`. Si hay errores, no seguir: copiar el mensaje.
3. **Authentication > Providers > Email**: dejar activada la **confirmación de email** (la seguridad de las invitaciones depende de ella) y mínimo de contraseña **8**. Si el plan lo permite, activar la protección contra contraseñas filtradas.
4. **Authentication > URL Configuration**: *Site URL* = la URL final del sitio; en *Redirect URLs* agregar `https://TU-SITIO/**` (y `http://localhost:5173/**` para desarrollo).
5. **Authentication > SMTP**: configurar un SMTP propio (el de prueba de Supabase limita muy pocos correos por hora; no sirve para clientes reales).
6. **Project Settings > API**: copiar `Project URL` y la clave **anon**. **Nunca** usar `service_role` en el frontend.
7. Verificar en **Storage** que existe el bucket privado `company-assets`.

## 2. Netlify

1. Nuevo sitio desde el repositorio. Build: `npm run build`, publicar `dist` (ya está en `netlify.toml`).
2. Variables de entorno: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
3. Si usás dominio propio para Supabase, ajustar `connect-src` e `img-src` de la CSP en `netlify.toml`.
4. Probar en un celular real (Chrome en Android para el dictado).

## 3. Primer uso

El primer usuario se registra, confirma el email y crea su empresa (queda como administrador). Para sumar empleados: Ajustes > Equipo > Invitar; la persona se registra con **ese mismo email**, lo confirma, y entra sola a la empresa.

## 4. Copias de seguridad

- **Plan Pro de Supabase**: backups diarios gestionados (PITR opcional). El plan gratuito **no** los tiene.
- **Independiente del plan**: `scripts/backup.sh` (pg_dump cifrado). El workflow `.github/workflows/backup.yml` lo corre cada día si cargás en el repositorio los secretos `DATABASE_URL` y `BACKUP_PASSPHRASE`. Guardá la frase de cifrado también fuera de GitHub: sin ella el backup no se abre.
- **Restaurar**: `TARGET_DATABASE_URL=... BACKUP_PASSPHRASE=... ./scripts/restore.sh volt-XXXX.tar.enc --yes` (destructivo: probalo primero en un proyecto de prueba). El ciclo completo está probado con `npm run test:backup`.
- Los logos (Storage) no van en `pg_dump`: se vuelven a subir desde Ajustes.
- Cada negocio puede bajar sus datos en CSV desde Ajustes > Datos.

## 5. Un cliente con datos totalmente aislados

Repetir los pasos 1 y 2 con un proyecto Supabase y un sitio Netlify nuevos (mismo código, otras variables). Es la opción recomendada para clientes que lo exijan por contrato.

## 6. Lista de chequeo antes de entregar

- [ ] `npm run test:all` en verde y `npm run build` sin errores
- [ ] Registro, confirmación de email, alta de empresa, logo, cliente, catálogo
- [ ] Presupuesto por voz en un celular Android: corregir, guardar, PDF, WhatsApp
- [ ] Invitar a un empleado: entra, no ve costos, no puede borrar presupuestos
- [ ] Un segundo negocio de prueba no ve nada del primero
- [ ] Backup ejecutado y restaurado una vez en un proyecto de prueba
- [ ] Ninguna clave secreta en el repositorio ni en las variables `VITE_*`

## Estado de la conexión (proyecto `gnksbrieykexgngpmdiv`)

- Migraciones 001, 002 y 003 **ya aplicadas** a ese proyecto y verificadas con una prueba de humo que se revierte sola (perfiles, totales, historial, aislamiento entre usuarios, `anon` bloqueado).
- El proyecto ya tenía otra app (`events`, `items`, `tasks`, bucket `fotos`): no se tocó. Las migraciones de VOLT solo otorgan o quitan permisos sobre las tablas de VOLT.
- Pendiente en el panel de Supabase (no se puede hacer por SQL): **Authentication > URL Configuration** (Site URL = tu dominio de Netlify y la URL local `http://localhost:5173` en Redirect URLs) y **Authentication > Passwords > Leaked password protection** (según el plan).
- Avisos que quedan en el linter y son intencionales: `accept_invitations`, `create_company`, `is_admin`, `is_member`, `log_quote_event` son funciones que la app llama a propósito; todas validan `auth.uid()`.
