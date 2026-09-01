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
import { finishOperation } from "@/lib/operations/queue";

const NO_CMD_STRATEGY = process.env.NO_CMD_STRATEGY || "ok_empty";

export async function handleReceiveCmd(
  request: NextRequest,
  requestBody: Buffer,
  devId: string | null
) {
  if (!devId) {
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

  await runAsync(
    `INSERT INTO devices (dev_id, fk_name, firmware, fk_bin_data_lib, supported_enroll_data, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ${NOW_MS})
     ON CONFLICT(dev_id) DO UPDATE SET
       fk_name = excluded.fk_name,
       firmware = excluded.firmware,
       fk_bin_data_lib = excluded.fk_bin_data_lib,
       supported_enroll_data = excluded.supported_enroll_data,
       last_seen_at = ${NOW_MS}`,
    [devId, fkName, firmware, fkBinDataLib, supportedEnrollData]
  );

  // Find oldest WAIT command for this device
  const command = await getAsync<{
    trans_id: number;
    cmd_code: string;
    cmd_param: string | null;
    cmd_binary: Buffer | null;
  }>(
    `SELECT trans_id, cmd_code, cmd_param, cmd_binary FROM commands
     WHERE dev_id = ? AND status = 'WAIT'
     ORDER BY created_at ASC LIMIT 1`,
    [devId]
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
  devId: string | null
) {
  if (!devId) {
    const resp = buildResponse({ responseCode: "ERROR" });
    await logRawTraffic("out", null, "send_cmd_result", resp.headers, resp.body);
    return new NextResponse(resp.body, { status: 400, headers: resp.headers });
  }

  const transId = request.headers.get("trans_id");
  const blkNo = request.headers.get("blk_no");
  const cmdReturnCode = request.headers.get("cmd_return_code") || "OK";

  if (!transId) {
    const resp = buildResponse({ responseCode: "ERROR" });
    await logRawTraffic("out", devId, "send_cmd_result", resp.headers, resp.body);
    return new NextResponse(resp.body, { status: 400, headers: resp.headers });
  }

  const blkNoNum = blkNo ? parseInt(blkNo, 10) : undefined;

  // If blk_no is present and not 0, this is a fragment
  if (blkNoNum !== undefined && blkNoNum !== 0) {
    // Store in block_buffer
    await runAsync(
      `INSERT INTO block_buffer (dev_id, trans_id, blk_no, data)
       VALUES (?, ?, ?, ?)`,
      [devId, transId, blkNoNum, requestBody]
    );

    const resp = buildResponse({ responseCode: "OK", transId });
    await logRawTraffic("out", devId, "send_cmd_result", resp.headers, resp.body);
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
      [devId, transId]
    );

    const buffers = blocks.map(b => b.data);
    buffers.push(requestBody); // Final block
    finalData = Buffer.concat(buffers);

    // Clean up block buffer
    await runAsync(
      `DELETE FROM block_buffer WHERE dev_id = ? AND trans_id = ?`,
      [devId, transId]
    );
  }

  // Parse result
  const { json: resultJson, binaries } = parseBody(finalData);
  const resultBinary = binaries.length > 0 ? binaries[0] : null;

  const command = await getAsync<{ cmd_code: string; op_id: number | null }>(
    `SELECT cmd_code, op_id FROM commands WHERE trans_id = ?`,
    [transId]
  );

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

  const resp = buildResponse({ responseCode: "OK" });
  return new NextResponse(resp.body, {
    status: 200,
    headers: resp.headers,
  });
}
