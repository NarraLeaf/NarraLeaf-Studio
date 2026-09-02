import { describe, expect, it, vi } from "vitest";
import { WindowAppType } from "@shared/types/window";

vi.mock("electron", () => ({}));

const {
    ProjectTrustGrantHandler,
    ProjectTrustListHandler,
    ProjectTrustQueryHandler,
    ProjectTrustRevokeHandler,
} = await import("./projectTrustAction");

type AppWindowLike = Parameters<InstanceType<typeof ProjectTrustGrantHandler>["handle"]>[0];

/** A window of one type, on an app whose ledger records what it was asked. */
function makeWindow(type: WindowAppType) {
    const manager = {
        isTrusted: vi.fn(() => false),
        getRecord: vi.fn(() => null),
        grantTrust: vi.fn(() => true),
        revokeTrust: vi.fn(() => true),
        listTrusted: vi.fn(() => []),
        listDistrusted: vi.fn(() => []),
    };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const window = {
        getWindowType: () => type,
        app: { logger, projectTrustManager: manager },
    } as unknown as AppWindowLike;
    return { window, manager, logger };
}

const THEIRS = "D:/games/theirs";

/**
 * Who may change the ledger.
 *
 * The workspace is the window a project's content is shown in, and the grant is the one message
 * that turns a distrusted project into a trusted one; accepting it from there would let the thing
 * being judged answer the question. Settings is the only window Studio sends the author to for
 * this, and the only one these handlers answer.
 */
describe("project trust handlers", () => {
    const everyOtherWindow = Object.values(WindowAppType).filter(type => type !== WindowAppType.Settings);

    it.each(everyOtherWindow)("refuses to grant trust for a %s window", async type => {
        const { window, manager, logger } = makeWindow(type);

        const result = await new ProjectTrustGrantHandler().handle(window, { projectPath: THEIRS });

        expect(result.success).toBe(false);
        expect(manager.grantTrust).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledOnce();
    });

    it.each(everyOtherWindow)("refuses to withdraw trust for a %s window", async type => {
        const { window, manager } = makeWindow(type);

        const result = await new ProjectTrustRevokeHandler().handle(window, { projectPath: THEIRS });

        expect(result.success).toBe(false);
        expect(manager.revokeTrust).not.toHaveBeenCalled();
    });

    it.each(everyOtherWindow)("refuses to list the ledger for a %s window", async type => {
        const { window, manager } = makeWindow(type);

        const result = await new ProjectTrustListHandler().handle(window);

        expect(result.success).toBe(false);
        expect(manager.listTrusted).not.toHaveBeenCalled();
        expect(manager.listDistrusted).not.toHaveBeenCalled();
    });

    it("grants, withdraws and lists for the Settings window", async () => {
        const { window, manager } = makeWindow(WindowAppType.Settings);

        expect(await new ProjectTrustGrantHandler().handle(window, { projectPath: THEIRS })).toEqual({
            success: true,
            data: { changed: true },
        });
        expect(manager.grantTrust).toHaveBeenCalledWith(THEIRS, expect.any(String));

        expect(await new ProjectTrustRevokeHandler().handle(window, { projectPath: THEIRS })).toEqual({
            success: true,
            data: { changed: true },
        });
        expect(manager.revokeTrust).toHaveBeenCalledWith(THEIRS);

        expect((await new ProjectTrustListHandler().handle(window)).success).toBe(true);
    });

    it("answers the trust question for any window", async () => {
        // The workspace status bar and the puppet loader both ask, and the answer is about a path
        // the caller already named - nothing a window could not learn by watching what is refused.
        const { window } = makeWindow(WindowAppType.Workspace);

        const result = await new ProjectTrustQueryHandler().handle(window, { projectPath: THEIRS });

        expect(result).toEqual({ success: true, data: { trusted: false, record: null } });
    });
});
