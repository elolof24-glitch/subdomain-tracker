import { getObserved, saveObserved, setLastScan } from './store.js';

const userAgent = process.env.USER_AGENT || 'subdomain-tracker/1.0';
const requestTimeoutMs = Math.max(
  10000,
  Number(process.env.CT_REQUEST_TIMEOUT_MS || 30000)
);
const maxAttempts = Math.max(1, Number(process.env.CT_MAX_ATTEMPTS || 3));
const retryBaseMs = Math.max(2000, Number(process.env.CT_RETRY_BASE_MS || 5000));

export function normalizeDomain(value) {
  if (typeof value !== 'string') {
    throw new Error('Domain must be a string');
  }

  const domain = value
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .replace(/\.$/, '');

  if (!domain || domain.includes(' ') || !domain.includes('.')) {
    throw new Error(`Invalid domain: ${value}`);
  }

  return domain;
}

function extractHostnames(rows, domain) {
  if (!Array.isArray(rows)) {
    throw new Error('Certificate Transparency returned a non-array response');
  }

  const normalizedDomain = domain.toLowerCase();
  const suffix = `.${normalizedDomain}`;
  const hostnames = new Set();

  for (const row of rows) {
    const values = String(row?.name_value || '').split(/[\s,]+/);

    for (let hostname of values) {
      hostname = hostname
        .toLowerCase()
        .trim()
        .replace(/^\*\./, '')
        .replace(/\.$/, '');

      if (
        hostname &&
        hostname !== normalizedDomain &&
        hostname.endsWith(suffix) &&
        !hostname.includes('..')
      ) {
        hostnames.add(hostname);
      }
    }
  }

  return [...hostnames].sort();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function retryDelay(attempt, retryAfterHeader) {
  const retryAfterSeconds = Number(retryAfterHeader);

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 60000);
  }

  return Math.min(retryBaseMs * 2 ** (attempt - 1), 60000);
}

async function requestCtJson(url, domain) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'user-agent': userAgent,
          accept: 'application/json'
        }
      });

      const body = await response.text();

      if (response.ok) {
        try {
          return JSON.parse(body);
        } catch {
          throw new Error(
            `crt.sh returned invalid JSON: ${body.slice(0, 200)}`
          );
        }
      }

      const error = new Error(
        `crt.sh returned HTTP ${response.status}: ${body.slice(0, 200)}`
      );
      error.status = response.status;
      error.retryAfter = response.headers.get('retry-after');
      throw error;
    } catch (error) {
      lastError = error.name === 'AbortError'
        ? new Error(`request timed out after ${requestTimeoutMs}ms`)
        : error;

      const status = lastError.status;
      const retryable = !status || isRetryableStatus(status);

      console.warn(
        `CT request for ${domain} failed ` +
        `(attempt ${attempt}/${maxAttempts}): ${lastError.message}`
      );

      if (!retryable || attempt === maxAttempts) {
        break;
      }

      await sleep(retryDelay(attempt, lastError.retryAfter));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    `Certificate Transparency unavailable for ${domain} after ` +
    `${maxAttempts} attempt(s): ${lastError?.message || 'unknown error'}`
  );
}

export async function queryCertificateTransparency(domain) {
  domain = normalizeDomain(domain);

  const query = encodeURIComponent(`%.${domain}`);
  const url = `https://crt.sh/?q=${query}&output=json`;
  const rows = await requestCtJson(url, domain);

  return extractHostnames(rows, domain);
}

export async function scanDomain(domain, notify) {
  domain = normalizeDomain(domain);

  const hostnames = await queryCertificateTransparency(domain);
  const observed = getObserved(domain);
  const fresh = hostnames.filter(hostname => !observed.has(hostname));

  saveObserved(domain, hostnames);
  setLastScan(domain);

  if (fresh.length > 0 && typeof notify === 'function') {
    await notify({ domain, hostnames: fresh });
  }

  return {
    domain,
    total: hostnames.length,
    fresh,
    hostnames
  };
}
