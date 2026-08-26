import * as http from "http";

// Full enrollment request with array
const enrollJson = {
  user_id: "U002",
  user_name: "Test User",
  user_privilege: "USER",
  enroll_data_array: [
    { backup_number: 0 },
    { backup_number: 1 },
  ],
};

const body = Buffer.from(JSON.stringify(enrollJson));

const options = {
  hostname: "localhost",
  port: parseInt(process.env.PORT || "3000", 10),
  path: "/",
  method: "POST",
  headers: {
    dev_id: "TEST_ARRAY",
    request_code: "realtime_enroll_data",
    "Content-Type": "application/octet-stream",
    "Content-Length": body.length,
  },
};

console.log("Sending enrollment request with array...");
console.log("JSON size:", body.length);

const req = http.request(options, (res) => {
  console.log("Status:", res.statusCode);
  console.log("response_code header:", res.headers["response_code"]);
  res.on("data", () => {});
  res.on("end", () => {
    process.exit(res.statusCode === 200 ? 0 : 1);
  });
});

req.on("error", (err) => {
  console.error("Error:", err);
  process.exit(1);
});

req.write(body);
req.end();
