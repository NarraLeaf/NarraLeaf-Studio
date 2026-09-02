import path from "path";
import { UserDataNamespace } from "@shared/types/constants";
import {
    isProjectTrusted,
    PROJECT_TRUST_LEDGER_VERSION,
    PROJECT_TRUST_ON_ARRIVAL,
    type ProjectTrustOrigin,
    type ProjectTrustRecord,
    type ProjectTrustTable,
} from "@shared/types/projectTrust";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { PersistentState } from "@shared/utils/persistentState";
import type { PersistentStateConfig } from "@shared/types/persistentState";

interface ProjectTrustState extends Record<string, any> {
    "project.trust": ProjectTrustTable;
    "project.trust.version": number;
}

const DEFAULT_STATE: ProjectTrustState = {
    "project.trust": {},
    "project.trust.version": 0,
};

/** A row as the first version of the ledger wrote it, before it said who vouched or when it was met. */
type LegacyProjectTrustRecord = Partial<ProjectTrustRecord> & { importedAt?: string };

/**
 * A normalized key followed by each of its ancestors, nearest first, stopping short of the root.
 *
 * Splits on both separators because {@link normalizeProjectPath} writes `\` on Windows and leaves
 * `/` alone elsewhere, and this manager is tested under both rules on one machine. An empty key
 * yields nothing, which is how an unusable path stays a project nobody vouched for.
 */
function selfAndAncestors(key: string): string[] {
    const keys: string[] = [];
    let current = key;
    while (current) {
        keys.push(current);
        const cut = Math.max(current.lastIndexOf("\\"), current.lastIndexOf("/"));
        if (cut <= 0) {
            break;
        }
        current = current.slice(0, cut);
    }
    return keys;
}

/**
 * Which projects may run: the ones Studio wrote, and the ones the author has vouched for.
 *
 * # Why this lives in the main process
 *
 * Because the renderer is where the untrusted code runs. A project's puppet backend is `import()`ed
 * into the workspace renderer's own realm, so any answer computed there is an answer that code
 * could have influenced; and a keybinding, a second window or a stale renderer can all ask for a
 * build regardless of what the first one believed. Main is the only place that can say no and mean
 * it. This is the property workspace freeze does *not* have - its state is reported to main by the
 * renderer - and the difference is deliberate.
 *
 * # Why it lives under `authorization/`
 *
 * That directory is a protected storage root: no renderer reaches it, not even with the
 * experimental unscoped-file-access flag. It sits beside `plugin-permissions.config`, which is the
 * same kind of thing - a record of what a person decided to allow.
 *
 * It is emphatically *not* stored inside the project. The project is the thing being judged; a mark
 * it could edit is a mark it could remove.
 *
 * # Absence means distrusted
 *
 * A project with no row does not run. Losing this file, moving a folder, or opening a project by a
 * route nobody recorded all land on the safe side, at the price of the author vouching once more.
 * The first version of the ledger had it the other way round - only external arrivals were
 * recorded, and everything unlisted ran - which is why {@link initialize} migrates: the projects the
 * author already had in their recent list are vouched for by Studio on the way up, so an upgrade
 * does not turn their own work into a list of questions.
 */
export class ProjectTrustManager {
    private readonly state: PersistentState<ProjectTrustState>;

    constructor(userDataDir: string) {
        const dbPath = path.join(userDataDir, UserDataNamespace.Authorization, "project-trust.config");
        const config: PersistentStateConfig<ProjectTrustState> = {
            dbPath,
            defaults: DEFAULT_STATE,
        };
        this.state = new PersistentState(config);
    }

    /**
     * Bring a ledger written by an earlier Studio up to the current shape.
     *
     * `rememberedProjects` is the recent-projects list. A ledger below the current version comes
     * from a Studio in which an unlisted project ran, so the projects the author was working in
     * are vouched for by Studio as the version turns - once, and only for paths that have no row
     * yet. Rows the author already decided keep their decision and learn who made it.
     */
    public initialize(
        rememberedProjects: () => readonly { path: string }[] = () => [],
        now: string = new Date().toISOString(),
    ): Promise<void> {
        const version = this.state.getItem("project.trust.version") ?? 0;
        if (version < PROJECT_TRUST_LEDGER_VERSION) {
            this.migrate(rememberedProjects(), now);
            this.state.setItem("project.trust.version", PROJECT_TRUST_LEDGER_VERSION);
        }
        return Promise.resolve();
    }

    private migrate(remembered: readonly { path: string }[], now: string): void {
        const table = this.table();
        for (const [key, row] of Object.entries(table as Record<string, LegacyProjectTrustRecord>)) {
            const trustedAt = row.trustedAt ?? null;
            table[key] = {
                path: row.path ?? key,
                displayPath: row.displayPath ?? key,
                origin: row.origin ?? "opened",
                seenAt: row.seenAt ?? row.importedAt ?? now,
                trustedAt,
                vouchedBy: row.vouchedBy ?? (trustedAt !== null ? "author" : null),
            };
        }
        this.write(table);
        for (const project of remembered) {
            this.recordArrival(project.path, "recent", now);
        }
    }

    private table(): ProjectTrustTable {
        return this.state.getItem("project.trust") ?? {};
    }

    private write(table: ProjectTrustTable): void {
        this.state.setItem("project.trust", table);
    }

    /** The row for exactly this key, or the nearest ancestor's. */
    private governing(table: ProjectTrustTable, key: string): ProjectTrustRecord | undefined {
        for (const candidate of selfAndAncestors(key)) {
            const record = table[candidate];
            if (record) {
                return record;
            }
        }
        return undefined;
    }

