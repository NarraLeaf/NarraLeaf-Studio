import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("ProjectTrustManager", () => {
    let manager: ProjectTrustManager;

    beforeEach(() => {
        manager = new ProjectTrustManager("/tmp/userData");
    });

    it("trusts a project it never saw arrive", () => {
        // The whole of the "only external arrivals are distrusted" decision. A project the author
        // made themselves has no row, and must not be asked about.
        expect(manager.isTrusted("D:/games/mine")).toBe(true);
        expect(manager.getRecord("D:/games/mine")).toBeUndefined();
    });

    it("distrusts a project that arrived from outside", () => {
        manager.recordImport("D:/games/imported", "package", T1);
        expect(manager.isTrusted("D:/games/imported")).toBe(false);
    });

    it("keeps the arrival after trust is granted, so revoking returns it to distrusted", () => {
        // This is the whole reason the row is not deleted on either edge: "remove the folder from
        // settings and the next launch is distrusted" only works if the arrival is remembered.
        manager.recordImport("D:/games/imported", "package", T1);
        expect(manager.grantTrust("D:/games/imported", T2)).toBe(true);
        expect(manager.isTrusted("D:/games/imported")).toBe(true);

        expect(manager.revokeTrust("D:/games/imported")).toBe(true);
        expect(manager.isTrusted("D:/games/imported")).toBe(false);
        expect(manager.getRecord("D:/games/imported")?.origin).toBe("package");
        expect(manager.getRecord("D:/games/imported")?.importedAt).toBe(T1);
    });

    it("answers the same for every spelling of one path", () => {
        // Four spellings of one directory were four projects once already, which is what
        // `normalizeProjectPath` exists for. A trust gate that misses on the other spelling fails
        // open, and that is the one failure mode nobody would notice.
        manager.recordImport("D:\\games\\Imported\\", "package", T1);
        expect(manager.isTrusted("D:/games/imported")).toBe(false);
        expect(manager.isTrusted("d:\\GAMES\\imported")).toBe(false);
    });

    it("does not revoke trust when an already-trusted project is imported over again", () => {
        // Re-importing over a folder the author vouched for says nothing new about their intent,
        // and silently distrusting the project they are working in reads as Studio breaking.
        manager.recordImport("D:/games/imported", "package", T1);
        manager.grantTrust("D:/games/imported", T2);
        manager.recordImport("D:/games/imported", "remote", T2);
        expect(manager.isTrusted("D:/games/imported")).toBe(true);
        expect(manager.getRecord("D:/games/imported")?.origin).toBe("remote");
    });

    it("will not invent a row for a project that was never imported", () => {
        // Granting trust to a project that already had it would put the author's own work into the
        // settings list of things they had to vouch for.
        expect(manager.grantTrust("D:/games/mine", T2)).toBe(false);
        expect(manager.getRecord("D:/games/mine")).toBeUndefined();
        expect(manager.listTrusted()).toEqual([]);
    });

    it("reports nothing to revoke for a project that is already distrusted", () => {
        manager.recordImport("D:/games/imported", "remote", T1);
        expect(manager.revokeTrust("D:/games/imported")).toBe(false);
    });

    it("keeps the spelling the author saw, and keys on the normalized one", () => {
        manager.recordImport("D:\\Games\\Imported", "package", T1);
        const record = manager.getRecord("D:/games/imported");
        expect(record?.displayPath).toBe("D:\\Games\\Imported");
        expect(record?.path).toBe("d:\\games\\imported");
    });

    it("separates the settings list from the projects still awaiting a decision", () => {
        manager.recordImport("D:/a", "package", T1);
        manager.recordImport("D:/b", "remote", T1);
        manager.grantTrust("D:/b", T2);

        expect(manager.listTrusted().map(r => r.displayPath)).toEqual(["D:/b"]);
        expect(manager.listDistrusted().map(r => r.displayPath)).toEqual(["D:/a"]);
    });

    it("governs a project folder nested inside an arrival", () => {
        // A package or a clone is a tree, and a tree can hold a second `.nlproj` deeper down. The
        // author asked to open the inner folder is opening the same arrival, so the outer row
        // answers for it - distrusted until trusted, and trusted once the author vouches for the
        // tree.
        manager.recordImport("D:/games/imported", "package", T1);
        expect(manager.isTrusted("D:/games/imported/inner")).toBe(false);
        expect(manager.isTrusted("D:\\games\\Imported\\inner\\deeper")).toBe(false);
        expect(manager.getRecord("D:/games/imported/inner")?.path).toBe("d:\\games\\imported");

        manager.grantTrust("D:/games/imported", T2);
        expect(manager.isTrusted("D:/games/imported/inner")).toBe(true);

        manager.revokeTrust("D:/games/imported");
        expect(manager.isTrusted("D:/games/imported/inner")).toBe(false);
    });

    it("does not let a sibling that shares a prefix inherit a row", () => {
        // `imported-2` is not inside `imported`, and a string-prefix walk would say it was.
        manager.recordImport("D:/games/imported", "package", T1);
        expect(manager.isTrusted("D:/games/imported-2")).toBe(true);
        expect(manager.isTrusted("D:/games")).toBe(true);
    });

    it("prefers the nearest row when an arrival sits inside another", () => {
        manager.recordImport("D:/games/outer", "package", T1);
        manager.recordImport("D:/games/outer/inner", "remote", T2);
        manager.grantTrust("D:/games/outer", T2);
        // The inner arrival has its own row, still waiting; the outer grant does not reach past it.
        expect(manager.isTrusted("D:/games/outer")).toBe(true);
        expect(manager.isTrusted("D:/games/outer/inner")).toBe(false);
    });

    it("forgets an arrival, and only one that was recorded", () => {
        manager.recordImport("D:/games/imported", "package", T1);
        expect(manager.forgetImport("D:/games/imported")).toBe(true);
        expect(manager.isTrusted("D:/games/imported")).toBe(true);
        expect(manager.listDistrusted()).toEqual([]);
        expect(manager.forgetImport("D:/games/imported")).toBe(false);
        expect(manager.forgetImport("")).toBe(false);
    });

    it("treats an unusable path as one nobody imported", () => {
        // Total on purpose: refusing here would break opening projects rather than protect
        // anything, and there is nothing to protect - no row can exist under an empty key.
        expect(manager.isTrusted("")).toBe(true);
        manager.recordImport("", "package", T1);
        expect(manager.listDistrusted()).toEqual([]);
    });
});
