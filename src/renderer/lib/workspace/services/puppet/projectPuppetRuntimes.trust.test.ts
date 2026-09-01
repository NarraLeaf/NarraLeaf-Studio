import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPuppetBackendSource } from "./projectPuppetRuntimes";
import { resetProjectTrustCacheForTests } from "@/lib/workspace/projectTrust";
import { SurfacePuppetUnavailableError } from "@/lib/ui-editor/runtime/game/surfacePuppetSession";
import type { Porject } from "@/lib/workspace/project/project";

const query = vi.fn();
const requestRead = vi.fn();
const requestReadRaw = vi.fn();

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ projectTrust: { query } }),
}));

vi.mock("@/lib/app/privilegedFacade", () => ({
    appPrivilegedFacade: {
        fs: {
            requestRead: (...args: unknown[]) => requestRead(...args),
            requestReadRaw: (...args: unknown[]) => requestReadRaw(...args),
        },
    },
}));

const project = {
    resolve: (...parts: (string | readonly string[])[]) =>
        ["D:/games/theirs", ...parts.flatMap(p => (Array.isArray(p) ? p : [p]))].join("/"),
} as unknown as Porject;

describe("createPuppetBackendSource and project trust", () => {
    beforeEach(() => {
        resetProjectTrustCacheForTests();
        query.mockReset();
        requestRead.mockReset();
        requestReadRaw.mockReset();
        requestRead.mockResolvedValue({ success: true, data: { ok: true, data: "hash" } });
    });

    it("will not mint a module URL for a distrusted project", async () => {
        query.mockResolvedValue({ success: true, data: { trusted: false, record: null } });

        await expect(createPuppetBackendSource(project, "live2d"))
            .rejects.toBeInstanceOf(SurfacePuppetUnavailableError);

        // The refusal has to come before the grant, not after: a minted `app://fs/` URL is already
        // an importable module, and nothing downstream asks again.
        expect(requestRead).not.toHaveBeenCalled();
    });

    it("refuses as an unavailable, not as a failure", async () => {
        // The type is the contract, but carrying it is only half of it — three callers reach this
        // function, and each has to do something with the `reason` rather than with the message:
        //
        //  - `PuppetDescriptionService.openSession`, whose rejection `SurfacePuppetMount` maps
        //    through `publishUnavailable(error.reason)`. This one degrades correctly: the preview
        //    box and the `nl.puppet` widget come up empty with the trust sentence under them.
        //  - `PuppetDescriptionService.probe`, the description path behind every motion/expression/
        //    skin dropdown. It caught this error and reported `reason: "failed"`, so a distrusted
        //    project read as "The model could not be read" — an author sent to debug an asset that
        //    is fine. It now passes the typed reason through, and `plan()` answers `distrusted`
        //    before a mount is even set up.
        //  - `installPuppetRuntime.registeredBackendNames`, which loads a freshly copied directory
        //    to see what it registers. It rolls the install back and rethrows, reading the message
        //    rather than the reason.
        //
        // Anything that is *not* this type means a runtime was found and then misbehaved, which is
        // a red error box. A distrusted project is the other kind: nothing is broken, and the
        // author has somewhere to go.
        query.mockResolvedValue({ success: true, data: { trusted: false, record: null } });
        await expect(createPuppetBackendSource(project, "live2d"))
            .rejects.toMatchObject({ reason: "distrusted" });
    });

    it("mints one for a project the author vouched for", async () => {
        query.mockResolvedValue({ success: true, data: { trusted: true, record: null } });

        const source = await createPuppetBackendSource(project, "live2d");
        expect(source.id).toBe("live2d");
        expect(source.url).toContain("hash");
        expect(requestRead).toHaveBeenCalledOnce();
    });

    it("asks about the project, not about the backend directory", async () => {
        // The ledger is keyed by project path. Asking with the backend folder would miss every row
        // and answer "trusted" for everything.
        query.mockResolvedValue({ success: true, data: { trusted: true, record: null } });
        await createPuppetBackendSource(project, "live2d");
        expect(query).toHaveBeenCalledWith("D:/games/theirs");
    });
});
