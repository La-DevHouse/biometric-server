-- =============================================================================
-- Diagnóstico de UN equipo en UN día — solo lectura, para exportar en DBeaver
-- (seleccionar todo → Execute → Export From Query → JSON → carpeta results/).
--
-- Equipo: 2023054254 · Día: 2026-09-27 (hora de Caracas, UTC-4).
-- Para otro equipo o día: buscar y reemplazar '2023054254' y las dos fechas
-- '2026-09-27 00:00-04' / '2026-09-28 00:00-04'.
--
-- La última sección (R) es la revisión nocturna de las 03:00 (todos los equipos).
-- =============================================================================


-- E1. EL EQUIPO: asignación, cuándo se registró, último contacto y totales leídos.
SELECT d.dev_id, d.fk_name, d.firmware,
       c.name AS empresa, s.name AS sede, d.company_linked_at AS asignado_desde,
       to_timestamp(d.created_at / 1000) AT TIME ZONE 'America/Caracas'      AS registrado,
       to_timestamp(d.last_seen_at / 1000) AT TIME ZONE 'America/Caracas'    AS ultimo_contacto,
       d.stat_user_count AS usuarios_en_equipo, d.stat_fp_count AS huellas_en_equipo, d.stat_log_count AS marcaciones_en_memoria,
       to_timestamp(d.stat_updated_at / 1000) AT TIME ZONE 'America/Caracas' AS totales_leidos,
       (SELECT count(*) FROM users u WHERE u.dev_id = d.dev_id)                                 AS usuarios_guardados,
       (SELECT count(*) FROM enroll_data e WHERE e.dev_id = d.dev_id AND e.backup_number <= 9)  AS huellas_guardadas,
       (SELECT count(*) FROM employee_device_enrollment x WHERE x.dev_id = d.dev_id AND x.status = 'active') AS empleados_vinculados,
       (SELECT count(*) FROM device_fingerprint_slot f WHERE f.dev_id = d.dev_id)               AS slots_registrados
  FROM devices d
  LEFT JOIN site s ON s.id = d.site_id
  LEFT JOIN client_company c ON c.id = s.company_id
 WHERE d.dev_id = '2023054254';


-- E2. TRÁFICO POR HORA: cuántos requests de cada tipo, y bytes que subió el equipo.
SELECT date_trunc('hour', to_timestamp(created_at / 1000) AT TIME ZONE 'America/Caracas') AS hora,
       request_code, direction, count(*) AS requests,
       sum(body_size) AS bytes, max(body_size) AS max_bytes
  FROM raw_traffic
 WHERE dev_id = '2023054254'
   AND created_at >= extract(epoch FROM timestamptz '2026-09-27 00:00-04') * 1000
   AND created_at <  extract(epoch FROM timestamptz '2026-09-28 00:00-04') * 1000
 GROUP BY 1, 2, 3
 ORDER BY 1, 2, 3;


-- E3. TODAS LAS OPERACIONES DEL DÍA: resultado, duración y cada comando que usó.
SELECT o.id, o.kind, o.label, o.stage,
       to_timestamp(o.created_at / 1000) AT TIME ZONE 'America/Caracas' AS iniciada,
       round((coalesce(o.finished_at, o.updated_at) - o.created_at) / 1000.0) AS duro_s,
       count(c.*)                                                       AS comandos,
       count(c.*) FILTER (WHERE c.cmd_code = 'GET_USER_INFO')          AS get_user_info,
       count(c.*) FILTER (WHERE c.status = 'ERROR')                    AS comandos_con_error,
       string_agg(c.cmd_code || CASE WHEN c.status = 'ERROR' THEN '(' || coalesce(c.cmd_return_code, 'ERROR') || ')' ELSE '' END,
                  ' → ' ORDER BY c.trans_id)                           AS secuencia,
       coalesce(o.result_note, o.error_note)                           AS resultado
  FROM operations o
  LEFT JOIN commands c ON c.op_id = o.id
 WHERE o.dev_id = '2023054254'
   AND o.created_at >= extract(epoch FROM timestamptz '2026-09-27 00:00-04') * 1000
   AND o.created_at <  extract(epoch FROM timestamptz '2026-09-28 00:00-04') * 1000
 GROUP BY o.id
 ORDER BY o.created_at;


