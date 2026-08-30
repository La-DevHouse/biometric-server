# Especificación de administración — dominio, vistas y flujos (Hitos 3–5)

Estado: **borrador de trabajo (rev. 2026-08-30)**. Sintetiza el relevamiento de
Adempiere (`docs/adempiere/`) y las respuestas de Grupo ALCO
(`docs/adempiere/preguntas-alco.md`) en un modelo de dominio, un conjunto de
vistas y un set de flujos para el panel nuevo.

**Adempiere es referencia, no destino.** El sistema nuevo no se integra con él.
Donde Adempiere modela algo de forma más compleja de lo que Fase 1 necesita, se
simplifica deliberadamente (y se dice por qué).

Este documento alimenta `docs/08-data-model.md` (schema Postgres/Prisma). Aquí se
describe el "qué"; el "cómo se guarda" va en el 08.

> **Alcance del cálculo de asistencia — DECIDIDO (2026-08-30).** Fase 1 **incluye
> el motor de cálculo de asistencia**: determinación automática de
> presente/tardanza/salida anticipada/ausencia y totalización de horas contra el
> horario asignado, con umbrales configurables por empresa/grupo. Lo que queda
> fuera (Fase 2+) es la **valoración legal/monetaria**: recargos por horas extra,
> bono nocturno, feriados y días de descanso especiales — como siempre estuvo en
> `01-requirements.md`. Ver §8.

---

## 1. Catálogo de entidades del dominio

Nomenclatura provisional en inglés/snake para alinear con el schema; los rótulos
de UI van en español.

### 1.1 `client_company` — empresa cliente

Origen: ventana **Organización** de Adempiere (`docs/adempiere/views/organizacion.md`).
ALCO: **32 empresas reales hoy**.

| Campo | Notas |
| --- | --- |
| `id` | interno |
| `parent_id` | self-FK, **jerarquía de 2 niveles** (padre → hijas). Una empresa con `parent_id` no puede ser padre de otra. **Relación simple y mutable** — una empresa puede cambiar de grupo con el tiempo (ALCO A3); no se guarda historia de a qué grupo perteneció. |
| `name` | razón social (requerido) |
| `tax_id` | RIF (`J`/`G` + dígitos) para empresas operativas. Las entidades "grupo" pueden no tener RIF — en Adempiere su "Código" era un secuencial (`16`). Nullable, pero requerido para empresas hoja. |
| `is_group` | equivale a "Entidad Acumulada" de Adempiere — marca las que son/pueden ser padre. Una `is_group=true` agrupa; puede o no tener dispositivos/empleados propios. |
| `shared_employees` | equivale a "Empleados Compartidos". Si está activo, un empleado de una empresa hija puede enrolar su huella en equipos de empresas hermanas del mismo padre sin ser dado de alta como empleado completo ahí. Ver flujo 5.4. |
| `status` | activa / inactiva (soft-delete) |
| `address` | opcional |

Reglas:
- Dispositivos y empleados se asignan **a una empresa** — puede ser la hoja o el
  padre (ALCO A2: "el sistema debe dar todas las opciones").
- Reportes y export: el sistema debe permitir **cualquier alcance** — por empresa
  individual, por grupo (rollup a las hijas del padre), o combinado.

**Fuera de alcance (no llevar al modelo nuevo):** toda la sección "Talento Humano
(Venezuela)" de Adempiere (NIL, SSO, RPE, INCES, FAOV, BANAVIH, aportes/
deducciones) — cálculo de nómina, fuera de Fase 1.

### 1.2 `site` — sede

**Entidad nueva.** ALCO (D12) nombró "sede" como categoría configurable, y el
caso de uso de empleados compartidos es explícitamente **una empresa con varias
sedes** (C10). Una sede es un lugar físico de una empresa donde hay uno o más
dispositivos.

| Campo | Notas |
| --- | --- |
| `id` | interno |
| `company_id` | FK a `client_company` |
| `name`, `code` | ej. "Sede Principal", "Acarigua" |
| `status` | activa / inactiva |

