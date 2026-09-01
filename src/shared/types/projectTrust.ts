/**
 * Whether a project is allowed to cause effects.
 *
 * A project is not only data. It ships JavaScript that Studio executes: a puppet backend lives at
 * `<project>/runtimes/puppet/<backend>/index.js` and is `import()`ed into the workspace renderer the
 * moment anything shows a model - the character editor, a story row's inspector, an `nl.puppet`
 * widget on a canvas, and one offscreen probe that no gesture starts. That is deliberate and cannot
 * be designed away: the Live2D and Spine licences forbid shipping their renderers, so the renderer
 * has to be the author's own file. Nor is it confined to puppets - a workspace window holds a
 * recursive read grant over the whole project and `app://fs/` types its responses by extension, so
 * any `.js` in the tree can be minted into a module URL.
 *
 * Opening a project you wrote yourself is therefore fine, and opening one that arrived from
 * somebody else is running their code. Distrust is what separates the two.
 *
 * # What this is not
 *
 * Not a freeze. Freeze answers "may Studio write to this project"; this answers "may this project
 * make Studio do something". They are different axes and a distrusted project stays fully
 * editable - the author can open it, read it, and change it. Only execution, fetching and the
 * other risky primitives are refused.
 *
 * Not recovery mode either. That one is per window, lives in memory, is forgotten on restart, and
 * deliberately guts the service graph; and it was ruled to be for damage nobody can explain rather
 * than a general "open this safely" door.
 */

/**
 * How a project arrived, for the arrivals Studio can name.
 *
 * Only external arrivals are recorded. A project the author created, or opened from a path they
 * chose, has no record and is trusted - which is the decision, not an omission: a table of "what
 * counts as external" is itself the thing an attacker studies, and the alternative (distrust
 * everything unlisted) would have every existing project ask for trust once.
 *
 * The cost of that choice is real and no test closes it: a new external route that forgets to
 * record its arrivals produces a project that is trusted forever, silently, in exactly the case
 * this exists for. `projectTrustOrigins.test.ts` narrows the gap rather than shutting it - it holds
 * this union and the recording sites against each other and names the sites explicitly, so a
 * removed writer or an undeclared origin fails, and adding a route is at least a visible diff.
 * Whoever adds the next way a project can arrive has to remember. That is the trade the "only
 * external arrivals" decision buys, and it is worth knowing it was bought rather than assumed.
 */
export type ProjectImportOrigin =
    /** Unpacked from an `.nlspkg` project package. */
    | "package"
    /** Cloned or pulled from a remote source. */
    | "remote";

/**
 * One project Studio has seen arrive from elsewhere.
 *
 * The record outlives the decision on purpose. Granting trust sets {@link trustedAt} rather than
 * deleting the row, so revoking it from settings returns the project to distrusted instead of
 * making it indistinguishable from one the author wrote - "remove the trusted folder and the next
 * launch is distrusted again" only works if the arrival is still remembered.
 */
export type ProjectTrustRecord = {
    /**
     * `normalizeProjectPath()` of the project directory, and the key of the table holding it.
     *
     * The path, never the project's own `identifier`: that identifier is a field inside the
     * project, which is the untrusted thing here. A project that copied another's identifier would
     * inherit its trust.
     */
    path: string;
    /** The path as it was spelled when recorded, for showing in settings. */
    displayPath: string;
    origin: ProjectImportOrigin;
    /** ISO timestamp of the arrival. */
    importedAt: string;
    /** ISO timestamp of the author's grant, or `null` while the project is distrusted. */
    trustedAt: string | null;
};

export type ProjectTrustTable = Record<string, ProjectTrustRecord>;

/**
 * Whether a project may cause effects.
 *
 * Absence means trusted, and that is the whole of the "only external arrivals" decision expressed
 * in one line. Anything asking this question must ask the main process: a renderer that could
 * answer it could also answer it wrongly, and the project's own code runs in a renderer.
 */
export function isProjectTrusted(record: ProjectTrustRecord | undefined | null): boolean {
    return !record || record.trustedAt !== null;
}

/** The reason a distrusted project gives when it refuses something, for logs and diagnostics. */
export const PROJECT_DISTRUSTED_REASON = "project-distrusted" as const;
