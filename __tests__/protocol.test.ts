import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  parseBody,
  buildResponse,
  toDeviceTime,
  parseDeviceTime,
  decodeUserIdList,
  decodeLogData,
  annotateBinaryRefs,
  resolveBinaryRef,
} from "@/lib/protocol";

test("parseBody - JSON only", () => {
  const json = { test: "value" };
  const buf = Buffer.from(JSON.stringify(json), "utf-8");
  const result = parseBody(buf);
  assert.deepEqual(result.json, json);
  assert.equal(result.binaries.length, 0);
});

test("parseBody - JSON with trailing binary", () => {
  const json = { test: "value" };
  const jsonStr = JSON.stringify(json);
  const binaryData = Buffer.from("binary content");
  const buf = Buffer.concat([Buffer.from(jsonStr, "utf-8"), binaryData]);

  const result = parseBody(buf);
  assert.deepEqual(result.json, json);
  assert.equal(result.binaries.length, 1);
  assert.deepEqual(result.binaries[0], binaryData);
});

test("parseBody - JSON with escaped quotes in string", () => {
  const jsonStr = '{"message":"He said \\"hello\\""}';
  const binaryData = Buffer.from("binary");
  const buf = Buffer.concat([Buffer.from(jsonStr, "utf-8"), binaryData]);

  const result = parseBody(buf);
  assert.deepEqual(result.json, { message: 'He said "hello"' });
  assert.equal(result.binaries.length, 1);
  assert.deepEqual(result.binaries[0], binaryData);
});

test("parseBody - Nested JSON with braces in strings", () => {
  const json = { template: "{hello: world}", nested: { key: "value" } };
  const jsonStr = JSON.stringify(json);
  const binaryData = Buffer.from("xyz");
  const buf = Buffer.concat([Buffer.from(jsonStr, "utf-8"), binaryData]);

  const result = parseBody(buf);
  assert.deepEqual(result.json, json);
  assert.deepEqual(result.binaries[0], binaryData);
});

test("parseBody - Empty buffer", () => {
  const result = parseBody(Buffer.alloc(0));
  assert.equal(result.json, null);
  assert.equal(result.binaries.length, 0);
});

test("parseBody - Malformed JSON", () => {
  const buf = Buffer.from('{"incomplete": ', "utf-8");
  const result = parseBody(buf);
  assert.equal(result.json, null);
});

test("parseBody - No JSON, only binary", () => {
  const buf = Buffer.from("not json at all");
  const result = parseBody(buf);
  assert.equal(result.json, null);
});

test("buildResponse - OK with no trans_id", () => {
  const { headers, body } = buildResponse({ responseCode: "OK" });
  assert.equal(headers["response_code"], "OK");
  assert.equal(body.length, 0);
});

test("buildResponse - OK with trans_id and cmd_code", () => {
  const { headers, body } = buildResponse({
    responseCode: "OK",
    transId: 42,
    cmdCode: "SET_TIME",
    bodyJson: { time: "20260729120000" },
  });
  assert.equal(headers["response_code"], "OK");
  assert.equal(headers["trans_id"], "42");
  assert.equal(headers["cmd_code"], "SET_TIME");
  assert(body.includes(Buffer.from("20260729120000")));
});

test("buildResponse - RESET_FK special case", () => {
  const { headers, body } = buildResponse({ responseCode: "RESET_FK" });
  assert.equal(headers["response_code"], "RESET_FK");
  assert.equal(body.length, 0);
});

test("buildResponse - With binary", () => {
  const binary = Buffer.from("binary data");
  const { headers, body } = buildResponse({
    responseCode: "OK",
    bodyJson: { type: "data" },
    binary,
  });
  assert(body.includes(Buffer.from("type")));
  assert(body.includes(binary));
});

test("toDeviceTime - formats wall-clock in the given time zone", () => {
  const date = new Date("2026-07-29T14:30:45Z");
  // Caracas es UTC-4 (sin DST): 14:30:45Z -> 10:30:45 hora local
  assert.equal(toDeviceTime(date, "America/Caracas"), "20260729103045");
  assert.equal(toDeviceTime(date, "UTC"), "20260729143045");
});

test("parseDeviceTime - interprets the string as wall-clock in the zone", () => {
  const result = parseDeviceTime("20260729143045", "America/Caracas");
  assert(result !== null);
  // 14:30:45 en Caracas (UTC-4) == 18:30:45 UTC
  assert.equal(result.toISOString(), "2026-07-29T18:30:45.000Z");
  assert.equal(
    parseDeviceTime("20260729143045", "UTC")!.toISOString(),
    "2026-07-29T14:30:45.000Z"
  );
});