### 1.3 `employee` — persona

Origen: **Socio de Negocio** de Adempiere. En Adempiere "Empleado" es un rol sobre
el modelo unificado de Business Partner. **El sistema nuevo modela solo la
persona-empleado, como entidad propia y simple.**

| Campo | Notas |
| --- | --- |
| `id` | interno |
| `national_id` | cédula / documento. **Formato flexible: `V`, `E`, `J`, `G` + dígitos** (ALCO B4), bajo las normas de cédula/RIF venezolanas. Todos los trabajadores tienen. Identificador natural principal. |
| `tax_id` | RIF. En la práctica suele ser igual a la cédula para personas naturales. |
| `first_name`, `last_name` | requeridos |
| `birth_date` | opcional |
| `photo` | opcional |

**Registro global con historial.** ALCO (B6) quiere mantener el registro de
todos los trabajadores para futuro reclutamiento — una `employee` **nunca se
borra** y puede existir **sin ningún `employment` activo** (persona en el pool de
reclutamiento, sin vínculo laboral vigente).

**No llevar al modelo:** "Nombre de los Padres" (ALCO: "no importa"), campos de
educación (vacíos en la práctica), "Imagen de Pulgar" de Adempiere (no es el dato
biométrico funcional).

### 1.4 `employment` — vínculo persona ↔ empresa

Origen: **Contrato de Empleado** de Adempiere (sub-tab de Socio de Negocio, `1/N`).

| Campo | Notas |
| --- | --- |
| `id` | interno |
| `employee_id` | FK a `employee` (la persona) |
| `company_id` | FK a `client_company` |
| `site_id` | FK a `site`, opcional — sede donde trabaja |
| `employee_group_id` | FK a `employee_group`, opcional — grupo que define su horario (ver 1.9) |
| `position_id` | FK a `position` (cargo/puesto), opcional |
| `department_id` | FK a `department`, opcional |
| `payroll_ref` | "Empleado Nómina" de Adempiere — id numérico del sistema de nómina, distinto de la cédula. Opcional; probablemente necesario para el export de Fase 2. |
| `start_date` | inicio del vínculo |
| `end_date` | nullable — baja / fin de contrato |
| `status` | activo / inactivo |

**Modelo persona + N empleos:** se separa `employee` (persona, por cédula) de
`employment` (vínculo con una empresa, con fechas). Multi-empresa concurrente es
**excepcional pero posible** (ALCO B5) — **no** se pone constraint de "un solo
empleo activo". La historia de una persona son sus filas de `employment`.

**Baja (B6):** `end_date` + `status=inactivo`. La persona y sus marcajes quedan.
**En los reportes de la empresa, el empleado desaparece apenas se desvincula** —
las queries de reporte filtran por `employment` activo en el período.

**Traslado (B7):** acción única "Trasladar" — cierra el `employment` de la
empresa origen (`end_date`) y abre uno nuevo en la destino, **misma `employee`**.
La ficha de la persona conserva toda su historia. Ver flujo 5.7.

### 1.5 `department` y `position` — categorización de cargo

Origen: ventanas **Departamento** (45 registros) y **Puesto** (288, FK a
Departamento). ALCO (D12–D13): configurable desde el panel, listas dinámicas; qué
subconjunto migrar se decide después.

- `department`: `code`, `name`, `description`, `status`.
- `position`: `code`, `name`, `description`, `department_id` (FK), `status`.

Ambas CRUD desde el panel. No se modelan: "Manager" de Departamento (no relevante
Fase 1), ni los catálogos vacíos de Adempiere (Estructura Salarial, Designación,
Tipo de Habilidad, Tipo de Empleado, Carrera, Grado, Nivel de Estudio).

