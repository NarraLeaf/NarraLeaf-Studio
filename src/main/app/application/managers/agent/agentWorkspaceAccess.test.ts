import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { afterEach, describe, expect, it } from "vitest";
import { agentRefusal, agentText } from "@shared/agent/protocol";
import { activityProjectPath, copySkillTree, isNonEmptyDirectory, mainActivity, summarizeMainCall } from "./agentWorkspaceAccess";

/**
 * What the workspace's Agent log is told about a call main answered, and how the skill is copied
 * out. The log line must never carry the call's arguments wholesale - only the one field each tool
 * names - and an export must never delete what was already in the folder.
 */

describe("main-answered calls in the Agent log", () => {
    it("names one chosen field per tool and nothing for the rest", () => {
        const ok = agentText("done");
        expect(summarizeMainCall("project_create", { name: "Winter", dir: "/secret/place" }, ok)).toBe("Winter");
        expect(summarizeMainCall("project_open", { path: "/Users/a/Games/Winter" }, ok)).toBe("Winter");
        expect(summarizeMainCall("test", { id: "narraleaf-studio:route-coverage", project: "/p" }, ok)).toBe("narraleaf-studio:route-coverage");
        expect(summarizeMainCall("build", {}, ok)).toBe("current");
        expect(summarizeMainCall("agent_status", { anything: "x" }, ok)).toBeNull();
    });

    it("carries the refusal but not the arguments", () => {
        const refused = agentRefusal("writes_disabled", "build changes the project", "Ask the author");
        const line = mainActivity("build", { target: "web", output: "/private/out" }, refused, "Claude Code", 12.4);
        expect(line).toEqual({
            tool: "build",
            clientName: "Claude Code",
            ok: false,
            code: "writes_disabled",
            message: "build changes the project",
            hint: "Ask the author",
            durationMs: 12,
            summary: "web",
        });
        expect(JSON.stringify(line)).not.toContain("/private/out");
    });

    it("goes to the project the call created or opened, else the one it named, else everywhere", () => {
        expect(activityProjectPath("project_create", { name: "W" }, agentText("ok", { project: "/games/W" }))).toBe(path.resolve("/games/W"));
        expect(activityProjectPath("project_open", { path: "/games/X" }, agentRefusal("unavailable", "no"))).toBe(path.resolve("/games/X"));
        expect(activityProjectPath("test", { project: "/games/Y", id: "t" }, agentText("ok"))).toBe(path.resolve("/games/Y"));
        expect(activityProjectPath("agent_status", {}, agentText("ok"))).toBeNull();
    });
});

describe("exporting the agent skill", () => {
    const made: string[] = [];
    afterEach(async () => {
        await Promise.all(made.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
    });

    async function tempDir(): Promise<string> {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-skill-export-"));
        made.push(dir);
        return dir;
    }

    it("copies the whole tree, replaces files of the same name and keeps everything else", async () => {
        const source = await tempDir();
        await fs.mkdir(path.join(source, "narraleaf-make-game", "references"), { recursive: true });
        await fs.writeFile(path.join(source, "README.md"), "new readme");
        await fs.writeFile(path.join(source, "narraleaf-make-game", "SKILL.md"), "skill");
        await fs.writeFile(path.join(source, "narraleaf-make-game", "references", "ui-format.md"), "ui");

        const target = path.join(await tempDir(), "NarraLeaf-Skills");
        expect(await isNonEmptyDirectory(fs, target)).toBe(false);
        await fs.mkdir(target, { recursive: true });
        await fs.writeFile(path.join(target, "README.md"), "old readme");
        await fs.writeFile(path.join(target, "my-notes.md"), "mine");
        expect(await isNonEmptyDirectory(fs, target)).toBe(true);

        expect(await copySkillTree(fs, source, target)).toBe(3);
        expect(await fs.readFile(path.join(target, "README.md"), "utf8")).toBe("new readme");
        expect(await fs.readFile(path.join(target, "my-notes.md"), "utf8")).toBe("mine");
        expect(await fs.readFile(path.join(target, "narraleaf-make-game", "references", "ui-format.md"), "utf8")).toBe("ui");
    });
});
