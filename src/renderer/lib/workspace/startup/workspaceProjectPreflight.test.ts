import { describe, expect, it } from "vitest";
import { DirEntry } from "@shared/utils/nlproj";
import {
    getWorkspaceProjectPreflightIssue,
    WorkspaceStartupErrorKind,
} from "./workspaceProjectPreflight";

const file = (name: string, ext: string | null): DirEntry => ({
    name,
    ext,
    type: "file",
});

describe("workspaceProjectPreflight", () => {
    it("allows a project folder with an nlproj file", () => {
        expect(getWorkspaceProjectPreflightIssue([file("Demo", ".nlproj")])).toBeNull();
    });

    it("reports missing project config when no nlproj exists", () => {
        const issue = getWorkspaceProjectPreflightIssue([]);
        expect(issue?.kind).toBe(WorkspaceStartupErrorKind.MissingProjectConfig);
    });

    it("does not parse project.json when nlproj is absent", () => {
        const issue = getWorkspaceProjectPreflightIssue(
            [file("project", ".json")],
        );
        expect(issue?.kind).toBe(WorkspaceStartupErrorKind.MissingProjectConfig);
    });
});
