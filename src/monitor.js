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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function queryCertificateTransparency(domain) {
  const url = `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'user-agent': userAgent,
          accept: 'application/json'
        }
      });

      if (response.ok) {
        return extractHostnames(await response.json(), domain);
      }

      const retryable = [429, 500, 502, 503, 504].includes(response.status);

      if (!retryable) {
        throw new Error(`crt.sh returned HTTP ${response.status}`);
      }

      console.warn(
        `crt.sh returned HTTP ${response.status} for ${domain}; attempt ${attempt}/${maxAttempts}`
      );
    } catch (error) {
      if (attempt === maxAttempts) {
        throw new Error(
          `Certificate Transparency unavailable after ${maxAttempts} attempts: ${error.message}`
        );
      }

      console.warn(
        `crt.sh request failed for ${domain}; attempt ${attempt}/${maxAttempts}: ${error.message}`
      );
    } finally {
      clearTimeout(timeout);
    }

    await sleep(attempt * 3000);
  }

  throw new Error('Certificate Transparency request failed');
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
