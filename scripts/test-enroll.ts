import * as http from "http";

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

const options = {
  hostname: "localhost",
  port: parseInt(process.env.PORT || "3000", 10),
  path: "/",
  method: "POST",
  headers: {
    dev_id: "TEST_ENROLL",
    request_code: "realtime_enroll_data",
    "Content-Type": "application/octet-stream",
    "Content-Length": enrollBody.length,
  },
};

const req = http.request(options, (res) => {
  let data = Buffer.alloc(0);
  res.on("data", (chunk) => {
    data = Buffer.concat([data, chunk]);
  });
  res.on("end", () => {
    console.log("Status:", res.statusCode);
    console.log("Headers:", res.headers);
    console.log("Body:", data.toString("utf-8"));
  });
});

req.on("error", (err) => {
  console.error("Error:", err);
});

req.write(enrollBody);
req.end();
