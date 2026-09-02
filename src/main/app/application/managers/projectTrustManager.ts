import path from "path";
import { UserDataNamespace } from "@shared/types/constants";
import {
    isProjectTrusted,
    type ProjectImportOrigin,
    type ProjectTrustRecord,
    type ProjectTrustTable,
} from "@shared/types/projectTrust";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { PersistentState } from "@shared/utils/persistentState";
import type { PersistentStateConfig } from "@shared/types/persistentState";

interface ProjectTrustState extends Record<string, any> {
    "project.trust": ProjectTrustTable;
}

const DEFAULT_STATE: ProjectTrustState = {
    "project.trust": {},
};

/**
 * A normalized key followed by each of its ancestors, nearest first, stopping short of the root.
 *
 * Splits on both separators because {@link normalizeProjectPath} writes `\` on Windows and leaves
 * `/` alone elsewhere, and this manager is tested under both rules on one machine. An empty key
 * yields nothing, which is how an unusable path stays "nobody imported it".
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
 * Which projects arrived from elsewhere, and which of those the author has since trusted.
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
 * # The one honest weakness
 *
 * Absence means trusted, so losing this file turns previously-distrusted projects into trusted
 * ones. That follows from recording only external arrivals rather than distrusting everything
 * unlisted, and it is the accepted cost of not asking about every project the author already has.
 * It is also why {@link recordImport} never silently drops a write: an arrival that fails to record
 * is a project that will be trusted forever after.
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

    public initialize(): Promise<void> {
        return Promise.resolve();
    }

    private table(): ProjectTrustTable {
        return this.state.getItem("project.trust") ?? {};
    }

    private write(table: ProjectTrustTable): void {
        this.state.setItem("project.trust", table);
    }

    /**
     * The record governing a project, or `undefined` when Studio never saw it arrive.
     *
     * The project's own row when it has one, else the nearest ancestor's. An arrival is a tree,
     * not a path: a package or a clone can carry a second project folder inside the first, and an
     * author told to "open the inner folder" would otherwise be opening it with no row at all -
     * which, under absence-means-trusted, is a project from outside that Studio trusts. Whatever
     * the author decided about the tree applies to everything in it, so trusting the outer project
     * trusts the inner one too, and withdrawing that trust withdraws it from both.
     */
    public getRecord(projectPath: string): ProjectTrustRecord | undefined {
        const table = this.table();
        for (const key of selfAndAncestors(normalizeProjectPath(projectPath))) {
            const record = table[key];
            if (record) {
                return record;
            }
        }
        return undefined;
    }

    /**
     * Whether this project may cause effects.
     *
     * The question every gate asks. Keep it total: a path that normalizes to nothing is a path
     * nobody imported, and refusing it would break opening projects rather than protect anything.
     */
    public isTrusted(projectPath: string): boolean {
        return isProjectTrusted(this.getRecord(projectPath));
    }

    /**
     * Remember that a project arrived from outside, leaving it distrusted.
     *
     * Called by every route that brings a project in from elsewhere. Re-recording an arrival for a
     * path that is already trusted does **not** revoke that trust: re-importing over a folder the
     * author vouched for is not new evidence about the author's intent, and silently distrusting
     * their working project would read as Studio breaking.
     */
    public recordImport(projectPath: string, origin: ProjectImportOrigin, now: string): void {
        const key = normalizeProjectPath(projectPath);
        if (!key) {
            return;
        }
        const table = this.table();
        const existing = table[key];
        table[key] = {
            path: key,
            displayPath: projectPath,
            origin,
            importedAt: existing?.importedAt ?? now,
            trustedAt: existing?.trustedAt ?? null,
        };
        this.write(table);
    }

    /**
     * The author vouches for this project.
     *
     * A no-op for a project with no record: it was already trusted, and inventing a row for it
     * would put a project the author wrote into the settings list of things they had to vouch for.
     */
    public grantTrust(projectPath: string, now: string): boolean {
        const key = normalizeProjectPath(projectPath);
        const table = this.table();
        const existing = key ? table[key] : undefined;
        if (!existing) {
            return false;
        }
        table[key] = { ...existing, trustedAt: now };
        this.write(table);
        return true;
    }

    /**
     * Take the trust back, from the settings list.
     *
     * Clears the grant and **keeps the arrival**, which is what makes the next launch distrusted
     * rather than indistinguishable from a project the author wrote themselves.
     */
    public revokeTrust(projectPath: string): boolean {
        const key = normalizeProjectPath(projectPath);
        const table = this.table();
        const existing = key ? table[key] : undefined;
        if (!existing || existing.trustedAt === null) {
            return false;
        }
        table[key] = { ...existing, trustedAt: null };
        this.write(table);
        return true;
    }

    /**
     * Drop an arrival that left nothing behind.
     *
     * For the routes that record before they copy - the safe order, since a copy that lands
     * unrecorded is a project trusted by accident - when the copy then fails without writing a
     * byte. A row for an empty folder would sit in the settings list as a project waiting for a
     * decision that no folder exists to receive. Whether the folder is empty is the caller's to
     * check; this only forgets.
     */
    public forgetImport(projectPath: string): boolean {
        const key = normalizeProjectPath(projectPath);
        const table = this.table();
        if (!key || !table[key]) {
            return false;
        }
        delete table[key];
        this.write(table);
        return true;
    }

    /** Every project the author has vouched for, newest grant first - the settings list. */
    public listTrusted(): ProjectTrustRecord[] {
        return Object.values(this.table())
            .filter(record => record.trustedAt !== null)
            .sort((a, b) => (b.trustedAt ?? "").localeCompare(a.trustedAt ?? ""));
    }

    /** Every arrival still awaiting a decision. */
    public listDistrusted(): ProjectTrustRecord[] {
        return Object.values(this.table())
            .filter(record => record.trustedAt === null)
            .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    }
}