-- E4. LAS OPERACIONES QUE NO TERMINARON BIEN (error / mismatch / canceladas / colgadas).
SELECT o.id, o.kind, o.label, o.stage,
       to_timestamp(o.created_at / 1000) AT TIME ZONE 'America/Caracas' AS iniciada,
       round((coalesce(o.finished_at, o.updated_at) - o.created_at) / 1000.0) AS duro_s,
       o.error_note, o.result_note,
       left(o.plan_json, 400) AS plan
  FROM operations o
 WHERE o.dev_id = '2023054254'
   AND o.created_at >= extract(epoch FROM timestamptz '2026-09-27 00:00-04') * 1000
   AND o.created_at <  extract(epoch FROM timestamptz '2026-09-28 00:00-04') * 1000
   AND o.stage NOT IN ('done')
 ORDER BY o.created_at;


-- E5. COMANDOS CON ERROR O SIN RESULTADO: cuál, a qué usuario, qué devolvió el equipo.
SELECT c.trans_id, c.cmd_code, c.status, c.cmd_return_code,
       c.cmd_param::json->>'user_id' AS user_id,
       o.id AS op_id, o.kind AS operacion,
       to_timestamp(c.created_at / 1000) AT TIME ZONE 'America/Caracas' AS encolado,
       to_timestamp(c.updated_at / 1000) AT TIME ZONE 'America/Caracas' AS ultimo_cambio,
       left(c.result_json, 300) AS resultado
  FROM commands c
  LEFT JOIN operations o ON o.id = c.op_id
 WHERE c.dev_id = '2023054254'
   AND c.created_at >= extract(epoch FROM timestamptz '2026-09-27 00:00-04') * 1000
   AND c.created_at <  extract(epoch FROM timestamptz '2026-09-28 00:00-04') * 1000
   AND (c.status <> 'RESULT' OR coalesce(c.cmd_return_code, 'OK') <> 'OK')
 ORDER BY c.trans_id;


-- E6. SILENCIOS > 30 s (el panel lo marca desconectado) y qué le mandábamos justo antes.
WITH ins AS (
  SELECT id, dev_id, request_code, created_at,
         LAG(created_at) OVER (ORDER BY id) AS prev_at,
         LAG(id)         OVER (ORDER BY id) AS prev_id
    FROM raw_traffic
   WHERE direction = 'in' AND dev_id = '2023054254'
     AND created_at >= extract(epoch FROM timestamptz '2026-09-27 00:00-04') * 1000
     AND created_at <  extract(epoch FROM timestamptz '2026-09-28 00:00-04') * 1000
)
SELECT to_timestamp(ins.prev_at / 1000) AT TIME ZONE 'America/Caracas'    AS ultimo_contacto,
       to_timestamp(ins.created_at / 1000) AT TIME ZONE 'America/Caracas' AS volvio,
       round((ins.created_at - ins.prev_at) / 1000.0)                     AS silencio_s,
       p.request_code                                                     AS ultimo_request,
       (SELECT o.created_at - p.created_at FROM raw_traffic o
         WHERE o.direction = 'out' AND o.dev_id = p.dev_id AND o.id > p.id ORDER BY o.id LIMIT 1) AS respuesta_servidor_ms,
       (SELECT string_agg((o.headers_json::json->>'cmd_code') || ' ' || coalesce(c.cmd_param::json->>'user_id', ''), ', ' ORDER BY o.id)
          FROM raw_traffic o LEFT JOIN commands c ON c.trans_id::text = o.headers_json::json->>'trans_id'
         WHERE o.direction = 'out' AND o.dev_id = ins.dev_id AND o.request_code = 'receive_cmd'
           AND o.headers_json::json->>'cmd_code' IS NOT NULL
           AND o.created_at BETWEEN ins.prev_at - 60000 AND ins.prev_at + 1000) AS comandos_minuto_previo,
       ins.request_code                                                   AS volvio_con
  FROM ins JOIN raw_traffic p ON p.id = ins.prev_id
 WHERE ins.created_at - ins.prev_at > 30000
 ORDER BY ins.created_at;


