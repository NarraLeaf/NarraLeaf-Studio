import { describe, expect, it, vi } from "vitest";
import { WindowAppType } from "@shared/types/window";

vi.mock("electron", () => ({}));

const {
    ProjectTrustGrantHandler,
    ProjectTrustListHandler,
    ProjectTrustPromptHandler,
    ProjectTrustQueryHandler,
    ProjectTrustRevokeHandler,
} = await import("./projectTrustAction");

type AppWindowLike = Parameters<InstanceType<typeof ProjectTrustGrantHandler>["handle"]>[0];

const THEIRS = "D:/games/theirs";

/** A window of one type, on an app whose ledger and prompt record what they were asked. */
function makeWindow(type: WindowAppType, options: { projectPath?: string; trusted?: boolean; answer?: boolean } = {}) {
    const manager = {
        isTrusted: vi.fn(() => options.trusted ?? false),
        getRecord: vi.fn(() => null),
        grantTrust: vi.fn(() => true),
        revokeTrust: vi.fn(() => true),
        listTrusted: vi.fn(() => []),
        listDistrusted: vi.fn(() => []),
    };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const app = {
        logger,
        projectTrustManager: manager,
        askProjectTrust: vi.fn(async () => options.answer ?? false),
        applyProjectTrustChange: vi.fn(async () => undefined),
    };
    const window = {
        getWindowType: () => type,
        getProps: () => ({ projectPath: options.projectPath }),
        getApp: () => app,
        app,
    } as unknown as AppWindowLike;
    return { window, manager, logger, app };
}

/**
 * Who may change the ledger.
 *
 * The workspace is the window a project's content is shown in, and the grant is the one message
 * that turns a distrusted project into a trusted one; accepting it from there would let the thing
 * being judged answer the question. Settings is the only window Studio sends the author to for the
 * list, and the only one these handlers answer.
 */
describe("project trust handlers", () => {
    const everyOtherWindow = Object.values(WindowAppType).filter(type => type !== WindowAppType.Settings);

    it.each(everyOtherWindow)("refuses to grant trust for a %s window", async type => {
        const { window, manager, logger, app } = makeWindow(type);

        const result = await new ProjectTrustGrantHandler().handle(window, { projectPath: THEIRS });

        expect(result.success).toBe(false);
        expect(manager.grantTrust).not.toHaveBeenCalled();
        expect(app.applyProjectTrustChange).not.toHaveBeenCalled();
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

    it("grants, withdraws and lists for the Settings window, carrying each change to open windows", async () => {
        const { window, manager, app } = makeWindow(WindowAppType.Settings);

        expect(await new ProjectTrustGrantHandler().handle(window, { projectPath: THEIRS })).toEqual({
            success: true,
            data: { changed: true },
        });
        expect(manager.grantTrust).toHaveBeenCalledWith(THEIRS, expect.any(String));
        expect(app.applyProjectTrustChange).toHaveBeenLastCalledWith(THEIRS, true);

        expect(await new ProjectTrustRevokeHandler().handle(window, { projectPath: THEIRS })).toEqual({
            success: true,
            data: { changed: true },
        });
        expect(manager.revokeTrust).toHaveBeenCalledWith(THEIRS);
        expect(app.applyProjectTrustChange).toHaveBeenLastCalledWith(THEIRS, false);

        expect((await new ProjectTrustListHandler().handle(window)).success).toBe(true);
    });

    it("carries nothing when the ledger did not change", async () => {
        const { window, manager, app } = makeWindow(WindowAppType.Settings);
        manager.grantTrust.mockReturnValue(false);

        await new ProjectTrustGrantHandler().handle(window, { projectPath: THEIRS });

        expect(app.applyProjectTrustChange).not.toHaveBeenCalled();
    });

    it("answers the trust question for any window", async () => {
        // The workspace status bar and the puppet loader both ask, and the answer is about a path
        // the caller already named - nothing a window could not learn by watching what is refused.
        const { window } = makeWindow(WindowAppType.Workspace);

        const result = await new ProjectTrustQueryHandler().handle(window, { projectPath: THEIRS });

        expect(result).toEqual({ success: true, data: { trusted: false, record: null } });
    });
});

/**
 * A workspace may raise the question but never answer it: the prompt is a window of Studio's own,
 * the host reads the answer, and what comes back here is what the ledger then says.
 */
describe("ProjectTrustPromptHandler", () => {
    it("puts the question for the window's own project and carries a yes to the window", async () => {
        const { window, app } = makeWindow(WindowAppType.Workspace, { projectPath: THEIRS, answer: true });

        const result = await new ProjectTrustPromptHandler().handle(window);

        expect(result).toEqual({ success: true, data: { trusted: true } });
        expect(app.askProjectTrust).toHaveBeenCalledWith(window, THEIRS);
        expect(app.applyProjectTrustChange).toHaveBeenCalledWith(THEIRS, true);
    });

    it("leaves a refused project as it was", async () => {
        const { window, app } = makeWindow(WindowAppType.Workspace, { projectPath: THEIRS, answer: false });

        const result = await new ProjectTrustPromptHandler().handle(window);

        expect(result).toEqual({ success: true, data: { trusted: false } });
        expect(app.applyProjectTrustChange).not.toHaveBeenCalled();
    });

    it("does not ask again about a project that is already trusted", async () => {
        const { window, app } = makeWindow(WindowAppType.Workspace, { projectPath: THEIRS, trusted: true });

        const result = await new ProjectTrustPromptHandler().handle(window);

        expect(result).toEqual({ success: true, data: { trusted: true } });
        expect(app.askProjectTrust).not.toHaveBeenCalled();
    });

    it.each(Object.values(WindowAppType).filter(type => type !== WindowAppType.Workspace))(
        "refuses a %s window",
        async type => {
            const { window, app } = makeWindow(type, { projectPath: THEIRS });

            const result = await new ProjectTrustPromptHandler().handle(window);

            expect(result.success).toBe(false);
            expect(app.askProjectTrust).not.toHaveBeenCalled();
        },
    );

    it("refuses a workspace that has no project", async () => {
        const { window, app } = makeWindow(WindowAppType.Workspace);

        const result = await new ProjectTrustPromptHandler().handle(window);

        expect(result.success).toBe(false);
        expect(app.askProjectTrust).not.toHaveBeenCalled();
    });
});