**Categorías configurables futuras:** ALCO listó "departamento, cargo/puesto, tipo
de jornada, sede" como el set inicial y pidió que sea configurable. `department`,
`position` y `site` son entidades explícitas. "Tipo de jornada" se resuelve vía
`employee_group` + `shift` (1.9). Si ALCO más adelante quiere agregar tipos de
etiqueta arbitrarios, se añade un mecanismo genérico `employee_attribute`
entonces — no ahora, para no sobre-diseñar.

### 1.6 `device` — dispositivo biométrico

Evoluciona la tabla `devices` actual (capa de protocolo, ver `docs/02-architecture.md`).
Origen adicional: **Dispositivos de Asistencia** de Adempiere (23 registros).

Campos nuevos sobre lo que ya existe:

| Campo | Notas |
| --- | --- |
| `company_id` | FK a `client_company` |
| `site_id` | FK a `site` — en qué sede está el equipo |
| `last_sync_at` | última sincronización **exitosa de marcajes** — distinta del heartbeat `last_seen_at` que ya existe. Requisito explícito de `docs/01-requirements.md`. |
| `device_admin_note` | referencia libre a quién administra el equipo del lado de la empresa cliente (ver nota de acceso abajo). No es un FK a `app_user`. |

**No llevar:** campos legacy de Adempiere `Servidor` / `Puerto 29092` / `Aplicación
Soportada: TAD-Kafka-Command` — el sistema viejo hablaba con los equipos vía Kafka.
El sistema nuevo usa el protocolo HTTP push ya verificado
(`docs/04-device-protocol-real.md`).

**Acceso del "administrador de dispositivo" por empresa (RESUELTO — ALCO C11):**
solo Grupo ALCO tiene acceso a la app web. El administrador del lado de la empresa
cliente tiene acceso **admin al dispositivo físico**, no a la plataforma. No hay
ampliación de alcance. Ese rol se maneja como configuración/credencial del equipo
(vía comandos del protocolo, ej. privilegio `MANAGER`), no como `app_user`.

### 1.7 `employee_device_enrollment` — vínculo empleado ↔ enrolado del equipo

**Entidad nueva.** ALCO (C8): la relación "usuario X en dispositivo Y = empleado
Z" la maneja el sistema nuevo, con soporte para el mismo empleado en varios
dispositivos.

| Campo | Notas |
| --- | --- |
| `id` | interno |
| `employee_id` | FK a `employee` |
| `dev_id` | FK a `device` |
| `device_user_id` | número del usuario dentro del equipo (`"1"`, `"2"`… string, como el protocolo) |
| `status` | activo / inactivo |
| `enrolled_at` | cuándo se hizo el vínculo |

- Cardinalidad: normalmente **un equipo por empleado** (ALCO C10). Varios equipos
  = caso de empresa con `shared_employees` y varias sedes.
- Único por `(dev_id, device_user_id)` — un slot de equipo mapea a un empleado a
  la vez.

### 1.8 `employee_fingerprint` — plantilla biométrica a nivel empleado

**Entidad nueva.** ALCO: las huellas son parte de la info del empleado, para
poder usarlas en varios biométricos.

Distinta de `enroll_data` actual (copia **por dispositivo**). Esta es la copia
**canónica por empleado**.

| Campo | Notas |
| --- | --- |
| `employee_id` | FK a `employee` |
| `finger_index` | dedo / slot (`backup_number` del protocolo: 0–9 dedos, 10 password, 11 tarjeta, 12 rostro) |
| `template` | bytes de la plantilla propietaria del equipo |
| `source_dev_id` | de qué equipo se capturó |
| `captured_at` | |

**Depende de resolver la migración de huellas entre dispositivos** (`GET_ENROLL_DATA`
/ `SET_ENROLL_DATA`, hoy no lograda por el equipo de desarrollo —
`docs/02-architecture.md`; ALCO C9 no tiene aporte técnico). El modelo se deja
listo; la funcionalidad es trabajo aparte. Ver flujo 5.5.

### 1.9 `employee_group` y `shift` — grupos de horario y turnos

