# QA en vivo — Hito 3 (administración de dominio)

Checklist para probar a mano en el panel **después de pushear a `main` y que Coolify
redespliegue**. Cada sección: pasos + resultado esperado + casilla.

Se completa a medida que se construye cada pieza del CRUD. Lo verificado en local
antes de pushear va marcado como _(local ✓)_ — igual conviene repasarlo en vivo
porque prod tiene otro Postgres, otra red y datos reales.

---

## 0. Prerrequisitos (una sola vez)

1. Esperar a que el deploy termine. En los **Runtime Logs** de la app debe verse
   `Applying migration ...` (la primera vez) o `No pending migrations to apply`, y
   `Biometric server listening`.
2. Crear un usuario de plataforma en prod (si no existe):
   ```bash
   ssh root@2.28.70.76
   APP=$(docker ps -q --filter "publish=8090")
   docker exec -it "$APP" npm run create-user tu-email@grupoalco.com "Tu Nombre" "una-clave-fuerte"
   ```
3. Abrir el dominio del panel → debería **redirigir a `/login`**.

- [ ] Deploy ok, migraciones aplicadas (Runtime Logs)
- [ ] Usuario creado

---

## 1. Auth

| # | Paso | Esperado |
| --- | --- | --- |
| 1.1 | Ir a `/admin` sin haber iniciado sesión | Redirige a `/login` |
| 1.2 | Login con email/clave correctos | Entra a `/admin` |
| 1.3 | Login con clave incorrecta | "Credenciales inválidas.", no entra |
| 1.4 | Recargar `/admin` estando logueado | Sigue adentro (la sesión persiste) |
| 1.5 | En el sidebar abajo: nombre + "Salir" → click "Salir" | Vuelve a `/login`; ir a `/admin` redirige de nuevo |
| 1.6 | `GET /` del server (health) — abrir el dominio raíz o `curl` | `Biometric server OK` **sin** pedir login (los equipos no autentican) |

- [ ] 1.1–1.6 ok

---

## 2. Empresas y sedes  _(local ✓)_

Ruta: **Administración → Empresas**.

### 2.1 Crear

| # | Paso | Esperado |
| --- | --- | --- |
| 2.1.1 | "+ Nueva empresa" → marcar "Es un grupo", nombre `GRUPO PRUEBA`, sin RIF → Crear | Se crea; aparece en la lista con tag **Grupo** |
| 2.1.2 | "+ Nueva empresa" → nombre `HIJA PRUEBA`, RIF `J-12345678`, padre = `GRUPO PRUEBA` → Crear | Se crea como hija (indentada con `↳` bajo el grupo), tag **Operativa** |
| 2.1.3 | "+ Nueva empresa" → nombre sin RIF y **sin** marcar grupo → Crear | Error: "El RIF es obligatorio para empresas operativas…". No se crea. |
| 2.1.4 | "+ Nueva empresa" → poner de padre a `HIJA PRUEBA` (que ya es hija) | Error: "…la jerarquía es de 2 niveles…". No se crea. |

### 2.2 Editar / estado

| # | Paso | Esperado |
| --- | --- | --- |
| 2.2.1 | Entrar al detalle de `HIJA PRUEBA` → "Editar" → cambiar dirección y umbrales (tardanza 10, regla "No marcó entrada") → Guardar | Vuelve el detalle con los valores nuevos |
| 2.2.2 | En el detalle → "Desactivar" → confirmar | Estado pasa a **Inactiva**; en la lista aparece como inactiva |
| 2.2.3 | "Reactivar" | Vuelve a **Activa** |
| 2.2.4 | Intentar editar `HIJA PRUEBA` y ponerle un padre distinto teniendo… (si tuviera hijas) | Rechaza si la empresa ya es padre de otras |

### 2.3 Sedes

| # | Paso | Esperado |
| --- | --- | --- |
| 2.3.1 | En el detalle de una empresa → "+ Sede" → nombre `Sede Centro`, código `SC` → Crear | Aparece en la tabla de sedes |
| 2.3.2 | "Editar" la sede → cambiar el nombre → Guardar | Se actualiza |
| 2.3.3 | "Desactivar" la sede → luego "Reactivar" | Cambia de estado correctamente |

- [ ] 2.1 ok
- [ ] 2.2 ok
- [ ] 2.3 ok

### 2.4 Auditoría (opcional, por SSH)

```bash
docker exec -it d0l2qvobp9zmvdvmqx7fyvzq psql -U postgres -d postgres -c \
  "SELECT action, entity_type, entity_id, actor_app_user_id, created_at FROM audit_log ORDER BY id DESC LIMIT 10;"
```
Esperado: filas `company.create` / `company.update` / `company.deactivate` / `site.create` … con `actor_app_user_id` = tu usuario.

