export async function searchDotdb(keyword) {
  const url = new URL('https://api.dotdb.com/v2/search');

  url.searchParams.set('keyword', keyword);
  url.searchParams.set('position', 'end');

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${process.env.DOTDB_API_KEY}`
    }
  });

  if (!response.ok) {
    throw new Error(`DotDB error: ${response.status}`);
  }

  const result = await response.json();

  const domains = JSON.stringify(result)
    .match(/[a-z0-9-]+\\.[a-z]{2,}/gi) || [];

  return [...new Set(domains)].sort();
}
