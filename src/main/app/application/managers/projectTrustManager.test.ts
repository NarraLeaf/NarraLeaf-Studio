import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_TRUST_LEDGER_VERSION } from "@shared/types/projectTrust";
import { ProjectTrustManager } from "./projectTrustManager";

vi.mock("electron", () => ({
    app: {
        getPath: () => "/tmp",
    },
}));

vi.mock("@shared/utils/persistentState", () => ({
    PersistentState: class<T extends Record<string, any>> {
        private store: T;

        constructor(config: { defaults: T }) {
            this.store = JSON.parse(JSON.stringify(config.defaults));
        }

        getItem<K extends keyof T>(key: K): T[K] {
            return this.store[key];
        }

        setItem<K extends keyof T>(key: K, value: T[K]): void {
            this.store[key] = value;
        }
    },
}));

const T1 = "2026-09-01T00:00:00.000Z";
const T2 = "2026-09-02T00:00:00.000Z";

/** The raw store behind a manager, for seeding a ledger an earlier Studio wrote. */
function storeOf(manager: ProjectTrustManager) {
    return (manager as unknown as { state: { setItem(key: string, value: unknown): void; getItem(key: string): unknown } }).state;
}

describe("ProjectTrustManager", () => {
    let manager: ProjectTrustManager;

    beforeEach(async () => {
        manager = new ProjectTrustManager("/tmp/userData");
        await manager.initialize(() => [], T1);
    });

    it("distrusts a project it never met", () => {
        // The whole of absence-means-distrusted. A moved folder, a lost ledger and a route nobody
        // recorded all land here, and here is the safe side.
        expect(manager.isTrusted("D:/games/unknown")).toBe(false);
        expect(manager.getRecord("D:/games/unknown")).toBeUndefined();
    });

    it("trusts a project Studio wrote, without listing it", () => {
        // Studio vouches for its own work and the author is never asked about it - which is what
        // keeps the settings list a list of the author's decisions.
        manager.recordArrival("D:/games/mine", "created", T1);
        expect(manager.isTrusted("D:/games/mine")).toBe(true);
        expect(manager.getRecord("D:/games/mine")?.vouchedBy).toBe("studio");
        expect(manager.listTrusted()).toEqual([]);
        expect(manager.listDistrusted()).toEqual([]);
    });

    it.each(["package", "remote", "opened"] as const)("leaves a project that arrived by %s waiting", origin => {
        manager.recordArrival("D:/games/theirs", origin, T1);
        expect(manager.isTrusted("D:/games/theirs")).toBe(false);
        expect(manager.listDistrusted().map(r => r.origin)).toEqual([origin]);
    });

    it("trusts a project named to a command-line build, in the author's name", () => {
        // Naming a project to `--build` is the decision Settings asks for, made at a keyboard, so
        // it is listed as the author's - and can be withdrawn there like any other.
        manager.recordArrival("D:/games/ci", "command-line", T1);
        expect(manager.isTrusted("D:/games/ci")).toBe(true);
        expect(manager.listTrusted().map(r => [r.origin, r.vouchedBy])).toEqual([["command-line", "author"]]);
    });

    it("grants a waiting project when an arrival vouches for it, and changes nothing otherwise", () => {
        manager.recordArrival("D:/games/theirs", "package", T1);
        expect(manager.recordArrival("D:/games/theirs", "command-line", T2)).toBe(true);
        expect(manager.isTrusted("D:/games/theirs")).toBe(true);
        expect(manager.getRecord("D:/games/theirs")?.origin).toBe("package");

        expect(manager.recordArrival("D:/games/theirs", "command-line", T2)).toBe(false);
    });

    it("does not let Studio's own vouch override a project the author left waiting", () => {
        // The migration and the wizard vouch implicitly; only a person's explicit act changes a
        // decision that is pending.
        manager.recordArrival("D:/games/theirs", "package", T1);
        expect(manager.recordArrival("D:/games/theirs", "recent", T2)).toBe(false);
        expect(manager.recordArrival("D:/games/theirs", "created", T2)).toBe(false);
        expect(manager.isTrusted("D:/games/theirs")).toBe(false);
    });

    it("keeps a decision when the project is met again", () => {
        // Opening it is not new evidence about the author's intent, in either direction.
        manager.recordArrival("D:/games/theirs", "package", T1);
        manager.grantTrust("D:/games/theirs", T2);
        expect(manager.recordArrival("D:/games/theirs", "opened", T2)).toBe(false);
        expect(manager.isTrusted("D:/games/theirs")).toBe(true);

        manager.recordArrival("D:/games/waiting", "remote", T1);
        expect(manager.recordArrival("D:/games/waiting", "opened", T2)).toBe(false);
        expect(manager.isTrusted("D:/games/waiting")).toBe(false);
    });

    it("keeps the more specific origin", () => {
        // A package that was opened later is still a package; a folder that later turns out to
        // have been an import is now known to be one.
        manager.recordArrival("D:/games/pkg", "package", T1);
        manager.recordArrival("D:/games/pkg", "opened", T2);
        expect(manager.getRecord("D:/games/pkg")?.origin).toBe("package");

        manager.recordArrival("D:/games/folder", "opened", T1);
        manager.recordArrival("D:/games/folder", "remote", T2);
        expect(manager.getRecord("D:/games/folder")?.origin).toBe("remote");
    });

    it("keeps the arrival after trust is granted, so revoking returns it to waiting", () => {
        manager.recordArrival("D:/games/imported", "package", T1);
        expect(manager.grantTrust("D:/games/imported", T2)).toBe(true);
        expect(manager.isTrusted("D:/games/imported")).toBe(true);
        expect(manager.getRecord("D:/games/imported")?.vouchedBy).toBe("author");

        expect(manager.revokeTrust("D:/games/imported")).toBe(true);
        expect(manager.isTrusted("D:/games/imported")).toBe(false);
        expect(manager.getRecord("D:/games/imported")?.origin).toBe("package");
        expect(manager.getRecord("D:/games/imported")?.seenAt).toBe(T1);
        expect(manager.listDistrusted().map(r => r.displayPath)).toEqual(["D:/games/imported"]);
    });

    it("answers the same for every spelling of one path", () => {
        // Four spellings of one directory were four projects once already, which is what
        // `normalizeProjectPath` exists for. A gate that misses on another spelling of a trusted
        // project refuses the author's own work, which is the failure they would notice.
        manager.recordArrival("D:\\games\\Mine\\", "created", T1);
        expect(manager.isTrusted("D:/games/mine")).toBe(true);
        expect(manager.isTrusted("d:\\GAMES\\mine")).toBe(true);
    });

    it("will not invent a row for a project it never met", () => {
        expect(manager.grantTrust("D:/games/unknown", T2)).toBe(false);
        expect(manager.getRecord("D:/games/unknown")).toBeUndefined();
        expect(manager.listTrusted()).toEqual([]);
    });

    it("reports nothing to revoke for a project that is already waiting", () => {
        manager.recordArrival("D:/games/imported", "remote", T1);
        expect(manager.revokeTrust("D:/games/imported")).toBe(false);
    });

    it("keeps the spelling the author saw, and keys on the normalized one", () => {
        manager.recordArrival("D:\\Games\\Imported", "package", T1);
        const record = manager.getRecord("D:/games/imported");
        expect(record?.displayPath).toBe("D:\\Games\\Imported");
        expect(record?.path).toBe("d:\\games\\imported");
    });

    it("separates the settings list from the projects still waiting", () => {
        manager.recordArrival("D:/a", "package", T1);
        manager.recordArrival("D:/b", "remote", T1);
        manager.recordArrival("D:/c", "created", T1);
        manager.grantTrust("D:/b", T2);

        expect(manager.listTrusted().map(r => r.displayPath)).toEqual(["D:/b"]);
        expect(manager.listDistrusted().map(r => r.displayPath)).toEqual(["D:/a"]);
    });

    it("governs a project folder nested inside an arrival", () => {
        // A package or a clone is a tree, and a tree can hold a second `.nlproj` deeper down. The
        // author asked to open the inner folder is opening the same arrival, so the outer row
        // answers for it - waiting until trusted, and trusted once the author vouches for the tree.
        manager.recordArrival("D:/games/imported", "package", T1);
        expect(manager.isTrusted("D:/games/imported/inner")).toBe(false);
        expect(manager.getRecord("D:\\games\\Imported\\inner\\deeper")?.path).toBe("d:\\games\\imported");

        manager.grantTrust("D:/games/imported", T2);
        expect(manager.isTrusted("D:/games/imported/inner")).toBe(true);

        manager.revokeTrust("D:/games/imported");
        expect(manager.isTrusted("D:/games/imported/inner")).toBe(false);
    });

    it("adds no row for a folder opened inside a governed tree", () => {
        manager.recordArrival("D:/games/mine", "created", T1);
        expect(manager.recordArrival("D:/games/mine/sub", "opened", T2)).toBe(false);
        expect(manager.isTrusted("D:/games/mine/sub")).toBe(true);
        expect(manager.listDistrusted()).toEqual([]);
    });

    it("gives a package landing inside a trusted tree a row of its own", () => {
        // Somebody else's code is somebody else's code however trusted its surroundings are.
        manager.recordArrival("D:/games/mine", "created", T1);
        expect(manager.recordArrival("D:/games/mine/imports/theirs", "package", T2)).toBe(true);
        expect(manager.isTrusted("D:/games/mine/imports/theirs")).toBe(false);
        expect(manager.isTrusted("D:/games/mine/imports")).toBe(true);
    });

    it("does not let a sibling that shares a prefix inherit a row", () => {
        // `mine-2` is not inside `mine`, and a string-prefix walk would say it was.
        manager.recordArrival("D:/games/mine", "created", T1);
        expect(manager.isTrusted("D:/games/mine-2")).toBe(false);
        expect(manager.isTrusted("D:/games")).toBe(false);
    });

    it("prefers the nearest row when an arrival sits inside another", () => {
        manager.recordArrival("D:/games/outer", "created", T1);
        manager.recordArrival("D:/games/outer/inner", "remote", T2);
        expect(manager.isTrusted("D:/games/outer")).toBe(true);
        expect(manager.isTrusted("D:/games/outer/inner")).toBe(false);
    });

    it("forgets an arrival, and only one that was recorded", () => {
        manager.recordArrival("D:/games/imported", "package", T1);
        expect(manager.forgetArrival("D:/games/imported")).toBe(true);
        expect(manager.getRecord("D:/games/imported")).toBeUndefined();
        expect(manager.listDistrusted()).toEqual([]);
        expect(manager.forgetArrival("D:/games/imported")).toBe(false);
        expect(manager.forgetArrival("")).toBe(false);
    });

    it("treats an unusable path as a project nobody vouched for", () => {
        // No row can exist under an empty key, and nothing that has no key may run.
        expect(manager.isTrusted("")).toBe(false);
        expect(manager.recordArrival("", "created", T1)).toBe(false);
        expect(manager.listTrusted()).toEqual([]);
    });
});