- [ ] auditoría registra las acciones

---

## 3. Departamentos y Puestos  _(local ✓)_

Ruta: **Administración → Categorías**. Una página con dos tablas.

### 3.1 Departamentos

| # | Paso | Esperado |
| --- | --- | --- |
| 3.1.1 | "+ Departamento" → nombre `DOCENTES`, código `A55` → Crear | Aparece en la tabla, estado **Activo** |
| 3.1.2 | "+ Departamento" → sin nombre → Crear | Error "El nombre es obligatorio.", no crea |
| 3.1.3 | "Editar" en la fila → cambiar la descripción → Guardar | Se actualiza |
| 3.1.4 | "Desactivar" → luego "Reactivar" | Cambia de estado |

### 3.2 Puestos

| # | Paso | Esperado |
| --- | --- | --- |
| 3.2.1 | "+ Puesto" → nombre `Coordinador`, departamento = `DOCENTES` → Crear | Aparece con su departamento en la columna |
| 3.2.2 | "+ Puesto" → nombre `Genérico`, sin departamento → Crear | Se crea; columna Departamento muestra `—` |
| 3.2.3 | "Editar" un puesto → cambiarle el departamento → Guardar | Se refleja |
| 3.2.4 | Desactivar el departamento `DOCENTES` | El puesto `Coordinador` **sigue** asociado a `DOCENTES` (desactivar ≠ borrar) |
| 3.2.5 | "Desactivar" / "Reactivar" un puesto | Cambia de estado |

- [ ] 3.1 ok
- [ ] 3.2 ok
- [ ] `audit_log` registra `department.*` / `position.*` con tu `actor_app_user_id`

---

## 4. Grupos de empleados y Turnos  _(local ✓)_

Ruta: **Administración → Grupos y turnos**. Requiere que exista al menos una empresa.

### 4.1 Grupos

| # | Paso | Esperado |
| --- | --- | --- |
| 4.1.1 | "+ Nuevo grupo" → empresa = (una activa), nombre `Administrativo` → Crear | Aparece en la lista con su empresa |
| 4.1.2 | "+ Nuevo grupo" sin elegir empresa | El `select` obliga a elegir (o error "Seleccioná una empresa") |
| 4.1.3 | Entrar al detalle → "Editar" → poner tolerancia tardanza = 10 → Guardar | En el detalle la fila muestra `10` (sin el sufijo "(empresa)") |
| 4.1.4 | En el detalle, si el grupo NO tiene umbral propio | Muestra el de la empresa con sufijo `(empresa)`, o `—` si tampoco |
| 4.1.5 | Editar un grupo | El campo Empresa está **deshabilitado** (no se puede mover de empresa) |
| 4.1.6 | "Desactivar" / "Reactivar" el grupo | Cambia de estado |

### 4.2 Turnos (dentro del detalle del grupo)

| # | Paso | Esperado |
| --- | --- | --- |
| 4.2.1 | "+ Turno" → nombre `Mañana`, inicio `06:30`, fin `13:30`, descanso `12:00`–`13:00`, horas `6`, días L-V, vigencia desde hoy → Crear | Aparece en la tabla: horario `06:30–13:30`, días `L M M J V`, vigencia `<fecha> → ∞` |
| 4.2.2 | "+ Turno" con hora `25:00` o `6:3` | Error "Hora de inicio/fin inválida (formato HH:MM, 24h)." |
| 4.2.3 | "+ Turno" con "vigencia hasta" anterior a "desde" | Error "La fecha 'hasta' no puede ser anterior a 'desde'." |
| 4.2.4 | "+ Turno" marcando "cruza la medianoche", inicio `22:00` fin `06:00` | Se crea; en la tabla aparece el tag `+1 día` |
| 4.2.5 | "Editar" un turno → cambiar días / horario | Se refleja |
| 4.2.6 | "Eliminar" un turno → confirmar | Desaparece de la tabla (borrado real; si tenía días de asistencia calculados, esos quedan sin turno, no se borran) |

- [ ] 4.1 ok
- [ ] 4.2 ok
- [ ] `audit_log` registra `group.*` / `shift.*`

---

## 5. Empleados y empleos  _(local ✓)_

Ruta: **Administración → Empleados**. Necesita al menos una empresa.

### 5.1 Persona

