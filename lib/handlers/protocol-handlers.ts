import { NextRequest, NextResponse } from "next/server";
import {
  parseBody,
  buildResponse,
  toDeviceTime,
  DEFAULT_TZ,
  decodeUserIdList,
  decodeLogData,
  annotateBinaryRefs,
} from "@/lib/protocol";
import {
  runAsync,
  getAsync,
  allAsync,
  NOW_MS,
} from "@/lib/db";
import { logRawTraffic } from "./index";
import { upsertUserFromInfo, upsertDeviceStatus } from "@/lib/operations/persist";
import { advanceOperationForCommand, sweepStaleOperations } from "@/lib/operations/advance";
import { finishOperation, getOperationRow } from "@/lib/operations/queue";
import { maybeAutoSyncClock } from "@/lib/deviceClock";
import { resolveDeviceIdentity, isPlaceholderDevId } from "@/lib/deviceIdentity";

const NO_CMD_STRATEGY = process.env.NO_CMD_STRATEGY || "ok_empty";
/** Hueco entre consultas que cuenta como "estuvo fuera" (= DEVICE_GONE_MS de lib/sync/reconcile). */
const RECONNECT_GAP_MS = 5 * 60 * 1000;
/**
 * Comandos que el servidor encola solo (reescribir fk_name). Detrás de todo lo
 * del panel (100) y del reconciliador (200).
 */
const AUTO_PRIORITY = 300;
/** Si el equipo no aplica el SET_FK_NAME, no se insiste en cada consulta. */
const FK_NAME_HEAL_COOLDOWN_MS = 60 * 60 * 1000;
/**
 * Cada cuánto se le pide GET_LOG_DATA a un equipo con dev_id placeholder: sus
 * realtime_glog no se pueden atribuir (lib/deviceIdentity), así que las
 * marcaciones entran por acá.
 */
const PLACEHOLDER_LOG_PULL_MS = Number(process.env.PLACEHOLDER_LOG_PULL_MS) || 15 * 60 * 1000;
const lastPlaceholderPull = new Map<string, number>();
const lastQuarantineWarn = new Map<string, number>();

/**
 * Equipos normales: su fk_name debe ser su serial (dev_id). Se verifica en
 * cada consulta y, si alguien lo cambió desde el teclado, se reescribe. El
 * nombre visible vive en devices.name, nunca en el equipo.
 */
async function maybeHealFkName(devId: string): Promise<void> {
  const recent = await getAsync<{ x: number }>(
    `SELECT 1 AS x FROM commands
      WHERE dev_id = ? AND cmd_code = 'SET_FK_NAME'
        AND (status IN ('WAIT','RUN') OR created_at > ${NOW_MS} - ?)
      LIMIT 1`,
    [devId, FK_NAME_HEAL_COOLDOWN_MS]
  );
  if (recent) return;
  await runAsync(
    `INSERT INTO commands (dev_id, cmd_code, cmd_param, status, priority) VALUES (?, 'SET_FK_NAME', ?, 'WAIT', ?)`,
    [devId, JSON.stringify({ fk_name: devId }), AUTO_PRIORITY]
  );
  console.log(`[identity] ${devId}: fk_name distinto del serial — se encola SET_FK_NAME`);
}

/** Pull periódico de marcaciones de un equipo con dev_id placeholder. No bloquea. */
function maybePullPlaceholderLogs(devId: string, lastSyncAt: number | null): void {
  const now = Date.now();
  if (lastSyncAt != null && now - lastSyncAt < PLACEHOLDER_LOG_PULL_MS) return;
  if (now - (lastPlaceholderPull.get(devId) ?? 0) < PLACEHOLDER_LOG_PULL_MS) return;
  lastPlaceholderPull.set(devId, now);
  // Import dinámico: lib/sync importa lib/operations, que importa este archivo.
  void import("@/lib/sync/attendance")
    .then(({ attendancePullDevices }) => attendancePullDevices([devId], "event", { background: true }))
    .catch((err) => console.error("[identity] no se pudo encolar el pull de marcaciones de", devId, err));
}

