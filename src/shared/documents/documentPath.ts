/**
 * The path language the document registry routes on.
 *
 * Documents live at both fixed paths (`editor/ui/uidoc.json`) and parameterised ones
 * (`editor/story/stories/<storyId>/storydoc.json`), so routing needs more than
 * string equality. It needs less than a glob, though, and that matters: the registry
 * has to refuse two specs claiming one path *at registration*, and "do these two
 * patterns share a path?" is only decidable for a language small enough to reason
 * about. Hence one parameter per segment and nothing else - no `*`, no `**`, no
 * alternation. Every real document path fits, and pattern overlap stays a few lines
 * of prefix/suffix arithmetic rather than regex intersection.
 */

export class DocumentPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentPathError";
  }
}

/** `<name>` anywhere in a segment, with literal text either side: `<locale>.json`, `assets.metadata.<type>.json`. */
const PARAMETER = /^([^<>]*)<([A-Za-z][A-Za-z0-9]*)>([^<>]*)$/;

export type DocumentPathSegment =
  | { readonly kind: "literal"; readonly text: string }
  | {
      readonly kind: "parameter";
      readonly name: string;
      readonly prefix: string;
      readonly suffix: string;
    };

export interface DocumentPathPattern {
  /** The normalised source text, for error messages. */
  readonly source: string;
  readonly segments: readonly DocumentPathSegment[];
}

/**
 * A project-relative path in the one form everything downstream compares.
 *
 * Callers hand over host paths, so Windows separators are converted rather than
 * rejected. Everything else is refused: an absolute path has no meaning here (the
 * project root is not this module's business), and a `..` segment matters more than
 * it looks - it is the path that would put a quarantine copy outside the project.
 *
 * `normalizeProjectPackagePath` in `@shared/utils/projectPackage` applies the same
 * rules and is deliberately not reused: importing it would drag `msgpack-lite` into
 * every consumer of the document model for the sake of fifteen lines.
 */
export function normalizeDocumentPath(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DocumentPathError("A document path must be a non-empty project-relative path.");
  }
  if (value.includes("\0")) {
    throw new DocumentPathError(
      `A document path may not contain a NUL character: ${JSON.stringify(value)}`
    );
  }

  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new DocumentPathError(
      `A document path must be relative to the project root, got: ${value}`
    );
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new DocumentPathError(
      `A document path may not contain empty, "." or ".." segments: ${value}`
    );
  }

  return segments.join("/");
}

export function compileDocumentPathPattern(source: string): DocumentPathPattern {
  const normalized = normalizeDocumentPath(source);
  return {
    source: normalized,
    segments: normalized.split("/").map((segment) => compileSegment(segment, normalized))
  };
}

/**
 * The captured parameters if `relativePath` matches, otherwise `null`.
 *
 * Matching is case-sensitive even though Windows filesystems are not: a repository
 * records the case a file was committed with, so treating `Editor/` and `editor/` as
 * the same path here would make a spec resolve for a path the VCS considers absent.
 */
export function matchDocumentPath(
  pattern: DocumentPathPattern,
  relativePath: string
): Record<string, string> | null {
  const segments = normalizeDocumentPath(relativePath).split("/");
  if (segments.length !== pattern.segments.length) {
    return null;
  }

  const parameters: Record<string, string> = {};
  for (let index = 0; index < segments.length; index += 1) {
    const expected = pattern.segments[index];
    const actual = segments[index];

    if (expected.kind === "literal") {
      if (actual !== expected.text) {
        return null;
      }
      continue;
    }

    if (!literalMatchesParameter(actual, expected)) {
      return null;
    }
    parameters[expected.name] = actual.slice(
      expected.prefix.length,
      actual.length - expected.suffix.length
    );
  }

  return parameters;
}

/** The parameter names a pattern captures, sorted. */
export function documentPathParameterNames(pattern: DocumentPathPattern): string[] {
  return pattern.segments
    .filter(
      (segment): segment is Extract<DocumentPathSegment, { kind: "parameter" }> =>
        segment.kind === "parameter"
    )
    .map((segment) => segment.name)
    .sort();
}

/**
 * The path for a document identified by `parameters` - the inverse of
 * {@link matchDocumentPath}, and how a service turns a story id into somewhere to save.
 *
 * The generated path is fed straight back through the matcher before being returned.
 * That is not belt-and-braces: an id carrying a separator, a `..`, or text that
 * happens to collide with a literal segment would otherwise produce a path this very
 * pattern does not recognise, and the contradiction would surface as a document
 * written to a file that nothing can ever find again. Checking here makes
 * `pathFor` and `matches` agree by construction rather than by review.
 */