-- E7. GET_USER_INFO QUE NO VOLVIERON, y el silencio que vino después de cada uno.
WITH entregas AS (
  SELECT id, dev_id, created_at, headers_json::json->>'trans_id' AS trans_id
    FROM raw_traffic
   WHERE direction = 'out' AND request_code = 'receive_cmd' AND dev_id = '2023054254'
     AND headers_json::json->>'cmd_code' = 'GET_USER_INFO'
     AND created_at >= extract(epoch FROM timestamptz '2026-09-27 00:00-04') * 1000
     AND created_at <  extract(epoch FROM timestamptz '2026-09-28 00:00-04') * 1000
)
SELECT to_timestamp(e.created_at / 1000) AT TIME ZONE 'America/Caracas' AS entregado,
       c.cmd_param::json->>'user_id' AS user_id, u.user_name, u.user_privilege,
       EXISTS (SELECT 1 FROM employee x WHERE regexp_replace(x.national_id, '\D', '', 'g') = c.cmd_param::json->>'user_id') AS es_empleado,
       (SELECT count(*) FROM enroll_data d WHERE d.dev_id = c.dev_id AND d.user_id = c.cmd_param::json->>'user_id') AS huellas_conocidas,
       o.kind AS operacion, c.status, c.cmd_return_code,
       round(((SELECT min(i.created_at) FROM raw_traffic i
                WHERE i.direction = 'in' AND i.dev_id = e.dev_id AND i.id > e.id) - e.created_at) / 1000.0) AS silencio_despues_s
  FROM entregas e
  JOIN commands c ON c.trans_id::text = e.trans_id
  LEFT JOIN operations o ON o.id = c.op_id
  LEFT JOIN users u ON u.dev_id = c.dev_id AND u.user_id = c.cmd_param::json->>'user_id'
 WHERE NOT EXISTS (SELECT 1 FROM raw_traffic r
                    WHERE r.direction = 'in' AND r.request_code = 'send_cmd_result'
                      AND r.dev_id = e.dev_id AND r.headers_json::json->>'trans_id' = e.trans_id)
 ORDER BY e.created_at;


-- E8. RESPUESTAS GRANDES Y FRAGMENTADAS (blk_no): las más pesadas que mandó el equipo.
--     Un equipo con mucha data manda la lista de usuarios / marcaciones en bloques.
SELECT to_timestamp(r.created_at / 1000) AT TIME ZONE 'America/Caracas' AS cuando,
       r.headers_json::json->>'trans_id' AS trans_id, c.cmd_code,
       r.headers_json::json->>'blk_no'   AS bloque,
       r.headers_json::json->>'cmd_return_code' AS return_code,
       r.body_size, r.binary_size
  FROM raw_traffic r
  LEFT JOIN commands c ON c.trans_id::text = r.headers_json::json->>'trans_id'
 WHERE r.direction = 'in' AND r.request_code = 'send_cmd_result' AND r.dev_id = '2023054254'
   AND r.created_at >= extract(epoch FROM timestamptz '2026-09-27 00:00-04') * 1000
   AND r.created_at <  extract(epoch FROM timestamptz '2026-09-28 00:00-04') * 1000
   AND (r.body_size > 4000 OR r.headers_json::json->>'blk_no' IS NOT NULL)
 ORDER BY r.id;


-- E9. CUÁNTO TARDÓ EL SERVIDOR EN RESPONDERLE (por tipo de request).
WITH t AS (
  SELECT direction, request_code, created_at,
         LEAD(direction)  OVER w AS next_dir,
         LEAD(created_at) OVER w AS next_at
    FROM raw_traffic
   WHERE dev_id = '2023054254'
     AND created_at >= extract(epoch FROM timestamptz '2026-09-27 00:00-04') * 1000
     AND created_at <  extract(epoch FROM timestamptz '2026-09-28 00:00-04') * 1000
  WINDOW w AS (PARTITION BY request_code ORDER BY id)
)
SELECT request_code, count(*) AS requests,
       round(avg(next_at - created_at)) AS prom_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY next_at - created_at) AS p95_ms,
       max(next_at - created_at) AS max_ms
  FROM t WHERE direction = 'in' AND next_dir = 'out'
 GROUP BY request_code ORDER BY max_ms DESC;


