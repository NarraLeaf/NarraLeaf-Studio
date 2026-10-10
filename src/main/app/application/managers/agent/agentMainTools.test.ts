import path from "path";
import { describe, expect, it, vi } from "vitest";
import { AGENT_INTERNAL_TOOL_BUILD, AGENT_INTERNAL_TOOL_TEST, agentRefusal, agentText, type AgentCallResult } from "@shared/agent/protocol";
import { AGENT_TOOLS, agentToolsForSide } from "@shared/agent/tools";
import { chooseAgentWorkspace } from "./agentRouting";
import { AGENT_MAIN_TOOL_HANDLERS, type AgentMainToolHost, type AgentWorkspaceHandle } from "./agentMainTools";
import { guideFileCandidates, pluginGuideFile, stripFrontMatter } from "./agentGuide";
import { agentCallTimeoutMs } from "./agentCallTimeout";

describe("main-side tool handlers", () => {
    it("has a handler for every main tool and none for anything else", () => {
        expect(Object.keys(AGENT_MAIN_TOOL_HANDLERS).sort()).toEqual(agentToolsForSide("main").map(tool => tool.name).sort());
        const known = new Set(AGENT_TOOLS.map(tool => tool.name));
        for (const name of Object.keys(AGENT_MAIN_TOOL_HANDLERS)) {
            expect(known.has(name), name).toBe(true);
        }
    });
});

function fakeHost(overrides: Partial<AgentMainToolHost> = {}, open: AgentWorkspaceHandle[] = []): AgentMainToolHost & {
    forward: ReturnType<typeof vi.fn>;
} {
    const host = {
        openWorkspaces: async () => open,
        workspaceState: async () => ({ paused: false, follow: true }),
        policy: () => ({ writesEnabled: false, allowedImportRoots: [] }),
        endpointUrl: () => "http://127.0.0.1:1/mcp",
        readGuide: async () => null,
        listPluginGuides: async () => [],
        readPluginGuide: async () => null,
        pluginToolsOf: () => [],
        route: (project: string | null) => chooseAgentWorkspace(
            project,
            open.map(handle => ({ window: handle, projectPath: handle.projectPath, lastFocusedAt: 0 })),
            value => value.replace(/\/+$/, ""),
        ),
        forward: vi.fn(async (): Promise<AgentCallResult> => agentText("forwarded")),
        isProjectDirectory: async () => true,
        isTrusted: () => true,
        defaultProjectsDir: () => "/home/me/NarraLeaf",
        openProject: async (projectPath: string) => ({ ok: true as const, handle: { projectPath, name: "Game" }, alreadyOpen: false }),
        createProject: vi.fn(async () => agentText("created")),
        runHeadlessTest: vi.fn(async () => agentText("headless")),
        ...overrides,
    };
    return host as typeof host & { forward: ReturnType<typeof vi.fn> };
}

const ctx = { clientName: "test" };

describe("agent_status", () => {
    it("lists open projects with their state, and says writes are off", async () => {
        const host = fakeHost({}, [{ projectPath: "/games/a", name: "A" }]);
        const result = await AGENT_MAIN_TOOL_HANDLERS.agent_status(host, {}, ctx);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.structured).toMatchObject({
            projects: [{ path: "/games/a", name: "A", responding: true, paused: false, follow: true }],
            writesEnabled: false,
        });
        expect((result.content[0] as { text: string }).text).toContain("Write access: OFF");
    });

    it("tolerates a workspace that does not answer", async () => {
        const host = fakeHost({ workspaceState: async () => null }, [{ projectPath: "/games/a", name: null }]);
        const result = await AGENT_MAIN_TOOL_HANDLERS.agent_status(host, {}, ctx);
        expect(result.ok && result.structured).toMatchObject({ projects: [{ responding: false, paused: null }] });
    });
});