export async function handleReceiveCmd(
  request: NextRequest,
  requestBody: Buffer,
  reportedDevId: string | null
) {
  if (!reportedDevId) {
    const resp = buildResponse({ responseCode: "ERROR" });
    await logRawTraffic("out", null, "receive_cmd", resp.headers, resp.body);
    return new NextResponse(resp.body, { status: 400, headers: resp.headers });
  }

  // No cron in this stack — devices poll every ~10s regardless, so that's a
  // free heartbeat for expiring operations whose device never comes back.
  try {
    await sweepStaleOperations();
  } catch (err) {
    console.error("[operations] fallo en la barrida de operaciones expiradas:", err);
  }

  const { json } = parseBody(requestBody);

  // Identidad: el header dev_id, o el fk_name si el dev_id es un placeholder
  // de firmware (lib/deviceIdentity). Sin identidad → cuarentena: ni se
  // registra ni recibe comandos, para no mezclarlo con otro equipo.
  const identity = resolveDeviceIdentity(reportedDevId, json?.fk_name);
  if (identity.kind === "quarantine") {
    const now = Date.now();
    if (now - (lastQuarantineWarn.get(reportedDevId) ?? 0) > 10 * 60 * 1000) {
      lastQuarantineWarn.set(reportedDevId, now);
      console.warn(
        `[identity] equipo con dev_id placeholder ${reportedDevId} y fk_name vacío: en cuarentena. ` +
          `Escribir el serial de la caja en el nombre del equipo.`
      );
    }
    const resp = buildResponse({ responseCode: "OK" });
    await logRawTraffic("out", reportedDevId, "receive_cmd", resp.headers, resp.body);
    return new NextResponse(resp.body, { status: 200, headers: resp.headers });
  }
  const devId = identity.devId;

  // Upsert device. Real firmware nests the capability fields under `fk_info`:
  //   {"fk_name":"","fk_time":"...","fk_info":{"firmware":"WS535BW1_BSCS_v1.5.31",
  //    "fk_bin_data_lib":"FKDATAHS101","supported_enroll_data":["FP","PASSWORD"]}}
  // Fall back to the top level so the simulator and e2e suite keep working.
  const info = json?.fk_info ?? {};
  const fkName = json?.fk_name || null;
  const firmware = info.firmware ?? json?.firmware ?? null;
  const fkBinDataLib = info.fk_bin_data_lib ?? json?.fk_bin_data_lib ?? null;
  const rawEnrollData = info.supported_enroll_data ?? json?.supported_enroll_data;
  const supportedEnrollData = rawEnrollData
    ? JSON.stringify(rawEnrollData)
    : null;

  // Cuándo consultó por última vez ANTES de esta: si hace más de 5 min (o nunca),
  // estuvo fuera y el cron no le lanzó nada (D4) — se le lanza al volver.
  const prev = await getAsync<{ last_seen_at: number | null; last_sync_at: number | null }>(
    `SELECT last_seen_at, last_sync_at FROM devices WHERE dev_id = ?`,
    [devId]
  );
  const reconnected = !prev?.last_seen_at || Date.now() - prev.last_seen_at > RECONNECT_GAP_MS;

  await runAsync(
    `INSERT INTO devices (dev_id, fk_name, reported_dev_id, firmware, fk_bin_data_lib, supported_enroll_data, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ${NOW_MS})
     ON CONFLICT(dev_id) DO UPDATE SET
       fk_name = excluded.fk_name,
       reported_dev_id = excluded.reported_dev_id,
       firmware = excluded.firmware,
       fk_bin_data_lib = excluded.fk_bin_data_lib,
       supported_enroll_data = excluded.supported_enroll_data,
       last_seen_at = ${NOW_MS}`,
    [devId, fkName, identity.reported, firmware, fkBinDataLib, supportedEnrollData]
  );

  // Solo con un cuerpo real (el simulador y los tests a veces mandan vacío):
  // ahí sí sabemos qué fk_name tiene el equipo.
  if (identity.kind === "serial" && json && (fkName ?? "") !== devId) {
    try {
      await maybeHealFkName(devId);
    } catch (err) {
      console.error("[identity] no se pudo encolar SET_FK_NAME para", devId, err);
    }
  }
  if (identity.kind === "fk_name") {
    maybePullPlaceholderLogs(devId, prev?.last_sync_at != null ? Number(prev.last_sync_at) : null);
  }

  if (reconnected) {
    // No espera: la respuesta al equipo no se demora por esto. Import dinámico:
    // lib/sync/reconcile importa lib/operations, que importa este archivo.
    void import("@/lib/sync/reconcile")
      .then(({ onDeviceReconnect }) => onDeviceReconnect(devId))
      .catch((err) => console.error("[sync] no se pudo lanzar la corrida al reconectarse", devId, err));
  }

  // Reloj desviado → "Sincronizar hora" sola (lib/deviceClock). No espera: la
  // respuesta al equipo no se demora por esto.
  maybeAutoSyncClock(devId, json?.fk_time ?? null);

  // Next WAIT command: lowest priority first (panel 100 before reconciler
  // 200 — docs/10 §3.1), then oldest.
  //
  // Candado por equipo (docs/10 §4.2, D1): UNA operación a la vez. La que ya
  // arrancó (salió de 'queued': el equipo recibió alguno de sus comandos) sigue hasta terminar;
  // recién ahí pasa la siguiente por prioridad. Las verificaciones por conteo
  // (+1 usuario, +N huellas) suponen que nadie más escribe en el equipo
  // mientras tanto: sin esto, dos altas o un alta y una baja del panel se
  // cruzaban y ningún conteo cerraba. Los comandos sueltos (Diagnóstico, sin
  // operación) no esperan.
  const command = await getAsync<{
    trans_id: number;
    cmd_code: string;
    cmd_param: string | null;
    cmd_binary: Buffer | null;
  }>(
    `WITH active AS (
       SELECT o.id, o.priority, o.created_at, o.stage <> 'queued' AS started
         FROM operations o
        WHERE o.dev_id = ? AND o.stage IN ('queued','sent','waiting','verifying')
     ), head AS (
       SELECT id FROM active ORDER BY started DESC, priority ASC, created_at ASC, id ASC LIMIT 1
     )
     SELECT c.trans_id, c.cmd_code, c.cmd_param, c.cmd_binary FROM commands c
      WHERE c.dev_id = ? AND c.status = 'WAIT'
        AND (c.op_id IS NULL
             OR c.op_id = (SELECT id FROM head)
             OR c.op_id NOT IN (SELECT id FROM active))
      ORDER BY c.priority ASC, c.created_at ASC, c.trans_id ASC LIMIT 1`,
    [devId, devId]
  );

  if (command) {
    // Mark command as RUN
    await runAsync(
      `UPDATE commands SET status = 'RUN', updated_at = ${NOW_MS} WHERE trans_id = ?`,
      [command.trans_id]
    );

    // If this command belongs to an operation, the device just picked it
    // up — flip queued/waiting to sent. Deliberately excludes 'verifying':
    // a verification GET_USER_INFO in flight should keep reading as such,
    // not revert to a generic "sent".
    await runAsync(
      `UPDATE operations
          SET stage = 'sent', updated_at = ${NOW_MS}
        WHERE current_trans_id = ? AND stage IN ('queued','waiting')`,
      [command.trans_id]
    );

    // Build response with command
    const cmdParams = command.cmd_param ? JSON.parse(command.cmd_param) : {};

    // A SET_TIME queued without an explicit time syncs to the moment of
    // delivery. Stamping it at queue time leaves the device seconds behind,
    // because it only picks the command up on its next poll (~10s).
    // La hora se manda en hora de PARED de la zona de la sede del equipo
    // (el servidor corre en UTC), no en la del proceso.
    if (command.cmd_code === "SET_TIME" && !cmdParams.time) {
      const tzRow = await getAsync<{ timezone: string | null }>(
        `SELECT s.timezone FROM devices d LEFT JOIN site s ON s.id = d.site_id WHERE d.dev_id = ?`,
        [devId]
      );
      cmdParams.time = toDeviceTime(new Date(), tzRow?.timezone || DEFAULT_TZ);
    }
    const resp = buildResponse({
      responseCode: "OK",
      transId: command.trans_id,
      cmdCode: command.cmd_code,
      bodyJson: cmdParams,
      binary: command.cmd_binary,
    });

    await logRawTraffic("out", devId, "receive_cmd", resp.headers, resp.body);
    return new NextResponse(resp.body, {
      status: 200,
      headers: resp.headers,
    });
  } else {
    // No command pending
    if (NO_CMD_STRATEGY === "error") {
      const resp = buildResponse({ responseCode: "ERROR" });
      await logRawTraffic("out", devId, "receive_cmd", resp.headers, resp.body);
      return new NextResponse(resp.body, {
        status: 200,
        headers: resp.headers,
      });
    }

    // Default: ok_empty
    const resp = buildResponse({ responseCode: "OK" });
    await logRawTraffic("out", devId, "receive_cmd", resp.headers, resp.body);
    return new NextResponse(resp.body, {
      status: 200,
      headers: resp.headers,
    });
  }
}

