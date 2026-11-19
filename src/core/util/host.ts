/** A URL's hostname, lowercased and without a leading `www.`; null when it isn't an http(s) URL. */
export function urlHost(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return host === '' ? null : host;
}

/** True when `host` is `domain` or one of its subdomains: us.jooble.org is on jooble.org. */
export function hostIsOn(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** True when the URL's host is on one of `domains`. A domain in the path or query doesn't count. */
export function urlIsOn(url: string, domains: readonly string[]): boolean {
  const host = urlHost(url);
  return host !== null && domains.some((domain) => hostIsOn(host, domain));
}
