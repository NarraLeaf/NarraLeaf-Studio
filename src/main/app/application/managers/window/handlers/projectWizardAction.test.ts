import { describe, expect, it, vi } from "vitest";
import type { WindowAppType, WindowCloseResults } from "@shared/types/window";
import type { AppWindow } from "../appWindow";
import { ProjectWizardLaunchHandler } from "./projectWizardAction";

/**
 * What the wizard reported, as the window that opened it receives it.
 *
 * **The answer is handed on whole.** It used to be copied into a fresh
 * `{ created, projectPath }`, and every other field the wizard reported was dropped on the
 * way through - so a caller that needed one more fact about the project got `undefined`
 * with nothing anywhere to say why. It cost a real-app run to find, because both ends were
 * right: the wizard sent the field and the launcher read it.
 *
 * The two fields are still what tells a wizard that finished from one that was closed, so
 * they are checked; they are just no longer the whole of what survives.
 */

function handlerWith(result: WindowCloseResults[WindowAppType.ProjectWizard]) {
    const wizard = {
        setCloseResultResolver: (resolve: (value: typeof result) => void) => resolve(result),
    };
    const launch = vi.fn(async () => wizard);
    const window = {
        win: {},
        getApp: () => ({ launchProjectWizard: launch }),
        addChild: vi.fn(),
    } as unknown as AppWindow;
    return { window, launch };
}

describe("opening the project wizard", () => {
    it("hands on every field the wizard reported, not only the two it is recognised by", async () => {
        const { window } = handlerWith({
            created: true,
            projectPath: "D:/games/moonlit",
            projectName: "Moonlit",
            appId: "moonlit",
        });

        const answer = await new ProjectWizardLaunchHandler().handle(window, {});

        expect(answer).toEqual({
            success: true,
            data: {
                created: true,
                projectPath: "D:/games/moonlit",
                projectName: "Moonlit",
                appId: "moonlit",
            },
        });
    });

    it("answers null for a window closed without finishing", async () => {
        const { window } = handlerWith(null);

        await expect(new ProjectWizardLaunchHandler().handle(window, {}))
            .resolves.toEqual({ success: true, data: null });
    });

    it("carries the props through to the window, which is how a question arrives answered", async () => {
        const { window, launch } = handlerWith(null);
        const props = { publishTo: { remoteOrigin: "lore://team.example.lan:41337", server: "Team" } };

        await new ProjectWizardLaunchHandler().handle(window, props);

        expect(launch).toHaveBeenCalledWith(window, props, expect.anything());
    });
});