ALCO (E14): **el horario se define por grupo de empleados**. Origen: Adempiere
tenía "Grupo de Trabajo" y "Grupo de Turnos" — ALCO pidió **colapsar a un solo
concepto**.

**`employee_group`** — grupo de empleados con un horario común (ej. "Administrativo",
"Planta", "Docentes").

| Campo | Notas |
| --- | --- |
| `id` | interno |
| `company_id` | FK a `client_company` |
| `name`, `code` | |
| `status` | |

**`shift`** — turno de trabajo, asignado a un `employee_group` con vigencia.
Origen: "Turno de Trabajo" de Adempiere.

| Campo | Notas |
| --- | --- |
| `id` | interno |
| `employee_group_id` | FK a `employee_group` |
| `code`, `name` | ej. `8/12-2/6`, `"6:30 AM ~ 1:30 PM"` |
| `start_time`, `end_time` | |
| `break_start`, `break_end` | descanso |
| `hours` | horas de la jornada |
| `variable_in_out` | "Entrada y Salida Variable" |
| `workdays` | días activos (L–D) — se colapsa el doble nivel de días de Adempiere a uno |
| `crosses_midnight` | para turnos que cruzan medianoche. ALCO (E15): no todo turno nocturno cruza medianoche — no hardcodear la regla, es un flag explícito. |
| `effective_from`, `effective_to` | vigencia — un grupo puede cambiar de turno con el tiempo |

**Umbrales configurables** (tardanza, salida anticipada, definición de ausencia):
ALCO (E16–E18) los quiere **configurables por empresa y grupo de empleados**.
Viven como columnas de config en `employee_group` (con fallback a un default de
`client_company`):

| Campo (en `employee_group`, nullable → hereda de company) | |
| --- | --- |
| `late_tolerance_min` | minutos de atraso tolerados antes de tardanza |
| `early_leave_tolerance_min` | minutos de salida anticipada tolerados |
| `absence_rule` | qué cuenta como ausencia: `no_check_in` / `no_marks` / `under_hours` (+ `min_hours`) |

Feriados / días especiales: ALCO (E20) → **fuera de Fase 1**, todo al sistema de
nómina.

### 1.10 `attendance_log` — marcaje crudo (ya existe)

La tabla `attendance_logs` actual (capa de protocolo). Se conserva **inmutable**
como capa de ingesta. Se le agrega:

| Campo | Notas |
| --- | --- |
| `employee_id` | nullable — resuelto vía `employee_device_enrollment` a partir de `(dev_id, user_id)`. Nullable porque un marcaje puede llegar de un slot todavía no mapeado. |

### 1.11 `attendance_day` — día procesado

**Entidad nueva.** Resultado del motor de asistencia (ver §8 sobre alcance).

| Campo | Notas |
| --- | --- |
| `employee_id`, `date` | clave natural |
| `employment_id` | a qué vínculo/empresa corresponde ese día |
| `shift_id` | turno aplicado |
| `first_in`, `last_out` | primera entrada / última salida derivadas de los marcajes |
| `worked_minutes` | horas trabajadas |
| `overtime_minutes` | minutos por encima de la jornada — **dato de referencia, sin recargo legal** |
| `status` | presente / tardanza / salida_anticipada / ausente |
| `computed_at` | |

**Diseñar como dato de primera clase, consultable** — no solo insumo de un
generador de reportes. Ver §7 (Fase 2 accede a esto por app y probablemente API).

### 1.12 `attendance_correction` — corrección auditada

**Entidad nueva.** Requisito: corrección manual "con registro auditable de quién
ajustó y cuándo". ALCO (E19): la hace cualquiera de Grupo ALCO desde el panel;
bueno tener un motivo.

| Campo | Notas |
| --- | --- |
| `target` | referencia a `attendance_log` o `attendance_day` |
| `field`, `old_value`, `new_value` | qué cambió |
| `reason` | motivo (recomendado, no obligatorio por ahora) |
| `actor_app_user_id` | quién |
| `created_at` | cuándo |

