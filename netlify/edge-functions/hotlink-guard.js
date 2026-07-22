export default async function hotlinkGuard(request) {
  const url = new URL(request.url);
  const referer = request.headers.get('referer') || '';

  if (referer) {
    try {
      if (new URL(referer).hostname === url.hostname) return;
    } catch (error) {
      // Malformed referrers are treated as cross-site.
    }
  }

  return new Response(null, {
    status: 204,
    headers: {
      'cache-control': 'public, max-age=300',
      'x-robots-tag': 'noindex, nofollow, noarchive',
      'x-hotlink-guard': 'blocked',
    },
  });
}
