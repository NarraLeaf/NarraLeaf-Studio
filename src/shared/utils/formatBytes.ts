/**
 * Bytes as a short human-readable size.
 *
 * Binary units (1024), because every number this formats comes from a filesystem, and one decimal
 * place, because a cache listing is read at a glance rather than reconciled. A GB tier exists
 * because the electron-builder cache genuinely reaches it - "4812.3 MB" is a number nobody parses.
 *
 * Not localized: the units are the same three letters in every locale Studio ships, and a
 * translated "字节" next to a decimal point reads worse than "B".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