### 1.13 `app_user` — usuarios de la plataforma

**Entidad nueva.** Hoy el panel **no tiene auth de ningún tipo**. Los usuarios
internos de Grupo ALCO (≈4).

| Campo | Notas |
| --- | --- |
| `id` | interno |
| `email`, `name` | |
| `password_hash` | |
| `role` | campo presente para futuro; **en Fase 1 todos tienen el mismo acceso completo** (ALCO G27–G28: hay división de tareas informal pero mismo acceso, y ninguna acción se reserva). |
| `status` | activo / inactivo |
| `last_login_at` | |

Sin matriz de permisos en Fase 1. El `role` queda como gancho para diferenciar
después si hace falta (ej. cuando entre el sistema de nómina de Fase 2).

### 1.14 `audit_log` — auditoría de acciones sensibles

**Entidad nueva.** Requisito: "registro de auditoría de acciones sensibles".
Aunque no haya restricción de permisos, sí hay que registrar **quién** hizo qué.

| Campo | Notas |
| --- | --- |
| `actor_app_user_id` | quién |
| `action` | ej. `company.delete`, `attendance.correct`, `export.run`, `device.clear_enroll`, `employee.transfer` |
| `entity_type`, `entity_id` | sobre qué |
| `before_json`, `after_json` | estado antes/después |
| `created_at` | |

### 1.15 `export_run` — corrida de exportación

**Entidad nueva.** Auditabilidad del insumo que va a nómina.

| Campo | Notas |
| --- | --- |
| `period_start`, `period_end` | período — rango arbitrario (ALCO F22: mensual/quincenal, poder hacerlo semanal) |
| `scope` | empresa individual / grupo / combinado (ALCO F23: configurable) |
| `generated_by`, `generated_at` | |
| `file_ref` | referencia al archivo generado |

---

## 2. Relaciones (ERD textual)

```
client_company ──┐ (parent_id, self, 2 niveles, mutable)
   │             └── client_company (hijas)
   ├──< site
   │      └──< device ──< employee_device_enrollment >── employee
   │      │         └──< enroll_data          (por dispositivo, ya existe)
   │      │         └──< attendance_log >── employee (nullable)
   │      └──< employment
   ├──< employee_group ──< shift
   │      └──< employment
   └──< employment >── employee
          ├── position >── department
          └──< attendance_day ──< attendance_correction
employee ──< employee_fingerprint
app_user ──< audit_log
app_user ──< attendance_correction
app_user ──< export_run
```

---

## 3. Vistas del panel nuevo

El panel actual (`app/admin/**`) ya tiene: Inicio, Dispositivos, Usuarios
(enrolados de equipo), Asistencia (marcajes), Diagnóstico. Se **mantienen** y se
suman las de dominio.

| Vista | Propósito | Acciones principales |
| --- | --- | --- |
| **Empresas** (Organización) | Árbol de empresas con jerarquía padre/hija; sedes por empresa | Alta / editar / dar de baja; mover de grupo; marcar `is_group` / `shared_employees`; gestionar sedes |
| **Empleados** (Socio de Negocio + Contrato) | Listado filtrable por empresa / sede / grupo / departamento / puesto / estado; y el **pool de reclutamiento** (personas sin empleo activo) | Alta de persona; abrir/cerrar `employment`; **Trasladar**; baja; ver marcajes; gestionar enrollments |
| **Departamentos y Puestos** | CRUD de categorías | Alta / editar / desactivar |
| **Grupos y Turnos** | CRUD de `employee_group` + `shift` por empresa; umbrales de tardanza/ausencia por grupo | Alta / editar; asignar empleados al grupo |
| **Dispositivos** (Dispositivos de Asistencia) | La vista actual + asignación a empresa/sede | Asignar a empresa y sede; ver `last_sync_at`; (lo que ya hace) |
| **Enrolamiento** (nueva) | Enrolados de un equipo y su vínculo con empleados | Mapear `device_user_id` → empleado; desvincular; **copiar huella a otro equipo** (flujo 5.5) |
| **Asistencia** | La vista actual de marcajes + capa procesada (`attendance_day`) | Filtrar; **corregir un marcaje** (con motivo, auditado); ver día procesado |
| **Reportes** (nueva) | Consolidado por empresa/grupo/empleado/rango | Generar; exportar a hoja de cálculo; registrar `export_run` |
| **Usuarios de la plataforma** (nueva) | Los usuarios de ALCO | Alta / editar / desactivar |
| **Auditoría** (nueva) | Log de acciones sensibles | Consultar / filtrar |

