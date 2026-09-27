-- =============================================================================
-- Limpieza de datos en la base (producción o prueba) — para correr en DBeaver.
--
-- Cada sección es independiente: una transacción que
--   1) toma los IDs que vos ponés,
--   2) MUESTRA qué se va a borrar,
--   3) borra en el orden correcto (respetando las FK),
--   4) termina en ROLLBACK.
-- Corré la sección entera, revisá los resultados, y si está bien cambiá el
-- ROLLBACK final por COMMIT y corréla de nuevo. En DBeaver: seleccionar el
-- bloque completo y "Execute script" (Alt+X), con auto-commit APAGADO.
--
-- ANTES DE CUALQUIER COSA — backup (por SSH al servidor):
--   docker exec <contenedor-postgres> pg_dump -U postgres -Fc postgres > /root/backup-$(date +%F-%H%M).dump
-- Restaurar (solo si hace falta):
--   docker exec -i <contenedor-postgres> pg_restore -U postgres -d postgres --clean < /root/backup-XXXX.dump
--
-- ⚠ LO IMPORTANTE: borrar de la base NO borra nada de los equipos físicos.
-- Si borrás un empleado (o su empresa) mientras su cédula está cargada en un
-- equipo, esa cédula pasa a ser un "ID sin empleado": el reconciliador NUNCA la
-- toca (salvaguarda), así que queda en el equipo para siempre y sigue marcando
-- sin imputarse a nadie. Orden correcto para que los equipos queden limpios:
--   1. Dar de baja los contratos (panel, o la sección 0 de abajo) con los
--      equipos todavía asignados a su sede.
--   2. "Sincronizar todos" (Equipos) y esperar: el reconciliador borra a esas
--      personas de los equipos. Si son más de 5 por equipo, aparece "Bajas
--      frenadas" en el equipo: aprobarlas.
--   3. Verificar en Equipo → Usuarios que ya no están.
--   4. Recién ahí, correr las secciones 1–4.
-- (Si igual querés vaciar un equipo por completo, ver la sección 5.)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Consultas de ayuda: para encontrar los IDs (solo lectura).
-- -----------------------------------------------------------------------------
SELECT g.id AS grupo_id, g.name AS grupo, c.id AS empresa_id, c.name AS empresa, c.tax_id, c.status
  FROM client_company c LEFT JOIN company_group g ON g.id = c.group_id
 ORDER BY g.name NULLS LAST, c.name;

SELECT e.id, e.national_id, e.last_name, e.first_name,
       (SELECT string_agg(c.name || CASE WHEN em.status = 'active' THEN '' ELSE ' (baja)' END, ', ')
          FROM employment em JOIN client_company c ON c.id = em.company_id
         WHERE em.employee_id = e.id) AS contratos
  FROM employee e ORDER BY e.last_name, e.first_name;

SELECT d.dev_id, d.fk_name, s.name AS sede, c.name AS empresa
  FROM devices d LEFT JOIN site s ON s.id = d.site_id LEFT JOIN client_company c ON c.id = s.company_id
 ORDER BY d.dev_id;

SELECT sg.id, sg.name AS horario, c.name AS empresa, (SELECT count(*) FROM shift sh WHERE sh.schedule_group_id = sg.id) AS turnos
  FROM schedule_group sg JOIN client_company c ON c.id = sg.company_id ORDER BY c.name, sg.name;


-- =============================================================================
-- 0. DAR DE BAJA CONTRATOS (paso previo recomendado, ver arriba)
--    Equivale a "Dar de baja" en el panel: los equipos se vacían solos en la
--    próxima corrida. Después, "Sincronizar todos" en el panel.
-- =============================================================================
BEGIN;
CREATE TEMP TABLE x_empresa ON COMMIT DROP AS
  SELECT id FROM client_company WHERE id IN (0 /* ← IDs de empresa, ej: 12, 15 */);
CREATE TEMP TABLE x_empleado ON COMMIT DROP AS
  SELECT id FROM employee WHERE id IN (0 /* ← y/o IDs de empleado */);

