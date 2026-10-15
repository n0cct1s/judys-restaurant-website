/**
 * Judy's newsletter API for Cloudflare Workers + KV.
 * Serves the same paths the static site already calls.
 */

const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });

const corsHeaders = (request, env) => {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(
    env.CORS_ORIGINS ||
      "https://judysvb.com,https://www.judysvb.com,https://n0cct1s.github.io,http://127.0.0.1:3000,http://localhost:3000"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
};

const isValidEmail = (email) => {
  const value = String(email || "").trim().toLowerCase();
  if (!value || value.length > 254 || value.includes("..")) return false;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
    value
  );
};

const LIST_KEY = "subscribers:v1";
const SESSION_PREFIX = "session:";
const SESSION_MS = 1000 * 60 * 60 * 2;

const readList = async (env) => {
  const raw = await env.SUBSCRIBERS.get(LIST_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeList = async (env, list) => {
  await env.SUBSCRIBERS.put(LIST_KEY, JSON.stringify(list));
};

const adminPassword = (env) =>
  String(env.ADMIN_PASSWORD || env.DEFAULT_ADMIN_PASSWORD || "judys-admin");

const newToken = () => crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

const getSession = async (env, request) => {
  const auth = request.headers.get("Authorization") || "";
  const cookie = request.headers.get("Cookie") || "";
  let token = "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    token = auth.slice(7).trim();
  } else {
    const match = cookie.match(/(?:^|;\s*)judys_admin=([^;]+)/);
    if (match) token = decodeURIComponent(match[1]);
  }
  if (!token) return null;
  const raw = await env.SUBSCRIBERS.get(SESSION_PREFIX + token);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (!session?.exp || Date.now() > session.exp) {
      await env.SUBSCRIBERS.delete(SESSION_PREFIX + token);
      return null;
    }
    return { token, ...session };
  } catch {
    return null;
  }
};

const requireAdmin = async (env, request) => {
  const session = await getSession(env, request);
  if (!session) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
  return session;
};

async function handleSubscribe(request, env) {
  const body = await request.json().catch(() => ({}));
  if (String(body.company || "").trim()) {
    return json({
      ok: true,
      message: "Thanks for signing up! Watch your inbox for a $10 coupon.",
    });
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return json({ error: "Please enter a valid email address." }, 400);
  }
  const sourceRaw = String(body.source || "website").trim().toLowerCase();
  const source = ["website", "coupon", "newsletter"].includes(sourceRaw)
    ? sourceRaw
    : "website";
  const list = await readList(env);
  const existing = list.find((row) => row.email === email);
  const now = new Date().toISOString();
  if (existing) {
    if (existing.status === "subscribed") {
      return json({ error: "This email is already subscribed." }, 409);
    }
    existing.status = "subscribed";
    existing.source = source;
    existing.updated_at = now;
  } else {
    list.unshift({
      id: Date.now(),
      email,
      status: "subscribed",
      source,
      created_at: now,
      updated_at: now,
    });
  }
  await writeList(env, list);
  return json({
    ok: true,
    message: "Thanks for signing up! Watch your inbox for a $10 coupon.",
    status: "subscribed",
  });
}

async function handleUnsubscribe(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return json({ error: "Please enter a valid email address." }, 400);
  }
  const list = await readList(env);
  const existing = list.find((row) => row.email === email);
  if (!existing) {
    return json({ error: "Email not found." }, 404);
  }
  existing.status = "unsubscribed";
  existing.updated_at = new Date().toISOString();
  await writeList(env, list);
  return json({
    ok: true,
    message: "You have been unsubscribed. You will no longer receive our emails.",
    subscriber: { email: existing.email, status: existing.status },
  });
}

async function handleAdminLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  if (String(body.password || "") !== adminPassword(env)) {
    return json({ error: "Incorrect password." }, 401);
  }
  const token = newToken();
  const exp = Date.now() + SESSION_MS;
  await env.SUBSCRIBERS.put(
    SESSION_PREFIX + token,
    JSON.stringify({ exp }),
    { expirationTtl: Math.ceil(SESSION_MS / 1000) }
  );
  return json(
    { ok: true, expiresInMs: SESSION_MS, token },
    200,
    {
      "Set-Cookie": `judys_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(
        SESSION_MS / 1000
      )}`,
    }
  );
}

