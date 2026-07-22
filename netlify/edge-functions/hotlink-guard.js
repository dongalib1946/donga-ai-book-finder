export default async function hotlinkGuard(request) {
  const url = new URL(request.url);
  const referer = request.headers.get('referer') || '';
  const trustedAssetReferrerHosts = new Set([
    'library.donga.ac.kr',
  ]);
  const isStaticAsset = url.pathname.startsWith('/img/')
    || url.pathname.endsWith('.js')
    || url.pathname.endsWith('.css');

  if (referer) {
    try {
      const referrerHost = new URL(referer).hostname.toLowerCase();
      if (referrerHost === url.hostname.toLowerCase()) return;
      if (isStaticAsset && trustedAssetReferrerHosts.has(referrerHost)) return;
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