-- E10. CUÁNTO TARDÓ EL EQUIPO EN EJECUTAR CADA TIPO DE COMANDO.
WITH entregas AS (
  SELECT headers_json::json->>'trans_id' AS trans_id, created_at AS entregado_at
    FROM raw_traffic
   WHERE direction = 'out' AND request_code = 'receive_cmd' AND dev_id = '2023054254'
     AND headers_json::json->>'trans_id' IS NOT NULL
     AND created_at >= extract(epoch FROM timestamptz '2026-09-27 00:00-04') * 1000
     AND created_at <  extract(epoch FROM timestamptz '2026-09-28 00:00-04') * 1000
), resultados AS (
  SELECT headers_json::json->>'trans_id' AS trans_id, min(created_at) AS primero_at, max(created_at) AS ultimo_at
    FROM raw_traffic
   WHERE direction = 'in' AND request_code = 'send_cmd_result' AND dev_id = '2023054254'
   GROUP BY 1
)
SELECT c.cmd_code, count(*) AS veces,
       round(avg(r.ultimo_at - e.entregado_at)) AS prom_ms,
       max(r.ultimo_at - e.entregado_at)        AS max_ms,
       count(*) FILTER (WHERE r.primero_at IS NULL) AS sin_resultado
  FROM entregas e
  LEFT JOIN resultados r ON r.trans_id = e.trans_id
  LEFT JOIN commands c ON c.trans_id::text = e.trans_id
 GROUP BY c.cmd_code ORDER BY max_ms DESC NULLS FIRST;


-- E11. SINCRONIZACIONES DEL DÍA con todas sus estadísticas (errores, fallidos, frenadas).
SELECT r.id, r.kind, r.trigger, r.ok,
       to_timestamp(extract(epoch FROM r.started_at)) AT TIME ZONE 'America/Caracas'  AS inicio,
       to_timestamp(extract(epoch FROM r.finished_at)) AT TIME ZONE 'America/Caracas' AS fin,
       r.stats->>'read_mode' AS lectura, r.stats->>'info_ok' AS leidos,
       jsonb_array_length(coalesce(r.stats->'info_failed', '[]'::jsonb)) AS lecturas_fallidas,
       r.stats->>'in_scope' AS en_alcance, r.stats->>'added' AS altas, r.stats->>'completed' AS completar,
       r.stats->>'removed' AS bajas, r.stats->>'held' AS frenadas,
       r.stats->'unknown'   AS ids_sin_empleado,
       r.stats->'protected' AS admins_protegidos,
       r.stats->'overflow'  AS mas_de_10_huellas,
       r.stats->'errors'    AS errores,
       r.stats->>'error'    AS error
  FROM sync_run r
 WHERE r.dev_id = '2023054254'
   AND r.started_at >= timestamptz '2026-09-27 00:00-04'
   AND r.started_at <  timestamptz '2026-09-28 00:00-04'
 ORDER BY r.started_at;


-- E12. BAJAS FRENADAS (freno de borrado masivo) y cómo se resolvieron.
SELECT h.id, to_timestamp(extract(epoch FROM h.created_at)) AT TIME ZONE 'America/Caracas' AS creada,
       jsonb_array_length(h.planned_removals) AS bajas_frenadas,
       h.resolution, h.resolved_at, left(h.planned_removals::text, 300) AS usuarios
  FROM sync_hold h
 WHERE h.dev_id = '2023054254'
 ORDER BY h.created_at;


-- E13. USUARIOS DEL EQUIPO según la última lectura: con/sin empleado, huellas, vínculo.
SELECT u.user_id, u.user_name, u.user_privilege,
       (SELECT count(*) FROM enroll_data e WHERE e.dev_id = u.dev_id AND e.user_id = u.user_id AND e.backup_number <= 9) AS huellas,
       (SELECT count(*) FROM device_fingerprint_slot f WHERE f.dev_id = u.dev_id AND f.device_user_id = u.user_id AND f.origin = 'physical')   AS fisicas,
       (SELECT count(*) FROM device_fingerprint_slot f WHERE f.dev_id = u.dev_id AND f.device_user_id = u.user_id AND f.origin = 'propagated') AS copiadas,
       (SELECT x.last_name || ', ' || x.first_name FROM employee x WHERE regexp_replace(x.national_id, '\D', '', 'g') = u.user_id LIMIT 1) AS empleado,
       EXISTS (SELECT 1 FROM employee_device_enrollment v WHERE v.dev_id = u.dev_id AND v.device_user_id = u.user_id AND v.status = 'active') AS vinculado
  FROM users u
 WHERE u.dev_id = '2023054254'
 ORDER BY NULLIF(regexp_replace(u.user_id, '\D', '', 'g'), '')::bigint NULLS LAST, u.user_id;