SELECT em.id, e.national_id, e.last_name, c.name AS empresa, em.start_date
  FROM employment em JOIN employee e ON e.id = em.employee_id JOIN client_company c ON c.id = em.company_id
 WHERE em.status = 'active'
   AND (em.company_id IN (SELECT id FROM x_empresa) OR em.employee_id IN (SELECT id FROM x_empleado));

UPDATE employment SET status = 'inactive', end_date = GREATEST(start_date, CURRENT_DATE), updated_at = now()
 WHERE status = 'active'
   AND (company_id IN (SELECT id FROM x_empresa) OR employee_id IN (SELECT id FROM x_empleado));

ROLLBACK;  -- ← COMMIT cuando estés conforme


-- =============================================================================
-- 1. BORRAR EMPRESAS (y opcionalmente sus grupos)
--    Se van: sus contratos, sus sedes, sus horarios y turnos.
--    Quedan: los empleados (pasan al pool si no tienen otro contrato; borralos
--    con la sección 2), y sus equipos, que pasan a "pendiente de asignar".
-- =============================================================================
BEGIN;
CREATE TEMP TABLE x_empresa ON COMMIT DROP AS
  SELECT id FROM client_company WHERE id IN (0 /* ← IDs de empresa */);
CREATE TEMP TABLE x_grupo ON COMMIT DROP AS
  SELECT id FROM company_group WHERE id IN (0 /* ← IDs de grupo a borrar (opcional) */);

-- Qué se va a borrar
SELECT 'empresa' AS que, id::text, name FROM client_company WHERE id IN (SELECT id FROM x_empresa)
UNION ALL SELECT 'grupo', id::text, name FROM company_group WHERE id IN (SELECT id FROM x_grupo)
UNION ALL SELECT 'empresa que queda SIN grupo', id::text, name FROM client_company
 WHERE group_id IN (SELECT id FROM x_grupo) AND id NOT IN (SELECT id FROM x_empresa);
SELECT
  (SELECT count(*) FROM employment     WHERE company_id IN (SELECT id FROM x_empresa)) AS contratos,
  (SELECT count(*) FROM site           WHERE company_id IN (SELECT id FROM x_empresa)) AS sedes,
  (SELECT count(*) FROM schedule_group WHERE company_id IN (SELECT id FROM x_empresa)) AS horarios,
  (SELECT count(*) FROM devices d JOIN site s ON s.id = d.site_id WHERE s.company_id IN (SELECT id FROM x_empresa)) AS equipos_que_quedan_sin_sede;

-- Contratos (FK Restrict: van primero). attendance_day.employment_id queda en NULL solo.
DELETE FROM employment WHERE company_id IN (SELECT id FROM x_empresa);
-- La empresa: en cascada se van site y schedule_group (+ shift); devices.site_id y
-- export_run.scope_company_id quedan en NULL solos. El trigger "empresa con ≥1 sede"
-- no se queja porque la empresa ya no existe.
DELETE FROM client_company WHERE id IN (SELECT id FROM x_empresa);
-- Grupos: primero se sueltan las empresas que quedan (FK Restrict), después el grupo.
UPDATE client_company SET group_id = NULL, updated_at = now() WHERE group_id IN (SELECT id FROM x_grupo);
DELETE FROM company_group WHERE id IN (SELECT id FROM x_grupo);

-- Verificación: todo en 0
SELECT (SELECT count(*) FROM client_company WHERE id IN (SELECT id FROM x_empresa)) AS empresas_restantes,
       (SELECT count(*) FROM company_group  WHERE id IN (SELECT id FROM x_grupo))   AS grupos_restantes;

ROLLBACK;  -- ← COMMIT cuando estés conforme


-- =============================================================================
-- 2. BORRAR EMPLEADOS
--    Se van: sus contratos, sus huellas de referencia, sus vínculos con equipos,
--    sus días procesados y el registro de sus huellas en cada equipo.
--    Quedan: sus marcaciones crudas (attendance_logs) con employee_id en NULL —
--    siguen atadas a la cédula; si la persona se vuelve a registrar, se le
--    vuelven a imputar. Para borrarlas también, descomentar el DELETE marcado.
-- =============================================================================
BEGIN;
CREATE TEMP TABLE x_empleado ON COMMIT DROP AS
  SELECT id, regexp_replace(national_id, '\D', '', 'g') AS cedula
    FROM employee WHERE id IN (0 /* ← IDs de empleado */);

