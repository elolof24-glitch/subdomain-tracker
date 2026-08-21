import { getObserved, saveObserved, setLastScan } from './store.js';

const userAgent = process.env.USER_AGENT || 'subdomain-tracker/1.0';
const requestTimeoutMs = Math.max(
  10000,
  Number(process.env.SUBDOMAIN_REQUEST_TIMEOUT_MS || 30000)
);
const c99ApiKey = String(process.env.C99_API_KEY || '').trim();

if (!c99ApiKey) {
  throw new Error('C99_API_KEY is required');
}

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

function extractHostnames(data, domain) {
  const suffix = `.${domain}`;
  const found = new Set();

  function add(value) {
    if (typeof value !== 'string') return;

    const cleaned = value
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .replace(/^\*\./, '')
      .replace(/\.$/, '');

    if (
      cleaned &&
      cleaned !== domain &&
      cleaned.endsWith(suffix) &&
      !cleaned.includes('..')
    ) {
      found.add(cleaned);
    }
  }

  function walk(value, key = '') {
    if (typeof value === 'string') {
      if (
        /subdomain|hostname|host|domain/i.test(key) ||
        value.toLowerCase().endsWith(suffix)
      ) {
        add(value);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(item => walk(item, key));
      return;
    }

    if (value && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) {
        walk(childValue, childKey);
      }
    }
  }

  walk(data);

  return [...found].sort();
}

async function requestC99(domain) {
  const url = new URL('https://api.c99.nl/subdomainfinder');

  url.searchParams.set('key', c99ApiKey);
  url.searchParams.set('domain', domain);
  url.searchParams.set('json', '');

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    requestTimeoutMs
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json, text/plain',
        'user-agent': userAgent
      }
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `C99 returned HTTP ${response.status}: ${text.slice(0, 300)}`
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(
        `C99 request timed out after ${requestTimeoutMs}ms`
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function querySubdomains(domain) {
  domain = normalizeDomain(domain);

  const data = await requestC99(domain);
  const hostnames = extractHostnames(data, domain);

  if (hostnames.length === 0) {
    console.warn(
      `C99 returned no matching hostnames for ${domain}:`,
      typeof data === 'string'
        ? data.slice(0, 500)
        : JSON.stringify(data).slice(0, 500)
    );
  }

  return hostnames;
}

export async function scanDomain(domain, notify) {
  domain = normalizeDomain(domain);

  const hostnames = await querySubdomains(domain);
  const observed = getObserved(domain);
  const fresh = hostnames.filter(hostname => !observed.has(hostname));

  saveObserved(domain, hostnames);
  setLastScan(domain);

  if (fresh.length > 0 && typeof notify === 'function') {
    await notify({
      domain,
      hostnames: fresh
    });
  }

  return {
    domain,
    total: hostnames.length,
    fresh,
    hostnames
  };
}