test("parseDeviceTime - Invalid format", () => {
  assert.equal(parseDeviceTime("not-a-time"), null);
  assert.equal(parseDeviceTime("2026072"), null);
  assert.equal(parseDeviceTime("202607291430459"), null);
});

test("toDeviceTime and parseDeviceTime round-trip", () => {
  const originalDate = new Date("2025-12-31T23:59:59Z");
  const timeStr = toDeviceTime(originalDate, "America/Caracas");
  const parsedDate = parseDeviceTime(timeStr, "America/Caracas");
  assert(parsedDate !== null);
  assert.equal(parsedDate.getTime(), originalDate.getTime());
  assert.equal(parsedDate.getFullYear(), originalDate.getFullYear());
  assert.equal(parsedDate.getMonth(), originalDate.getMonth());
  assert.equal(parsedDate.getDate(), originalDate.getDate());
});

// --- Real-device body framing (device 2023081158, firmware WS535BW1_BSCS_v1.5.31) ---

/** Prefix a payload with its length as a little-endian uint32, like the firmware does. */
function withLengthPrefix(payload: Buffer): Buffer {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(payload.length, 0);
  return Buffer.concat([prefix, payload]);
}

test("parseBody - strips the device's uint32 LE length prefix", () => {
  const json = {
    fk_name: "",
    fk_time: "20000101024026",
    fk_info: { firmware: "WS535BW1_BSCS_v1.5.31" },
  };
  const buf = withLengthPrefix(Buffer.from(JSON.stringify(json), "utf-8"));

  const result = parseBody(buf);
  assert.deepEqual(result.json, json);
  assert.equal(result.binaries.length, 0);
});

test("parseBody - length-prefixed blocks: JSON block plus BIN_1", () => {
  // Byte-for-byte the GET_USER_ID_LIST result captured from the real device.
  const jsonBlock = Buffer.concat([
    Buffer.from(
      '{"user_id_count":3,"one_user_id_size":8,"user_id_array":"BIN_1"}',
      "utf-8",
    ),
    Buffer.from([0x00]), // firmware NUL-terminates the JSON block
  ]);
  const bin1 = Buffer.from(
    "010000000101080002000000020108000300000001010800",
    "hex",
  );
  const buf = Buffer.concat([
    withLengthPrefix(jsonBlock),
    withLengthPrefix(bin1),
  ]);

  const result = parseBody(buf);
  assert.deepEqual(result.json, {
    user_id_count: 3,
    one_user_id_size: 8,
    user_id_array: "BIN_1",
  });
  assert.equal(result.binaries.length, 1);
  assert.deepEqual(result.binaries[0], bin1);
  // 3 users x one_user_id_size
  assert.equal(result.binaries[0].length, 24);
});

test("parseBody - length-prefixed blocks: several binaries stay separate", () => {
  // The old parser lumped every trailing byte into binaries[0], which made
  // BIN_1 vs BIN_2 impossible to tell apart.
  const jsonBlock = Buffer.from('{"a":"BIN_1","b":"BIN_2"}', "utf-8");
  const bin1 = Buffer.from([0x11, 0x22, 0x33]);
  const bin2 = Buffer.from([0xaa, 0xbb]);
  const buf = Buffer.concat([
    withLengthPrefix(jsonBlock),
    withLengthPrefix(bin1),
    withLengthPrefix(bin2),
  ]);

  const result = parseBody(buf);
  assert.deepEqual(result.json, { a: "BIN_1", b: "BIN_2" });
  assert.equal(result.binaries.length, 2);
  assert.deepEqual(result.binaries[0], bin1);
  assert.deepEqual(result.binaries[1], bin2);
});

test("parseBody - trailing NUL/newline padding is not treated as binary", () => {
  // The firmware pads realtime_glog bodies with bytes like 00 0a; storing those
  // as binaries[0] would persist 2 bytes of junk as a fingerprint or photo.
  const json = { user_id: "1", verify_mode: "33", io_time: "20000101025023" };
  const buf = Buffer.concat([
    Buffer.from(JSON.stringify(json), "utf-8"),
    Buffer.from([0x00, 0x0a]),
  ]);

  const result = parseBody(buf);
  assert.deepEqual(result.json, json);
  assert.equal(result.binaries.length, 0);
});

test("parseBody - a 4-byte value that is not a length prefix is left alone", () => {
  // Bodies that already start with `{` must never be reinterpreted.
  const json = { a: 1 };
  const result = parseBody(Buffer.from(JSON.stringify(json), "utf-8"));
  assert.deepEqual(result.json, json);
});