describe("agent_guide", () => {
    it("returns the chapter, or a clear refusal when it is not installed", async () => {
        const present = await AGENT_MAIN_TOOL_HANDLERS.agent_guide(fakeHost({ readGuide: async () => "# Hi" }), { chapter: "workflow" }, ctx);
        expect(present).toEqual(agentText("# Hi", { chapter: "workflow" }));
        const missing = await AGENT_MAIN_TOOL_HANDLERS.agent_guide(fakeHost(), { chapter: "ui-format" }, ctx);
        expect(missing).toMatchObject({ ok: false, error: { code: "unavailable" } });
    });

    it("finds chapters under their own name or a longer one, and drops SKILL.md's front matter", () => {
        expect(guideFileCandidates("workflow")).toEqual([["SKILL.md"]]);
        expect(guideFileCandidates("ui-design")).toEqual([["references", "ui-design.md"], ["references", "ui-design-guide.md"]]);
        expect(stripFrontMatter("---\nname: x\ndescription: y\n---\n\n# Body\n")).toBe("# Body\n");
        expect(stripFrontMatter("# No front matter")).toBe("# No front matter");
    });

    it("lists every chapter, the plugins' included, when none is named, and refuses an unknown one with the list", async () => {
        const host = fakeHost({ listPluginGuides: async () => [{ pluginId: "narraleaf.gallery", name: "Gallery" }] });
        const listed = await AGENT_MAIN_TOOL_HANDLERS.agent_guide(host, {}, ctx);
        expect(listed.ok).toBe(true);
        const text = listed.ok ? (listed.content[0] as { text: string }).text : "";
        expect(text).toContain("workflow");
        expect(text).toContain("plugin:narraleaf.gallery (Gallery)");
        const unknown = await AGENT_MAIN_TOOL_HANDLERS.agent_guide(host, { chapter: "nope" }, ctx);
        expect(unknown).toMatchObject({ ok: false, error: { code: "not_found" } });
        expect(unknown.ok ? "" : unknown.error.hint).toContain("plugin:narraleaf.gallery");
    });

    it("serves a plugin's chapter as plugin:<id>, and only for a plugin that ships one", async () => {
        const host = fakeHost({
            listPluginGuides: async () => [{ pluginId: "narraleaf.gallery", name: "Gallery" }],
            readPluginGuide: async pluginId => (pluginId === "narraleaf.gallery" ? "# Gallery" : null),
        });
        expect(await AGENT_MAIN_TOOL_HANDLERS.agent_guide(host, { chapter: "plugin:narraleaf.gallery" }, ctx))
            .toEqual(agentText("# Gallery", { chapter: "plugin:narraleaf.gallery" }));
        expect(await AGENT_MAIN_TOOL_HANDLERS.agent_guide(host, { chapter: "plugin:acme.other" }, ctx))
            .toMatchObject({ ok: false, error: { code: "not_found" } });
    });

    it("keeps a plugin's guide path inside its package", () => {
        expect(pluginGuideFile("/plugins/gallery", "agent/guide.md")).toBe(path.resolve("/plugins/gallery/agent/guide.md"));
        expect(pluginGuideFile("/plugins/gallery", "../other/guide.md")).toBeNull();
        expect(pluginGuideFile("/plugins/gallery", "agent/guide.txt")).toBeNull();
    });
});

describe("agent_status with plugin tools", () => {
    it("names the plugin tools each project offers", async () => {
        const host = fakeHost({ pluginToolsOf: () => ["narraleaf_gallery__list"] }, [{ projectPath: "/games/a", name: "A" }]);
        const result = await AGENT_MAIN_TOOL_HANDLERS.agent_status(host, {}, ctx);
        expect(result.ok ? result.structured : null).toMatchObject({ projects: [{ pluginTools: ["narraleaf_gallery__list"] }] });
        expect(result.ok ? (result.content[0] as { text: string }).text : "").toContain("narraleaf_gallery__list");
    });
});

describe("project_create", () => {
    it("fills defaults the schema promises", async () => {
        const host = fakeHost();
        await AGENT_MAIN_TOOL_HANDLERS.project_create(host, { name: "Ghost" }, ctx);
        expect(host.createProject).toHaveBeenCalledWith({
            name: "Ghost",
            parentDir: "/home/me/NarraLeaf",
            template: "skeleton",
            language: "en",
            languages: [],
            width: 1920,
            height: 1080,
        });
    });

    it("passes further languages through, and none unless asked", async () => {
        const host = fakeHost();
        await AGENT_MAIN_TOOL_HANDLERS.project_create(host, { name: "Ghost", language: "zh-CN", languages: ["en"] }, ctx);
        expect(host.createProject).toHaveBeenCalledWith(expect.objectContaining({ language: "zh-CN", languages: ["en"] }));
    });
});

