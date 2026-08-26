import * as http from "http";

// Very simple enrollment request
const body = Buffer.from('{"user_id":"U002","user_name":"Test"}');

const options = {
  hostname: "localhost",
  port: parseInt(process.env.PORT || "3000", 10),
  path: "/",
  method: "POST",
  headers: {
    dev_id: "TEST_SIMPLE",
    request_code: "realtime_enroll_data",
    "Content-Type": "application/octet-stream",
    "Content-Length": body.length,
  },
};

console.log("Sending simple enrollment request...");

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
