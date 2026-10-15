import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import dotenv from "dotenv";
import {
  STATUSES,
  createCampaign,
  deleteSubscriber,
  finishCampaign,
  getSubscriberCounts,
  getSubscribersByStatus,
  listCampaigns,
  listSubscribers,
  unsubscribeByEmail,
  updateSubscriber,
  upsertSubscriber,
} from "./db.js";
import { isMailConfigured, sendCampaignEmail } from "./mail.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "judys-admin";
const SESSION_MS = 1000 * 60 * 60 * 2; // 2 hours
const SUBSCRIBE_LIMIT = 8;
const SUBSCRIBE_WINDOW_MS = 15 * 60 * 1000;
const subscribeHits = new Map();
const CORS_ORIGINS = String(
  process.env.CORS_ORIGINS ||
    "https://judysvb.com,https://www.judysvb.com,https://n0cct1s.github.io,http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:5500,http://localhost:5500"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CROSS_SITE_COOKIES = String(process.env.COOKIE_SAMESITE || "").toLowerCase() === "none";

app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const origin = String(req.headers.origin || "");
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  return next();
});

app.use(
  session({
    name: "judys.sid",
    secret: process.env.SESSION_SECRET || "judys-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: CROSS_SITE_COOKIES ? "none" : "lax",
      maxAge: SESSION_MS,
      secure: CROSS_SITE_COOKIES || process.env.NODE_ENV === "production",
    },
  })
);

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || req.ip || req.socket?.remoteAddress || "unknown";
}

function allowSubscribe(ip) {
  const now = Date.now();
  const recent = (subscribeHits.get(ip) || []).filter(
    (t) => now - t < SUBSCRIBE_WINDOW_MS
  );
  if (recent.length >= SUBSCRIBE_LIMIT) {
    subscribeHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  subscribeHits.set(ip, recent);
  return true;
}

function requireAdmin(req, res, next) {
  if (!req.session?.isAdmin) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const loginAt = Number(req.session.loginAt || 0);
  if (!loginAt || Date.now() - loginAt > SESSION_MS) {
    return req.session.destroy(() => {
      res.status(401).json({ error: "Session expired. Please log in again." });
    });
  }

  return next();
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mailConfigured: isMailConfigured(),
  });
});

app.post("/api/newsletter/subscribe", (req, res) => {
  try {
    // Honeypot: bots fill hidden "company" field; humans leave it empty.
    if (String(req.body.company || "").trim()) {
      return res.json({
        ok: true,
        message: "Thanks for signing up! Watch your inbox for a $10 coupon.",
      });
    }

    if (!allowSubscribe(clientIp(req))) {
      return res
        .status(429)
        .json({ error: "Too many signup attempts. Please try again later." });
    }

    const sourceRaw = String(req.body.source || "website").trim().toLowerCase();
    const source = ["website", "coupon", "newsletter"].includes(sourceRaw)
      ? sourceRaw
      : "website";
    const subscriber = upsertSubscriber({
      email: req.body.email,
      source,
    });
    res.json({
      ok: true,
      message: "Thanks for signing up! Watch your inbox for a $10 coupon.",
      // Do not expose the stored row; confirmation message is enough for the UI.
      status: subscriber.status,
    });
  } catch (err) {
    const status = err.code === "ALREADY_SUBSCRIBED" ? 409 : 400;
    res.status(status).json({ error: err.message || "Unable to subscribe." });
  }
});

app.post("/api/newsletter/unsubscribe", (req, res) => {
  try {
    const subscriber = unsubscribeByEmail(req.body.email || req.query.email);
    res.json({
      ok: true,
      message: "You have been unsubscribed. You will no longer receive our emails.",
      subscriber: {
        email: subscriber.email,
        status: subscriber.status,
      },
    });
  } catch (err) {
    const status = err.code === "NOT_FOUND" ? 404 : 400;
    res.status(status).json({ error: err.message || "Unable to unsubscribe." });
  }
});

app.post("/api/admin/login", (req, res) => {
  const password = String(req.body.password || "");
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  req.session.isAdmin = true;
  req.session.loginAt = Date.now();
  res.json({ ok: true, expiresInMs: SESSION_MS });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/admin/me", (req, res) => {
  const loginAt = Number(req.session?.loginAt || 0);
  const authenticated =
    Boolean(req.session?.isAdmin) &&
    Boolean(loginAt) &&
    Date.now() - loginAt <= SESSION_MS;

  if (req.session?.isAdmin && !authenticated) {
    return req.session.destroy(() => {
      res.json({
        authenticated: false,
        mailConfigured: isMailConfigured(),
        expiresInMs: 0,
      });
    });
  }

  const expiresInMs = authenticated ? Math.max(0, SESSION_MS - (Date.now() - loginAt)) : 0;

  res.json({
    authenticated,
    mailConfigured: isMailConfigured(),
    expiresInMs,
  });
});

