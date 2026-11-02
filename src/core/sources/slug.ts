/** Lowercase hyphenated token. Used for board probes and search-source company rows. */
export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    // biome-ignore lint/suspicious/noMisleadingCharacterClass: stripping combining marks after NFKD
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'unknown';
}
