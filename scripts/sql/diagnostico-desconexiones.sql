-- =============================================================================
-- Diagnóstico: "el equipo aparece desconectado mientras copia usuarios"
-- Solo lectura. Correr en DBeaver contra la base donde apuntan los equipos.
-- Cubre los dos equipos de prueba (columna "equipo"). Para otro rango, buscar y
-- reemplazar el interval (24 hours / 6 hours) en todo el archivo.
--
-- Contexto: el panel marca "Desconectado" si el equipo lleva > 30 s sin PEDIR
-- comandos (receive_cmd); entregar un resultado (send_cmd_result) no cuenta.
-- raw_traffic guarda cada request que entra ('in') y cada respuesta ('out').
-- =============================================================================

-- 1. SILENCIOS > 30 s del equipo, y qué pasó en el minuto anterior.
--    - "respuesta_servidor_ms" = cuánto tardamos en contestarle su último request.
--      Alta (segundos) → el servidor lo hizo esperar.
--    - "comandos_minuto_previo" = lo que le estábamos mandando justo antes.
--      Silencio tras una ráfaga de escrituras con respuesta rápida → el equipo.
WITH ins AS (
  SELECT id, dev_id, request_code, created_at,
         LAG(created_at) OVER (PARTITION BY dev_id ORDER BY id) AS prev_at,
         LAG(id)         OVER (PARTITION BY dev_id ORDER BY id) AS prev_id
    FROM raw_traffic
   WHERE direction = 'in'
     AND dev_id IN ('2023081133', '2023081158')                                                  -- ← equipo
     AND created_at > (extract(epoch FROM now() - interval '24 hours') * 1000)  -- ← rango
)
SELECT ins.dev_id AS equipo,
       to_timestamp(ins.prev_at / 1000) AT TIME ZONE 'America/Caracas'   AS ultimo_contacto,
       to_timestamp(ins.created_at / 1000) AT TIME ZONE 'America/Caracas' AS volvio,
       round((ins.created_at - ins.prev_at) / 1000.0)                    AS silencio_s,
       p.request_code                                                    AS ultimo_request,
       (SELECT o.created_at - p.created_at FROM raw_traffic o
         WHERE o.direction = 'out' AND o.dev_id = p.dev_id AND o.id > p.id
         ORDER BY o.id LIMIT 1)                                          AS respuesta_servidor_ms,
       (SELECT string_agg(o.headers_json::json->>'cmd_code', ', ' ORDER BY o.id) FROM raw_traffic o
         WHERE o.direction = 'out' AND o.dev_id = ins.dev_id AND o.request_code = 'receive_cmd'
           AND o.headers_json::json->>'cmd_code' IS NOT NULL
           AND o.created_at BETWEEN ins.prev_at - 60000 AND ins.prev_at + 1000) AS comandos_minuto_previo,
       ins.request_code                                                  AS volvio_con
  FROM ins JOIN raw_traffic p ON p.id = ins.prev_id
 WHERE ins.created_at - ins.prev_at > 30000
 ORDER BY ins.created_at DESC
 LIMIT 50;


-- 1b. ¿SE CALLARON LOS DOS EQUIPOS A LA VEZ?  Si sí → el problema es del
--     servidor (proceso reiniciado, trabado o sin memoria), no del equipo.
WITH ins AS (
  SELECT dev_id, created_at,
         LAG(created_at) OVER (PARTITION BY dev_id ORDER BY id) AS prev_at
    FROM raw_traffic
   WHERE direction = 'in'
     AND created_at > (extract(epoch FROM now() - interval '24 hours') * 1000)
), silencios AS (
  SELECT dev_id, prev_at AS desde, created_at AS hasta FROM ins WHERE created_at - prev_at > 30000
)
SELECT a.dev_id AS equipo, to_timestamp(a.desde / 1000) AT TIME ZONE 'America/Caracas' AS desde,
       round((a.hasta - a.desde) / 1000.0) AS silencio_s,
       string_agg(DISTINCT b.dev_id, ', ') AS otros_equipos_callados_a_la_vez
  FROM silencios a
  LEFT JOIN silencios b ON b.dev_id <> a.dev_id AND b.desde < a.hasta AND b.hasta > a.desde
 GROUP BY a.dev_id, a.desde, a.hasta
 ORDER BY a.desde DESC;