test("parseBody - a length-prefixed block whose length is 0x7b is not mistaken for flat JSON", () => {
  // Regression: a GET_USER_INFO response for a user renamed to "Eibar" had a
  // 123-byte JSON block (123 = 0x7b, the ASCII code for '{'). The length
  // prefix's first byte and a flat body's first byte are indistinguishable
  // in that case, and parseBody used to treat any buf[0] === 0x7b as proof
  // of the flat shape — silently discarding a real, correctly-framed device
  // response and reporting the rename as unverifiable.
  // Byte-for-byte the real capture: no NUL terminator this time, the JSON
  // text itself happens to fill the declared length exactly.
  const jsonBlock = Buffer.from(
    '{"user_id":"2","user_name":"Eibar","user_privilege":"USER",' +
      '"enroll_data_array":[{"backup_number":0,"enroll_data":"BIN_1"}]}',
    "utf-8"
  );
  assert.equal(jsonBlock.length, 123, "fixture must reproduce the exact 123-byte collision");

  const bin1 = Buffer.from([0xaa, 0xbb, 0xcc]);
  const buf = Buffer.concat([withLengthPrefix(jsonBlock), withLengthPrefix(bin1)]);
  assert.equal(buf[0], 0x7b, "the length prefix's first byte must collide with ASCII '{'");

  const result = parseBody(buf);
  assert.deepEqual(result.json, {
    user_id: "2",
    user_name: "Eibar",
    user_privilege: "USER",
    enroll_data_array: [{ backup_number: 0, enroll_data: "BIN_1" }],
  });
  assert.equal(result.binaries.length, 1);
  assert.deepEqual(result.binaries[0], bin1);
});

// --- decodeUserIdList (GET_USER_ID_LIST binary payload) ---

test("decodeUserIdList - decodes the real device's 3-user response", () => {
  // Byte-for-byte the GET_USER_ID_LIST result captured from device 2023081158
  // (firmware WS535BW1_BSCS_v1.5.31). IDs cross-checked against the same
  // device's realtime_glog entries, which used the plain strings "1" and "2".
  const json = { user_id_count: 3, one_user_id_size: 8, user_id_array: "BIN_1" };
  const binary = Buffer.from(
    "010000000101080002000000020108000300000001010800",
    "hex",
  );

  const userIds = decodeUserIdList(json, [binary]);
  assert.deepEqual(userIds, ["1", "2", "3"]);
});

test("decodeUserIdList - returns null when one_user_id_size is missing", () => {
  const json = { user_id_count: 3, user_id_array: "BIN_1" };
  const binary = Buffer.from("010000000101080002000000020108000300000001010800", "hex");
  assert.equal(decodeUserIdList(json, [binary]), null);
});

test("decodeUserIdList - returns null when the binary is absent", () => {
  const json = { user_id_count: 3, one_user_id_size: 8, user_id_array: "BIN_1" };
  assert.equal(decodeUserIdList(json, []), null);
});

test("decodeUserIdList - returns null when the binary length doesn't divide evenly", () => {
  const json = { user_id_count: 2, one_user_id_size: 8, user_id_array: "BIN_1" };
  const binary = Buffer.from([1, 2, 3]); // not a multiple of 8
  assert.equal(decodeUserIdList(json, [binary]), null);
});

// --- resolveBinaryRef / annotateBinaryRefs (GET_USER_INFO, GET_ENROLL_DATA) ---

test("resolveBinaryRef - maps BIN_1/BIN_2 to the right array index", () => {
  const bin1 = Buffer.from([1, 2, 3]);
  const bin2 = Buffer.from([4, 5]);
  assert.deepEqual(resolveBinaryRef("BIN_1", [bin1, bin2]), bin1);
  assert.deepEqual(resolveBinaryRef("BIN_2", [bin1, bin2]), bin2);
});

test("resolveBinaryRef - null for non-references and out-of-range indexes", () => {
  const bin1 = Buffer.from([1]);
  assert.equal(resolveBinaryRef("not a ref", [bin1]), null);
  assert.equal(resolveBinaryRef(42, [bin1]), null);
  assert.equal(resolveBinaryRef("BIN_5", [bin1]), null);
});

