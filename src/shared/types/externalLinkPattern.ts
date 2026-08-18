/**
 * Address *patterns* a plugin declares, and the match that decides one request against them.
 *
 * This is a second regime, deliberately beside the first rather than folded into it:
 *
 *  - The core **Open Link** node opens the addresses the *project's variant* declared, matched
 *    exactly on the parsed address and restricted to `http(s)` (see {@link isExternalLinkDeclared}
 *    in `./appTag`). Nothing here changes that.
 *  - A **plugin** declares patterns in `contributes.externalLinks`, the author approves them by
 *    name at install, and the plugin may then open an address matching one of *its own* patterns.
 *    Patterns take wildcards and are not restricted to `http(s)`, because the whole point is the
 *    storefront a plugin integrates with: `steam://run/480` is not an http address and no amount of
 *    project configuration makes it one.
 *
 * # Why this file is the boundary
 *
 * Raw prefix matching was refused for the core node and is refused again here, for the same reason
 * written down there: `https://store.example.com` is a *prefix* of `https://store.example.com.evil.test`,
 * because a host is a suffix-structured name and a prefix over the whole address is not a prefix
 * over the authority. So nothing below compares raw strings. Both sides are parsed, and every part
 * is compared as the structured thing it is - the host label by label, the path segment by segment.
 *
 * Comments in English per project convention.
 */

/**
 * Schemes no declaration may name, whatever it says.
 *
 * The first three are not addresses at all - they are script and inline content, and handing one to
 * `shell.openExternal` (or to `window.open`) is the classic way a "just open a link" capability
 * turns into arbitrary execution in whatever the platform decides should handle it.
 *
 * `file:` is here for a related reason that is worth stating separately, because it *is* an address:
 * the platform opener runs a file's registered handler, and for `.exe`, `.bat`, `.lnk` and friends
 * that is execution on the player's machine. A plugin that legitimately wants to show the player a
 * folder needs a capability that reveals a folder, not one that opens addresses - the install prompt
 * for those two questions cannot honestly be the same sentence.
 */
export const EXTERNAL_LINK_PATTERN_DENIED_SCHEMES: readonly string[] = [
  "javascript:",
  "data:",
  "vbscript:",
  "file:"
];

/** Whether a parsed `protocol` (`"https:"`) is one this never opens. Case-insensitive. */
export function isDeniedExternalLinkScheme(protocol: string): boolean {
  return EXTERNAL_LINK_PATTERN_DENIED_SCHEMES.includes(String(protocol ?? "").toLowerCase());
}

/**
 * One declared pattern, taken apart.
 *
 * `null` for anything that is not a pattern at all - unparseable, schemeless, a denied scheme, one
 * carrying credentials, or one whose host wears a `*` somewhere a wildcard is not a wildcard.
 */
type ParsedExternalLinkPattern = {
  /** Lowercased, with the colon: `"https:"`, `"steam:"`. */
  scheme: string;
  /** Lowercased hostname. `"*"` for the whole-authority wildcard, `""` for an opaque URL. */
  host: string;
  /** As `URL` reports it, so a default port is already gone (`https://x:443` -> `""`). */
  port: string;
  /** As `URL` reports it. Hierarchical paths start with `/`; opaque ones (`mailto:`) do not. */
  path: string;
  search: string;
  hash: string;
  /**
   * `scheme://*` and nothing else - the one form that constrains nothing below the scheme.
   *
   * It has to exist. `steam://run/480`, `steam://rungameid/480` and `steam://store/480` are
   * different *hosts* under one scheme, so an author who means "hand `steam:` addresses to Steam"
   * has no other way to say it. It is deliberately the only case where the path goes unchecked,
   * and it is legible at a glance in the install prompt, which is where it has to be understood.
   */
  wholeScheme: boolean;
};

/**
 * Whether the leading label is a wildcard, and what has to be matched after it.
 *
 * A `*` is a wildcard only as the entire first label. `*x.example.com` is not one and never becomes
 * one - it is rejected by {@link parseExternalLinkPattern} rather than quietly read as the literal
 * host `*x.example.com`, which would be a declaration that looks like it grants something and
 * grants nothing.
 */