-- 2. CUÁNTO TARDA EL SERVIDOR EN RESPONDER, por tipo de request (in → su out).
--    El equipo espera esta respuesta antes de pedir el siguiente comando: si el
--    máximo pasa de ~10-15 s, el firmware puede darlo por caído y reintentar tarde.
WITH t AS (
  SELECT dev_id, direction, request_code, created_at,
         LEAD(direction)  OVER w AS next_dir,
         LEAD(created_at) OVER w AS next_at
    FROM raw_traffic
   WHERE dev_id IN ('2023081133', '2023081158')
     AND created_at > (extract(epoch FROM now() - interval '24 hours') * 1000)
  WINDOW w AS (PARTITION BY dev_id, request_code ORDER BY id)
)
SELECT dev_id AS equipo, request_code, count(*) AS requests,
       round(avg(next_at - created_at))                                        AS prom_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY next_at - created_at)      AS p95_ms,
       max(next_at - created_at)                                               AS max_ms
  FROM t WHERE direction = 'in' AND next_dir = 'out'
 GROUP BY dev_id, request_code ORDER BY dev_id, max_ms DESC;


-- 3. LOS 20 REQUESTS MÁS LENTOS DEL SERVIDOR, con el comando al que respondían.
WITH t AS (
  SELECT id, dev_id, direction, request_code, created_at,
         headers_json::json->>'trans_id' AS trans_id,
         LEAD(direction)  OVER w AS next_dir,
         LEAD(created_at) OVER w AS next_at
    FROM raw_traffic
   WHERE dev_id IN ('2023081133', '2023081158')
     AND created_at > (extract(epoch FROM now() - interval '24 hours') * 1000)
  WINDOW w AS (PARTITION BY dev_id, request_code ORDER BY id)
)
SELECT t.dev_id AS equipo, to_timestamp(t.created_at / 1000) AT TIME ZONE 'America/Caracas' AS cuando,
       t.request_code, t.next_at - t.created_at AS servidor_ms,
       t.trans_id, c.cmd_code, c.op_id
  FROM t LEFT JOIN commands c ON c.trans_id::text = t.trans_id
 WHERE t.direction = 'in' AND t.next_dir = 'out'
 ORDER BY servidor_ms DESC LIMIT 20;


-- 4. CUÁNTO TARDA EL EQUIPO EN EJECUTAR CADA TIPO DE COMANDO
--    (desde que se lo entregamos hasta que manda el resultado).
WITH entregas AS (
  SELECT dev_id, (headers_json::json->>'trans_id') AS trans_id, created_at AS entregado_at
    FROM raw_traffic
   WHERE direction = 'out' AND request_code = 'receive_cmd' AND dev_id IN ('2023081133', '2023081158')
     AND headers_json::json->>'trans_id' IS NOT NULL
     AND created_at > (extract(epoch FROM now() - interval '24 hours') * 1000)
), resultados AS (
  SELECT (headers_json::json->>'trans_id') AS trans_id, min(created_at) AS resultado_at
    FROM raw_traffic
   WHERE direction = 'in' AND request_code = 'send_cmd_result' AND dev_id IN ('2023081133', '2023081158')
   GROUP BY 1
)
SELECT e.dev_id AS equipo, c.cmd_code, count(*) AS veces,
       round(avg(r.resultado_at - e.entregado_at))                                       AS prom_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY r.resultado_at - e.entregado_at)     AS p95_ms,
       max(r.resultado_at - e.entregado_at)                                              AS max_ms,
       count(*) FILTER (WHERE r.resultado_at IS NULL)                                    AS sin_resultado
  FROM entregas e
  LEFT JOIN resultados r ON r.trans_id = e.trans_id
  LEFT JOIN commands c ON c.trans_id::text = e.trans_id
 GROUP BY e.dev_id, c.cmd_code ORDER BY e.dev_id, max_ms DESC NULLS FIRST;