/**
 * Bringing up a ledger the first Studio wrote: rows without a voucher, and an author whose projects
 * ran unlisted until now.
 */
describe("ProjectTrustManager migration", () => {
    it("fills in who vouched for rows the first ledger wrote, and keeps their decisions", async () => {
        const manager = new ProjectTrustManager("/tmp/userData");
        storeOf(manager).setItem("project.trust", {
            "d:\\games\\trusted": {
                path: "d:\\games\\trusted", displayPath: "D:\\games\\trusted", origin: "package", importedAt: T1, trustedAt: T2,
            },
            "d:\\games\\waiting": {
                path: "d:\\games\\waiting", displayPath: "D:\\games\\waiting", origin: "remote", importedAt: T1, trustedAt: null,
            },
        });

        await manager.initialize(() => [], T2);

        expect(manager.getRecord("D:/games/trusted")).toMatchObject({ trustedAt: T2, vouchedBy: "author", seenAt: T1 });
        expect(manager.getRecord("D:/games/waiting")).toMatchObject({ trustedAt: null, vouchedBy: null, seenAt: T1 });
        expect(manager.listTrusted().map(r => r.displayPath)).toEqual(["D:\\games\\trusted"]);
        expect(storeOf(manager).getItem("project.trust.version")).toBe(PROJECT_TRUST_LEDGER_VERSION);
    });

    it("vouches for the projects the author was already working in, once", async () => {
        // Their recent list is the closest thing to "Studio already knew these". Vouched by Studio,
        // so an upgrade does not turn their own work into a list of questions - and not shown, for
        // the same reason a project the wizard wrote is not.
        const manager = new ProjectTrustManager("/tmp/userData");
        storeOf(manager).setItem("project.trust", {
            "d:\\games\\waiting": {
                path: "d:\\games\\waiting", displayPath: "D:\\games\\waiting", origin: "package", importedAt: T1, trustedAt: null,
            },
        });
        const remembered = [{ path: "D:\\games\\mine" }, { path: "D:\\games\\waiting" }, { path: "" }];

        await manager.initialize(() => remembered, T2);

        expect(manager.isTrusted("D:/games/mine")).toBe(true);
        expect(manager.getRecord("D:/games/mine")).toMatchObject({ origin: "recent", vouchedBy: "studio" });
        // A remembered project that was already waiting stays waiting: the author's earlier
        // decision to import it as somebody else's outranks a list entry.
        expect(manager.isTrusted("D:/games/waiting")).toBe(false);
        expect(manager.listTrusted()).toEqual([]);

        // A second start does not migrate again, so a project the author has since withdrawn
        // trust from is not re-vouched by the list it is still in.
        manager.revokeTrust("D:/games/mine");
        await manager.initialize(() => remembered, T2);
        expect(manager.isTrusted("D:/games/mine")).toBe(false);
    });
});
