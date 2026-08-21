const apiKey = process.env.WHOISFREAKS_API_KEY;

if (!apiKey) {
  throw new Error('WHOISFREAKS_API_KEY is required');
}

const blockedTlds = new Set([
  'se',
  'ru',
  'email',
  'club',
  'online',
  'video',
  'tech',
  'info',
  'shop',
  'ltd',
  'space'
]);

async function fetchPage(keyword, page) {
  const url = new URL(
    'https://api.whoisfreaks.com/v1.0/whois'
  );

  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('whois', 'reverse');
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('format', 'json');
  url.searchParams.set('page', String(page));

  const response = await fetch(url, {
    headers: {
      accept: 'application/json'
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `WhoisFreaks error: ${response.status} — ${text.slice(0, 300)}`
    );
  }

  return JSON.parse(text);
}

export async function searchDotdb(keyword) {
  const allDomains = [];
  const domainPattern =
    /(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})/gi;

  for (let page = 1; page <= 5; page++) {
    const data = await fetchPage(keyword, page);
    const matches = JSON.stringify(data).match(domainPattern) || [];

    allDomains.push(...matches);

    if (matches.length === 0) break;
  }

  const wanted = keyword.toLowerCase();

  return [...new Set(
    allDomains
      .map(domain => domain.toLowerCase())
      .filter(domain => domain.includes(wanted))
      .filter(domain => {
        const parts = domain.split('.');
        const tld = parts[parts.length - 1];
        return !blockedTlds.has(tld);
      })
  )].sort();
}