-- 5. CADA GET_USER_INFO QUE NO VOLVIÓ, y el silencio que vino después.
--    Si cada uno coincide con un silencio de ~120 s, ese comando es el disparador.
--    - Fallan sobre todo usuarios CON varias huellas (respuesta grande) → la
--      subida se pierde en la red y el equipo espera su timeout (~2 min).
--    - Fallan también usuarios SIN huella (respuesta chica) → el equipo se
--      cuelga con el comando (docs/10 O9), independiente de la red.
WITH entregas AS (
  SELECT id, dev_id, created_at, headers_json::json->>'trans_id' AS trans_id
    FROM raw_traffic
   WHERE direction = 'out' AND request_code = 'receive_cmd'
     AND headers_json::json->>'cmd_code' = 'GET_USER_INFO'
     AND dev_id IN ('2023081133', '2023081158')                                                  -- ← equipo
     AND created_at > (extract(epoch FROM now() - interval '24 hours') * 1000)  -- ← rango
)
SELECT e.dev_id AS equipo, to_timestamp(e.created_at / 1000) AT TIME ZONE 'America/Caracas' AS entregado,
       c.cmd_param::json->>'user_id'                                    AS user_id,
       u.user_name, u.user_privilege,
       EXISTS (SELECT 1 FROM employee x
                WHERE regexp_replace(x.national_id, '\D', '', 'g') = c.cmd_param::json->>'user_id') AS es_empleado,
       (SELECT count(*) FROM enroll_data d
         WHERE d.dev_id = c.dev_id AND d.user_id = c.cmd_param::json->>'user_id')  AS huellas_conocidas,
       o.kind                                                            AS operacion,
       c.status, c.cmd_return_code,
       round(((SELECT min(i.created_at) FROM raw_traffic i
                WHERE i.direction = 'in' AND i.dev_id = e.dev_id AND i.id > e.id) - e.created_at) / 1000.0) AS silencio_despues_s,
       (SELECT i.request_code FROM raw_traffic i
         WHERE i.direction = 'in' AND i.dev_id = e.dev_id AND i.id > e.id ORDER BY i.id LIMIT 1)           AS volvio_con
  FROM entregas e
  JOIN commands c ON c.trans_id::text = e.trans_id
  LEFT JOIN operations o ON o.id = c.op_id
  LEFT JOIN users u ON u.dev_id = c.dev_id AND u.user_id = c.cmd_param::json->>'user_id'
 WHERE NOT EXISTS (SELECT 1 FROM raw_traffic r
                    WHERE r.direction = 'in' AND r.request_code = 'send_cmd_result'
                      AND r.dev_id = e.dev_id AND r.headers_json::json->>'trans_id' = e.trans_id)
 ORDER BY e.created_at DESC;


-- 6. VERIFICAR EL ARREGLO (después de desplegar): qué comandos usó cada operación.
--    "Agregar persona" debería mostrar 0 GET_USER_INFO en el caso normal
--    (GET_DEVICE_STATUS + SET_USER_INFO + GET_DEVICE_STATUS + SET_ENROLL_DATA…).
SELECT o.id, o.kind, o.dev_id, o.stage,
       to_timestamp(o.created_at / 1000) AT TIME ZONE 'America/Caracas' AS iniciada,
       round((coalesce(o.finished_at, o.updated_at) - o.created_at) / 1000.0) AS duro_s,
       count(c.*) FILTER (WHERE c.cmd_code = 'GET_USER_INFO') AS get_user_info,
       string_agg(c.cmd_code, ' → ' ORDER BY c.trans_id)     AS comandos,
       left(coalesce(o.result_note, o.error_note, ''), 120)   AS resultado
  FROM operations o
  LEFT JOIN commands c ON c.op_id = o.id
 WHERE o.created_at > (extract(epoch FROM now() - interval '6 hours') * 1000)   -- ← rango
   AND o.kind IN ('ADD_EMPLOYEE_TO_DEVICE', 'RECONCILE_DEVICE')
 GROUP BY o.id
 ORDER BY o.created_at DESC
 LIMIT 50;

-- 6b. Cada sincronización: ¿leyó solo lo que cambió ("incremental") o todo ("full")?
SELECT r.id, r.dev_id, r.trigger,
       to_timestamp(extract(epoch FROM r.started_at)) AT TIME ZONE 'America/Caracas' AS inicio,
       r.stats->>'read_mode' AS lectura, r.stats->>'info_ok' AS usuarios_leidos,
       r.stats->>'added' AS altas, r.stats->>'completed' AS completar, r.stats->>'removed' AS bajas
  FROM sync_run r
 WHERE r.started_at > now() - interval '6 hours'
 ORDER BY r.started_at DESC
 LIMIT 50;