-- E14. MARCACIONES DEL DÍA: cuántas llegaron y cuántas se pudieron asignar a un empleado.
SELECT count(*) AS marcaciones,
       count(*) FILTER (WHERE employee_id IS NOT NULL
                          OR EXISTS (SELECT 1 FROM employee x WHERE regexp_replace(x.national_id, '\D', '', 'g') = a.user_id)) AS de_empleados,
       count(DISTINCT user_id) AS ids_distintos,
       min(io_time) AS primera, max(io_time) AS ultima
  FROM attendance_logs a
 WHERE a.dev_id = '2023054254'
   AND a.received_at >= extract(epoch FROM timestamptz '2026-09-27 00:00-04') * 1000
   AND a.received_at <  extract(epoch FROM timestamptz '2026-09-28 00:00-04') * 1000;


-- E15. AUDITORÍA: altas/bajas y cambios sobre este equipo registrados por el sistema.
SELECT a.id, to_timestamp(extract(epoch FROM a.created_at)) AT TIME ZONE 'America/Caracas' AS cuando,
       a.action, a.entity_type, a.entity_id, left(a.after_json::text, 300) AS detalle
  FROM audit_log a
 WHERE (a.entity_id = '2023054254' OR a.after_json::text LIKE '%2023054254%' OR a.before_json::text LIKE '%2023054254%')
   AND a.created_at >= timestamptz '2026-09-27 00:00-04'
 ORDER BY a.created_at;


-- =============================================================================
-- R. REVISIÓN NOCTURNA (03:00 de hoy, 2026-09-28) — todos los equipos
-- =============================================================================

-- R1. LAS CORRIDAS DE LA NOCHE: ¿cuadró la caché? ¿a quién sacó?
SELECT r.id, r.dev_id, r.trigger, r.ok,
       to_timestamp(extract(epoch FROM r.started_at)) AT TIME ZONE 'America/Caracas'  AS inicio,
       to_timestamp(extract(epoch FROM r.finished_at)) AT TIME ZONE 'America/Caracas' AS fin,
       r.stats->>'audit'          AS revision,
       r.stats->>'cache_exact'    AS cache_exacta,
       r.stats->>'audit_checked'  AS consultados_sin_huella,
       r.stats->'audit_gone'      AS sacados,
       r.stats->>'info_ok'        AS leidos,
       jsonb_array_length(coalesce(r.stats->'info_failed', '[]'::jsonb)) AS lecturas_fallidas,
       r.stats->>'added' AS altas, r.stats->>'removed' AS bajas, r.stats->>'held' AS frenadas,
       r.stats->>'user_count' AS usuarios_equipo, r.stats->>'fp_count' AS huellas_equipo,
       r.stats->'errors' AS errores, r.stats->>'error' AS error
  FROM sync_run r
 WHERE r.kind = 'fingerprints'
   AND r.started_at >= timestamptz '2026-09-28 02:55-04'
   AND r.started_at <  timestamptz '2026-09-28 05:00-04'
 ORDER BY r.dev_id, r.started_at;


-- R2. LAS OPERACIONES DE LA NOCHE (revisión y lo que haya disparado).
SELECT o.id, o.dev_id, o.kind, o.label, o.stage,
       to_timestamp(o.created_at / 1000) AT TIME ZONE 'America/Caracas' AS iniciada,
       round((coalesce(o.finished_at, o.updated_at) - o.created_at) / 1000.0) AS duro_s,
       count(c.*) FILTER (WHERE c.cmd_code = 'GET_USER_INFO') AS get_user_info,
       count(c.*) FILTER (WHERE c.status = 'ERROR')           AS comandos_con_error,
       string_agg(c.cmd_code || CASE WHEN c.status = 'ERROR' THEN '(' || coalesce(c.cmd_return_code, 'ERROR') || ')' ELSE '' END,
                  ' → ' ORDER BY c.trans_id)                  AS secuencia,
       coalesce(o.result_note, o.error_note) AS resultado
  FROM operations o
  LEFT JOIN commands c ON c.op_id = o.id
 WHERE o.created_at >= extract(epoch FROM timestamptz '2026-09-28 01:55-04') * 1000
   AND o.created_at <  extract(epoch FROM timestamptz '2026-09-28 05:00-04') * 1000
 GROUP BY o.id
 ORDER BY o.dev_id, o.created_at;


