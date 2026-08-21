const dotdbApiKey = process.env.DOTDB_API_KEY;

if (!dotdbApiKey) {
  throw new Error('DOTDB_API_KEY is required for /find');
}

export async function searchDotdb({
  keyword,
  position = 'any',
  includeSuffix = ''
}) {
  const params = new URLSearchParams({
    keyword,
    position
  });

  if (includeSuffix) {
    params.set('include_suffix', includeSuffix);
  }

  const response = await fetch(
    `https://api.dotdb.com/v2/search?${params.toString()}`,
    {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${dotdbApiKey}`,
        'user-agent': 'subdomain-tracker/1.0'
      }
    }
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`DotDB returned HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`DotDB returned invalid JSON: ${body.slice(0, 200)}`);
  }
}
