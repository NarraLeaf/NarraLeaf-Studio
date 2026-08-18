import { ATOMIC_WRITE_TEMP_PATTERN, ATOMIC_WRITE_TEMP_SUFFIX } from "@shared/utils/atomicWriteTemp";

/**
 * What is under version control: the whole project directory, minus caches and
 * derived files that are not content.
 *
 * The default is deliberately "everything". A version control system that only
 * tracks the file types it knows about loses the author's work the first time they
 * put something unexpected in the project - and they will never find out until they
 * need it back. So the interesting part of this module is the exclusion list, and
 * every entry on it has to justify itself.
 *
 * Two representations of the same policy live here, and they MUST agree:
 *
 *  - {@link isVersioned}, the predicate Studio reasons with.
 *  - {@link workingSetIgnorePatterns}, the glob lines written into the repository's
 *    ignore file, which is what the backend actually enforces during a scan.
 *
 * They are generated from one table for that reason. A predicate that says a file is
 * versioned while the backend's filter drops it is the worst failure this milestone
 * can produce: the author is shown a file as protected, every commit silently omits
 * it, and the divergence only surfaces when they try to restore it.
 *
 * **Shared rather than main-only**, and nothing here may import `fs` or `path`. The
 * scan and the ignore file belong to the main process, but the renderer asks the same
 * question - which files a change list may show, which edits a write path is allowed
 * to make - and a renderer-side copy of the table is precisely the drift described
 * above with a process boundary hiding it. The walk that needs a filesystem stays in
 * main (`managers/vcs/workingSet.ts`) and imports the predicate from here.
 *
 * The pattern semantics below are measured against the real library (v0.8.5), not
 * assumed from familiarity with gitignore:
 *
 *  - a single-segment pattern matches at ANY depth (`dist` also excludes `sub/dist`)
 *  - a multi-segment pattern is anchored to the repository root
 *  - a leading `/` anchors a single-segment pattern to the root
 *  - `*.ext` matches at any depth; `#`-prefixed lines are inert
 */

/**
 * Excluded only at the project root.
 *
 * Anchored on purpose. These are ordinary English words that an author may
 * legitimately use for content - an asset folder called `dist`, a story folder
 * called `cache` - and the backend matches a bare single-segment pattern at every
 * depth. Unanchored, `node_modules` would be right and `dist` would silently drop
 * `assets/content/dist/`, which is exactly the "file the author thinks is versioned
 * and is not" failure.
 */
const ROOT_EXCLUDED_DIRECTORIES: readonly string[] = [
  /** Build output. */
  "dist",
  /** Dependencies of the project's own scripts; restorable from a manifest. */
  "node_modules",
  /** Thumbnails and other derived artefacts, rebuilt on demand. */
  "editor/cache",
  /** Locally cached copies of remote assets; the reference is versioned, not the copy. */
  "editor/assets/remote"
];

/**
 * Excluded wherever they appear.
 *
 * Every name here is owned by a tool or by the operating system and can never be
 * author content, so matching at any depth costs nothing and catches the cases
 * anchoring would miss - a `.git` checkout dropped inside `assets/`, a second
 * project nested in the tree, a `.DS_Store` in every folder a Mac user opened.
 */
const EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  /** The repository itself. Lore excludes it intrinsically; listed so this predicate agrees. */
  ".lore",
  /** Studio's per-machine state: editor layout, installed plugins, quarantine. */
  ".nlstudio",
  ".git",
  ".DS_Store",
  "Thumbs.db"
]);

/**
 * Notably NOT excluded: `resources/icons/derived/`.
 *
 * Those PNGs are baked from the author's master image, but they ship inside the
 * package and the bake deliberately never rewrites an unchanged file - they are
 * project content that happens to have been generated, not cache. The same call was
 * already made when they were placed under `resources/` rather than under a cache
 * directory (see ProjectNameConvention.ProjectIconDerived).
 */

/** Header written above the generated patterns. `#` lines are measured to be inert. */
const IGNORE_FILE_HEADER: readonly string[] = [
  "# Written by NarraLeaf Studio when version control was enabled for this project.",
  "# Studio's own copy of these rules is compiled in and it does not read this file,",
  "# so editing a line changes what the repository stores without changing what",
  "# Studio reports."
];

/**
 * The exclusion policy as glob lines, in the order they are written.
 *
 * Exported so a test can hold it against {@link isVersioned} - the two encode the
 * same rules in different languages and nothing but a test keeps them honest.
 */
export function workingSetIgnorePatterns(): string[] {
  return [
    ...ROOT_EXCLUDED_DIRECTORIES.map((directory) => `/${directory}/`),
    ...[...EXCLUDED_NAMES],
    // Derived from the suffix the atomic writer actually appends rather than
    // spelled out again: a scratch file that reaches a commit is a half-written
    // document in permanent history, and the two constants drifting apart is the
    // only way that happens.
    `*${ATOMIC_WRITE_TEMP_SUFFIX}`
  ];
}

/** The full text of the repository's ignore file, header included. */
export function renderWorkingSetIgnoreFile(): string {
  return [...IGNORE_FILE_HEADER, "", ...workingSetIgnorePatterns(), ""].join("\n");
}

/**
 * Whether one repository-relative path belongs under version control.
 *
 * Pure and total: anything outside the working set - including a path that escapes
 * the repository - answers false rather than throwing, because the question being
 * asked is "should this be versioned", and the answer for those is no.
 *
 * Accepts either separator; callers on Windows have both spellings in hand.
 */
export function isVersioned(repositoryRelativePath: string): boolean {
  const segments = splitRelative(repositoryRelativePath);
  if (segments.length === 0) return false;
  if (segments.some((segment) => segment === ".." || EXCLUDED_NAMES.has(segment))) return false;

  const relative = segments.join("/");
  if (ATOMIC_WRITE_TEMP_PATTERN.test(relative)) return false;

  return !ROOT_EXCLUDED_DIRECTORIES.some(
    (directory) => relative === directory || relative.startsWith(`${directory}/`)
  );
}

/** Path to segments, tolerating either separator, a leading `./`, and trailing slashes. */
function splitRelative(repositoryRelativePath: string): string[] {
  return repositoryRelativePath
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0 && segment !== ".");
}
