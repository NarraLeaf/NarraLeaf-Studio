import { encodeCanonicalJson } from "./canonicalJson";
import {
  compileDocumentPathPattern,
  DocumentPathError,
  DocumentPathPattern,
  documentPathParameterNames,
  documentPathPatternsOverlap,
  documentPathPatternSubsumes,
  formatDocumentPath,
  matchDocumentPath,
  normalizeDocumentPath
} from "./documentPath";
import type { DocumentDiff, DocumentMerge3 } from "./diff";
import {
  AnyDocumentSpec,
  DocumentKind,
  DocumentParseContext,
  DocumentSpec,
  DocumentSummary
} from "./types";

/**
 * Which spec owns a path.
 *
 * Version control works from paths, not from services: a revision hands back a list
 * of changed files, and every one of them has to be turned into "a story document"
 * or "an asset blob we do not diff" before anything can be said about the change.
 * This is the only place that mapping lives.
 */

export class DocumentRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentRegistrationError";
  }
}

export interface DocumentPathMatch {
  readonly spec: AnyDocumentSpec;
  /** Values captured from the path, e.g. `{storyId: "..."}` or `{locale: "zh-CN"}`. */
  readonly parameters: Readonly<Record<string, string>>;
}

interface RegistryEntry {
  readonly spec: AnyDocumentSpec;
  readonly patterns: readonly DocumentPathPattern[];
}

export class DocumentRegistry {
  private readonly entries: RegistryEntry[] = [];

  /**
   * Two specs claiming one path is a bug in the registration order, and it has to
   * surface here rather than at read time: resolved at read time it would be a
   * document that silently parses with the wrong spec on some machines and not
   * others, depending on module evaluation order.
   *
   * An overlap where one pattern is strictly more specific is allowed, and the more
   * specific one wins - `editor/localization/keys.json` beside
   * `editor/localization/<locale>.json` is a real pair from `ProjectNameConvention`
   * and there is nothing ambiguous about it. Only an overlap where neither pattern
   * contains the other is rejected, because then no rule can decide.
   */
  public register(spec: AnyDocumentSpec): void {
    const duplicateKind = this.entries.find((entry) => entry.spec.kind === spec.kind);
    if (duplicateKind) {
      throw new DocumentRegistrationError(
        `Document kind "${spec.kind}" is already registered (paths: ${duplicateKind.spec.paths.join(", ")}).`
      );
    }

    const patterns = spec.paths.map(compileDocumentPathPattern);
    if (patterns.length === 0) {
      throw new DocumentRegistrationError(
        `Document kind "${spec.kind}" declares no paths, so nothing could ever resolve to it.`
      );
    }

    // Including the new spec's patterns against each other: a spec declaring the same
    // path twice is as much a bug as two specs doing it, and it would make parameter
    // extraction depend on declaration order.
    for (let index = 0; index < patterns.length; index += 1) {
      for (let other = 0; other < index; other += 1) {
        this.assertUnambiguous(patterns[index], spec.kind, patterns[other], spec.kind);
      }
      for (const entry of this.entries) {
        for (const existing of entry.patterns) {
          this.assertUnambiguous(patterns[index], spec.kind, existing, entry.spec.kind);
        }
      }
    }

    this.entries.push({ spec, patterns });
  }

  public get(kind: DocumentKind): AnyDocumentSpec | undefined {
    return this.entries.find((entry) => entry.spec.kind === kind)?.spec;
  }

  public list(): readonly AnyDocumentSpec[] {
    return this.entries.map((entry) => entry.spec);
  }

  /**
   * The spec owning `relativePath`, or `undefined` if no spec claims it - which is
   * the ordinary answer for the many project files that are not documents.
   *
   * Throws on a path that is not project-relative at all. That is the loud half of
   * the contract on purpose: Lore reports absolute paths, and an absolute path
   * quietly resolving to `undefined` would show up as a version-control feature
   * that produces no semantic diff for anything, with nothing in the logs.
   */
  public resolve(relativePath: string): DocumentPathMatch | undefined {
    const path = normalizeDocumentPath(relativePath);

    let best:
      | { entry: RegistryEntry; pattern: DocumentPathPattern; parameters: Record<string, string> }
      | undefined;
    for (const entry of this.entries) {
      for (const pattern of entry.patterns) {
        const parameters = matchDocumentPath(pattern, path);
        if (!parameters) {
          continue;
        }
        // Every pattern matching one path overlaps every other, and `register` has
        // already refused any overlapping pair that is not comparable. So the
        // candidates are totally ordered by specificity and one pass finds the least.
        if (!best || documentPathPatternSubsumes(pattern, best.pattern)) {
          best = { entry, pattern, parameters };
        }
      }
    }

    return best ? { spec: best.entry.spec, parameters: best.parameters } : undefined;
  }

  private assertUnambiguous(
    pattern: DocumentPathPattern,
    kind: DocumentKind,
    other: DocumentPathPattern,
    otherKind: DocumentKind
  ): void {
    if (!documentPathPatternsOverlap(pattern, other)) {
      return;
    }

    const subsumesOther = documentPathPatternSubsumes(pattern, other);
    const subsumedByOther = documentPathPatternSubsumes(other, pattern);
    if (subsumesOther !== subsumedByOther) {
      return;
    }

    throw new DocumentRegistrationError(
      subsumesOther
        ? `Document path "${pattern.source}" is registered twice (${kind} and ${otherKind}).`
        : `Document paths "${pattern.source}" (${kind}) and "${other.source}" (${otherKind}) match some of the same files, ` +
            "and neither is more specific than the other, so no rule can decide which spec owns them."
    );
  }
}

