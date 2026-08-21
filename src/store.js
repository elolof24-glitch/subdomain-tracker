import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.DB_PATH || './data/monitor.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS domains (
    domain TEXT PRIMARY KEY,
    webhook TEXT,
    created_at TEXT NOT NULL,
    last_scan TEXT
  );

  CREATE TABLE IF NOT EXISTS observations (
    domain TEXT NOT NULL,
    hostname TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    PRIMARY KEY (domain, hostname)
  );
`);

export function addDomain(domain, webhook = null) {
  return db.prepare(`
    INSERT INTO domains (domain, webhook, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET
      webhook = COALESCE(excluded.webhook, domains.webhook)
  `).run(domain, webhook, new Date().toISOString());
}

export function removeDomain(domain) {
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM observations WHERE domain = ?').run(domain);
    return db.prepare('DELETE FROM domains WHERE domain = ?').run(domain);
  });

  return transaction();
}

export function getDomain(domain) {
  return db.prepare('SELECT * FROM domains WHERE domain = ?').get(domain);
}

export function listDomains() {
  return db.prepare('SELECT * FROM domains ORDER BY domain ASC').all();
}

export function setLastScan(domain) {
  return db.prepare(
    'UPDATE domains SET last_scan = ? WHERE domain = ?'
  ).run(new Date().toISOString(), domain);
}

export function getObserved(domain) {
  const rows = db.prepare(
    'SELECT hostname FROM observations WHERE domain = ?'
  ).all(domain);

  return new Set(rows.map(row => row.hostname));
}

export function saveObserved(domain, hostnames) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO observations (domain, hostname, first_seen)
    VALUES (?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const hostname of hostnames) {
      insert.run(domain, hostname, new Date().toISOString());
    }
  });

  transaction();
}