    /**
     * The record governing a project, or `undefined` when Studio never met it.
     *
     * The project's own row when it has one, else the nearest ancestor's. An arrival is a tree,
     * not a path: a package or a clone can carry a second project folder inside the first, and an
     * author told to "open the inner folder" is opening the same arrival. Whatever the author
     * decided about the tree applies to everything in it - trusting the outer project trusts the
     * inner one too, and withdrawing that trust withdraws it from both.
     */
    public getRecord(projectPath: string): ProjectTrustRecord | undefined {
        return this.governing(this.table(), normalizeProjectPath(projectPath));
    }

    /**
     * Whether this project may cause effects.
     *
     * The question every gate asks. A path that normalizes to nothing is not a project anybody
     * vouched for, and answers no like any other absence.
     */
    public isTrusted(projectPath: string): boolean {
        return isProjectTrusted(this.getRecord(projectPath));
    }

    /**
     * Studio has met a project by this route; put it on the ledger.
     *
     * Called by every route that brings a project to a window. What the row says depends on the
     * origin - see `PROJECT_TRUST_ON_ARRIVAL`: a package, a clone or a folder Studio never saw
     * waits for the author, while a project Studio wrote, remembered from before the ledger, or
     * was told to build from the command line is vouched for on arrival.
     *
     * A project that already has a row keeps its decision. Meeting it again is not new evidence
     * about the author's intent, and silently distrusting the project they are working in would
     * read as Studio breaking. The one exception is an arrival the author vouches through - a
     * command-line build - which grants a row still waiting, because that arrival *is* their
     * decision; Studio's own vouches never override a row it has already met, so a project the
     * author left waiting stays waiting however it is met again. The origin is kept too, unless
     * the row only said "opened" and the arrival says something more specific.
     *
     * Opening a folder inside a tree that already has a row adds nothing: the ancestor's row
     * governs it. A package or a clone landing inside a trusted tree does get a row of its own,
     * because it is somebody else's code however trusted its surroundings are.
     *
     * Returns whether the ledger changed. Never drops a write silently: an arrival that fails to
     * record is a project that does not run, which is the safe side, but the caller may want to
     * know.
     */
    public recordArrival(projectPath: string, origin: ProjectTrustOrigin, now: string): boolean {
        const key = normalizeProjectPath(projectPath);
        if (!key) {
            return false;
        }
        const table = this.table();
        const voucher = PROJECT_TRUST_ON_ARRIVAL[origin];
        const own = table[key];
        if (own) {
            if (voucher === "author" && own.trustedAt === null) {
                table[key] = { ...own, trustedAt: now, vouchedBy: voucher };
                this.write(table);
                return true;
            }
            if (own.origin === "opened" && origin !== "opened") {
                table[key] = { ...own, origin };
                this.write(table);
                return true;
            }
            return false;
        }
        if (origin === "opened" && this.governing(table, key)) {
            return false;
        }
        table[key] = {
            path: key,
            displayPath: projectPath,
            origin,
            seenAt: now,
            trustedAt: voucher === null ? null : now,
            vouchedBy: voucher,
        };
        this.write(table);
        return true;
    }

    /**
     * The author vouches for this project, from Settings.
     *
     * Only for a project with a row of its own: the Settings page offers rows, and a grant for a
     * path nobody recorded would be a vouch for something Studio has not met.
     */
    public grantTrust(projectPath: string, now: string): boolean {
        const key = normalizeProjectPath(projectPath);
        const table = this.table();
        const existing = key ? table[key] : undefined;
        if (!existing) {
            return false;
        }
        table[key] = { ...existing, trustedAt: now, vouchedBy: "author" };
        this.write(table);
        return true;
    }

    /**
     * Take the trust back, from the settings list.
     *
     * Clears the grant and **keeps the row**, so the project returns to waiting and the author has
     * somewhere to change their mind again.
     */
    public revokeTrust(projectPath: string): boolean {
        const key = normalizeProjectPath(projectPath);
        const table = this.table();
        const existing = key ? table[key] : undefined;
        if (!existing || existing.trustedAt === null) {
            return false;
        }
        table[key] = { ...existing, trustedAt: null, vouchedBy: null };
        this.write(table);
        return true;
    }

    /**
     * Drop a row for an arrival that left nothing behind.
     *
     * For the routes that record before they copy - the safe order, since a copy that finished
     * unrecorded would be a project Studio never met - when the copy then fails without writing a
     * byte. A row for an empty folder would sit in the settings list as a project waiting for a
     * decision that no folder exists to receive. Whether the folder is empty is the caller's to
     * check; this only forgets.
     */
    public forgetArrival(projectPath: string): boolean {
        const key = normalizeProjectPath(projectPath);
        const table = this.table();
        if (!key || !table[key]) {
            return false;
        }
        delete table[key];
        this.write(table);
        return true;
    }

    /**
     * Every project the author vouched for, newest grant first - the settings list.
     *
     * Studio's own vouches are not in it. The page is a list of the author's decisions, and a
     * project they created or were already working in is not one they made.
     */
    public listTrusted(): ProjectTrustRecord[] {
        return Object.values(this.table())
            .filter(record => record.trustedAt !== null && record.vouchedBy === "author")
            .sort((a, b) => (b.trustedAt ?? "").localeCompare(a.trustedAt ?? ""));
    }

    /** Every project still waiting for a decision, newest first. */
    public listDistrusted(): ProjectTrustRecord[] {
        return Object.values(this.table())
            .filter(record => record.trustedAt === null)
            .sort((a, b) => b.seenAt.localeCompare(a.seenAt));
    }
}