SELECT e.id, e.national_id, e.last_name, e.first_name,
       (SELECT count(*) FROM employment em WHERE em.employee_id = e.id) AS contratos,
       (SELECT count(*) FROM employment em WHERE em.employee_id = e.id AND em.status = 'active') AS contratos_vigentes,
       (SELECT count(*) FROM employee_fingerprint f WHERE f.employee_id = e.id) AS huellas,
       (SELECT count(*) FROM employee_device_enrollment x WHERE x.employee_id = e.id AND x.status = 'active') AS en_equipos
  FROM employee e WHERE e.id IN (SELECT id FROM x_empleado);
-- ⚠ Si "en_equipos" > 0, esas personas siguen cargadas en equipos físicos (ver arriba).

DELETE FROM employment WHERE employee_id IN (SELECT id FROM x_empleado);        -- FK Restrict: primero
DELETE FROM device_fingerprint_slot WHERE device_user_id IN (SELECT cedula FROM x_empleado);
-- DELETE FROM attendance_logs WHERE user_id IN (SELECT cedula FROM x_empleado); -- ← opcional: sus marcaciones
-- En cascada: employee_fingerprint, employee_device_enrollment, attendance_day.
DELETE FROM employee WHERE id IN (SELECT id FROM x_empleado);

SELECT count(*) AS empleados_restantes FROM employee WHERE id IN (SELECT id FROM x_empleado);

ROLLBACK;  -- ← COMMIT cuando estés conforme


-- =============================================================================
-- 3. BORRAR HORARIOS (y sus turnos) de una empresa
--    Los contratos que lo usaban quedan "sin horario" (no se borran).
-- =============================================================================
BEGIN;
CREATE TEMP TABLE x_horario ON COMMIT DROP AS
  SELECT id FROM schedule_group
   WHERE id IN (0 /* ← IDs de horario */)
      OR company_id IN (0 /* ← o todos los de estas empresas */);

SELECT sg.id, sg.name, c.name AS empresa,
       (SELECT count(*) FROM shift sh WHERE sh.schedule_group_id = sg.id) AS turnos,
       (SELECT count(*) FROM employment em WHERE em.schedule_group_id = sg.id) AS contratos_que_quedan_sin_horario
  FROM schedule_group sg JOIN client_company c ON c.id = sg.company_id
 WHERE sg.id IN (SELECT id FROM x_horario);

-- En cascada: shift. employment.schedule_group_id y attendance_day.shift_id quedan en NULL.
DELETE FROM schedule_group WHERE id IN (SELECT id FROM x_horario);

ROLLBACK;  -- ← COMMIT cuando estés conforme


-- =============================================================================
-- 4. DESVINCULAR EQUIPOS (quedan "pendiente de asignar")
--    Igual que sacarles la sede en el panel. El equipo queda CONGELADO: no se
--    agrega ni se quita a nadie, lo que tiene cargado queda como está. Todo su
--    historial (marcaciones, corridas) se conserva.
-- =============================================================================
BEGIN;
CREATE TEMP TABLE x_equipo ON COMMIT DROP AS
  SELECT dev_id FROM devices WHERE dev_id IN ('' /* ← ej: '2023081133', '2023081158' */);

SELECT d.dev_id, d.fk_name, s.name AS sede_actual, c.name AS empresa_actual
  FROM devices d LEFT JOIN site s ON s.id = d.site_id LEFT JOIN client_company c ON c.id = s.company_id
 WHERE d.dev_id IN (SELECT dev_id FROM x_equipo);

UPDATE devices SET site_id = NULL, company_linked_at = NULL WHERE dev_id IN (SELECT dev_id FROM x_equipo);

ROLLBACK;  -- ← COMMIT cuando estés conforme


