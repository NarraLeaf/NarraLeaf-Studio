import path from "path";
import { describe, expect, it } from "vitest";
import { WINDOW_PROJECT_MISMATCH_CODE } from "@shared/types/window";
import { requireWindowProject, windowProjectPath } from "./windowProject";

type Window = Parameters<typeof requireWindowProject>[0];

/** A window carrying the props the main process wrote when it opened a project. */
function windowWith(props: unknown): Window {
    return { getProps: () => props } as unknown as Window;
}

const own = path.resolve("/projects/mine");
const other = path.resolve("/projects/theirs");

describe("windowProjectPath", () => {
    it("reads the project a window has open", () => {
        expect(windowProjectPath(windowWith({ projectPath: own }))).toBe(own);
    });

    /**
     * The launcher, settings and the wizard have no project. They must answer `null` rather than
     * something falsy-but-stringy, because the guard's whole behaviour for those windows hangs on
     * telling "no project" apart from "some project".
     */
    it("answers null for a window that has no project", () => {
        expect(windowProjectPath(windowWith({ onboarding: true }))).toBeNull();
        expect(windowProjectPath(windowWith({}))).toBeNull();
        expect(windowProjectPath(windowWith(undefined))).toBeNull();
    });

    it("answers null for props whose projectPath is not a usable string", () => {
        expect(windowProjectPath(windowWith({ projectPath: "" }))).toBeNull();
        expect(windowProjectPath(windowWith({ projectPath: 7 }))).toBeNull();
        expect(windowProjectPath(windowWith({ projectPath: null }))).toBeNull();
    });
});

describe("requireWindowProject", () => {
    it("passes a request about the window's own project", () => {
        expect(requireWindowProject(windowWith({ projectPath: own }), own)).toBe(own);
    });

    /**
     * The hole, stated as the thing it prevents: a renderer naming a project it does not have open
     * and having the main process act on it.
     */
    it("refuses a request about somebody else's project", () => {
        expect(() => requireWindowProject(windowWith({ projectPath: own }), other))
            .toThrowError(/no such project open/);
    });

    /** A window with no project can name none: there is nothing for the payload to agree with. */
    it("refuses a request from a window that has no project open", () => {
        expect(() => requireWindowProject(windowWith({ onboarding: true }), own)).toThrowError();
    });

    /**
     * The refusal has to be identifiable rather than merely present - the same reason the baseline
     * refusal beside it carries a code. Prose is what gets reworded, and a renderer or a log that
     * wants to recognise this must not be matching on an English sentence.
     */
    it("names the refusal with a code", () => {
        try {
            requireWindowProject(windowWith({ projectPath: own }), other);
            expect.unreachable("the guard should have refused");
        } catch (error) {
            expect((error as { code?: string }).code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
        }
    });

    /**
     * A relative path, or one that walks out through `..`, is the same path spelled differently.
     * Resolving before comparing is what makes those the same question - without it, a payload could
     * start inside the window's project and land anywhere.
     */
    it("refuses a traversal that starts inside the window's project", () => {
        expect(() => requireWindowProject(
            windowWith({ projectPath: own }),
            path.join(own, "..", "theirs"),
        )).toThrowError();
    });

    it("accepts a spelling of the window's own project that resolves to it", () => {
        expect(requireWindowProject(
            windowWith({ projectPath: own }),
            path.join(own, "assets", ".."),
        )).toBe(own);
    });

    /**
     * The failure mode that would be worse than the hole: a guard that refuses the author's own
     * project. On Windows `D:\Game` and `d:\game` are one project, and only the shared identity rule
     * folds them - `path.normalize` alone leaves them apart, which is exactly what the hand-rolled
     * comparison in `devModeAction` does.
     */
    it.runIf(process.platform === "win32")("accepts the window's project under another spelling", () => {
        const window = windowWith({ projectPath: "D:\\Projects\\Game" });

        expect(requireWindowProject(window, "d:/projects/game")).toBe("D:\\Projects\\Game");
        expect(requireWindowProject(window, "D:\\Projects\\Game\\")).toBe("D:\\Projects\\Game");
    });

    /**
     * The payload is whatever the renderer sent, whatever the type says. A non-string must come back
     * as this guard's refusal rather than as Node's `ERR_INVALID_ARG_TYPE` from `path.resolve`,
     * which would report a security refusal as an argument bug.
     */
    it("refuses a payload that is not a path at all, with its own code", () => {
        for (const named of [undefined, null, 7, {}, ""] as unknown as string[]) {
            let code: string | undefined;
            try {
                requireWindowProject(windowWith({ projectPath: own }), named);
                expect.unreachable("the guard should have refused");
            } catch (error) {
                code = (error as { code?: string }).code;
            }
            expect(code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
        }
    });
});
