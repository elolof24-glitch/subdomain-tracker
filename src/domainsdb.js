const apiKey = process.env.WHOISFREAKS_API_KEY;

if (!apiKey) {
  throw new Error('WHOISFREAKS_API_KEY is required');
}

export async function searchDotdb(keyword) {
  const url = new URL(
    'https://api.whoisfreaks.com/v1.0/whois'
  );

  url.searchParams.set('whois', 'reverse');
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('format', 'json');

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

  const domains = [];

  function collect(value) {
    if (typeof value === 'string') {
      if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(value)) {
        domains.push(value.toLowerCase());
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }

    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (/domain|domainName|domain_name/i.test(key)) {
          collect(item);
        } else if (Array.isArray(item) || (item && typeof item === 'object')) {
          collect(item);
        }
      }
    }
  }

  collect(data);

  return [...new Set(domains)]
    .filter(domain => domain.includes(keyword.toLowerCase()))
    .sort();
}