-- R3. EL PULL DE ASISTENCIA DE LAS 02:00 (el otro cron de la noche).
SELECT r.id, r.kind, r.dev_id, r.trigger, r.ok,
       to_timestamp(extract(epoch FROM r.started_at)) AT TIME ZONE 'America/Caracas' AS inicio,
       r.stats
  FROM sync_run r
 WHERE r.kind IN ('attendance_pull', 'attendance_compute')
   AND r.started_at >= timestamptz '2026-09-28 01:55-04'
   AND r.started_at <  timestamptz '2026-09-28 05:00-04'
 ORDER BY r.started_at;


-- R4. ¿ALGÚN EQUIPO SE QUEDÓ MUDO DURANTE LA NOCHE? (silencios > 30 s entre 01:55 y 05:00)
WITH ins AS (
  SELECT dev_id, id, created_at,
         LAG(created_at) OVER (PARTITION BY dev_id ORDER BY id) AS prev_at
    FROM raw_traffic
   WHERE direction = 'in'
     AND created_at >= extract(epoch FROM timestamptz '2026-09-28 01:55-04') * 1000
     AND created_at <  extract(epoch FROM timestamptz '2026-09-28 05:00-04') * 1000
)
SELECT dev_id AS equipo,
       to_timestamp(prev_at / 1000) AT TIME ZONE 'America/Caracas'    AS desde,
       to_timestamp(created_at / 1000) AT TIME ZONE 'America/Caracas' AS hasta,
       round((created_at - prev_at) / 1000.0) AS silencio_s
  FROM ins
 WHERE created_at - prev_at > 30000
 ORDER BY dev_id, prev_at;


-- R5. QUIÉN SALIÓ DE LA CACHÉ ESTA NOCHE (auditoría "device_user.gone").
SELECT a.id, to_timestamp(extract(epoch FROM a.created_at)) AT TIME ZONE 'America/Caracas' AS cuando,
       a.entity_id AS equipo, a.after_json AS detalle
  FROM audit_log a
 WHERE a.action = 'device_user.gone'
   AND a.created_at >= timestamptz '2026-09-28 01:55-04'
 ORDER BY a.created_at;


-- R6. APAGONES DE TODOS LOS EQUIPOS (27 18:00 → 28 10:00): silencios > 5 min por equipo.
--     Si todos se cortan en el mismo minuto, el problema fue del servidor o de la red,
--     no de los equipos.
WITH ins AS (
  SELECT dev_id, created_at,
         LAG(created_at) OVER (PARTITION BY dev_id ORDER BY id) AS prev_at
    FROM raw_traffic
   WHERE direction = 'in'
     AND created_at >= extract(epoch FROM timestamptz '2026-09-27 18:00-04') * 1000
     AND created_at <  extract(epoch FROM timestamptz '2026-09-28 10:00-04') * 1000
)
SELECT dev_id AS equipo,
       to_char(to_timestamp(prev_at / 1000) AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD HH24:MI:SS')    AS se_corto,
       to_char(to_timestamp(created_at / 1000) AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD HH24:MI:SS') AS volvio,
       round((created_at - prev_at) / 60000.0) AS minutos
  FROM ins
 WHERE created_at - prev_at > 300000
UNION ALL   -- y el último contacto de los que todavía no volvieron
SELECT dev_id, to_char(to_timestamp(max(created_at) / 1000) AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD HH24:MI:SS'), 'sigue sin volver', NULL
  FROM raw_traffic
 WHERE direction = 'in'
 GROUP BY dev_id
HAVING max(created_at) < extract(epoch FROM now() - interval '5 minutes') * 1000
ORDER BY 1, 2;
