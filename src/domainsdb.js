const requestTimeoutMs = 30000;

const allowedTlds = new Set([
  'com',
  'net',
  'org',
  'io',
  'xyz',
  'fun',
  'fi',
  'finance',
  'fund',
  'exchange',
  'money',
  'cash',
  'co',
  'me',
  'gg',
  'run',
  'live',
  'website',
  'social',
  'solutions',
  'pro',
  'vip',
  'dao',
  'defi',
  'web3',
  'wallet',
  'blockchain',
  'chain'
]);

function normalizeDomain(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^\*\./, '')
    .replace(/\.$/, '');
}

function getTld(domain) {
  return domain.split('.').at(-1) || '';
}

function isValidDomain(value) {
  return (
    value &&
    value.includes('.') &&
    !value.includes(' ') &&
    !value.includes('..') &&
    /^[a-z0-9.-]+$/.test(value)
  );
}

function isAllowedDomain(domain) {
  return allowedTlds.has(getTld(domain));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'user-agent': 'subdomain-tracker/1.0'
        }
      });

      if (response.status === 429 && attempt < attempts) {
        await sleep(attempt * 3000);
        continue;
      }

      if (!response.ok) {
        throw new Error(`crt.sh returned HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt === attempts) {
        if (error.name === 'AbortError') {
          throw new Error('crt.sh request timed out');
        }
        throw error;
      }

      await sleep(attempt * 1500);
    } finally {
      clearTimeout(timeout);
    }
  }

  return [];
}

export async function searchDotdb(keyword) {
  const cleanedKeyword = String(keyword || '').trim().toLowerCase();

  if (!/^[a-z0-9-]{1,63}$/.test(cleanedKeyword)) {
    throw new Error(
      'Use a keyword containing only letters, numbers, or hyphens.'
    );
  }

  const url = new URL('https://crt.sh/');
  url.searchParams.set('q', `%25${cleanedKeyword}%25`);
  url.searchParams.set('output', 'json');

  const records = await fetchJson(url);
  const domains = new Set();

  for (const record of records) {
    const names = String(record.name_value || '').split(/\r?\n/);

    for (const name of names) {
      const domain = normalizeDomain(name);

      if (
        isValidDomain(domain) &&
        domain.includes(cleanedKeyword) &&
        isAllowedDomain(domain)
      ) {
        domains.add(domain);
      }
    }
  }

  return [...domains].sort();
}