describe("project_open", () => {
    it("refuses a relative path and a directory that is not a project", async () => {
        expect(await AGENT_MAIN_TOOL_HANDLERS.project_open(fakeHost(), { path: "games/a" }, ctx))
            .toMatchObject({ ok: false, error: { code: "invalid_args" } });
        expect(await AGENT_MAIN_TOOL_HANDLERS.project_open(fakeHost({ isProjectDirectory: async () => false }), { path: "/x" }, ctx))
            .toMatchObject({ ok: false, error: { code: "not_found" } });
    });

    it("opens a project", async () => {
        const result = await AGENT_MAIN_TOOL_HANDLERS.project_open(fakeHost(), { path: "/games/a" }, ctx);
        expect(result).toMatchObject({ ok: true, structured: { project: "/games/a", alreadyOpen: false } });
    });
});

describe("test", () => {
    it("hands the test to the workspace that has the project open", async () => {
        const host = fakeHost({}, [{ projectPath: "/games/a", name: "A" }]);
        await AGENT_MAIN_TOOL_HANDLERS.test(host, { id: "narraleaf-studio:route-coverage" }, ctx);
        expect(host.forward).toHaveBeenCalledWith(expect.objectContaining({ projectPath: "/games/a" }), AGENT_INTERNAL_TOOL_TEST, { id: "narraleaf-studio:route-coverage" }, ctx);
        expect(host.runHeadlessTest).not.toHaveBeenCalled();
    });

    it("runs headlessly for a named project that is not open, if it is trusted", async () => {
        const host = fakeHost({}, [{ projectPath: "/games/a", name: "A" }]);
        await AGENT_MAIN_TOOL_HANDLERS.test(host, { id: "t", project: "/games/b" }, ctx);
        expect(host.runHeadlessTest).toHaveBeenCalledWith("/games/b", "t");
        const distrusted = fakeHost({ isTrusted: () => false });
        expect(await AGENT_MAIN_TOOL_HANDLERS.test(distrusted, { id: "t", project: "/games/b" }, ctx))
            .toMatchObject({ ok: false, error: { code: "untrusted" } });
    });

    it("says plainly when the workspace cannot run tests yet", async () => {
        const host = fakeHost({}, [{ projectPath: "/games/a", name: "A" }]);
        host.forward.mockResolvedValueOnce(agentRefusal("unknown_tool", "no"));
        expect(await AGENT_MAIN_TOOL_HANDLERS.test(host, { id: "t" }, ctx)).toMatchObject({ ok: false, error: { code: "unavailable" } });
    });

    it("refuses with the open projects listed when it cannot tell which one", async () => {
        const result = await AGENT_MAIN_TOOL_HANDLERS.test(fakeHost(), { id: "t" }, ctx);
        expect(result).toMatchObject({ ok: false, error: { code: "no_workspace" } });
    });
});

describe("build", () => {
    it("refuses an untrusted project before anything runs", async () => {
        const host = fakeHost({ isTrusted: () => false }, [{ projectPath: "/games/a", name: "A" }]);
        expect(await AGENT_MAIN_TOOL_HANDLERS.build(host, {}, ctx)).toMatchObject({ ok: false, error: { code: "untrusted" } });
        expect(host.forward).not.toHaveBeenCalled();
    });

    it("forwards to the open workspace with the target and an absolute output", async () => {
        const host = fakeHost({}, [{ projectPath: "/games/a", name: "A" }]);
        await AGENT_MAIN_TOOL_HANDLERS.build(host, { target: "web", output: "/out" }, ctx);
        expect(host.forward).toHaveBeenCalledWith(expect.anything(), AGENT_INTERNAL_TOOL_BUILD, { target: "web", output: "/out" }, ctx);
        expect(await AGENT_MAIN_TOOL_HANDLERS.build(host, { output: "out" }, ctx)).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    });

    it("asks for the project to be opened when it is not", async () => {
        const host = fakeHost({}, [{ projectPath: "/games/a", name: "A" }]);
        expect(await AGENT_MAIN_TOOL_HANDLERS.build(host, { project: "/games/b" }, ctx))
            .toMatchObject({ ok: false, error: { code: "unavailable", hint: expect.stringContaining("project_open") } });
    });
});

describe("call timeouts", () => {
    it("gives ordinary calls 30 seconds, long ones three minutes, and builds longer", () => {
        expect(agentCallTimeoutMs("story_apply")).toBe(30_000);
        expect(agentCallTimeoutMs("playtest_start")).toBe(180_000);
        expect(agentCallTimeoutMs(AGENT_INTERNAL_TOOL_TEST)).toBe(180_000);
        expect(agentCallTimeoutMs(AGENT_INTERNAL_TOOL_BUILD)).toBeGreaterThan(180_000);
    });
});
