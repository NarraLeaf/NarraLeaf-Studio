import { beforeEach, describe, expect, it, vi } from "vitest";
import { installPrebuiltPuppetRuntime } from "./installPuppetRuntime";
import { resetProjectTrustCacheForTests } from "@/lib/workspace/projectTrust";
import type { Porject } from "@/lib/workspace/project/project";

const query = vi.fn();
const isDirExists = vi.fn();
const list = vi.fn();
const copyDir = vi.fn();
const createDir = vi.fn();
const copyFile = vi.fn();
const deleteDir = vi.fn();

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ projectTrust: { query } }),
}));

vi.mock("@/lib/app/privilegedFacade", () => ({
    appPrivilegedFacade: {
        fs: {
            isDirExists: (...args: unknown[]) => isDirExists(...args),
            list: (...args: unknown[]) => list(...args),
            copyDir: (...args: unknown[]) => copyDir(...args),
            createDir: (...args: unknown[]) => createDir(...args),
            copyFile: (...args: unknown[]) => copyFile(...args),
            deleteDir: (...args: unknown[]) => deleteDir(...args),
        },
    },
}));

const project = {
    resolve: (...parts: (string | readonly string[])[]) =>
        ["D:/games/theirs", ...parts.flatMap(p => (Array.isArray(p) ? p : [p]))].join("/"),
} as unknown as Porject;

/**
 * Installing a prebuilt runtime ends in loading the module, so a distrusted project cannot finish it.
 *
 * The point of these two cases is *where* it stops. The load is the last step and its refusal used to
 * arrive after the whole directory had been copied into the project - so the author watched an install
 * happen, get undone, and fail with the single word "distrusted".
 */
describe("installing a prebuilt puppet runtime into a distrusted project", () => {
    beforeEach(() => {
        resetProjectTrustCacheForTests();
        for (const fn of [query, isDirExists, list, copyDir, createDir, copyFile, deleteDir]) {
            fn.mockReset();
        }
    });

    it("refuses before anything is written, and says what to do about it", async () => {
        query.mockResolvedValue({ success: true, data: { trusted: false, record: null } });

        await expect(installPrebuiltPuppetRuntime(project, "spine", { kind: "directory", path: "D:/sdk/spine" }))
            .rejects.toThrow(/not trusted[\s\S]*Settings/);

        // Not one call to the file system: no probe of the target, no copy, and therefore no
        // rollback either. A rollback that leaves the project as it was is still the author
        // watching work happen and be undone for a reason they were told a minute too late.
        for (const fn of [isDirExists, list, copyDir, createDir, copyFile, deleteDir]) {
            expect(fn).not.toHaveBeenCalled();
        }
    });

    it("gets as far as the ordinary checks for a trusted project", async () => {
        query.mockResolvedValue({ success: true, data: { trusted: true, record: null } });
        isDirExists.mockResolvedValue({ success: true, data: { ok: true, data: true } });

        // Refused because a runtime by that name is already installed, which is the check that sits
        // immediately after the trust one - proof that trust let it through rather than that some
        // other guard stopped it.
        await expect(installPrebuiltPuppetRuntime(project, "spine", { kind: "directory", path: "D:/sdk/spine" }))
            .rejects.toThrow(/already installed/);
        expect(isDirExists).toHaveBeenCalled();
    });
});