---

## 4. Permisos

**Fase 1: plano.** Todos los usuarios de Grupo ALCO tienen el mismo acceso
completo (ALCO G27–G28). No hay matriz de permisos. Toda acción sensible queda
igualmente registrada en `audit_log` con el usuario que la ejecutó.

El campo `app_user.role` existe como gancho para diferenciar en el futuro (Fase 2,
cuando entre el sistema de nómina completo).

---

## 5. Flujos transversales

### 5.1 Alta de empresa cliente
Crear `client_company` → si es grupo, marcar `is_group` y crear las hijas con
`parent_id` → crear sedes → asignar dispositivos.

### 5.2 Alta de empleado
Crear `employee` (persona, por documento) → crear `employment` en su empresa con
sede / grupo / departamento / puesto / fecha de inicio → el turno lo hereda del
`employee_group` → vincular su huella a un equipo (flujo 5.3).

### 5.3 Vincular empleado ↔ enrolado de equipo
Desde **Enrolamiento**: el equipo reporta sus `user_id`; el operador asocia cada
uno a un `employee` → se crea `employee_device_enrollment`. A partir de ahí los
`attendance_log` de ese slot resuelven `employee_id`.

### 5.4 Empleado compartido entre sedes/empresas hermanas
Si el grupo padre tiene `shared_employees`, un empleado de una hija puede
enrolarse en el equipo de otra sede/hija sin `employment` nuevo — solo un
`employee_device_enrollment` adicional. Su asistencia sigue contando para su
`employment`.

### 5.5 Copiar / migrar huella entre dispositivos
**Depende de funcionalidad técnica no lograda** (`docs/02-architecture.md`).
Diseño objetivo: `GET_ENROLL_DATA` del equipo origen → guardar en
`employee_fingerprint` → `SET_ENROLL_DATA` al equipo destino → verificar con otro
`GET_ENROLL_DATA`. Para el mismo grupo con `shared_employees`, ALCO quiere que sea
automático.

### 5.6 Baja de empleado
`end_date` + `status=inactivo` en el `employment`. La persona queda en el registro
global (reclutamiento). Desaparece de los reportes de la empresa de inmediato.
Opcionalmente desactivar sus `employee_device_enrollment`.

### 5.7 Traslado entre empresas
Acción única "Trasladar": cierra el `employment` de origen y abre uno en destino
con la **misma `employee`** → nueva sede / grupo → re-enrolar o copiar huella al
equipo de la nueva sede (5.5). Toda la historia queda en las filas de `employment`.

### 5.8 Corrección de marcaje (auditada)
Operador edita un `attendance_log` / `attendance_day` → ingresa motivo → se crea
`attendance_correction` con actor y timestamp → `audit_log`.

### 5.9 Generar consolidado y exportar
Elegir alcance (empresa / grupo / combinado) + rango → el motor produce el
consolidado por empleado (días trabajados, horas, tardanzas, ausencias, horas
extra de referencia) → exportar a hoja de cálculo → `export_run`.

**Formato del archivo (ALCO F21/F24):** ALCO no carga directo a su sistema de
nómina (**Galepso**) — pasa por un módulo interno de Adempiere que llaman **"el
utilitario"** que reformatea. El formato exacto de salida se **ajusta después**,
contra lo que "el utilitario" o Galepso necesiten. Para Fase 1: export a
CSV/Excel con columnas claras del consolidado; estructura parametrizable.