function splitWildcardHost(host: string): { wildcard: boolean; labels: string[] } | null {
  const labels = host.split(".");
  const wildcardCount = labels.filter((label) => label.includes("*")).length;
  if (wildcardCount === 0) {
    return { wildcard: false, labels };
  }
  if (wildcardCount > 1 || labels[0] !== "*") {
    return null;
  }
  return { wildcard: true, labels: labels.slice(1) };
}

function parseExternalLinkPattern(raw: unknown): ParsedExternalLinkPattern | null {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    // Anything without a scheme lands here, which is what "must parse into a scheme" means:
    // `store.example.com/*` is a string somebody hoped would be a pattern.
    return null;
  }
  if (isDeniedExternalLinkScheme(parsed.protocol)) {
    return null;
  }
  // Credentials in a declaration are refused for the same reason they are refused in a request
  // below: `https://store.example.com@evil.test/` reads as the store and goes to the attacker,
  // and there is no legitimate address a game hands a browser that carries a password.
  if (parsed.username || parsed.password) {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host && !splitWildcardHost(host)) {
    return null;
  }
  const path = parsed.pathname;
  const wholeScheme =
    host === "*" &&
    parsed.port === "" &&
    (path === "" || path === "/") &&
    parsed.search === "" &&
    parsed.hash === "";
  return {
    scheme: parsed.protocol.toLowerCase(),
    host,
    port: parsed.port,
    path,
    search: parsed.search,
    hash: parsed.hash,
    wholeScheme
  };
}

/**
 * A canonical key for one pattern, or `null` when it is not a pattern.
 *
 * Used to decide whether a manifest declared the same thing twice. It is *not* what gets stored:
 * the manifest keeps what the author wrote, because that string is what the install prompt shows
 * and rewriting a permission before showing it to the person approving it is its own small lie.
 */
export function externalLinkPatternKey(pattern: unknown): string | null {
  const parsed = parseExternalLinkPattern(pattern);
  if (!parsed) {
    return null;
  }
  if (parsed.wholeScheme) {
    return `${parsed.scheme}//*`;
  }
  const authority = parsed.host ? `//${parsed.host}${parsed.port ? `:${parsed.port}` : ""}` : "";
  return `${parsed.scheme}${authority}${parsed.path}${parsed.search}${parsed.hash}`;
}

/** Whether a string can be declared as a pattern at all. See {@link externalLinkPatternKey}. */
export function isValidExternalLinkPattern(pattern: unknown): boolean {
  return externalLinkPatternKey(pattern) !== null;
}

/** Path segments, empties dropped, so `/a//b/` and `/a/b` compare the same. */
function pathSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/**
 * Host comparison, label by label on the parsed hostname.
 *
 * Never `startsWith`, never `endsWith`, never a substring test on the raw address. The three
 * outcomes that matter, all decided here:
 *
 *  - `*.example.com` matches `a.example.com` and `b.a.example.com` - a leading wildcard covers one
 *    or more labels.
 *  - `*.example.com` does **not** match `example.com.evil.test`. The suffix compared is the label
 *    list `["example","com"]` against that host's *last two labels*, which are `["evil","test"]`.
 *  - `*.example.com` does **not** match bare `example.com`. A wildcard label stands for at least one
 *    label, so the candidate must be strictly longer; `a.b` is a subdomain of `b`, `b` is not.
 */
function hostMatches(pattern: string, candidate: string): boolean {
  if (pattern === "*") {
    return true;
  }
  const split = splitWildcardHost(pattern);
  if (!split) {
    return false;
  }
  const candidateLabels = candidate.split(".");
  if (!split.wildcard) {
    return (
      split.labels.length === candidateLabels.length &&
      split.labels.every((label, index) => label === candidateLabels[index])
    );
  }
  const suffix = split.labels;
  if (candidateLabels.length <= suffix.length) {
    return false;
  }
  const offset = candidateLabels.length - suffix.length;
  return suffix.every((label, index) => label === candidateLabels[offset + index]);
}

