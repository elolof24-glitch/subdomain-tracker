import { getObserved, saveObserved, setLastScan } from './store.js';

const userAgent = process.env.USER_AGENT || 'subdomain-tracker/1.0';

export function normalizeDomain(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/\.$/, '');
}

function extractHostnames(rows, domain) {
  const suffix = `.${domain}`;
  const hostnames = new Set();

  for (const row of rows) {
    const values = String(row.name_value || '').split(/\s+/);

    for (let hostname of values) {
      hostname = hostname
        .toLowerCase()
        .replace(/^\*\./, '')
        .replace(/\.$/, '');

      if (hostname !== domain && hostname.endsWith(suffix)) {
        hostnames.add(hostname);
      }
    }
  }

  return [...hostnames].sort();
}

export async function queryCertificateTransparency(domain) {
  const url = `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': userAgent,
        accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`crt.sh returned HTTP ${response.status}`);
    }

    return extractHostnames(await response.json(), domain);
  } finally {
    clearTimeout(timeout);
  }
}

export async function scanDomain(domain, notify) {
  domain = normalizeDomain(domain);

  const hostnames = await queryCertificateTransparency(domain);
  const observed = getObserved(domain);
  const fresh = hostnames.filter(hostname => !observed.has(hostname));

  saveObserved(domain, hostnames);
  setLastScan(domain);

  if (fresh.length > 0) {
    await notify({ domain, hostnames: fresh });
  }

  return {
    domain,
    total: hostnames.length,
    fresh
  };
}
