const apiKey = process.env.DOMAINSDB_API_KEY;

export async function searchDotdb(keyword) {
  const url = new URL(
    'https://api.domainsdb.info/v1/domains/search'
  );

  url.searchParams.set('domain', keyword);
  url.searchParams.set('limit', '100');
  url.searchParams.set('isDead', 'false');

  if (apiKey) {
    url.searchParams.set('api_key', apiKey);
  }

  const response = await fetch(url, {
    headers: {
      accept: 'application/json'
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `DomainsDB error: ${response.status} — ${text.slice(0, 300)}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('DomainsDB returned invalid JSON');
  }

  const domains = Array.isArray(data.domains)
    ? data.domains
    : [];

  return domains
    .map(item => {
      if (typeof item === 'string') return item;
      return item.domain || '';
    })
    .filter(Boolean)
    .map(domain => domain.toLowerCase())
    .filter((domain, index, all) => all.indexOf(domain) === index)
    .sort();
}
