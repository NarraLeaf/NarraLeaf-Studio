/**
 * What a versioned editor document is, from the outside.
 *
 * Today the eight document services each hold their own read/validate/migrate/write
 * logic, which is why nothing else in Studio can answer "what does this file
 * contain?" without importing a renderer service. Version control has to: the main
 * process reads blobs out of a revision that no service ever loaded, and has to
 * parse and summarise them with the renderer nowhere in the picture. A spec is that
 * knowledge, extracted to somewhere both processes can reach.
 */

/**
 * The document formats the project is made of.
 *
 * A closed union rather than a bare string so a typo cannot register a spec nobody
 * will ever look up. H2 owns the mapping from these to the eight services and may
 * add members as it goes; the list is drawn from the on-disk layout declared in
 * `ProjectNameConvention`.
 */
export type DocumentKind =
    | "project"
    | "story-index"
    | "story"
    | "story-animation-index"
    | "story-animation"
    | "ui-document"
    | "ui-graphs"
    | "variables"
    | "audio-tracks"
    | "localization"
    | "localization-keys"
    | "voice"
    | "assets-metadata"
    | "assets-groups"
    | "blueprint";

/**
 * One number worth showing about a document, e.g. how many scenes a story has.
 *
 * `key` is a stable identifier for the history UI to translate, not display text -
 * a spec returning "scenes" here would otherwise hard-code English into a diff view
 * that has a zh catalogue.
 */
export interface DocumentSummaryCount {
    readonly key: string;
    readonly value: number;
}

/** The one-line identity of a document, for history and diff lists. */
export interface DocumentSummary {
    /**
     * The name the author gave this document, e.g. a story's title. Empty when the
     * document has no authored name (a variable registry has none); the UI already
     * knows the {@link DocumentKind} and falls back to a translated label for it.
     * Never a file path - the path is shown separately and would be redundant here.
     */
    readonly title: string;
    readonly counts: readonly DocumentSummaryCount[];
}

/** What {@link DocumentSpec.parse} is told about the bytes it was handed. */
export interface DocumentParseContext {
    /** Project-relative, forward slashes. Some documents carry their id only in their path. */
    readonly path: string;
    /**
     * Reject the document, naming what is wrong with it.
     *
     * Returns `never`, so a validator can `return context.corrupt(...)` in a branch
     * that has to produce a value. The thrown error carries the original bytes,
     * which is what makes quarantine possible without re-reading the file.
     */
    corrupt(reason: string, options?: {cause?: unknown}): never;
}

/**
 * Everything the rest of Studio needs to know about one document format.
 *
 * `parse` is required to be total: it either returns a value of the current schema
 * version - migrating whatever older shape it was handed - or throws
 * {@link DocumentCorruptError}. Returning a half-migrated document is the one
 * outcome that must not happen, because the next save would write it back.
 */
export interface DocumentSpec<T> {
    readonly kind: DocumentKind;

    /** Schema version `parse` migrates up to and `serialize` writes. */
    readonly version: number;

    /**
     * Project-relative path patterns this spec owns, e.g.
     * `editor/story/stories/<storyId>/storydoc.json`. Declarative rather than only a
     * predicate because the registry has to detect two specs claiming one path at
     * registration time, and predicates cannot be compared. See `documentPath.ts`.
     */
    readonly paths: readonly string[];

    /** Whether `relativePath` is one of this spec's documents. Windows separators are accepted. */
    matches(relativePath: string): boolean;

    /**
     * Where a document identified by `parameters` lives, e.g.
     * `pathFor({storyId})`. The counterpart to `matches`: reading starts from a path,
     * saving starts from an id, and both have to name the same file.
     *
     * Throws rather than returning a best effort - a path built from a missing or
     * malformed parameter is a save that lands somewhere nothing will look.
     */
    pathFor(parameters?: Readonly<Record<string, string>>): string;

    parse(raw: unknown, context: DocumentParseContext): T;

    /** Canonical bytes, including the trailing newline. */
    serialize(document: T): string;

    summarize(document: T): DocumentSummary;
}

/**
 * A spec whose document type is not known at the use site.
 *
 * `DocumentSpec<unknown>` would be the honest type, but `T` appears in both argument
 * and return position, so a concrete spec only assigns to it through TypeScript's
 * method-parameter bivariance - a hole that silently disappears if these members are
 * ever rewritten as property-style function types. `any` states the erasure openly
 * instead of relying on that. Callers that know the type use `DocumentSpec<T>`
 * directly; `loadDocument` and `saveDocument` stay generic for exactly that reason.
 */
export type AnyDocumentSpec = DocumentSpec<any>;

export interface DocumentCorruptErrorInit {
    readonly kind: DocumentKind;
    /** Project-relative, forward slashes. */
    readonly path: string;
    readonly reason: string;
    /** The exact text that failed to parse. */
    readonly text: string;
    readonly cause?: unknown;
}

/**
 * A document that could be read from disk but could not be understood.
 *
 * It carries the original text rather than only the path because quarantine has to
 * preserve what was actually read: re-reading the file to copy it races with
 * whatever is still writing to it, and the bytes that get quarantined would then not
 * be the bytes that failed. Distinct from an I/O failure, which is not corruption
 * and must not trigger quarantine.
 */
export class DocumentCorruptError extends Error {
    public readonly kind: DocumentKind;
    public readonly path: string;
    public readonly reason: string;
    public readonly text: string;

    constructor(init: DocumentCorruptErrorInit) {
        super(`${init.kind} document at ${init.path} could not be read: ${init.reason}`, {cause: init.cause});
        this.name = "DocumentCorruptError";
        this.kind = init.kind;
        this.path = init.path;
        this.reason = init.reason;
        this.text = init.text;
    }
}
