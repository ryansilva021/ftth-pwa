const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

admin.initializeApp();

// Set this in Firebase env config:
// firebase functions:config:set apps_script.exec_url="https://script.google.com/macros/s/XXXX/exec"
const getExecUrl = () => {
  const cfg = functions.config();
  const fromCfg = cfg && cfg.apps_script && cfg.apps_script.exec_url;
  return fromCfg || process.env.APPS_SCRIPT_EXEC_URL;
};

function getBearer(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer (.+)$/);
  return m ? m[1] : null;
}

exports.proxy = functions.https.onRequest(async (req, res) => {
  // Allow preflight (not strictly needed for same-origin, but harmless)
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    // Pass through path after /api (optional) and querystring
    // Dependendo do rewrite, req.path pode vir "/me" OU "/api/me".
    // Normalizamos removendo o prefixo /api se existir.
    const path = (req.path || "/").replace(/^\/api\/?/, "").replace(/^\//, ""); // "me", "outraRota"

    // ✅ Rota local: /api/me (não vai para Apps Script)
    if (req.method === "GET" && path === "me") {
      const token = getBearer(req);
      if (!token) return res.status(401).json({ ok: false, error: "missing_bearer" });

      try {
        const decoded = await admin.auth().verifyIdToken(token);
        return res.json({
          ok: true,
          uid: decoded.uid,
          email: decoded.email || null,
          claims: decoded, // inclui custom claims
        });
      } catch (e) {
        return res.status(401).json({ ok: false, error: "invalid_token" });
      }
    }

    // ✅ Proxy para Apps Script (como já era)
    const execUrl = getExecUrl();
    if (!execUrl) {
      return res.status(500).json({
        ok: false,
        error: "Missing Apps Script exec URL. Set functions config apps_script.exec_url.",
      });
    }

    const url = new URL(execUrl);

    // Keep original query params
    for (const [k, v] of Object.entries(req.query || {})) url.searchParams.set(k, v);

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
      try { return res.json(JSON.parse(text)); } catch (e) {}
    }
    return res.send(text);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});