export interface DocumentSpecDefinition<T> {
  kind: DocumentKind;
  version: number;
  paths: readonly string[];
  parse(raw: unknown, context: DocumentParseContext): T;
  /** Defaults to canonical JSON. Override only for a format that is not JSON at all. */
  serialize?(document: T): string;
  summarize(document: T): DocumentSummary;
  /**
   * Optional semantic diff. See {@link DocumentSpec.diff} for the contract - pure, non-throwing,
   * and bound by `limit` - which this only forwards.
   *
   * Forwarding it at all is the point: a definition that quietly dropped `diff` would produce a
   * spec whose diff is `undefined`, and `documentDiff.ts` reads exactly that to decide between the
   * semantic and the summary tier. The author would get a working, plausible, lesser answer with
   * nothing anywhere reporting that the implementation they wrote was never called.
   */
  diff?(base: T, head: T, options: { limit: number }): DocumentDiff;
  /**
   * Optional three-way merge. See {@link DocumentSpec.merge3} for the contract - `base`
   * absent is add/add, an open conflict holds base, decisions carry `DocumentChange` paths -
   * which this only forwards.
   *
   * Forwarded here for the reason `diff` had to be: D1 declared `diff` on the spec interface
   * and forgot it in this definition, so `defineDocumentSpec` dropped it and every
   * implementation written against it would have been dead code that nothing reported. The
   * failure mode for `merge3` is worse than for `diff`, because the fallback is not a lesser
   * list - it is the whole file being resolved from one side.
   */
  merge3?(base: T | undefined, mine: T, theirs: T): DocumentMerge3<T>;
}

/**
 * Build a spec, deriving `matches` and `pathFor` from `paths` so the predicate, the
 * path builder, and the patterns the registry compares can never drift apart.
 *
 * The default `serialize` is the canonical encoder, which is the whole point of the
 * milestone: a spec that wants different bytes has to say so explicitly, rather than
 * getting them by forgetting.
 */
export function defineDocumentSpec<T>(definition: DocumentSpecDefinition<T>): DocumentSpec<T> {
  const patterns = definition.paths.map(compileDocumentPathPattern);
  const serialize = definition.serialize;

  return {
    kind: definition.kind,
    version: definition.version,
    paths: definition.paths,
    matches: (relativePath) =>
      patterns.some((pattern) => matchDocumentPath(pattern, relativePath) !== null),
    pathFor: (parameters) =>
      formatDocumentPath(
        selectPattern(definition.kind, patterns, parameters ?? {}),
        parameters ?? {}
      ),
    parse: definition.parse,
    serialize: serialize
      ? (document) => serialize(document)
      : (document) => encodeCanonicalJson(document),
    summarize: definition.summarize,
    ...(definition.diff ? { diff: definition.diff } : {}),
    ...(definition.merge3 ? { merge3: definition.merge3 } : {})
  };
}

/**
 * Which of a spec's patterns the caller meant, chosen by exactly which parameters they
 * supplied.
 *
 * Exact rather than "the first that can be filled in" so a typo cannot pick a
 * neighbouring pattern: `pathFor({storyID})` has to fail, not quietly build the
 * parameterless `editor/story/index.json`.
 *
 * Two patterns taking the same parameters are genuinely ambiguous - `assets.metadata.
 * <type>.json` and `assets.groups.<type>.json` would be, if one spec owned both - and
 * the way out is two kinds, which is what the message says.
 */
function selectPattern(
  kind: DocumentKind,
  patterns: readonly DocumentPathPattern[],
  parameters: Readonly<Record<string, string>>
): DocumentPathPattern {
  const supplied = Object.keys(parameters).sort();
  const candidates = patterns.filter((pattern) => {
    const names = documentPathParameterNames(pattern);
    return (
      names.length === supplied.length && names.every((name, index) => name === supplied[index])
    );
  });

  if (candidates.length === 1) {
    return candidates[0];
  }

  const described = supplied.length === 0 ? "no parameters" : `parameters (${supplied.join(", ")})`;
  throw new DocumentPathError(
    candidates.length === 0
      ? `No path of the "${kind}" document takes ${described}. It declares: ${patterns.map((pattern) => pattern.source).join(", ")}.`
      : `The "${kind}" document has more than one path taking ${described} ` +
          `(${candidates.map((pattern) => pattern.source).join(", ")}), so it needs to be split into separate kinds.`
  );
}

/**
 * The registry Studio itself uses. Held behind a class as well so tests - and any
 * future second project window with its own plugin-contributed specs - can build an
 * isolated one: a duplicate-registration test against a process-wide registry would
 * poison every test that ran after it.
 */
const defaultRegistry = new DocumentRegistry();

export function registerDocumentSpec(spec: AnyDocumentSpec): void {
  defaultRegistry.register(spec);
}

export function getDocumentSpec(kind: DocumentKind): AnyDocumentSpec | undefined {
  return defaultRegistry.get(kind);
}

export function resolveDocumentSpecForPath(relativePath: string): DocumentPathMatch | undefined {
  return defaultRegistry.resolve(relativePath);
}

export function listDocumentSpecs(): readonly AnyDocumentSpec[] {
  return defaultRegistry.list();
}