| # | Paso | Esperado |
| --- | --- | --- |
| 5.1.1 | "+ Registrar persona" → doc `V-12345678`, nombre `Juan`, apellido `Pérez` → Registrar | Aparece en la lista con tag **Pool** (no tiene empleo aún) |
| 5.1.2 | "+ Registrar persona" con doc `12345` (sin letra) o `X-999` | Error "Documento inválido (V/E/J/G + dígitos…)" |
| 5.1.3 | "+ Registrar persona" con un doc que ya existe | Error "Ya existe una persona con el documento …" |
| 5.1.4 | En el detalle → "Editar datos" → cambiar nombre → Guardar | Se actualiza |

### 5.2 Empleos — alta / baja

| # | Paso | Esperado |
| --- | --- | --- |
| 5.2.1 | Detalle de la persona → "+ Nuevo empleo" → empresa, (sede/grupo se filtran por esa empresa), puesto, fecha de inicio → Registrar | Aparece en la tabla de empleos; el tag de la persona pasa a **Activo** |
| 5.2.2 | En "+ Nuevo empleo", elegir empresa → los selects de **Sede** y **Grupo** solo muestran los de esa empresa | ✓ |
| 5.2.3 | Fila de empleo activo → "Dar de baja" → fecha de baja → Confirmar | El empleo pasa a **Cerrado** con esa fecha; si era el único activo, la persona vuelve a **Pool** |
| 5.2.4 | "Dar de baja" con fecha anterior al inicio del empleo | Error "La fecha de baja no puede ser anterior al inicio." |

### 5.3 Traslado

| # | Paso | Esperado |
| --- | --- | --- |
| 5.3.1 | Fila de empleo activo → "Trasladar" → empresa destino + fecha del traslado → Confirmar | El empleo origen queda **Cerrado** con esa fecha; aparece un empleo **Activo** nuevo en la empresa destino con esa fecha de inicio. La persona conserva todo el historial. |
| 5.3.2 | Tras el traslado, verificar que la persona tiene **exactamente 1** empleo activo | ✓ (en la empresa destino) |
| 5.3.3 | "Trasladar" con fecha anterior al inicio del empleo origen | Error |

### 5.4 Filtros de la lista

| # | Paso | Esperado |
| --- | --- | --- |
| 5.4.1 | Filtro **Estado = Pool** | Solo personas sin ningún empleo activo |
| 5.4.2 | Filtro **Empresa = X** | Solo personas con empleo activo en X |
| 5.4.3 | **Buscar** por apellido o por documento | Filtra por coincidencia (case-insensitive en nombre) |

- [ ] 5.1–5.4 ok
- [ ] `audit_log` registra `employee.create` / `employment.create` / `employment.end` / `employee.transfer`

---

## 6. Enrolamiento  _(local ✓)_

Ruta: **Administración → Enrolamiento**. Vincula cada slot `(equipo, ID de usuario)`
con una persona, para que el motor de asistencia sepa a quién pertenece cada marcaje.
Necesita: al menos un equipo, y que ese equipo tenga usuarios sincronizados
(pantalla **Usuarios** → "Sincronizar lista desde el equipo").

### 6.1 Vincular

| # | Paso | Esperado |
| --- | --- | --- |
| 6.1.1 | Elegir un equipo en el selector. La tabla lista un renglón por cada ID de usuario que el equipo reporta | Columna **Slot** = el `user_id` del equipo; **Nombre en el equipo** = el nombre cargado en el biométrico (o `—`) |
| 6.1.2 | En un slot "Sin vincular" → "Vincular empleado" → elegir una persona → Vincular | El slot pasa a mostrar el nombre de la persona (link a su ficha); contador "N vinculados" sube |
| 6.1.3 | El desplegable de personas | Solo muestra empleados con **empleo activo** en la empresa del equipo (o su empresa padre / hijas) |
| 6.1.4 | Si el equipo **no** está asignado a ninguna empresa | Aparece el aviso "Este equipo no está asignado…"; el desplegable cae a "todos los empleados con empleo activo" |
| 6.1.5 | Intentar vincular un segundo empleado al **mismo** slot (sin desvincular el primero) | Rechazado: "El slot N … ya tiene un empleado vinculado. Desvinculalo primero." |
| 6.1.6 | Vincular a la **misma** persona en **otro** slot del mismo equipo | Permitido (una persona puede ocupar varios slots) |

### 6.2 Desvincular

| # | Paso | Esperado |
| --- | --- | --- |
| 6.2.1 | En un slot vinculado → "Desvincular" → "Confirmar" | El slot vuelve a "Sin vincular"; el vínculo queda **cerrado** (no se borra) |
| 6.2.2 | Tras desvincular, volver a vincular a alguien en ese slot | Permitido (el unique parcial solo aplica al vínculo activo) |
| 6.2.3 | Abrir "Histórico de vínculos cerrados" al pie | Lista los vínculos inactivos con fecha desde / hasta |

