# 18 — Perfiles de acceso

Contrato: "4 usuarios de Grupo ALCO, con control de acceso por perfil". En Fase 1 se había decidido
que todos tuvieran el mismo acceso (`docs/07` §4, ALCO G27–G28). El 2026-10-19 el usuario lo
amplió: ALCO trabaja con **socios** que consiguen clientes y atienden solo a esos clientes, y hace
falta un perfil de **solo lectura**. Las cuentas de siempre siguen siendo Administrador.

## Perfiles

| | Puede editar | Solo ver |
| --- | --- | --- |
| **Todas las empresas** | Administrador | Solo lectura |
| **Ciertas empresas** | Socio | Solo lectura de ciertas empresas |

- **Administrador** (`admin`): todo, en todas las empresas. Es el único que ve Cuentas, Auditoría,
  Categorías, Diagnóstico y la guía de estilos; crea, desactiva y agrupa empresas; corrige el serial
  de un equipo; asigna equipos sin sede; aprueba bajas frenadas; sincroniza todos los equipos; y es
  el único que **edita huellas** (borrar un usuario del equipo, vaciar huellas o marcaciones).
- **Solo lectura** (`viewer`): ve y descarga (reportes, export a nómina), sin cambiar nada. Todas
  las empresas o solo las elegidas.
- **Socio** (`operator`): trabaja con las empresas asignadas: datos de la empresa (no su grupo),
  sedes, empleados y contratos, horarios, asignar horario, importar, correcciones de asistencia,
  recalcular, y operar los equipos de sus sedes. **No** crea empresas, **no** edita huellas, **no**
  ve equipos sin sede ni los de otras empresas, **no** edita Categorías (las usa al cargar contratos).

Reglas que pidió el usuario: el socio no crea empresas (las crea ALCO y se las asigna); ve a una
persona y sus datos, pero solo los contratos y la asistencia de sus empresas; no edita huellas
(una huella es de la persona y vale en todos los equipos, también ajenos); solo los equipos de sus
sedes; el acceso se asigna por empresa, con atajo "todas las de este grupo" (una empresa que se
agregue después al grupo no entra sola); Inicio, el menú y el buscador solo muestran lo suyo.

## Datos

- `app_user.role` (`admin` / `viewer` / `operator`) + `app_user.all_companies`, y la tabla
  `app_user_company` (cuenta ↔ empresa). Migración `20261019200000_account_access`.
- CHECKs: un administrador siempre tiene todas las empresas; un socio nunca.
- Las 3 cuentas que existían quedaron como Administrador.
- El acceso se lee en cada request: cambiar el perfil o las empresas de una cuenta aplica de
  inmediato, sin que tenga que volver a entrar.

## Cómo se valida

Todo pasa por `lib/access.ts`:

- `getAccess()` / `accessFor(user)`: perfil y empresas de la cuenta (`companyIds` null = todas).
- `allow(need)` en cada **server action** (devuelve error "Su cuenta no tiene permiso para esto."):
  `need` dice si hace falta administrador, editar o editar huellas, y los objetos que toca
  (empresa, sede, equipo, persona, contrato, horario, operación); cada objeto se juzga por la
  empresa a la que pertenece. Un equipo sin sede solo lo ve un administrador. Una persona es
  visible si tiene o tuvo contrato con alguna empresa del alcance.
- `requirePage(need)` en cada **página** de detalle y `requireAdminPage()` en las de
  administración: lo ajeno responde **404** (no revela que existe).
- Listas, Inicio, el contador de equipos, el buscador (`globalSearch(q, companyIds)`), la API de
  operaciones y las descargas (cédula, logo, export, reportes) filtran por alcance.
- La interfaz oculta lo que la cuenta no puede usar (editar, corregir, recalcular, huellas…), pero
  eso es comodidad: **la validación es la del servidor**.
- `__tests__/accessGuards.test.ts` falla si una server action nueva no valida el acceso.

## Alta de personas por un socio

Una persona sin contrato con sus empresas sería invisible para el socio. Por eso, para una cuenta
limitada, "Registrar persona" pide además la **empresa** y el **inicio del contrato** y crea las dos
cosas juntas. Si la cédula ya existe (la persona trabaja en otra empresa), no se muestran sus datos:
se le agrega el contrato y el aviso dice "ya estaba registrada: se le agregó el contrato".

## Pruebas

`__tests__/access.test.ts` (perfiles, CHECKs, la guardia por cada tipo de objeto, equipos
visibles, buscador), `__tests__/accessGuards.test.ts` (todas las acciones validan) y
`e2e/perfiles.spec.ts` (el administrador crea un Socio con una empresa y una cuenta de Solo
lectura; el Socio ve solo lo suyo y lo ajeno da 404; Solo lectura no tiene botones para cambiar).

## A futuro

Los perfiles más específicos ("puede corregir asistencia pero no tocar equipos") son un permiso
más en `Access` y en `Need`, sin rehacer las pantallas.
