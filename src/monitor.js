import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getObserved, saveObserved, setLastScan } from './store.js';

const execFileAsync = promisify(execFile);

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

function cleanSubdomains(output, domain) {
  const suffix = `.${domain}`;

  return [...new Set(
    output
      .split(/\r?\n/)
      .map(value => value.trim().toLowerCase())
      .filter(value =>
        value &&
        value.endsWith(suffix) &&
        value !== domain &&
        !value.includes(' ') &&
        !value.includes('..')
      )
  )].sort();
}

export async function querySubdomains(domain) {
  domain = normalizeDomain(domain);

  try {
    const { stdout, stderr } = await execFileAsync(
      'subfinder',
      [
        '-d', domain,
        '-silent',
        '-all',
        '-timeout', '30',
        '-max-time', '2'
      ],
      {
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024
      }
    );

    if (stderr?.trim()) {
      console.warn(`Subfinder warning for ${domain}: ${stderr.trim()}`);
    }

    return cleanSubdomains(stdout, domain);
  } catch (error) {
    const details = error.stderr || error.message;
    throw new Error(`Subfinder failed for ${domain}: ${details}`);
  }
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