### 6.3 Vínculos huérfanos

| # | Paso | Esperado |
| --- | --- | --- |
| 6.3.1 | Vincular un slot, luego borrar ese usuario del equipo (pantalla Usuarios → Eliminar) y **no** re-sincronizar | En Enrolamiento aparece la sección "Vínculos sin slot en el equipo" con ese vínculo, y un botón "Desvincular" |

### 6.4 Ficha del empleado

| # | Paso | Esperado |
| --- | --- | --- |
| 6.4.1 | Ir a **Empleados → (persona vinculada) → Detalle** | Sección "Enrolamientos" lista equipo · slot · estado · desde, con link "Gestionar →" a la pantalla de Enrolamiento de ese equipo |
| 6.4.2 | Persona sin vínculos | Muestra "Sin enrolamientos" |

- [ ] 6.1–6.4 ok
- [ ] `audit_log` registra `enrollment.create` / `enrollment.end` con tu `actor_app_user_id`

---

## 7. Cuentas de plataforma  _(local ✓)_

Ruta: **Administración → Cuentas**. CRUD de los usuarios internos de ALCO que entran
al panel (≠ "Usuarios de equipo", que son los enrolados en el biométrico).

> Nota de navegación: el ítem del sidebar que antes decía **"Usuarios"** ahora dice
> **"Usuarios de equipo"** (gestión del biométrico). El nuevo **"Cuentas"** es el de esta sección.

### 7.1 Alta / edición

| # | Paso | Esperado |
| --- | --- | --- |
| 7.1.1 | "+ Nueva cuenta" → nombre, email, contraseña (≥ 8) → Crear cuenta | Aparece en la tabla como **Activa**, "Último ingreso: Nunca" |
| 7.1.2 | "+ Nueva cuenta" con contraseña de 5 caracteres | Error "La contraseña debe tener al menos 8 caracteres." |
| 7.1.3 | "+ Nueva cuenta" con un email que ya existe | Error "Ya existe una cuenta con el email …" |
| 7.1.4 | En una fila → "Editar" → cambiar nombre / email → Guardar | Se actualiza |
| 7.1.5 | Cerrar sesión y entrar con la cuenta nueva | Entra; su fila pasa a mostrar fecha/hora en "Último ingreso" |

### 7.2 Resetear contraseña (otra cuenta)

| # | Paso | Esperado |
| --- | --- | --- |
| 7.2.1 | En la fila de **otra** cuenta → "Resetear contraseña" → contraseña nueva (≥ 8) → Restablecer | Toast "Contraseña de X restablecida…"; la columna **Sesiones** de esa fila pasa a `0` |
| 7.2.2 | Si esa persona tenía el panel abierto, que recargue | La tira a `/login` (sus sesiones se cerraron) |
| 7.2.3 | Esa persona entra con la contraseña nueva | Funciona |

### 7.3 Activar / desactivar

| # | Paso | Esperado |
| --- | --- | --- |
| 7.3.1 | En **tu propia** fila (marcada "· vos") → "Desactivar" | Error "No podés desactivar tu propia cuenta." |
| 7.3.2 | Dejá una sola cuenta activa e intentá desactivarla | Error "Debe quedar al menos una cuenta activa." |
| 7.3.3 | Desactivar otra cuenta (habiendo ≥ 2 activas) → confirmar | Pasa a **Inactiva**; sus sesiones se cierran; ya no puede iniciar sesión ("Credenciales inválidas.") |
| 7.3.4 | "Reactivar" esa cuenta | Vuelve a **Activa**; ya puede entrar de nuevo |

### 7.4 Cambiar mi contraseña

| # | Paso | Esperado |
| --- | --- | --- |
| 7.4.1 | Botón "Cambiar mi contraseña" (arriba a la derecha) → actual incorrecta + nueva → Actualizar | Error "La contraseña actual no es correcta." |
| 7.4.2 | Actual correcta + nueva (≥ 8) → Actualizar | Toast "Contraseña actualizada." La sesión **actual sigue abierta** (no te saca) |
| 7.4.3 | Si tenías otra sesión abierta en otro navegador, recargala | Te pide login (las demás sesiones se cerraron) |
| 7.4.4 | Cerrar sesión y volver a entrar con la contraseña nueva | Funciona |

- [ ] 7.1–7.4 ok
- [ ] `audit_log` registra `app_user.create` / `app_user.update` / `app_user.reset_password` / `app_user.deactivate` / `app_user.change_password` — y **ningún** registro contiene contraseñas

---

<!-- Las secciones siguientes se agregan a medida que se construyen. -->



