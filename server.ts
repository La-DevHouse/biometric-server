// Custom Next server that normalizes the request path before Next sees it.
//
// Why this exists: the biometric terminals post to `//` instead of `/`
//
//     POST // HTTP/1.0
//     request_code:receive_cmd
//     dev_id: 2023081158
//
// Next's base server collapses repeated slashes by answering 308 Permanent
// Redirect, and it does so before proxy.ts, before `redirects`, and before
// routing — so it cannot be disabled from next.config. The firmware speaks
// HTTP/1.0 and never follows redirects, so every device request died at that
// redirect and none reached app/route.ts.
//
// Collapsing the slashes here is equivalent to following the redirect Next
// would have sent, except the method, headers and body survive.
//
// lib/deviceHttp rescues what Node's HTTP parser rejects before any of this
// runs: the facial terminals report command errors with `Content-Length: -1`.

import { createServer } from "http";
import next from "next";
import { rescueNegativeContentLength } from "./lib/deviceHttp";

const port = parseInt(process.env.PORT || "3000", 10);
// `--prod` keeps `npm start` shell-agnostic — no cross-env dependency needed to
// set NODE_ENV on Windows.
const dev =
  !process.argv.includes("--prod") && process.env.NODE_ENV !== "production";

const app = next({ dev });
const handle = app.getRequestHandler();

/** Collapse repeated slashes in the path, leaving the query string alone. */
function normalizeUrl(url: string): string {
  const qIndex = url.indexOf("?");
  const path = qIndex === -1 ? url : url.slice(0, qIndex);
  const query = qIndex === -1 ? "" : url.slice(qIndex);

  if (!path.includes("//")) return url;
  return path.replace(/\/{2,}/g, "/") + query;
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    if (req.url) {
      const normalized = normalizeUrl(req.url);
      if (normalized !== req.url) {
        console.log(`[normalize] ${req.method} ${req.url} -> ${normalized}`);
        req.url = normalized;
      }
    }
    handle(req, res);
  });
  rescueNegativeContentLength(server, port);
  server.listen(port, () => {
    console.log(
      `> Biometric server listening on http://0.0.0.0:${port} (${dev ? "development" : "production"})`,
    );
  });
});
