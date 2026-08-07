import path from "node:path";
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

app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    name: "judys.sid",
    secret: process.env.SESSION_SECRET || "judys-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_MS,
      secure: process.env.NODE_ENV === "production",
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

    const subscriber = upsertSubscriber({
      email: req.body.email,
      source: "website",
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