test("annotateBinaryRefs - GET_USER_INFO: fingerprint gets a size, no fabricated text", () => {
  // The exact shape reported from the real device for user 1 (jesus, MANAGER)
  // with one fingerprint enrolled at backup_number 0.
  const json = {
    user_id: "1",
    user_name: "jesus",
    user_privilege: "MANAGER",
    enroll_data_array: [{ backup_number: 0, enroll_data: "BIN_1" }],
  };
  // Real fingerprint templates are opaque binary, not printable text.
  const fingerprint = Buffer.from([0x00, 0xff, 0x10, 0xaa, 0x00, 0x01, 0x02, 0x9c]);

  const result = annotateBinaryRefs(json, [fingerprint]);

  assert.equal(result!.user_id, "1");
  assert.equal(result!.enroll_data_array[0].enroll_data, "BIN_1");
  assert.equal(result!.enroll_data_array[0].enroll_data_size, fingerprint.length);
  assert.equal("enroll_data_text" in result!.enroll_data_array[0], false);
});

test("annotateBinaryRefs - a password entry decodes as text because the bytes are printable", () => {
  // backup_number 10 = password. Not asserted from the field name — only
  // added because these particular bytes round-trip as printable UTF-8.
  const json = {
    user_id: "2",
    enroll_data_array: [{ backup_number: 10, enroll_data: "BIN_1" }],
  };
  const password = Buffer.from("1234", "utf-8");

  const result = annotateBinaryRefs(json, [password]);
  assert.equal(result!.enroll_data_array[0].enroll_data_size, 4);
  assert.equal(result!.enroll_data_array[0].enroll_data_text, "1234");
});

test("annotateBinaryRefs - resolves multiple BIN_N refs to the right blocks", () => {
  const json = {
    user_photo: "BIN_1",
    enroll_data_array: [{ backup_number: 0, enroll_data: "BIN_2" }],
  };
  const photo = Buffer.from([0xff, 0xd8, 0xff]); // JPEG magic bytes, not text
  const fingerprint = Buffer.from([0x00, 0x01, 0x02]);

  const result = annotateBinaryRefs(json, [photo, fingerprint]);
  assert.equal(result!.user_photo_size, 3);
  assert.equal("user_photo_text" in result!, false);
  assert.equal(result!.enroll_data_array[0].enroll_data_size, 3);
});

test("annotateBinaryRefs - does nothing when there are no BIN_N references", () => {
  const json = { status: "ok" };
  assert.deepEqual(annotateBinaryRefs(json, []), json);
});

test("annotateBinaryRefs - null json passes through", () => {
  assert.equal(annotateBinaryRefs(null, []), null);
});

// --- decodeLogData (GET_LOG_DATA binary payload) ---

test("decodeLogData - decodes real device records byte-for-byte", () => {
  // Verified against 64 real records from device 2023081133, cross-checked
  // against the same attendance already captured via realtime_glog (which
  // reports user_id/io_time as plain JSON). All 5 selected here span
  // different years, users, and verify_modes to exercise the bitfield edges.
  const records = [
    { hex: "010000000100011d9111e138", expected: { user_id: "1", verify_mode: "1", io_mode: 0, io_time: "20000101071429" } },
    { hex: "010000000100012ff5614539", expected: { user_id: "1", verify_mode: "1", io_mode: 0, io_time: "20250605101447" } },
    { hex: "0200000001000124f5610604", expected: { user_id: "2", verify_mode: "1", io_mode: 0, io_time: "20250606000136" } },
    { hex: "030000000100212df5612825", expected: { user_id: "3", verify_mode: "33", io_mode: 0, io_time: "20250608090945" } },
    { hex: "0500000001002120f981b099", expected: { user_id: "5", verify_mode: "33", io_mode: 0, io_time: "20260816133832" } },
  ];

  const binary = Buffer.concat(records.map((r) => Buffer.from(r.hex, "hex")));
  const json = { log_count: "5", one_log_size: "12", log_array: "BIN_1" };

  const logs = decodeLogData(json, [binary]);
  assert.deepEqual(logs, records.map((r) => r.expected));
});

test("decodeLogData - returns null when one_log_size is missing", () => {
  const binary = Buffer.from("010000000100011d9111e138", "hex");
  assert.equal(decodeLogData({ log_count: "1", log_array: "BIN_1" }, [binary]), null);
});

test("decodeLogData - returns null when the binary is absent", () => {
  const json = { log_count: "1", one_log_size: "12", log_array: "BIN_1" };
  assert.equal(decodeLogData(json, []), null);
});

test("decodeLogData - returns null when the binary length doesn't divide evenly", () => {
  const json = { log_count: "1", one_log_size: "12", log_array: "BIN_1" };
  assert.equal(decodeLogData(json, [Buffer.alloc(11)]), null);
});
