/**
 * The refusal every raw project-document read gives a file a newer NarraLeaf Studio wrote.
 *
 * The document specs already refuse one through `rejectNewerSchema`, and the renderer's own loaders
 * refuse the documents they own. What had no guard was every place the **main process** reads a
 * project file straight off disk - Dev Mode, the preview and the build all assemble their bundle
 * from raw JSON - and a normalizer handed a newer document simply drops every field it has not
 * heard of. A build made that way ships a game with part of the author's work silently missing,
 * which is worse than a build that stops.
 *
 * One error class rather than one per format, because every reader answers the same three
 * questions - which file, which version it is at, which version this build reads - and the sentence
 * the author sees is composed from those three fields in their own language (see the main process's
 * `describeProjectDocumentTooNew`). The kind is a closed list so that list and the catalogue's nouns
 * for it (`documents.tooNew.kind`) are held together by a test.
 *
 * The message this error carries is English and goes to a log. It is not what the author reads.
 *
 * Only a number strictly greater than the supported version is refused, for the reason
 * `rejectNewerSchema` gives: several of these formats have always tolerated a missing or
 * non-numeric version, and inventing a requirement here would refuse files that read perfectly well.
 */

export const PROJECT_DOCUMENT_KINDS = [
    "story",
    "storyIndex",
    "storyAnimation",
    "uiDocument",
    "uiGraphs",
    "blueprints",
    "variables",
    "saveSchema",
    "localization",
    "localizationKeys",
    "voice",
    "brand",
    "appTags",
    "dlc",
    "assetSets",
    "audioTracks",
    "characters",
] as const;

export type ProjectDocumentKind = typeof PROJECT_DOCUMENT_KINDS[number];

export class ProjectDocumentTooNewError extends Error {
    constructor(
        /** What kind of file this is; the catalogue names it for the author. */
        public readonly kind: ProjectDocumentKind,
        /**
         * What the sentence calls the file: its project-relative path for most kinds, and the
         * story's own name for a story document, whose path is made of an id nothing should print.
         */
        public readonly subject: string,
        /** The version the file on disk is written at. */
        public readonly version: number,
        /** The newest version this build reads. */
        public readonly supportedVersion: number,
    ) {
        super(
            `${subject} was written by a newer version of Studio`
            + ` (${kind} schema v${version}; this build reads v${supportedVersion})`,
        );
        this.name = "ProjectDocumentTooNewError";
    }
}

export type ProjectDocumentGate = {
    kind: ProjectDocumentKind;
    /** See {@link ProjectDocumentTooNewError.subject}. */
    subject: string;
    supportedVersion: number;
    /** The field carrying the version; `schemaVersion` unless a format spells it otherwise. */
    field?: string;
};

/** The version a raw document claims, or undefined when it claims none a reader could compare. */
export function readDocumentSchemaVersion(raw: unknown, field = "schemaVersion"): number | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return undefined;
    }
    const value = (raw as Record<string, unknown>)[field];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Refuse `raw` before anything reads it, when a newer Studio wrote it.
 *
 * Called on the parsed JSON and nothing else: the whole point is that no normalizer, migrator or
 * compiler sees a document this build cannot represent, so the check has to sit between the parse
 * and the first reader.
 */
export function refuseNewerProjectDocument(raw: unknown, gate: ProjectDocumentGate): void {
    const version = readDocumentSchemaVersion(raw, gate.field);
    if (version !== undefined && version > gate.supportedVersion) {
        throw new ProjectDocumentTooNewError(gate.kind, gate.subject, version, gate.supportedVersion);
    }
}

/**
 * The {@link ProjectDocumentTooNewError} behind a failure, however many times it has been rewrapped.
 *
 * A refusal thrown deep inside a bundle assembly is caught and rethrown by the loaders above it, and
 * the boundary that has a language to say it in should not have to know how many wrappers sit
 * between it and the read.
 */
export function findProjectDocumentTooNewError(error: unknown): ProjectDocumentTooNewError | null {
    const seen = new Set<unknown>();
    let current = error;
    while (current && typeof current === "object" && !seen.has(current)) {
        if (current instanceof ProjectDocumentTooNewError) {
            return current;
        }
        seen.add(current);
        current = (current as { cause?: unknown }).cause;
    }
    return null;
}
