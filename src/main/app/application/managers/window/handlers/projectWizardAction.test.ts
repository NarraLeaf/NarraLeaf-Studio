import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { WindowAppType as Types } from "@shared/types/window";
import type { WindowAppType, WindowCloseResults } from "@shared/types/window";
import type { AppWindow } from "../appWindow";
import { ProjectWizardLaunchHandler } from "./projectWizardAction";
import { ProjectWizardCreatedHandler } from "./projectWizardCreatedAction";

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

/**
 * The launcher's "new project on this server" publishes the project the wizard made - from a window
 * with no project, which `vcs.publishProject` holds to a folder it holds a write grant over. The
 * wizard wrote the project through its own grant, and that grant dies with it, so the launch handler
 * hands the launcher one on that folder. What is pinned is how little it hands over, and on whose
 * word: only the folder the wizard reported through `projectWizard.created` (which checked the
 * wizard's own grant and that a project was there), only for a wizard opened to publish, and only the
 * folder itself.
 */
describe("handing the made project to the window that opened the wizard", () => {
    const PUBLISH_TO = { publishTo: { remoteOrigin: "lore://team.example.lan:41337", server: "Team" } };

    async function scene(report: "created" | "nothing") {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-wizard-handover-"));
        const made = path.join(root, "made");
        await fs.mkdir(made);
        await fs.writeFile(path.join(made, "game.nlproj"), "");

        let finish: (result: WindowCloseResults[WindowAppType.ProjectWizard]) => void = () => undefined;
        const wizard = {
            getWindowType: () => Types.ProjectWizard,
            app: {
                logger: { info: vi.fn(), warn: vi.fn() },
                projectTrustManager: { recordArrival: vi.fn(() => true) },
                storageManager: {
                    // The wizard's grant is on the folder the author picked, and everything under it.
                    isPathAllowed: vi.fn(async (_window: unknown, fsPath: string) =>
                        path.resolve(fsPath).startsWith(root)),
                },
            },
            setCloseResultResolver: (resolve: typeof finish) => {
                finish = resolve;
            },
        };
        if (report === "created") {
            await new ProjectWizardCreatedHandler().handle(wizard as never, { projectPath: made });
        }
        const grantFileSystemAccess = vi.fn();
        const opener = {
            win: {},
            getApp: () => ({ launchProjectWizard: vi.fn(async () => wizard) }),
            addChild: vi.fn(),
            app: { storageManager: { grantFileSystemAccess }, logger: { warn: vi.fn() } },
        } as unknown as AppWindow;
        const close = (result: WindowCloseResults[WindowAppType.ProjectWizard]) => finish(result);
        return { root, made, opener, grantFileSystemAccess, close };
    }

    it("grants the opener the folder the wizard reported making, and that folder alone", async () => {
        const { root, made, opener, grantFileSystemAccess, close } = await scene("created");

        const answer = new ProjectWizardLaunchHandler().handle(opener, PUBLISH_TO);
        await vi.waitFor(() => expect(opener.addChild).toHaveBeenCalled());
        close({ created: true, projectPath: made, projectName: "Made", appId: "made" });
        await answer;

        expect(grantFileSystemAccess).toHaveBeenCalledTimes(1);
        // Write, and not recursive: enough to name the folder, nothing inside it.
        expect(grantFileSystemAccess).toHaveBeenCalledWith(opener, path.resolve(made), "write", false);
        await fs.rm(root, { recursive: true, force: true });
    });

    it("grants nothing for a folder named only in the close result", async () => {
        const { root, made, opener, grantFileSystemAccess, close } = await scene("nothing");

        const answer = new ProjectWizardLaunchHandler().handle(opener, PUBLISH_TO);
        await vi.waitFor(() => expect(opener.addChild).toHaveBeenCalled());
        close({ created: true, projectPath: made });
        await answer;

        expect(grantFileSystemAccess).not.toHaveBeenCalled();
        await fs.rm(root, { recursive: true, force: true });
    });

    it("grants nothing to a wizard's opener that has nothing to send the project on to", async () => {
        const { root, made, opener, grantFileSystemAccess, close } = await scene("created");

        const answer = new ProjectWizardLaunchHandler().handle(opener, {});
        await vi.waitFor(() => expect(opener.addChild).toHaveBeenCalled());
        close({ created: true, projectPath: made });
        await answer;

        expect(grantFileSystemAccess).not.toHaveBeenCalled();
        await fs.rm(root, { recursive: true, force: true });
    });
});
