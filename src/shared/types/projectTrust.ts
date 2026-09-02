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
 * any `.js` in the tree can be minted into a module URL. That is why the handler behind `app://fs/`
 * asks this ledger before it types a response as something a page would run: a distrusted
 * project's scripts are served as text, whatever a renderer asked for.
 *
 * Opening a project you wrote yourself is therefore fine, and opening one that arrived from
 * somebody else is running their code. Trust is what separates the two.
 *
 * # The ledger is the list of what may run
 *
 * A project is trusted when its row says so, and only then. A project Studio created is on the
 * list from the moment the wizard writes it, vouched for by Studio and never shown to the author -
 * their own work is not something they are asked about. Everything else - a package, a clone, a
 * folder opened from the disk - gets a row the first time Studio meets it and waits on that row
 * until the author vouches for it under Settings, or names it to a command-line build, which is
 * the same decision made at a keyboard.
 *
 * Absence means distrusted. A moved folder, a lost ledger file or a route nobody thought to record
 * all fail towards "does not run" rather than towards running somebody else's code. The cost is
 * one decision per project Studio did not create, made once and kept.
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
 * How Studio first met a project.
 *
 * The origin decides who vouches on arrival - see {@link PROJECT_TRUST_ON_ARRIVAL} - and is shown
 * beside the project in Settings. Every route that brings a project to a window records one;
 * `projectTrustOrigins.test.ts` holds this union and the recording sites against each other, so
 * an origin nothing writes, or a writer naming an origin nothing declares, fails there.
 */
export type ProjectTrustOrigin =
    /** Unpacked from an `.nlspkg` project package. */
    | "package"
    /** Cloned from a remote source. */
    | "remote"
    /** Opened from a folder Studio had never seen before. */
    | "opened"
    /** Written by Studio's own project wizard. */
    | "created"
    /** Remembered in the recent-projects list from before the ledger existed. */
    | "recent"
    /** Named to `--build` on the command line. */
    | "command-line";

/**
 * Who vouched for a project.
 *
 * The author, from Settings or by naming the project to a build; or Studio, for a project it wrote
 * itself or already knew. Studio's vouches are never listed - the author is not asked about their
 * own work - which is what keeps the Settings page a list of the author's decisions.
 */
export type ProjectTrustVoucher = "author" | "studio";

/**
 * Who vouches for a project on arrival, by origin, or null for one that waits for the author.
 *
 * The three that vouch are the whole of what an attacker would want to reach: a route that records
 * one of them is a route that trusts a project without asking. Adding one here is a decision, and
 * the test beside the ledger names the sites that may record each.
 */
export const PROJECT_TRUST_ON_ARRIVAL: Readonly<Record<ProjectTrustOrigin, ProjectTrustVoucher | null>> = {
    package: null,
    remote: null,
    opened: null,
    created: "studio",
    recent: "studio",
    "command-line": "author",
};

/**
 * One project Studio has met.
 *
 * The record outlives the decision on purpose. Withdrawing trust clears {@link trustedAt} rather
 * than deleting the row, so the project returns to waiting instead of being forgotten - and a
 * forgotten project is a distrusted one, which is the same thing under absence-means-distrusted,
 * but a row is what the Settings page has to offer the author a way back.
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
    origin: ProjectTrustOrigin;
    /** ISO timestamp of when Studio first met the project. */
    seenAt: string;
    /** ISO timestamp of the grant, or `null` while the project waits for one. */
    trustedAt: string | null;
    /** Who granted it, or `null` while the project waits. */
    vouchedBy: ProjectTrustVoucher | null;
};

export type ProjectTrustTable = Record<string, ProjectTrustRecord>;

/**
 * The shape of the ledger on disk. Bumped when a row gains a field the reader has to fill in for
 * rows written before it existed; the manager migrates on start and stamps the new number.
 */
export const PROJECT_TRUST_LEDGER_VERSION = 2;

/**
 * Whether a project may cause effects.
 *
 * Absence means distrusted, and that is the whole of the ledger expressed in one line. Anything
 * asking this question must ask the main process: a renderer that could answer it could also
 * answer it wrongly, and the project's own code runs in a renderer.
 */
export function isProjectTrusted(record: ProjectTrustRecord | undefined | null): boolean {
    return record !== undefined && record !== null && record.trustedAt !== null;
}

/** The reason a distrusted project gives when it refuses something, for logs and diagnostics. */
export const PROJECT_DISTRUSTED_REASON = "project-distrusted" as const;
