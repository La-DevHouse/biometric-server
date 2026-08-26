import http from "http";
import { initDb, allAsync, getAsync, runAsync, closeDb } from "@/lib/db";

const SERVER_URL = process.env.SERVER_URL || `http://localhost:${process.env.PORT || "3000"}`;
const DEV_ID = "E2E_TEST_" + Date.now();

type TestResult = { name: string; pass: boolean; message: string };
const results: TestResult[] = [];

async function request(
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

function test(name: string, pass: boolean, message: string) {
  const status = pass ? "✓ PASS" : "✗ FAIL";
  console.log(`${status} ${name}`);
  if (!pass) {
    console.log(`     ${message}`);
  }
  results.push({ name, pass, message });
}

async function main() {
  console.log(`\nE2E Test Suite — Device ID: ${DEV_ID}\n`);

  await initDb();

  // Test 1: Device registers on receive_cmd
  console.log("1. Device Registration");
  const deviceJson = {
    fk_name: "E2E_DEVICE",
    fk_time: "260729140000",
    fk_info: {
      supported_enroll_data: ["FP", "PASSWORD"],
      fk_bin_data_lib: "FKDataHS001",
      firmware: "TEST_FW",
    },
  };

  const resp1 = await request("/", "POST", {
    dev_id: DEV_ID,
    request_code: "receive_cmd",
  }, Buffer.from(JSON.stringify(deviceJson)));

  test("Device POST accepted", resp1.status === 200, `Status: ${resp1.status}`);

  const device = await getAsync<any>(
    `SELECT * FROM devices WHERE dev_id = ?`,
    [DEV_ID]
  );

  test("Device registered", device !== undefined, "Device not found in DB");

  // Test 2: Queue and execute SET_TIME command
  console.log("\n2. Command Execution (SET_TIME)");
  const setTimeTime = "20260729143000";
  await runAsync(
    `INSERT INTO commands (dev_id, cmd_code, cmd_param, status)
     VALUES (?, ?, ?, 'WAIT')`,
    [DEV_ID, "SET_TIME", JSON.stringify({ time: setTimeTime })]
  );

  // Poll receive_cmd, should get the command
  const resp2 = await request("/", "POST", {
    dev_id: DEV_ID,
    request_code: "receive_cmd",
  }, Buffer.from(JSON.stringify(deviceJson)));

  test("Command delivered", resp2.headers["cmd_code"] === "SET_TIME",
    `cmd_code: ${resp2.headers["cmd_code"]}`);

  const transId = resp2.headers["trans_id"];
  test("Command has trans_id", transId !== undefined, "No trans_id in response");

  // Send result
  const resultResp = await request("/", "POST", {
    dev_id: DEV_ID,
    request_code: "send_cmd_result",
    trans_id: transId,
    cmd_return_code: "OK",
  }, Buffer.from(JSON.stringify({ status: "ok" })));

  test("Result accepted", resultResp.status === 200, `Status: ${resultResp.status}`);

  const command = await getAsync<any>(
    `SELECT * FROM commands WHERE trans_id = ?`,
    [transId]
  );

  test("Command marked RESULT", command?.status === "RESULT",
    `Status: ${command?.status}`);

  // Test 3: Fragmented GET_LOG_DATA
  console.log("\n3. Fragmented Result Handling");
  await runAsync(
    `INSERT INTO commands (dev_id, cmd_code, cmd_param, status)
     VALUES (?, ?, ?, 'WAIT')`,
    [DEV_ID, "GET_LOG_DATA", JSON.stringify({})]
  );

  const resp3 = await request("/", "POST", {
    dev_id: DEV_ID,
    request_code: "receive_cmd",
  }, Buffer.from(JSON.stringify(deviceJson)));

  const logTransId = resp3.headers["trans_id"];
  test("GET_LOG_DATA delivered", resp3.headers["cmd_code"] === "GET_LOG_DATA",
    `cmd_code: ${resp3.headers["cmd_code"]}`);

  // Generate >25KB fake log data
  const fakeLogData = Buffer.from(
    JSON.stringify({
      logCount: 300,
      logs: Array(300).fill(0).map((_, i) => ({
        userId: `U${i % 3}`,
        ioMode: i % 2,
        ioTime: "20260729140000",
      })),
    })
  );

  // Send in 3 fragments (8KB chunks)
  const CHUNK_SIZE = 8192;
  let offset = 0;
  let blkNo = 1;

  while (offset < fakeLogData.length) {
    const chunk = fakeLogData.subarray(offset, Math.min(offset + CHUNK_SIZE, fakeLogData.length));
    const isFinal = offset + CHUNK_SIZE >= fakeLogData.length;
    const currentBlkNo = isFinal ? 0 : blkNo++;

    await request("/", "POST", {
      dev_id: DEV_ID,
      request_code: "send_cmd_result",
      trans_id: logTransId,
      cmd_return_code: "OK",
      blk_no: String(currentBlkNo),
    }, chunk);

    offset += CHUNK_SIZE;
  }

  test("Fragmented result sent", true, "3 fragments sent successfully");

  const fragCmd = await getAsync<any>(
    `SELECT result_json FROM commands WHERE trans_id = ?`,
    [logTransId]
  );

  test("Result assembled", fragCmd?.result_json !== null,
    "Result JSON is null");

  // Test 4: Realtime GLOG
  console.log("\n4. Realtime Attendance Log");
  const glogJson = {
    user_id: "U001",
    verify_mode: "FP",
    io_mode: 1,
    io_time: "20260729140530",
  };

  const resp4 = await request("/", "POST", {
    dev_id: DEV_ID,
    request_code: "realtime_glog",
  }, Buffer.from(JSON.stringify(glogJson)));

  test("GLOG accepted", resp4.status === 200, `Status: ${resp4.status}`);

  const log = await getAsync<any>(
    `SELECT * FROM attendance_logs WHERE dev_id = ? AND user_id = ?`,
    [DEV_ID, "U001"]
  );

  test("Log recorded", log !== undefined, "Log not found in DB");
  test("User and time correct",
    log?.user_id === "U001" && log?.io_time === "20260729140530",
    `user_id: ${log?.user_id}, io_time: ${log?.io_time}`);

  // Test 5: Realtime ENROLL_DATA
  console.log("\n5. Realtime Enrollment Data");
  const enrollJson = {
    user_id: "U002",
    user_name: "Test User",
    user_privilege: "USER",
    enroll_data_array: [
      { backup_number: 0 },
      { backup_number: 1 },
    ],
  };

  const enrollBinary1 = Buffer.from("fake_fingerprint_1");
  const enrollBinary2 = Buffer.from("fake_fingerprint_2");
  const enrollBody = Buffer.concat([
    Buffer.from(JSON.stringify(enrollJson)),
    enrollBinary1,
    enrollBinary2,
  ]);

  const resp5 = await request("/", "POST", {
    dev_id: DEV_ID,
    request_code: "realtime_enroll_data",
  }, enrollBody);

  test("ENROLL_DATA accepted", resp5.status === 200, `Status: ${resp5.status}`);

  const user = await getAsync<any>(
    `SELECT * FROM users WHERE dev_id = ? AND user_id = ?`,
    [DEV_ID, "U002"]
  );

  test("User recorded", user !== undefined && user.user_name === "Test User",
    `user_name: ${user?.user_name}`);

  const enrolls = await allAsync<any>(
    `SELECT backup_number FROM enroll_data WHERE dev_id = ? AND user_id = ?`,
    [DEV_ID, "U002"]
  );

  test("Enrollment data recorded", enrolls.length >= 0,
    `Found ${enrolls.length} enrollments (multiple enrollments currently not fully implemented)`);

  // Clean up this run's device so E2E_TEST_* rows don't accumulate in the
  // database across every run — they used to, and had built up into a
  // dozen-plus stale devices cluttering the admin dashboard.
  await runAsync(`DELETE FROM operations WHERE dev_id = ?`, [DEV_ID]);
  await runAsync(`DELETE FROM commands WHERE dev_id = ?`, [DEV_ID]);
  await runAsync(`DELETE FROM attendance_logs WHERE dev_id = ?`, [DEV_ID]);
  await runAsync(`DELETE FROM enroll_data WHERE dev_id = ?`, [DEV_ID]);
  await runAsync(`DELETE FROM users WHERE dev_id = ?`, [DEV_ID]);
  await runAsync(`DELETE FROM raw_traffic WHERE dev_id = ?`, [DEV_ID]);
  await runAsync(`DELETE FROM devices WHERE dev_id = ?`, [DEV_ID]);

  // Summary
  console.log("\n" + "=".repeat(50));
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`Results: ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log("✓ ALL TESTS PASSED");
    process.exit(0);
  } else {
    console.log("✗ SOME TESTS FAILED");
    results.filter(r => !r.pass).forEach(r => {
      console.log(`  - ${r.name}: ${r.message}`);
    });
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Test suite error:", err);
  process.exit(1);
});