async function handleAdminLogout(request, env) {
  const session = await getSession(env, request);
  if (session?.token) {
    await env.SUBSCRIBERS.delete(SESSION_PREFIX + session.token);
  }
  return json(
    { ok: true },
    200,
    {
      "Set-Cookie": "judys_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    }
  );
}

async function handleAdminMe(request, env) {
  const session = await getSession(env, request);
  return json({
    authenticated: Boolean(session),
    expiresInMs: session ? Math.max(0, session.exp - Date.now()) : 0,
    mailConfigured: false,
  });
}

async function handleListSubscribers(request, env) {
  await requireAdmin(env, request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "";
  const q = String(url.searchParams.get("q") || "")
    .trim()
    .toLowerCase();
  let list = await readList(env);
  if (status) list = list.filter((row) => row.status === status);
  if (q) list = list.filter((row) => row.email.includes(q));
  const all = await readList(env);
  const counts = { subscribed: 0, unsubscribed: 0, bounced: 0, total: all.length };
  for (const row of all) {
    if (counts[row.status] != null) counts[row.status] += 1;
  }
  return json({ ok: true, subscribers: list, counts });
}

async function handlePatchSubscriber(request, env, id) {
  await requireAdmin(env, request);
  const body = await request.json().catch(() => ({}));
  const list = await readList(env);
  const row = list.find((item) => String(item.id) === String(id));
  if (!row) return json({ error: "Not found." }, 404);
  if (body.status) row.status = String(body.status);
  row.updated_at = new Date().toISOString();
  await writeList(env, list);
  return json({ ok: true, subscriber: row });
}

async function handleDeleteSubscriber(request, env, id) {
  await requireAdmin(env, request);
  const list = await readList(env);
  const next = list.filter((item) => String(item.id) !== String(id));
  if (next.length === list.length) return json({ error: "Not found." }, 404);
  await writeList(env, next);
  return json({ ok: true });
}

async function handleCampaignsList(request, env) {
  await requireAdmin(env, request);
  return json({ ok: true, campaigns: [] });
}

async function handleCampaignSend(request, env) {
  await requireAdmin(env, request);
  return json(
    {
      error:
        "Campaign email sending is not enabled on the Cloudflare Worker yet. Subscriber list still works — use SMTP Node server later to send.",
    },
    501
  );
}

async function handleHealth() {
  return json({ ok: true, mailConfigured: false, runtime: "cloudflare-worker" });
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      let response;
      if (path === "/api/health" && request.method === "GET") {
        response = await handleHealth();
      } else if (path === "/api/newsletter/subscribe" && request.method === "POST") {
        response = await handleSubscribe(request, env);
      } else if (path === "/api/newsletter/unsubscribe" && request.method === "POST") {
        response = await handleUnsubscribe(request, env);
      } else if (path === "/api/admin/login" && request.method === "POST") {
        response = await handleAdminLogin(request, env);
      } else if (path === "/api/admin/logout" && request.method === "POST") {
        response = await handleAdminLogout(request, env);
      } else if (path === "/api/admin/me" && request.method === "GET") {
        response = await handleAdminMe(request, env);
      } else if (path === "/api/admin/subscribers" && request.method === "GET") {
        response = await handleListSubscribers(request, env);
      } else if (path.startsWith("/api/admin/subscribers/") && request.method === "PATCH") {
        response = await handlePatchSubscriber(request, env, path.split("/").pop());
      } else if (path.startsWith("/api/admin/subscribers/") && request.method === "DELETE") {
        response = await handleDeleteSubscriber(request, env, path.split("/").pop());
      } else if (path === "/api/admin/campaigns" && request.method === "GET") {
        response = await handleCampaignsList(request, env);
      } else if (path === "/api/admin/campaigns/send" && request.method === "POST") {
        response = await handleCampaignSend(request, env);
      } else {
        response = json({ error: "Not found." }, 404);
      }

      const outHeaders = new Headers(response.headers);
      for (const [k, v] of Object.entries(headers)) outHeaders.set(k, v);
      return new Response(response.body, {
        status: response.status,
        headers: outHeaders,
      });
    } catch (err) {
      const status = err.status || 500;
      const out = json({ error: err.message || "Server error." }, status);
      const outHeaders = new Headers(out.headers);
      for (const [k, v] of Object.entries(headers)) outHeaders.set(k, v);
      return new Response(out.body, { status, headers: outHeaders });
    }
  },
};