---

## 6. Decisiones nuevas / simplificaciones respecto a Adempiere

1. Empleado es entidad propia y simple, no un rol sobre "Business Partner".
2. Se descarta toda la capa de nómina venezolana (aportes, deducciones, SSO,
   INCES, FAOV, estructura salarial) — fuera de Fase 1.
3. "Grupo de Trabajo" y "Grupo de Turnos" se colapsan en `employee_group` + `shift`.
4. `site` (sede) es entidad propia — Adempiere no la exponía clara y es central
   para el caso de empleados compartidos multi-sede.
5. El vínculo empleado ↔ huella de equipo se modela explícitamente
   (`employee_device_enrollment`).
6. Copia canónica de huella por empleado (`employee_fingerprint`).
7. Corrección de marcaje auditada — entidad nueva.
8. Auth nueva; **permisos planos** en Fase 1 (todos los usuarios ALCO iguales).
9. El "administrador de dispositivo" por empresa **no es un usuario de la
   plataforma** — es acceso admin al equipo físico. Sin ampliación de alcance.
10. El import batch de marcajes de Adempiere **no** se replica (sin uso, ALCO H29).
11. Nada de Kafka — protocolo HTTP push ya verificado.
12. `parent_id` de empresa es relación simple y mutable — sin historia de grupo.

---

## 7. Nota de arquitectura — Fase 2 y la API

ALCO (F25) confirmó: **después de Fase 1, La Devhouse construye el sistema de
nómina completo (Fase 2+)**. Ese sistema va a necesitar los datos de asistencia
**no solo por export sino dentro de la aplicación, y probablemente vía API**.

Implicaciones para el diseño de Fase 1:
- `attendance_day` y el consolidado son **datos de primera clase** (tablas/vistas
  consultables), no artefactos efímeros de un generador de reportes.
- El schema debe ser API-friendly: entidades con IDs estables, timestamps
  consistentes, sin lógica de negocio escondida en queries de reporte que no se
  puedan reusar.
- No hace falta construir la API en Fase 1, pero sí no cerrarse la puerta.

---

## 8. Alcance del cálculo de asistencia — DECIDIDO

**Fase 1 incluye el motor de cálculo de asistencia** (decidido 2026-08-30).

**Dentro de Fase 1:**
- Resolver cada `attendance_log` a su `employee` vía `employee_device_enrollment`.
- Por empleado y día, determinar el `shift` vigente (vía `employment` →
  `employee_group` → `shift` con `effective_from/to` y `workdays`).
- Calcular `first_in`, `last_out`, `worked_minutes`, `overtime_minutes` (horas
  por encima de la jornada, **como referencia, sin recargo**).
- Clasificar `status`: `present` / `late` / `early_leave` / `absent`, aplicando
  los umbrales de `employee_group` (`late_tolerance_min`,
  `early_leave_tolerance_min`, `absence_rule` + `absence_min_hours`), con fallback
  a `client_company`.
- Persistir en `attendance_day`. Recalculable (idempotente) al llegar marcajes
  nuevos o al corregir uno.
- Corrección manual auditada (`attendance_correction`).
- Consolidado del período por empleado (días trabajados, horas, tardanzas,
  ausencias) para reporte y export.

**Fuera de Fase 1 (Fase 2+, sistema de nómina):**
- Valoración legal/monetaria: recargos por horas extra, bono nocturno.
- Feriados y días de descanso especiales que afecten el conteo (ALCO E20 → todo a
  nómina). El motor de Fase 1 usa solo `shift.workdays`.
- Reglas más finas por convención colectiva, si aparecen.

Nota: `attendance_day` no guarda un vínculo explícito a los `attendance_log` que
lo alimentaron — la relación es derivable por `(employee_id, dev_id, rango de
fecha)`. Se mantiene así para no acoplar la capa procesada a la de ingesta
inmutable; si el recálculo/audit lo requiere, se agrega `source_log_ids Int[]`
después.