export function formatDocumentPath(
  pattern: DocumentPathPattern,
  parameters: Readonly<Record<string, string>>
): string {
  const path = pattern.segments
    .map((segment) => {
      if (segment.kind === "literal") {
        return segment.text;
      }

      const value = parameters[segment.name];
      if (typeof value !== "string" || value.length === 0) {
        throw new DocumentPathError(
          `Cannot build "${pattern.source}": <${segment.name}> is missing or empty.`
        );
      }
      return `${segment.prefix}${value}${segment.suffix}`;
    })
    .join("/");

  const roundTrip = matchDocumentPath(pattern, path);
  if (
    !roundTrip ||
    documentPathParameterNames(pattern).some((name) => roundTrip[name] !== parameters[name])
  ) {
    throw new DocumentPathError(
      `Cannot build "${pattern.source}" from ${JSON.stringify(parameters)}: ` +
        `the result "${path}" would not read back as the same document.`
    );
  }

  return path;
}

/**
 * Whether some path matches both patterns.
 *
 * Exact, not conservative, which is the point: segments constrain each other in no
 * way, so a witness exists precisely when one exists for every segment pair.
 */
export function documentPathPatternsOverlap(
  a: DocumentPathPattern,
  b: DocumentPathPattern
): boolean {
  return (
    a.segments.length === b.segments.length &&
    a.segments.every((segment, index) => segmentsOverlap(segment, b.segments[index]))
  );
}

/**
 * Whether every path matching `a` also matches `b` - i.e. `a` is the more specific of
 * the two. This is what lets `editor/story/animations/index.json` and
 * `editor/story/animations/<animationId>.json` coexist: the literal wins for its own
 * path and the parameterised one keeps the rest.
 */
export function documentPathPatternSubsumes(
  a: DocumentPathPattern,
  b: DocumentPathPattern
): boolean {
  return (
    a.segments.length === b.segments.length &&
    a.segments.every((segment, index) => segmentSubsumes(segment, b.segments[index]))
  );
}

function compileSegment(segment: string, source: string): DocumentPathSegment {
  if (!segment.includes("<") && !segment.includes(">")) {
    return { kind: "literal", text: segment };
  }

  const match = PARAMETER.exec(segment);
  if (!match) {
    throw new DocumentPathError(
      `A path segment may hold at most one <parameter>, named with letters and digits: ${source}`
    );
  }

  return { kind: "parameter", name: match[2], prefix: match[1], suffix: match[3] };
}

function segmentsOverlap(a: DocumentPathSegment, b: DocumentPathSegment): boolean {
  if (a.kind === "literal" && b.kind === "literal") {
    return a.text === b.text;
  }
  if (a.kind === "literal") {
    return literalMatchesParameter(
      a.text,
      b as Extract<DocumentPathSegment, { kind: "parameter" }>
    );
  }
  if (b.kind === "literal") {
    return literalMatchesParameter(b.text, a);
  }

  // A parameter matches one or more characters, so a common string exists exactly when
  // one prefix extends the other and one suffix extends the other: take the longer of
  // each and any single character between them.
  return (
    (a.prefix.startsWith(b.prefix) || b.prefix.startsWith(a.prefix)) &&
    (a.suffix.endsWith(b.suffix) || b.suffix.endsWith(a.suffix))
  );
}

function segmentSubsumes(a: DocumentPathSegment, b: DocumentPathSegment): boolean {
  if (b.kind === "literal") {
    return a.kind === "literal" && a.text === b.text;
  }
  if (a.kind === "literal") {
    return literalMatchesParameter(a.text, b);
  }
  return a.prefix.startsWith(b.prefix) && a.suffix.endsWith(b.suffix);
}

function literalMatchesParameter(
  text: string,
  parameter: Extract<DocumentPathSegment, { kind: "parameter" }>
): boolean {
  // The strict length comparison is what stops `editor/localization/.json` matching
  // `<locale>.json` with an empty locale, which would then resolve to a document id
  // that cannot exist.
  return (
    text.startsWith(parameter.prefix) &&
    text.endsWith(parameter.suffix) &&
    text.length > parameter.prefix.length + parameter.suffix.length
  );
}
