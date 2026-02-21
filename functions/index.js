const functions = require("firebase-functions");
const fetch = (...args) => import("node-fetch").then(({default: fetch}) => fetch(...args));

// Set this in Firebase env config:
// firebase functions:config:set apps_script.exec_url="https://script.google.com/macros/s/XXXX/exec"
// or replace process.env.APPS_SCRIPT_EXEC_URL below with a hardcoded URL (not recommended).
const getExecUrl = () => {
  const cfg = functions.config();
  const fromCfg = cfg && cfg.apps_script && cfg.apps_script.exec_url;
  return fromCfg || process.env.APPS_SCRIPT_EXEC_URL;
};

exports.proxy = functions.https.onRequest(async (req, res) => {
  // Allow preflight (not strictly needed for same-origin, but harmless)
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).send("");

  const execUrl = getExecUrl();
  if (!execUrl) {
    return res.status(500).json({ ok: false, error: "Missing Apps Script exec URL. Set functions config apps_script.exec_url." });
  }

  try {
    // Pass through path after /api (optional) and querystring
    const path = req.path.replace(/^\/api\/?/, "");
    const url = new URL(execUrl);
    // Keep original query params
    for (const [k,v] of Object.entries(req.query || {})) url.searchParams.set(k, v);

    // Add api param based on path if not provided
    if (path && !url.searchParams.get("api")) url.searchParams.set("api", path);

    const method = req.method === "GET" ? "GET" : "POST";
    const headers = { "Content-Type": "application/json" };
    const body = method === "POST" ? JSON.stringify(req.body || {}) : undefined;

    const r = await fetch(url.toString(), { method, headers, body });
    const text = await r.text();

    // Try JSON passthrough; fallback to text
    res.status(r.status);
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      try { return res.json(JSON.parse(text)); } catch(e) {}
    }
    return res.send(text);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});
