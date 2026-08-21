const apiKey = process.env.WHOISFREAKS_API_KEY;

if (!apiKey) {
  throw new Error('WHOISFREAKS_API_KEY is required');
}

export async function searchDotdb(keyword) {
  const url = new URL(
    'https://api.whoisfreaks.com/v1.0/whois'
  );

  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('whois', 'reverse');
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('format', 'json');
  url.searchParams.set('page', '1');

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

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('WhoisFreaks returned invalid JSON');
  }

  const domainPattern = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/gi;
  const matches = JSON.stringify(data).match(domainPattern) || [];
  const wanted = keyword.toLowerCase();

  return [...new Set(
    matches
      .map(domain => domain.toLowerCase().replace(/[),.;:'"\]}]+$/, ''))
      .filter(domain => domain.includes(wanted))
  )].sort();
}