-- =============================================================================
-- 5. FRESH START DE UN EQUIPO (borrarlo de la base como si nunca se hubiera conectado)
--    Se vuelve a registrar SOLO en su próxima consulta (~11 s), como equipo
--    nuevo "pendiente de asignar". Borra su cola, sus operaciones, su copia de
--    usuarios/huellas, sus corridas, bajas frenadas y vínculos. Las huellas de
--    referencia de los empleados NO se borran (se re-propagan al asignarlo).
--
--    ⚠ El equipo FÍSICO conserva sus usuarios y huellas. Para vaciarlo también:
--    ANTES de esta sección, en el panel → Diagnóstico → Zona de riesgo → borrar
--    biométricos de ese equipo. Eso puede llevarse también al admin de
--    seguridad (9001): volver a crearlo por teclado después (docs/13 §0.1).
--    Si el equipo sigue conectado mientras corrés esto, puede re-registrarse a
--    mitad de camino: no pasa nada, es el resultado buscado.
-- =============================================================================
BEGIN;
CREATE TEMP TABLE x_equipo ON COMMIT DROP AS
  SELECT dev_id FROM devices WHERE dev_id IN ('' /* ← ej: '2023081133' */);

SELECT d.dev_id, d.fk_name,
       (SELECT count(*) FROM commands c   WHERE c.dev_id = d.dev_id) AS comandos,
       (SELECT count(*) FROM operations o WHERE o.dev_id = d.dev_id) AS operaciones,
       (SELECT count(*) FROM users u      WHERE u.dev_id = d.dev_id) AS usuarios_leidos,
       (SELECT count(*) FROM attendance_logs a WHERE a.dev_id = d.dev_id) AS marcaciones
  FROM devices d WHERE d.dev_id IN (SELECT dev_id FROM x_equipo);

-- Referencias "blandas" por dev_id (sin FK): hay que borrarlas a mano.
DELETE FROM commands     WHERE dev_id IN (SELECT dev_id FROM x_equipo);
DELETE FROM operations   WHERE dev_id IN (SELECT dev_id FROM x_equipo);
DELETE FROM users        WHERE dev_id IN (SELECT dev_id FROM x_equipo);
DELETE FROM enroll_data  WHERE dev_id IN (SELECT dev_id FROM x_equipo);
DELETE FROM block_buffer WHERE dev_id IN (SELECT dev_id FROM x_equipo);
-- Opcionales (historial): descomentar si querés el equipo sin pasado.
-- DELETE FROM attendance_logs WHERE dev_id IN (SELECT dev_id FROM x_equipo);  -- ⚠ afecta lo que se exporta a nómina
-- DELETE FROM raw_traffic     WHERE dev_id IN (SELECT dev_id FROM x_equipo);  -- log del sniffer
-- En cascada: device_fingerprint_slot, employee_device_enrollment, sync_run, sync_hold.
-- employee_fingerprint.source_dev_id queda en NULL (la huella de referencia se conserva).
DELETE FROM devices WHERE dev_id IN (SELECT dev_id FROM x_equipo);

SELECT count(*) AS equipos_restantes FROM devices WHERE dev_id IN (SELECT dev_id FROM x_equipo);

ROLLBACK;  -- ← COMMIT cuando estés conforme


-- =============================================================================
-- 6. OPERACIONES COLGADAS (ej. un equipo desconectado)
--    Normalmente no hace falta: una operación en cola sin respuesta se cancela
--    sola a los 10 min (3 min si ya se envió). Esto la cierra ya.
-- =============================================================================
BEGIN;
SELECT o.id, o.kind, o.dev_id, o.stage,
       to_timestamp(o.created_at / 1000) AT TIME ZONE 'America/Caracas' AS iniciada
  FROM operations o
 WHERE o.stage IN ('queued', 'sent', 'waiting', 'verifying')
 ORDER BY o.created_at;

UPDATE commands SET status = 'ERROR', cmd_return_code = 'CANCELED',
       updated_at = (extract(epoch FROM now()) * 1000)::bigint
 WHERE status IN ('WAIT', 'RUN')
   AND op_id IN (SELECT id FROM operations WHERE id IN (0 /* ← IDs de operación */));
UPDATE operations SET stage = 'canceled', error_note = 'Cancelada a mano (limpieza).',
       updated_at = (extract(epoch FROM now()) * 1000)::bigint,
       finished_at = (extract(epoch FROM now()) * 1000)::bigint
 WHERE id IN (0 /* ← los mismos IDs */) AND stage IN ('queued', 'sent', 'waiting', 'verifying');

ROLLBACK;  -- ← COMMIT cuando estés conforme
