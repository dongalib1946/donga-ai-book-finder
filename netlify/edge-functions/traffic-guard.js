const PASS_THROUGH_PATHS = new Set([
  '/robots.txt',
  '/favicon.svg',
]);

export default async function trafficGuard(request) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS' || PASS_THROUGH_PATHS.has(url.pathname)) {
    return;
  }

  return new Response(null, {
    status: 204,
    headers: {
      'cache-control': 'public, max-age=60',
      'x-robots-tag': 'noindex, nofollow, noarchive',
      'x-traffic-guard': 'automated-client',
    },
  });
}
