import { describe, expect, it } from "vitest";
import { shouldCheckpointOnClose, type CloseCheckpointFacts } from "./closeCheckpoint";

const BASE: CloseCheckpointFacts = {
    enabled: true,
    projectPath: "/projects/demo",
    workspaceLoaded: true,
};

describe("shouldCheckpointOnClose", () => {
    it("check points a workspace that came up", () => {
        expect(shouldCheckpointOnClose(BASE)).toBe(true);
    });

    it("skips a workspace that never came up", () => {
        // A startup still blocked on the repository lock, and a preflight that failed, are the
        // same answer here: there is no editor, so there is nothing this session changed.
        expect(shouldCheckpointOnClose({ ...BASE, workspaceLoaded: false })).toBe(false);
    });

    it("skips when the author turned it off", () => {
        expect(shouldCheckpointOnClose({ ...BASE, enabled: false })).toBe(false);
    });

    it("skips a window that named no project", () => {
        expect(shouldCheckpointOnClose({ ...BASE, projectPath: null })).toBe(false);
        expect(shouldCheckpointOnClose({ ...BASE, projectPath: "" })).toBe(false);
    });
});
