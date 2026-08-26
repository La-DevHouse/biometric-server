import * as http from "http";
import * as readline from "readline";
import * as crypto from "crypto";
import { parseBody } from "@/lib/protocol";

const DEV_ID = process.env.DEV_ID || "SIM001";
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${process.env.PORT || "3000"}`;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "5000");

// Fake device state
const deviceState = {
  users: [
    {
      userId: "U001",
      userName: "John Doe",
      privilege: "USER",
      photo: Buffer.alloc(0),
      enrollData: [
        { backupNumber: 0, data: Buffer.from("fake_fp_data_user1_" + Math.random()) },
        { backupNumber: 1, data: Buffer.from("fake_fp_data_user1_" + Math.random()) },
      ],
    },
    {
      userId: "U002",
      userName: "Jane Smith",
      privilege: "MANAGER",
      photo: Buffer.alloc(0),
      enrollData: [
        { backupNumber: 0, data: Buffer.from("fake_fp_data_user2_" + Math.random()) },
      ],
    },
    {
      userId: "U003",
      userName: "Admin User",
      privilege: "MANAGER",
      photo: Buffer.alloc(0),
      enrollData: [
        { backupNumber: 0, data: Buffer.from("fake_fp_data_user3_" + Math.random()) },
      ],
    },
  ],
  logs: [] as Array<{
    userId: string;
    verifyMode: string;
    ioMode: number;
    ioTime: string;
    image?: Buffer;
  }>,
  time: new Date(),
};

function generateFakeFingerprints(userId: string): Buffer[] {
  const prints = [];
  for (let i = 0; i < 10; i++) {
    prints.push(
      Buffer.from(
        `${userId}_fingerprint_${i}_${crypto.randomBytes(8).toString("hex")}`
      )
    );
  }
  return prints;
}

function generateFakeLogs(): Buffer {
  // Generate >25KB of fake log data to force fragmentation
  const logs = [];
  const logCount = 300; // ~80 bytes per log = ~24KB
  for (let i = 0; i < logCount; i++) {
    logs.push({
      userId: `U${String((i % 3) + 1).padStart(3, "0")}`,
      verifyMode: i % 2 === 0 ? "FP" : "PASSWORD",
      ioMode: i % 2,
      ioTime: new Date(Date.now() - i * 60000).toISOString().replace(/[-:T.Z]/g, "").substring(0, 14),
    });
  }
  return Buffer.from(JSON.stringify({ logCount: logs.length, logs }));
}

function generateFakeUserIdList(): Buffer {
  const users = deviceState.users.map(u => ({
    userId: u.userId,
    privilege: u.privilege,
  }));
  return Buffer.from(JSON.stringify({ userCount: users.length, users }));
}

async function sendRequest(
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: Buffer
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const url = new URL(SERVER_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path,
      method,
      headers: {
        "Content-Type": "application/octet-stream",
        ...headers,
      } as Record<string, string>,
    };

    if (body) {
      options.headers["Content-Length"] = String(body.length);
    }

    const req = http.request(options, (res) => {
      let data = Buffer.alloc(0);
      res.on("data", (chunk) => {
        data = Buffer.concat([data, chunk]);
      });
      res.on("end", () => {
        const resHeaders: Record<string, string> = {};
        if (res.headers) {
          Object.entries(res.headers).forEach(([k, v]) => {
            resHeaders[k] = String(v);
          });
        }
        resolve({
          status: res.statusCode || 200,
          headers: resHeaders,
          body: data,
        });
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function receiveCmd() {
  const fkTime = deviceState.time
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .substring(0, 14);

  const bodyJson = {
    fk_name: DEV_ID,
    fk_time: fkTime,
    fk_info: {
      supported_enroll_data: ["FP", "PASSWORD"],
      fk_bin_data_lib: "FKDataHS001",
      firmware: "FK725HS001_v2.0",
    },
  };

  const body = Buffer.from(JSON.stringify(bodyJson), "utf-8");

  console.log(`\n[${new Date().toISOString()}] -> receive_cmd`);

  const resp = await sendRequest("/", "POST", {
    dev_id: DEV_ID,
    request_code: "receive_cmd",
  }, body);

  console.log(`<- Status ${resp.status}, cmd_code: ${resp.headers["cmd_code"] || "none"}`);

  if (resp.headers["cmd_code"]) {
    const transId = resp.headers["trans_id"];
    const cmdCode = resp.headers["cmd_code"];
    const cmdBody = resp.body;

    // Parse command parameters with the shared protocol parser, so the
    // simulator reads responses the same way a real device does.
    const cmdParams = parseBody(cmdBody).json ?? {};

    // Execute command
    const result = await executeCommand(cmdCode, cmdParams);
    await sendCmdResult(transId, cmdCode, result);
  }
}

async function executeCommand(
  cmdCode: string,
  params: Record<string, any>
): Promise<{ json: Record<string, any>; binary?: Buffer }> {
  console.log(`  Executing: ${cmdCode}`);

  switch (cmdCode) {
    case "GET_ENROLL_DATA": {
      const userId = params.user_id;
      const backupNumber = params.backup_number;
      const user = deviceState.users.find(u => u.userId === userId);
      const enroll = user?.enrollData.find(e => e.backupNumber === backupNumber);
      return {
        json: { status: enroll ? "ok" : "error" },
        binary: enroll?.data,
      };
    }

    case "SET_ENROLL_DATA": {
      const userId = params.user_id;
      const backupNumber = params.backup_number;
      const user = deviceState.users.find(u => u.userId === userId);
      if (user) {
        const idx = user.enrollData.findIndex(e => e.backupNumber === backupNumber);
        if (idx >= 0) {
          user.enrollData[idx].data = Buffer.from("updated_" + Math.random());
        }
      }
      return { json: { status: "ok" } };
    }

    case "SET_TIME": {
      try {
        const timeStr = params.time; // "YYYYMMDDhhmmss"
        const year = parseInt(timeStr.substring(0, 4), 10);
        const month = parseInt(timeStr.substring(4, 6), 10);
        const day = parseInt(timeStr.substring(6, 8), 10);
        const hour = parseInt(timeStr.substring(8, 10), 10);
        const minute = parseInt(timeStr.substring(10, 12), 10);
        const second = parseInt(timeStr.substring(12, 14), 10);
        deviceState.time = new Date(year, month - 1, day, hour, minute, second);
      } catch {}
      return { json: { status: "ok" } };
    }

    case "DELETE_USER": {
      const userId = params.user_id;
      deviceState.users = deviceState.users.filter(u => u.userId !== userId);
      return { json: { status: "ok" } };
    }

    case "SET_USER_NAME": {
      const user = deviceState.users.find(u => u.userId === params.user_id);
      if (user) user.userName = params.user_name;
      return { json: { status: "ok" } };
    }

    case "SET_USER_PRIVILEGE": {
      const user = deviceState.users.find(u => u.userId === params.user_id);
      if (user) user.privilege = params.user_privilege;
      return { json: { status: "ok" } };
    }

    case "GET_USER_ID_LIST": {
      return {
        json: {
          userIdCount: deviceState.users.length,
          oneUserIdSize: 50,
        },
        binary: generateFakeUserIdList(),
      };
    }

    case "GET_LOG_DATA": {
      return {
        json: {
          logCount: 300,
          oneLogSize: 80,
        },
        binary: generateFakeLogs(),
      };
    }

    case "SET_FK_NAME": {
      // Update internal device name
      return { json: { status: "ok" } };
    }

    case "CLEAR_LOG_DATA":
    case "CLEAR_ENROLL_DATA": {
      return { json: { status: "ok" } };
    }

    case "GET_DEVICE_STATUS": {
      return {
        json: {
          totalUserCount: deviceState.users.length,
          userCount: deviceState.users.length,
          managerCount: deviceState.users.filter(u => u.privilege === "MANAGER").length,
          fpCount: deviceState.users.length * 2,
          faceCount: 0,
          passwordCount: 0,
          idcardCount: 0,
          totalLogCount: deviceState.logs.length,
        },
      };
    }

    case "GET_USER_INFO": {
      const user = deviceState.users.find(u => u.userId === params.user_id);
      if (!user) return { json: { status: "error" } };
      return {
        json: {
          userId: user.userId,
          userName: user.userName,
          userPrivilege: user.privilege,
        },
        binary: user.photo,
      };
    }

    case "SET_USER_INFO": {
      const user = deviceState.users.find(u => u.userId === params.user_id) ||
        { userId: params.user_id, userName: "", privilege: "USER", photo: Buffer.alloc(0), enrollData: [] };
      if (!deviceState.users.find(u => u.userId === params.user_id)) {
        deviceState.users.push(user);
      }
      user.userName = params.user_name;
      user.privilege = params.user_privilege;
      return { json: { status: "ok" } };
    }

    case "SET_WEB_SERVER_INFO": {
      console.log(`  Server info: ${params.server_ip}:${params.server_port}`);
      return { json: { status: "ok" } };
    }

    default:
      return { json: { status: "unknown_command" } };
  }
}

async function sendCmdResult(
  transId: string,
  cmdCode: string,
  result: { json: Record<string, any>; binary?: Buffer }
) {
  const json = result.json;
  const jsonStr = JSON.stringify(json);
  const body = result.binary
    ? Buffer.concat([Buffer.from(jsonStr, "utf-8"), result.binary])
    : Buffer.from(jsonStr, "utf-8");

  console.log(`  -> send_cmd_result (trans_id: ${transId})`);

  // Handle fragmentation for large results (>8KB)
  const CHUNK_SIZE = 8192;
  let blkNo = 1;

  if (body.length > CHUNK_SIZE) {
    // Send fragments
    for (let offset = 0; offset < body.length; offset += CHUNK_SIZE) {
      const chunk = body.subarray(offset, Math.min(offset + CHUNK_SIZE, body.length));
      const isFinal = offset + CHUNK_SIZE >= body.length;
      const currentBlkNo = isFinal ? 0 : blkNo++;

      await sendRequest("/", "POST", {
        dev_id: DEV_ID,
        request_code: "send_cmd_result",
        trans_id: transId,
        cmd_return_code: "OK",
        blk_no: String(currentBlkNo),
      }, chunk);

      console.log(`  <- Block ${currentBlkNo} sent`);
    }
  } else {
    // Send complete result
    await sendRequest("/", "POST", {
      dev_id: DEV_ID,
      request_code: "send_cmd_result",
      trans_id: transId,
      cmd_return_code: "OK",
    }, body);

    console.log(`  <- Result sent`);
  }
}

async function sendRealtimeGlog() {
  const user = deviceState.users[Math.floor(Math.random() * deviceState.users.length)];
  const json = {
    user_id: user.userId,
    verify_mode: Math.random() > 0.5 ? "FP" : "PASSWORD",
    io_mode: Math.random() > 0.5 ? 1 : 0,
    io_time: deviceState.time.toISOString().replace(/[-:T.Z]/g, "").substring(0, 14),
  };

  const body = Buffer.from(JSON.stringify(json), "utf-8");

  console.log(`\n[${new Date().toISOString()}] -> realtime_glog (user: ${user.userId})`);

  const resp = await sendRequest("/", "POST", {
    dev_id: DEV_ID,
    request_code: "realtime_glog",
  }, body);

  console.log(`<- Status ${resp.status}`);
  deviceState.logs.push(json as any);
}

async function sendRealtimeEnrollData() {
  const user = deviceState.users[0];
  const json = {
    user_id: user.userId,
    user_name: user.userName,
    user_privilege: user.privilege,
    enroll_data_array: user.enrollData.map(e => ({
      backup_number: e.backupNumber,
    })),
  };

  const jsonStr = JSON.stringify(json);
  let body = Buffer.from(jsonStr, "utf-8");

  // Append enrollment binaries
  for (const e of user.enrollData) {
    body = Buffer.concat([body, e.data]);
  }

  console.log(`\n[${new Date().toISOString()}] -> realtime_enroll_data (user: ${user.userId})`);

  const resp = await sendRequest("/", "POST", {
    dev_id: DEV_ID,
    request_code: "realtime_enroll_data",
  }, body);

  console.log(`<- Status ${resp.status}`);
}

async function main() {
  console.log(`Simulator starting... DEV_ID=${DEV_ID}, polling every ${POLL_INTERVAL}ms`);
  console.log("Interactive commands:");
  console.log("  'm' - Send realtime_glog (attendance)");
  console.log("  'e' - Send realtime_enroll_data (enrollment)");
  console.log("  'q' - Quit");

  // Setup interactive input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let running = true;

  rl.on("line", async (input) => {
    const cmd = input.trim().toLowerCase();
    if (cmd === "q") {
      running = false;
      rl.close();
      process.exit(0);
    } else if (cmd === "m") {
      try {
        await sendRealtimeGlog();
      } catch (err) {
        console.error("Error sending glog:", err);
      }
    } else if (cmd === "e") {
      try {
        await sendRealtimeEnrollData();
      } catch (err) {
        console.error("Error sending enroll:", err);
      }
    }
  });

  // Poll loop
  while (running) {
    try {
      await receiveCmd();
    } catch (err) {
      console.error("Error in poll:", err);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }
}

main().catch(console.error);
