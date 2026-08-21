import Database from 'better-sqlite3';

const databasePath = process.env.DATABASE_PATH || '/data/subdomain-tracker.sqlite';
const db = new Database(databasePath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS domains (
    domain TEXT PRIMARY KEY,
    last_scan TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS observed_hostnames (
    domain TEXT NOT NULL,
    hostname TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (domain, hostname),
    FOREIGN KEY (domain) REFERENCES domains(domain) ON DELETE CASCADE
  );
`);

const domainColumns = db.prepare(`PRAGMA table_info(domains)`).all();
const hasEnabledColumn = domainColumns.some(column => column.name === 'enabled');

if (!hasEnabledColumn) {
  db.exec(`
    ALTER TABLE domains
    ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1
  `);
}

const upsertDomain = db.prepare(`
  INSERT INTO domains (domain, last_scan, enabled)
  VALUES (?, ?, 1)
  ON CONFLICT(domain) DO UPDATE SET
    last_scan = COALESCE(excluded.last_scan, domains.last_scan),
    enabled = 1
`);

export function addDomain(domain) {
  upsertDomain.run(domain, null);
}

export function getDomain(domain) {
  return db.prepare(`
    SELECT *
    FROM domains
    WHERE domain = ? AND enabled = 1
  `).get(domain);
}

export function listDomains() {
  return db.prepare(`
    SELECT domain, last_scan
    FROM domains
    WHERE enabled = 1
    ORDER BY domain
  `).all();
}

export function removeDomain(domain) {
  return db.prepare(`
    UPDATE domains
    SET enabled = 0
    WHERE domain = ? AND enabled = 1
  `).run(domain);
}

export function getObserved(domain) {
  const rows = db.prepare(`
    SELECT hostname
    FROM observed_hostnames
    WHERE domain = ?
  `).all(domain);

  return new Set(rows.map(row => row.hostname));
}

const saveHostnamesTransaction = db.transaction((domain, hostnames, timestamp) => {
  upsertDomain.run(domain, null);

  const statement = db.prepare(`
    INSERT INTO observed_hostnames (domain, hostname, first_seen, last_seen)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(domain, hostname) DO UPDATE SET
      last_seen = excluded.last_seen
  `);

  for (const hostname of hostnames) {
    statement.run(domain, hostname, timestamp, timestamp);
  }
});

export function saveObserved(domain, hostnames) {
  const timestamp = new Date().toISOString();
  saveHostnamesTransaction(domain, hostnames, timestamp);
}

export function setLastScan(domain) {
  db.prepare(`
    UPDATE domains
    SET last_scan = ?
    WHERE domain = ? AND enabled = 1
  `).run(new Date().toISOString(), domain);
}