/**
 * Path comparison.
 *
 * A trailing `*` means "this prefix, at a segment boundary": `/app/*` covers `/app/480` and
 * `/app/480/reviews`, and does not cover `/appeal`, because the comparison is over the segment list
 * `["app"]` and `"app" !== "appeal"`. It also covers `/app` itself - the prefix is the place the
 * author named, and a server that serves `/app/` and `/app` differently is not a distinction a
 * declaration can usefully carry.
 *
 * Without a trailing `*` the path must match exactly.
 *
 * The wildcard applies only to a hierarchical path (one starting with `/`). An opaque path -
 * everything after the colon in `mailto:someone@example.com` - has no segments to be a boundary,
 * so it is compared whole, `*` and all.
 */
function pathMatches(pattern: string, candidate: string): boolean {
  if (pattern.startsWith("/") && pattern.endsWith("*")) {
    const prefix = pathSegments(pattern.slice(0, -1));
    const actual = pathSegments(candidate);
    return (
      actual.length >= prefix.length && prefix.every((segment, index) => segment === actual[index])
    );
  }
  return pattern === candidate;
}

/**
 * Whether one candidate address is covered by one declared pattern.
 *
 * Both sides are parsed first and nothing is compared as a raw string. In full:
 *
 *  - **Scheme** must be equal, case-insensitively. `http:` is not `https:`.
 *  - **Host** per {@link hostMatches}: exact, or `*` for any host, or a leading-label wildcard.
 *  - **Port** must be equal, always - `URL` has already removed a default port, so
 *    `https://example.com:443/` and `https://example.com/` are the same authority and
 *    `https://example.com:8443/` is a different one. The only exemption is the whole-scheme
 *    wildcard, which constrains nothing.
 *  - **Path** per {@link pathMatches}: a trailing `*` is a segment-boundary prefix, otherwise exact.
 *  - **Query and fragment** on the candidate are ignored unless the pattern names them; a pattern
 *    that names one must match it exactly, string for string, order included.
 *  - **Credentials** on the candidate refuse it outright. `https://evil@store.example.com/` parses
 *    to the host `store.example.com`, so a host check alone would pass it - and the address a
 *    person reads is not the address it goes to, which is the entire trick.
 *  - **Denied schemes** refuse it before any of that. A denied scheme cannot be declared either, so
 *    this can only fire on a request; it is here so the answer does not depend on validation having
 *    run somewhere else.
 *
 * Never throws: every caller is deciding whether to perform an act, and an exception on this path
 * would be a decision nobody made.
 */
export function matchesExternalLinkPattern(pattern: string, url: string): boolean {
  const declared = parseExternalLinkPattern(pattern);
  if (!declared) {
    return false;
  }
  let candidate: URL;
  try {
    candidate = new URL(String(url ?? "").trim());
  } catch {
    return false;
  }
  if (isDeniedExternalLinkScheme(candidate.protocol) || candidate.username || candidate.password) {
    return false;
  }
  if (declared.scheme !== candidate.protocol.toLowerCase()) {
    return false;
  }
  if (declared.wholeScheme) {
    return true;
  }
  if (!hostMatches(declared.host, candidate.hostname.toLowerCase())) {
    return false;
  }
  if (declared.port !== candidate.port) {
    return false;
  }
  if (!pathMatches(declared.path, candidate.pathname)) {
    return false;
  }
  if (declared.search && declared.search !== candidate.search) {
    return false;
  }
  if (declared.hash && declared.hash !== candidate.hash) {
    return false;
  }
  return true;
}

/**
 * Whether any of `patterns` covers `url`.
 *
 * The list belongs to one plugin and is read from that plugin's own manifest entry, which is what
 * makes "its own patterns and only its own" a property of the caller rather than a promise made
 * here - there is no plugin id in this function because there is no list here that could hold
 * another plugin's.
 */
export function isExternalLinkPatternDeclared(
  patterns: readonly string[] | undefined,
  url: string
): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => matchesExternalLinkPattern(pattern, url));
}
