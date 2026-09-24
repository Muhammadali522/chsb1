// Simple server-side exam integrity API for chsb1.
// Node.js 18+. For production, put this behind HTTPS and a real database.
const http = require("http");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8787);
const ATTEMPTS = new Map();
const EVENTS = new Map();
const SESSION_TTL_MS = 12000;

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": process.env.ALLOW_ORIGIN || "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, X-Exam-Attempt",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 100000) throw new Error("body too large");
  }
  return data ? JSON.parse(data) : {};
}

function newAttempt(input) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const duration = Math.max(60, Math.min(Number(input.durationSec) || 3600, 4 * 3600));
  const attempt = {
    id,
    userName: String(input.userName || "").slice(0, 100),
    subject: String(input.subject || "").slice(0, 100),
    startedAt: now,
    endsAt: now + duration * 1000,
    lastHeartbeat: now,
    status: "ACTIVE",
    sessionToken: crypto.randomBytes(32).toString("hex"),
    seq: 0
  };
  ATTEMPTS.set(id, attempt);
  EVENTS.set(id, []);
  return attempt;
}

function getAttempt(req) {
  const id = req.headers["x-exam-attempt"];
  const a = ATTEMPTS.get(id);
  if (!a) return null;
  if (a.status !== "ACTIVE") return a;
  if (Date.now() > a.endsAt) {
    a.status = "EXPIRED";
  }
  return a;
}

function appendEvent(a, event) {
  if (!event || typeof event !== "object") return;
  const seq = Number(event.seq);
  if (Number.isFinite(seq) && seq <= a.seq) return;
  if (Number.isFinite(seq)) a.seq = seq;
  const list = EVENTS.get(a.id);
  list.push({
    id: crypto.randomUUID(),
    serverTime: new Date().toISOString(),
    clientTime: event.timestamp || null,
    type: String(event.type || "UNKNOWN").slice(0, 80),
    severity: String(event.severity || "INFO").slice(0, 20),
    state: event.state || null,
    details: event.details || null
  });
  if (list.length > 2000) list.splice(0, list.length - 2000);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  try {
    if (req.method !== "POST") return json(res, 405, {error:"method_not_allowed"});

    const data = await body(req);

    if (req.url === "/api/exam/start") {
      const a = newAttempt(data);
      return json(res, 201, {
        attemptId: a.id,
        sessionToken: a.sessionToken,
        serverTime: Date.now(),
        endsAt: a.endsAt
      });
    }

    const a = getAttempt(req);
    if (!a) return json(res, 401, {error:"invalid_attempt"});
    if (a.status !== "ACTIVE") return json(res, 409, {error:"attempt_not_active", status:a.status});

    if (req.url === "/api/exam/heartbeat") {
      const token = String(data.sessionToken || "");
      if (!crypto.timingSafeEqual(Buffer.from(token), Buffer.from(a.sessionToken))) {
        a.status = "SESSION_INVALID";
        return json(res, 409, {error:"invalid_session"});
      }
      const now = Date.now();
      if (now > a.endsAt) {
        a.status = "EXPIRED";
        return json(res, 409, {error:"time_expired"});
      }
      a.lastHeartbeat = now;
      appendEvent(a, data.event);
      return json(res, 200, {
        ok:true,
        serverTime:now,
        endsAt:a.endsAt,
        remainingMs:Math.max(0, a.endsAt-now)
      });
    }

    if (req.url === "/api/exam/event") {
      appendEvent(a, data.event);
      return json(res, 202, {ok:true});
    }

    if (req.url === "/api/exam/finish") {
      appendEvent(a, data.event);
      a.status = "FINISHED";
      return json(res, 200, {ok:true, serverTime:Date.now()});
    }

    if (req.url === "/api/exam/status") {
      return json(res, 200, {
        attemptId:a.id,
        status:a.status,
        serverTime:Date.now(),
        endsAt:a.endsAt,
        lastHeartbeat:a.lastHeartbeat
      });
    }

    return json(res, 404, {error:"not_found"});
  } catch (e) {
    return json(res, 400, {error:"bad_request", message:e.message});
  }
});

setInterval(() => {
  const now = Date.now();
  for (const a of ATTEMPTS.values()) {
    if (a.status === "ACTIVE" && now - a.lastHeartbeat > SESSION_TTL_MS) {
      a.status = "HEARTBEAT_TIMEOUT";
      appendEvent(a, {
        type:"HEARTBEAT_TIMEOUT",
        severity:"CRITICAL",
        timestamp:new Date().toISOString(),
        seq:a.seq + 1
      });
    }
  }
}, 3000);

server.listen(PORT, () => console.log(`Exam integrity API listening on :${PORT}`));
