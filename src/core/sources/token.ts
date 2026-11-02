/** Board slugs are a single URL path segment. Reject anything that could change the path. */
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export function boardToken(token: string): string {
  if (!TOKEN.test(token)) {
    throw new Error(`invalid board token "${token}"`);
  }
  return token;
}
