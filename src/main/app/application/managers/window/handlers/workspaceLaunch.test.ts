import { describe, expect, it, vi } from "vitest";
import { WindowAppType } from "@shared/types/window";
import type { AppWindow } from "../appWindow";
import { WorkspaceLaunchHandler } from "./workspaceAction";

/**
 * What a launcher asking for a project carries with it.
 *
 * ⚠ **The props are not passed on.** `openProject` builds the window's props itself - it has to,
 * because the project may already be open and the request then goes to that window instead - so
 * this handler has to name every field it wants carried, one at a time. A field it does not name
 * is a field that silently never arrives, and the two ends both look right: the launcher set it and
 * the workspace read its props.
 *
 * That is not hypothetical: a launch intent was once added at both ends, unit-tested at both ends,
 * and did nothing at all on a real machine because this line forwarded nothing but `replaceOpener`.
 */

function handler() {
    const openProject = vi.fn(async () => undefined);
    // The launcher is the opener here, so the workspace-only open gate stays out of the way.
    const window = {
        getApp: () => ({ openProject }),
        getWindowType: () => WindowAppType.Launcher,
    } as unknown as AppWindow;
    return { window, openProject };
}

describe("launching a workspace from the launcher", () => {
    it("forwards nothing but the opener rule for an ordinary open", async () => {
        // Absent rather than undefined: `openProject` spreads what it is given into window props,
        // and a key with no value is a key the canonical encoder and every reader has to think about.
        const { window, openProject } = handler();

        await new WorkspaceLaunchHandler().handle(window, {
            props: { projectPath: "D:/games/moonlit" },
            closeCurrentWindow: false,
        });

        expect(openProject).toHaveBeenCalledWith(window, "D:/games/moonlit", { replaceOpener: false });
    });
});