app.get("/api/admin/subscribers", requireAdmin, (req, res) => {
  const subscribers = listSubscribers({
    status: req.query.status,
    q: req.query.q,
  });
  res.json({
    counts: getSubscriberCounts(),
    subscribers,
    statuses: STATUSES,
  });
});

app.patch("/api/admin/subscribers/:id", requireAdmin, (req, res) => {
  try {
    const updated = updateSubscriber(Number(req.params.id), {
      name: req.body.name,
      status: req.body.status,
      notes: req.body.notes,
    });
    if (!updated) return res.status(404).json({ error: "Subscriber not found." });
    res.json({ ok: true, subscriber: updated });
  } catch (err) {
    res.status(400).json({ error: err.message || "Unable to update subscriber." });
  }
});

app.delete("/api/admin/subscribers/:id", requireAdmin, (req, res) => {
  const deleted = deleteSubscriber(Number(req.params.id));
  if (!deleted) return res.status(404).json({ error: "Subscriber not found." });
  res.json({ ok: true });
});

app.get("/api/admin/campaigns", requireAdmin, (_req, res) => {
  res.json({ campaigns: listCampaigns() });
});

app.post("/api/admin/campaigns/send", requireAdmin, async (req, res) => {
  const subject = String(req.body.subject || "").trim();
  const body = String(req.body.body || "").trim();
  // Coupons/campaigns always go to subscribed only; sending does not change group.
  const targetStatus = "subscribed";

  if (!subject || !body) {
    return res.status(400).json({ error: "Subject and message are required." });
  }

  const recipients = getSubscribersByStatus(targetStatus);
  if (!recipients.length) {
    return res.status(400).json({
      error: "No subscribers found in the subscribed group.",
    });
  }

  const campaignId = createCampaign({
    subject,
    body,
    targetStatus,
    recipientCount: recipients.length,
  });

  let sentCount = 0;
  let failedCount = 0;
  const failures = [];
  const dryRun = !isMailConfigured();
  const baseUrl = `${req.protocol}://${req.get("host")}`;

  for (const recipient of recipients) {
    try {
      const unsubUrl = `${baseUrl}/unsubscribe.html?email=${encodeURIComponent(recipient.email)}`;
      const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#222">
          <p>Hello,</p>
          ${body.includes("<") ? body : `<p>${body.replace(/\n/g, "<br>")}</p>`}
          <hr style="border:none;border-top:1px solid #ddd;margin:24px 0" />
          <p style="font-size:12px;color:#666">
            Judy's Sichuan Cuisine · Virginia Beach<br />
            <a href="${unsubUrl}">Unsubscribe</a> if you no longer want these emails.
          </p>
        </div>
      `;
      await sendCampaignEmail({
        to: recipient.email,
        subject,
        html,
        text: `${body}\n\nUnsubscribe: ${unsubUrl}`,
      });
      sentCount += 1;
    } catch (err) {
      failedCount += 1;
      failures.push({ email: recipient.email, error: err.message });
    }
  }

  finishCampaign(campaignId, { sentCount, failedCount });

  res.json({
    ok: true,
    dryRun,
    campaignId,
    recipientCount: recipients.length,
    sentCount,
    failedCount,
    failures,
    message: dryRun
      ? "SMTP is not configured, so emails were logged locally (dry run). Subscribers stay in the subscribed group."
      : `Sent to ${sentCount} of ${recipients.length} subscribed emails. Groups were not changed.`,
  });
});

const MAPS_URL = "https://maps.app.goo.gl/V5uv4d8aqbzg4jXZA";
const MAPS_PLACE_URL =
  "https://www.google.com/maps/place/Judy's+Sichuan+Cuisine/@36.8463651,-76.1293899,17z/data=!4m6!3m5!1s0x89ba950a64b7fcff:0x80e31a6816a82eb6!8m2!3d36.8463651!4d-76.1293899";
const RATING_CACHE_FILE = path.join(rootDir, "js", "google-rating.json");
const RATING_TTL_MS = 6 * 60 * 60 * 1000;
let ratingMemoryCache = null;

function readRatingFile() {
  try {
    return JSON.parse(fs.readFileSync(RATING_CACHE_FILE, "utf8"));
  } catch {
    return { rating: 4.5, reviewCount: null, mapsUrl: MAPS_URL, source: "fallback" };
  }
}

function writeRatingFile(payload) {
  try {
    fs.writeFileSync(RATING_CACHE_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
  } catch {
    // ignore write failures on read-only hosts
  }
}

function parseRatingFromHtml(html) {
  const patterns = [
    /Judy's Sichuan Cuisine[^]{0,120}?([1-5]\.\d)/i,
    /"([1-5]\.\d)"[^]{0,40}?"([0-9,]+)"[^]{0,80}?review/i,
    /aria-label="([1-5]\.\d)\s*stars?/i,
    /([1-5]\.\d)\s*stars?/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m) continue;
    const rating = Number(m[1]);
    if (rating >= 1 && rating <= 5) {
      const reviewCount = m[2] ? Number(String(m[2]).replace(/,/g, "")) : null;
      return { rating, reviewCount: Number.isFinite(reviewCount) ? reviewCount : null };
    }
  }
  return null;
}

async function fetchRatingFromPlacesApi() {
  const key = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  const findUrl = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
  findUrl.searchParams.set("input", "Judy's Sichuan Cuisine Virginia Beach");
  findUrl.searchParams.set("inputtype", "textquery");
  findUrl.searchParams.set("fields", "place_id,name");
  findUrl.searchParams.set("key", key);

  const found = await fetch(findUrl).then((r) => r.json());
  const placeId = found?.candidates?.[0]?.place_id;
  if (!placeId) return null;

  const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  detailsUrl.searchParams.set("place_id", placeId);
  detailsUrl.searchParams.set("fields", "rating,user_ratings_total,url");
  detailsUrl.searchParams.set("key", key);

  const details = await fetch(detailsUrl).then((r) => r.json());
  const rating = Number(details?.result?.rating);
  if (!Number.isFinite(rating)) return null;
  return {
    rating,
    reviewCount: details?.result?.user_ratings_total ?? null,
    mapsUrl: details?.result?.url || MAPS_URL,
    source: "places-api",
  };
}

async function fetchRatingFromMapsPage() {
  const res = await fetch(MAPS_PLACE_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const parsed = parseRatingFromHtml(html);
  if (!parsed) return null;
  return { ...parsed, mapsUrl: MAPS_URL, source: "google-maps" };
}

async function getLiveGoogleRating(force = false) {
  const now = Date.now();
  if (!force && ratingMemoryCache && now - ratingMemoryCache.fetchedAt < RATING_TTL_MS) {
    return ratingMemoryCache.data;
  }

  const fileCache = readRatingFile();
  const fileAge = fileCache.updatedAt ? now - Date.parse(fileCache.updatedAt) : Infinity;
  if (!force && Number.isFinite(fileAge) && fileAge < RATING_TTL_MS && fileCache.rating) {
    ratingMemoryCache = { fetchedAt: now, data: fileCache };
    return fileCache;
  }

  let live = null;
  try {
    live = await fetchRatingFromPlacesApi();
  } catch {
    live = null;
  }
  if (!live) {
    try {
      live = await fetchRatingFromMapsPage();
    } catch {
      live = null;
    }
  }

  const payload = {
    rating: live?.rating ?? fileCache.rating ?? 4.5,
    reviewCount: live?.reviewCount ?? fileCache.reviewCount ?? null,
    mapsUrl: live?.mapsUrl || MAPS_URL,
    source: live?.source || fileCache.source || "fallback",
    updatedAt: new Date().toISOString(),
  };
  writeRatingFile(payload);
  ratingMemoryCache = { fetchedAt: now, data: payload };
  return payload;
}

app.get("/api/google-rating", async (req, res) => {
  try {
    const force = String(req.query.refresh || "") === "1";
    const data = await getLiveGoogleRating(force);
    res.set("Cache-Control", "public, max-age=300");
    res.json({ ok: true, ...data });
  } catch (err) {
    const fallback = readRatingFile();
    res.json({ ok: true, ...fallback, source: "fallback", error: err.message });
  }
});

app.use("/admin", express.static(path.join(rootDir, "admin")));

app.use((req, res, next) => {
  const blocked = [/^\/server(\/|$)/i, /^\/data(\/|$)/i, /^\/node_modules(\/|$)/i, /\.db$/i, /\.env/i];
  if (blocked.some((re) => re.test(req.path))) {
    return res.status(404).end();
  }
  next();
});

app.use(express.static(rootDir));

app.get(/^\/admin(?:\/.*)?$/, (_req, res) => {
  res.sendFile(path.join(rootDir, "admin", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Judy's site running at http://127.0.0.1:${PORT}`);
  console.log(`Newsletter admin: http://127.0.0.1:${PORT}/admin/`);
  console.log(`Mail configured: ${isMailConfigured() ? "yes" : "no (dry-run mode)"}`);
});
