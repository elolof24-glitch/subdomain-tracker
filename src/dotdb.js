const apiKey = process.env.DOMAINSDB_API_KEY;

if (!apiKey) {
  throw new Error('DOMAINSDB_API_KEY is required');
}

export async function searchDotdb(keyword) {
  const url = new URL(
    'https://api.domainsdb.info/v1/domains/search'
  );

  url.searchParams.set('domain', keyword);
  url.searchParams.set('limit', '100');

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${apiKey}`
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `DomainsDB error: ${response.status} — ${text.slice(0, 200)}`
    );
  }

  const result = JSON.parse(text);

  const domains = Array.isArray(result.domains)
    ? result.domains
    : [];

  return domains
    .map(item => {
      if (typeof item === 'string') return item;
      return item.domain || item.name || '';
    })
    .filter(domain => domain.includes('.'))
    .map(domain => domain.toLowerCase())
    .filter((domain, index, all) => all.indexOf(domain) === index)
    .sort();
}
