import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    ProjectDistrustedError,
    isProjectTrusted,
    requireProjectTrust,
    resetProjectTrustCacheForTests,
} from "./projectTrust";

const query = vi.fn();

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ projectTrust: { query } }),
}));

describe("renderer project trust", () => {
    beforeEach(() => {
        resetProjectTrustCacheForTests();
        query.mockReset();
    });

    it("asks main and reports what it said", async () => {
        query.mockResolvedValue({ success: true, data: { trusted: true, record: null } });
        await expect(isProjectTrusted("D:/games/mine")).resolves.toBe(true);
        expect(query).toHaveBeenCalledWith("D:/games/mine");
    });

    it("refuses when the project is distrusted", async () => {
        query.mockResolvedValue({ success: true, data: { trusted: false, record: null } });
        await expect(requireProjectTrust("D:/games/theirs", "do the thing"))
            .rejects.toBeInstanceOf(ProjectDistrustedError);
    });

    it("fails closed when the query fails", async () => {
        // Absence of an answer is not evidence of safety, and the thing this guards is executing
        // the project's own JavaScript.
        query.mockRejectedValue(new Error("no ipc"));
        await expect(isProjectTrusted("D:/games/theirs")).resolves.toBe(false);

        query.mockReset();
        query.mockResolvedValue({ success: false, error: "denied" });
        await expect(isProjectTrusted("D:/games/theirs")).resolves.toBe(false);
    });

    it("asks once for a project it was told is trusted", async () => {
        query.mockResolvedValue({ success: true, data: { trusted: true, record: null } });
        await isProjectTrusted("D:/games/mine");
        await isProjectTrusted("D:/games/mine");
        expect(query).toHaveBeenCalledTimes(1);
    });

    it("asks once for a project it was told is distrusted", async () => {
        // The case the module exists for, and the one every editor tab mount, the media scan and
        // the puppet loader ask about. Asking main again for each of them would spend an IPC round
        // trip per caller on an answer that cannot change until the project is launched again.
        query.mockResolvedValue({ success: true, data: { trusted: false, record: null } });
        await expect(isProjectTrusted("D:/games/theirs")).resolves.toBe(false);
        await expect(isProjectTrusted("D:/games/theirs")).resolves.toBe(false);
        expect(query).toHaveBeenCalledTimes(1);
    });

    it("does not remember a query that failed, so one dropped call does not distrust for the session", async () => {
        // A "no" main actually gave is a fact about the project and is kept. A "no" invented here
        // because the call never arrived is not, and remembering it would break puppets for the
        // whole window with nothing on screen to explain it.
        query.mockRejectedValueOnce(new Error("transient"));
        await expect(isProjectTrusted("D:/games/mine")).resolves.toBe(false);

        query.mockResolvedValue({ success: true, data: { trusted: true, record: null } });
        await expect(isProjectTrusted("D:/games/mine")).resolves.toBe(true);
        expect(query).toHaveBeenCalledTimes(2);
    });

    it("does not remember an unsuccessful result either", async () => {
        // `success: false` is main declining to answer, not main answering "no" - the same
        // situation as a rejected call, and it is retried for the same reason.
        query.mockResolvedValueOnce({ success: false, error: "denied" });
        await expect(isProjectTrusted("D:/games/mine")).resolves.toBe(false);

        query.mockResolvedValue({ success: true, data: { trusted: true, record: null } });
        await expect(isProjectTrusted("D:/games/mine")).resolves.toBe(true);
        expect(query).toHaveBeenCalledTimes(2);
    });

    it("does not fan out concurrent questions about one project", async () => {
        query.mockResolvedValue({ success: true, data: { trusted: true, record: null } });
        const [a, b] = await Promise.all([
            isProjectTrusted("D:/games/mine"),
            isProjectTrusted("D:/games/mine"),
        ]);
        expect([a, b]).toEqual([true, true]);
        expect(query).toHaveBeenCalledTimes(1);
    });
});
