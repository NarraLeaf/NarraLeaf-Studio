import { describe, expect, it } from "vitest";
import { WindowAppType } from "@shared/types/window";
import { decideWindowClosedTeardown, type WindowClosedFacts } from "./windowClosedTeardown";

const BASE: WindowClosedFacts = {
    windowType: WindowAppType.Workspace,
    projectPath: "D:\\games\\demo",
    quitting: false,
    projectStillOpen: false,
};

describe("decideWindowClosedTeardown", () => {
    it("ends the project's runtimes when its workspace closes", () => {
        expect(decideWindowClosedTeardown(BASE)).toEqual({
            stopRuntimes: true,
            releaseVersionControl: true,
        });
    });

    it("leaves the preview alone when only the Dev Mode window closes", () => {
        // The Dev Mode window carries the same projectPath; its close is that runtime ending, not
        // the project's. The workspace is still open, so version control stays open too.
        expect(decideWindowClosedTeardown({
            ...BASE,
            windowType: WindowAppType.DevMode,
            projectStillOpen: true,
        })).toEqual({
            stopRuntimes: false,
            releaseVersionControl: false,
        });
    });

    it("keeps version control open while any window still holds the project", () => {
        expect(decideWindowClosedTeardown({ ...BASE, projectStillOpen: true }).releaseVersionControl)
            .toBe(false);
    });

    it("does nothing on the way out of the app", () => {
        // The quit teardown does all of it, once, and is the thing the quit actually waits for.
        expect(decideWindowClosedTeardown({ ...BASE, quitting: true })).toEqual({
            stopRuntimes: false,
            releaseVersionControl: false,
        });
    });

    it("does nothing for a window that names no project", () => {
        for (const windowType of [WindowAppType.Launcher, WindowAppType.Settings, WindowAppType.ProjectWizard]) {
            expect(decideWindowClosedTeardown({ ...BASE, windowType, projectPath: null })).toEqual({
                stopRuntimes: false,
                releaseVersionControl: false,
            });
        }
        expect(decideWindowClosedTeardown({ ...BASE, projectPath: "" })).toEqual({
            stopRuntimes: false,
            releaseVersionControl: false,
        });
    });
});