export async function handleSendCmdResult(
  request: NextRequest,
  requestBody: Buffer,
  reportedDevId: string | null
) {
  if (!reportedDevId) {
    const resp = buildResponse({ responseCode: "ERROR" });
    await logRawTraffic("out", null, "send_cmd_result", resp.headers, resp.body);
    return new NextResponse(resp.body, { status: 400, headers: resp.headers });
  }

  const transId = request.headers.get("trans_id");
  const blkNo = request.headers.get("blk_no");
  const cmdReturnCode = request.headers.get("cmd_return_code") || "OK";

  if (!transId) {
    const resp = buildResponse({ responseCode: "ERROR" });
    await logRawTraffic("out", reportedDevId, "send_cmd_result", resp.headers, resp.body);
    return new NextResponse(resp.body, { status: 400, headers: resp.headers });
  }

  const blkNoNum = blkNo ? parseInt(blkNo, 10) : undefined;

  // If blk_no is present and not 0, this is a fragment. Buffered under the
  // dev_id from the wire: trans_id alone already identifies the command.
  if (blkNoNum !== undefined && blkNoNum !== 0) {
    // Store in block_buffer
    await runAsync(
      `INSERT INTO block_buffer (dev_id, trans_id, blk_no, data)
       VALUES (?, ?, ?, ?)`,
      [reportedDevId, transId, blkNoNum, requestBody]
    );

    const resp = buildResponse({ responseCode: "OK", transId });
    await logRawTraffic("out", reportedDevId, "send_cmd_result", resp.headers, resp.body);
    return new NextResponse(resp.body, {
      status: 200,
      headers: resp.headers,
    });
  }

  // This is either the final fragment (blk_no = 0) or a complete result
  let finalData = requestBody;

  if (blkNoNum === 0) {
    // Assemble from buffer
    const blocks = await allAsync<{ blk_no: number; data: Buffer }>(
      `SELECT blk_no, data FROM block_buffer
       WHERE dev_id = ? AND trans_id = ?
       ORDER BY blk_no ASC`,
      [reportedDevId, transId]
    );

    const buffers = blocks.map(b => b.data);
    buffers.push(requestBody); // Final block
    finalData = Buffer.concat(buffers);

    // Clean up block buffer
    await runAsync(
      `DELETE FROM block_buffer WHERE dev_id = ? AND trans_id = ?`,
      [reportedDevId, transId]
    );
  }

  // Parse result
  const { json: resultJson, binaries } = parseBody(finalData);
  const resultBinary = binaries.length > 0 ? binaries[0] : null;

  const command = await getAsync<{ cmd_code: string; op_id: number | null; dev_id: string }>(
    `SELECT cmd_code, op_id, dev_id FROM commands WHERE trans_id = ?`,
    [transId]
  );
  // El resultado es del equipo al que se le mandó el comando: con un dev_id
  // placeholder el header no dice cuál es (lib/deviceIdentity).
  const devId = isPlaceholderDevId(reportedDevId) && command ? command.dev_id : reportedDevId;

  // Results reference attached binaries as opaque "BIN_1"/"BIN_2" placeholders
  // the admin panel can't show usefully as-is. Annotate every one with its
  // real size (and text, when it happens to be printable) before storing, so
  // result_json is worth looking at rather than just what arrived on the wire.
  let storedResultJson = annotateBinaryRefs(resultJson, binaries);
  if (command?.cmd_code === "GET_USER_ID_LIST" && resultJson) {
    const userIds = decodeUserIdList(resultJson, binaries);
    if (userIds) {
      storedResultJson = { ...storedResultJson, user_ids: userIds };
    }
  }
  if (command?.cmd_code === "GET_LOG_DATA" && resultJson) {
    const logs = decodeLogData(resultJson, binaries);
    if (logs) {
      storedResultJson = { ...storedResultJson, logs };
    }
  }

  // Update command
  await runAsync(
    `UPDATE commands SET
       status = ?,
       result_json = ?,
       result_binary = ?,
       cmd_return_code = ?,
       updated_at = ${NOW_MS}
     WHERE trans_id = ?`,
    [
      cmdReturnCode === "OK" ? "RESULT" : "ERROR",
      storedResultJson ? JSON.stringify(storedResultJson) : null,
      resultBinary,
      cmdReturnCode,
      transId,
    ]
  );

  // Special handling for certain commands (runs for ad-hoc commands too, not
  // just ones that belong to an operation)
  if (cmdReturnCode === "OK" && resultJson && command) {
    await handleCommandResult(devId, command.cmd_code, resultJson, binaries);
  }

  // Advance the parent operation, if this command belongs to one. Isolated
  // in its own try/catch: a bug here must never cost the device its HTTP
  // 200 — the firmware does not retry send_cmd_result, so losing that
  // response would lose the result forever.
  if (command?.op_id) {
    try {
      await advanceOperationForCommand({
        opId: command.op_id,
        devId,
        transId: Number(transId),
        cmdCode: command.cmd_code,
        ok: cmdReturnCode === "OK",
        returnCode: cmdReturnCode,
        resultJson,
        binaries,
      });
    } catch (err) {
      console.error("[operations] fallo al avanzar la operación", command.op_id, err);
      try {
        await finishOperation(
          command.op_id,
          "error",
          `Fallo interno al avanzar la operación: ${String(err)}`
        );
      } catch (inner) {
        console.error("[operations] no se pudo ni registrar el fallo:", inner);
      }
    }

    // Si esto acaba de completar una captura manual con huellas nuevas, los
    // demás equipos del alcance de esa persona tienen que recibirlas: se les
    // dispara su corrida del reconciliador (docs/10 §4.3). Aparte del
    // try/catch de arriba: un fallo acá no toca el resultado ya guardado.
    try {
      const op = await getOperationRow(command.op_id);
      if (op?.kind === "CAPTURE_FINGERPRINT" && op.stage === "done") {
        const plan = op.plan_json ? JSON.parse(op.plan_json) : {};
        if (plan.employeeId && Array.isArray(plan.newFingerprintIds) && plan.newFingerprintIds.length > 0) {
          const { triggerReconcile } = await import("@/lib/sync/reconcile");
          const { applicableDevices } = await import("@/lib/scope");
          const targets = (await applicableDevices(plan.employeeId)).filter((d) => d !== op.dev_id);
          await triggerReconcile(targets, "event");
        }
      }
    } catch (err) {
      console.error("[operations] fallo al propagar huella capturada:", command.op_id, err);
    }
  }

  const resp = buildResponse({ responseCode: "OK", transId });
  await logRawTraffic("out", devId, "send_cmd_result", resp.headers, resp.body);
  return new NextResponse(resp.body, {
    status: 200,
    headers: resp.headers,
  });
}

