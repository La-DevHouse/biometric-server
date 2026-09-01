import { NextRequest, NextResponse } from "next/server";
import { parseBody, buildResponse } from "@/lib/protocol";
import {
  runAsync,
  getAsync,
  allAsync,
} from "@/lib/db";
import {
  handleReceiveCmd,
  handleSendCmdResult,
  handleRealtimeGlog,
  handleRealtimeEnrollData,
} from "./protocol-handlers";

export async function logRawTraffic(
  direction: "in" | "out",
  devId: string | null,
  requestCode: string | null,
  headers: Record<string, string>,
  body: Buffer
) {
  const head = body.subarray(0, 2000);
  // Devices concatenate binary after the JSON, so a plain utf-8 decode turns
  // into replacement characters — fall back to hex so the bytes stay
  // inspectable. Also fall back when the text contains a NUL (0x00): the
  // length-prefixed framing NUL-terminates its JSON block, and Postgres `text`
  // columns reject NUL outright (SQLite stored it fine). Without this, logging
  // a framed response bricks the request.
  const asText = head.toString("utf-8");
  const isCleanText =
    Buffer.from(asText, "utf-8").equals(head) && !asText.includes("\u0000");
  const bodyPreview = isCleanText ? asText : `hex: ${head.toString("hex")}`;
  const bodySize = body.length;
  const binaryStart = findJsonEnd(body);
  const binarySize = binaryStart !== -1 ? body.length - binaryStart : 0;

  await runAsync(
    `INSERT INTO raw_traffic (direction, dev_id, request_code, headers_json, body_preview, body_size, binary_size)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      direction,
      devId,
      requestCode,
      JSON.stringify(headers),
      bodyPreview,
      bodySize,
      binarySize,
    ]
  );
}

function findJsonEnd(buf: Buffer): number {
  let braceDepth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < buf.length; i++) {
    const char = String.fromCharCode(buf[i]);

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      braceDepth++;
    } else if (char === "}") {
      braceDepth--;
      if (braceDepth === 0) {
        return i + 1;
      }
    }
  }

  return -1;
}

export async function handleBiometricRequest(
  request: NextRequest,
  requestBody: Buffer
) {
  const requestCode = request.headers.get("request_code");
  const devId = request.headers.get("dev_id");

  const headersRecord: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headersRecord[key] = value;
  });

  try {
    // Log incoming request. Never let a logging failure break the response —
    // the device retries poorly and we lose the trace either way.
    try {
      await logRawTraffic("in", devId, requestCode, headersRecord, requestBody);
    } catch (logErr) {
      console.error("[traffic] failed to log incoming request:", logErr);
    }

    console.log(
      `[in] dev=${devId} code=${requestCode} bytes=${requestBody.length}`
    );

    // Dispatch based on request_code
    switch (requestCode) {
      case "receive_cmd":
        return await handleReceiveCmd(request, requestBody, devId);

      case "send_cmd_result":
        return await handleSendCmdResult(request, requestBody, devId);

      case "realtime_glog":
        return await handleRealtimeGlog(request, requestBody, devId);

      case "realtime_enroll_data":
        return await handleRealtimeEnrollData(request, requestBody, devId);

      default:
        // Unknown request code
        const errorHeaders = buildResponse({ responseCode: "ERROR" });
        await logRawTraffic(
          "out",
          devId,
          requestCode,
          errorHeaders.headers,
          errorHeaders.body
        );
        return new NextResponse(errorHeaders.body, {
          status: 400,
          headers: errorHeaders.headers,
        });
    }
  } catch (err) {
    console.error("Error processing request:", err);

    const errorHeaders = buildResponse({ responseCode: "ERROR" });
    await logRawTraffic(
      "out",
      devId,
      requestCode,
      errorHeaders.headers,
      errorHeaders.body
    );

    return new NextResponse(errorHeaders.body, {
      status: 500,
      headers: errorHeaders.headers,
    });
  }
}
