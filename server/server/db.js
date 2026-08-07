import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "judys.db");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'subscribed'
      CHECK (status IN ('subscribed', 'unsubscribed', 'bounced')),
    source TEXT DEFAULT 'website',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    target_status TEXT NOT NULL,
    recipient_count INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL
  );
`);

export const STATUSES = ["subscribed", "unsubscribed", "bounced"];

export function nowIso() {
  return new Date().toISOString();
}

export function listSubscribers({ status, q } = {}) {
  const clauses = [];
  const params = {};

  if (status && STATUSES.includes(status)) {
    clauses.push("status = $status");
    params.$status = status;
  }

  if (q) {
    clauses.push("email LIKE $q");
    params.$q = `%${q}%`;
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(
      `SELECT id, email, status, source, created_at, updated_at
       FROM subscribers
       ${where}
       ORDER BY datetime(created_at) DESC`
    )
    .all(params);
}

export function getSubscriberCounts() {
  const rows = db
    .prepare("SELECT status, COUNT(*) AS count FROM subscribers GROUP BY status")
    .all();
  const counts = { subscribed: 0, unsubscribed: 0, bounced: 0, total: 0 };
  for (const row of rows) {
    counts[row.status] = row.count;
    counts.total += row.count;
  }
  return counts;
}

export function upsertSubscriber({ email, name = "", source = "website" }) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    const err = new Error("Please enter a valid email address.");
    err.code = "INVALID_EMAIL";
    throw err;
  }

  const existing = db
    .prepare("SELECT * FROM subscribers WHERE email = ?")
    .get(normalized);
  const stamp = nowIso();

  if (existing) {
    if (existing.status === "subscribed") {
      const err = new Error("This email is already subscribed.");
      err.code = "ALREADY_SUBSCRIBED";
      throw err;
    }

    db.prepare(
      `UPDATE subscribers
       SET status = 'subscribed',
           name = COALESCE(NULLIF($name, ''), name),
           source = $source,
           updated_at = $stamp
       WHERE id = $id`
    ).run({
      $id: existing.id,
      $name: String(name || "").trim(),
      $source: source,
      $stamp: stamp,
    });

    return db.prepare("SELECT * FROM subscribers WHERE id = ?").get(existing.id);
  }

  const info = db
    .prepare(
      `INSERT INTO subscribers (email, name, status, source, notes, created_at, updated_at)
       VALUES ($email, $name, 'subscribed', $source, '', $stamp, $stamp)`
    )
    .run({
      $email: normalized,
      $name: String(name || "").trim(),
      $source: source,
      $stamp: stamp,
    });

  return db.prepare("SELECT * FROM subscribers WHERE id = ?").get(info.lastInsertRowid);
}

export function updateSubscriber(id, { name, status, notes }) {
  const current = db.prepare("SELECT * FROM subscribers WHERE id = ?").get(id);
  if (!current) return null;

  if (status && !STATUSES.includes(status)) {
    const err = new Error("Invalid status.");
    err.code = "INVALID_STATUS";
    throw err;
  }

  db.prepare(
    `UPDATE subscribers
     SET name = $name,
         status = $status,
         notes = $notes,
         updated_at = $stamp
     WHERE id = $id`
  ).run({
    $id: id,
    $name: name != null ? String(name).trim() : current.name,
    $status: status || current.status,
    $notes: notes != null ? String(notes) : current.notes,
    $stamp: nowIso(),
  });

  return db.prepare("SELECT * FROM subscribers WHERE id = ?").get(id);
}

export function deleteSubscriber(id) {
  return db.prepare("DELETE FROM subscribers WHERE id = ?").run(id).changes > 0;
}

export function unsubscribeByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    const err = new Error("Please enter a valid email address.");
    err.code = "INVALID_EMAIL";
    throw err;
  }

  const existing = db
    .prepare("SELECT * FROM subscribers WHERE email = ?")
    .get(normalized);

  if (!existing) {
    const err = new Error("We could not find that email on our list.");
    err.code = "NOT_FOUND";
    throw err;
  }

  if (existing.status === "unsubscribed") {
    return existing;
  }

  db.prepare(
    `UPDATE subscribers
     SET status = 'unsubscribed', updated_at = ?
     WHERE id = ?`
  ).run(nowIso(), existing.id);

  return db.prepare("SELECT * FROM subscribers WHERE id = ?").get(existing.id);
}

export function getSubscribersByStatus(status) {
  if (!STATUSES.includes(status)) return [];
  return db
    .prepare(
      `SELECT id, email, status
       FROM subscribers
       WHERE status = ?
       ORDER BY email ASC`
    )
    .all(status);
}

export function createCampaign({ subject, body, targetStatus, recipientCount }) {
  const info = db
    .prepare(
      `INSERT INTO campaigns
       (subject, body, target_status, recipient_count, sent_count, failed_count, status, created_at)
       VALUES ($subject, $body, $targetStatus, $recipientCount, 0, 0, 'sending', $stamp)`
    )
    .run({
      $subject: subject,
      $body: body,
      $targetStatus: targetStatus,
      $recipientCount: recipientCount,
      $stamp: nowIso(),
    });
  return info.lastInsertRowid;
}

export function finishCampaign(id, { sentCount, failedCount }) {
  db.prepare(
    `UPDATE campaigns
     SET sent_count = $sentCount,
         failed_count = $failedCount,
         status = 'sent'
     WHERE id = $id`
  ).run({
    $id: id,
    $sentCount: sentCount,
    $failedCount: failedCount,
  });
}

export function listCampaigns(limit = 20) {
  return db
    .prepare(
      `SELECT id, subject, target_status, recipient_count, sent_count, failed_count, status, created_at
       FROM campaigns
       ORDER BY datetime(created_at) DESC
       LIMIT ?`
    )
    .all(limit);
}

export default db;
