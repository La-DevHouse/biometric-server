-- =============================================================================
-- Limpieza de datos — para correr en DBeaver, sentencia por sentencia.
--
-- En cada sección: reemplazá los IDs de ejemplo (el 0 o el '') por los tuyos
-- EN TODAS LAS LÍNEAS de esa sección, corré primero el SELECT para ver qué se
-- va y después los DELETE en el orden en que están (el orden importa: FK).
-- Con auto-commit cada DELETE es definitivo.
--
-- Backup antes (por SSH al servidor):
--   docker exec <contenedor-postgres> pg_dump -U postgres -Fc postgres > /root/backup-$(date +%F-%H%M).dump
--
-- ⚠ Borrar de la base NO borra de los equipos físicos. Si una persona sigue
-- cargada en un equipo y la borrás de acá, su cédula queda en el equipo para
-- siempre (el sistema no toca IDs que no conoce). Para que los equipos queden
-- limpios: primero dar de baja sus contratos (sección 0 o el panel) →
-- "Sincronizar todos" → verificar en Equipo → Usuarios que salieron → recién
-- ahí borrar.
-- =============================================================================


-- Para encontrar los IDs ------------------------------------------------------
SELECT c.id, c.name AS empresa, c.tax_id, c.group_id, g.name AS grupo
  FROM client_company c LEFT JOIN company_group g ON g.id = c.group_id ORDER BY c.name;
SELECT id, national_id, last_name, first_name FROM employee ORDER BY last_name;
SELECT dev_id, fk_name, site_id FROM devices ORDER BY dev_id;
SELECT id, name, company_id FROM schedule_group ORDER BY company_id, name;


-- =============================================================================
-- 0. DAR DE BAJA CONTRATOS (paso previo, para que los equipos se vacíen solos)
-- =============================================================================
SELECT * FROM employment WHERE status = 'active' AND company_id IN (0);   -- o: employee_id IN (0)

UPDATE employment SET status = 'inactive', end_date = GREATEST(start_date, CURRENT_DATE), updated_at = now()
 WHERE status = 'active' AND company_id IN (0);                           -- o: employee_id IN (0)


-- =============================================================================
-- 1. EMPRESAS
--    Se van sus contratos, sedes, horarios y turnos. Sus equipos quedan
--    "pendiente de asignar". Los empleados quedan (sección 2 para borrarlos).
-- =============================================================================
SELECT id, name FROM client_company WHERE id IN (0);

DELETE FROM employment     WHERE company_id IN (0);   -- primero los contratos
DELETE FROM client_company WHERE id IN (0);           -- sedes, horarios y turnos se van solos (cascada)


-- =============================================================================
-- 1b. GRUPOS (las empresas del grupo quedan sin grupo, no se borran)
-- =============================================================================
SELECT id, name FROM company_group WHERE id IN (0);

UPDATE client_company SET group_id = NULL WHERE group_id IN (0);
DELETE FROM company_group WHERE id IN (0);


-- =============================================================================
-- 2. EMPLEADOS
--    Se van sus contratos, huellas y vínculos con equipos. Sus marcaciones
--    quedan (atadas a la cédula).
-- =============================================================================
SELECT id, national_id, last_name, first_name FROM employee WHERE id IN (0);

DELETE FROM employment WHERE employee_id IN (0);      -- primero los contratos
DELETE FROM device_fingerprint_slot
 WHERE device_user_id IN (SELECT regexp_replace(national_id, '\D', '', 'g') FROM employee WHERE id IN (0));
DELETE FROM employee WHERE id IN (0);                 -- huellas y vínculos se van solos (cascada)


-- =============================================================================
-- 3. HORARIOS (y sus turnos). Los contratos que lo usaban quedan sin horario.
-- =============================================================================
SELECT id, name, company_id FROM schedule_group WHERE id IN (0);   -- o: company_id IN (0)

DELETE FROM schedule_group WHERE id IN (0);                         -- o: company_id IN (0)


-- =============================================================================
-- 4. DESVINCULAR EQUIPO (queda "pendiente de asignar"; no borra nada)
-- =============================================================================
UPDATE devices SET site_id = NULL, company_linked_at = NULL WHERE dev_id IN ('');


-- =============================================================================
-- 5. FRESH START DE UN EQUIPO
--    Lo borra de la base; se vuelve a registrar solo en ~11 s como equipo
--    nuevo. Las huellas de los empleados se conservan. El equipo FÍSICO no se
--    vacía: para eso, antes, Diagnóstico → Zona de riesgo → borrar biométricos
--    (y volver a crear el admin 9001 por teclado).
-- =============================================================================
DELETE FROM commands     WHERE dev_id IN ('');
DELETE FROM operations   WHERE dev_id IN ('');
DELETE FROM users        WHERE dev_id IN ('');
DELETE FROM enroll_data  WHERE dev_id IN ('');
DELETE FROM block_buffer WHERE dev_id IN ('');
-- DELETE FROM attendance_logs WHERE dev_id IN ('');  -- opcional: sus marcaciones (afecta lo exportado)
DELETE FROM devices      WHERE dev_id IN ('');        -- corridas, vínculos y registro de huellas se van solos


-- =============================================================================
-- 6. OPERACIONES COLGADAS (se cancelan solas a los 10 min; esto las cierra ya)
-- =============================================================================
SELECT id, kind, dev_id, stage FROM operations WHERE stage IN ('queued', 'sent', 'waiting', 'verifying');

UPDATE commands SET status = 'ERROR', cmd_return_code = 'CANCELED'
 WHERE status IN ('WAIT', 'RUN') AND op_id IN (0);
UPDATE operations SET stage = 'canceled', error_note = 'Cancelada a mano.',
       finished_at = (extract(epoch FROM now()) * 1000)::bigint
 WHERE id IN (0);