async function handleCommandResult(
  devId: string,
  cmdCode: string,
  resultJson: Record<string, any>,
  binaries: Buffer[]
) {
  // Process results from commands that update state
  switch (cmdCode) {
    case "GET_DEVICE_STATUS":
      await upsertDeviceStatus(devId, resultJson);
      break;

    case "GET_LOG_DATA":
      // Bulk log sync is handled by the SYNC_LOGS operation chain
      // (lib/operations/advance.ts), not here — an ad-hoc GET_LOG_DATA from
      // the raw command form is for inspection, not archival.
      break;

    case "GET_USER_INFO":
      await upsertUserFromInfo(devId, resultJson, binaries);
      break;
  }
}

export async function handleRealtimeGlog(
  request: NextRequest,
  requestBody: Buffer,
  devId: string | null
) {
  if (!devId) {
    const resp = buildResponse({ responseCode: "ERROR" });
    await logRawTraffic("out", null, "realtime_glog", resp.headers, resp.body);
    return new NextResponse(resp.body, { status: 400, headers: resp.headers });
  }

  // Placeholder: no se sabe de qué equipo es. OK y se descarta; la marcación
  // sigue en la memoria del equipo y entra por el pull de GET_LOG_DATA.
  if (isPlaceholderDevId(devId)) {
    const resp = buildResponse({ responseCode: "OK" });
    await logRawTraffic("out", devId, "realtime_glog", resp.headers, resp.body);
    return new NextResponse(resp.body, { status: 200, headers: resp.headers });
  }

  const { json, binaries } = parseBody(requestBody);

  if (!json) {
    const resp = buildResponse({ responseCode: "ERROR" });
    await logRawTraffic("out", devId, "realtime_glog", resp.headers, resp.body);
    return new NextResponse(resp.body, { status: 400, headers: resp.headers });
  }

  const userId = json.user_id;
  const verifyMode = json.verify_mode
    ? Array.isArray(json.verify_mode)
      ? JSON.stringify(json.verify_mode)
      : json.verify_mode
    : null;
  const ioMode = json.io_mode;
  const ioTime = json.io_time;
  const logImage = binaries.length > 0 ? binaries[0] : null;

  await runAsync(
    `INSERT INTO attendance_logs (dev_id, user_id, verify_mode, io_mode, io_time, log_image)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [devId, userId, verifyMode, ioMode, ioTime, logImage]
  );

  const resp = buildResponse({ responseCode: "OK" });
  await logRawTraffic("out", devId, "realtime_glog", resp.headers, resp.body);
  return new NextResponse(resp.body, {
    status: 200,
    headers: resp.headers,
  });
}

export async function handleRealtimeEnrollData(
  request: NextRequest,
  requestBody: Buffer,
  devId: string | null
) {
  if (!devId) {
    const resp = buildResponse({ responseCode: "ERROR" });
    return new NextResponse(resp.body, { status: 400, headers: resp.headers });
  }

  // Placeholder: no se puede atribuir. El reconciliador descubre al usuario en
  // su corrida normal del equipo.
  if (isPlaceholderDevId(devId)) {
    const resp = buildResponse({ responseCode: "OK" });
    return new NextResponse(resp.body, { status: 200, headers: resp.headers });
  }

  const { json } = parseBody(requestBody);

  if (!json || !json.user_id) {
    const resp = buildResponse({ responseCode: "ERROR" });
    return new NextResponse(resp.body, { status: 400, headers: resp.headers });
  }

  // Simplified: just insert the user, don't try to parse multiple enrollments
  // TODO: Fix the enrollment loop - appears to cause issues with sqlite3/async
  const userId = String(json.user_id);
  const userName = String(json.user_name || "");
  const userPrivilege = String(json.user_privilege || "USER");

  await runAsync(
    `INSERT INTO users (dev_id, user_id, user_name, user_privilege)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(dev_id, user_id) DO NOTHING`,
    [devId, userId, userName, userPrivilege]
  );

  // Alguien se enroló en el teclado (verificado: el equipo manda esto en el
  // momento, docs/10 T3). La ingesta de la huella la hace el reconciliador con
  // su propio GET_USER_INFO (forma limpia de 612 B); acá solo se dispara, sin
  // bloquear la respuesta al equipo ni dejar que un fallo la afecte.
  import("@/lib/sync/reconcile")
    .then(({ startReconcileDevice, hintUserChanged }) => {
      // Solo este usuario cambió: la corrida lo lee a él, no a todo el equipo.
      hintUserChanged(devId, userId);
      return startReconcileDevice(devId, { trigger: "event" });
    })
    .catch((err) => console.error("[sync] no se pudo disparar la corrida tras realtime_enroll_data:", devId, err));

  const resp = buildResponse({ responseCode: "OK" });
  return new NextResponse(resp.body, {
    status: 200,
    headers: resp.headers,
  });
}
