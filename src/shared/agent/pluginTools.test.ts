import { describe, expect, it } from "vitest";
import {
    AGENT_MCP_TOOL_NAME_PATTERN,
    AGENT_PLUGIN_TOOL_SEPARATOR,
    AGENT_PLUGIN_TOOL_TEXT_MAX,
    agentPluginToolMcpName,
    checkAgentPluginToolSchema,
    checkReportedAgentPluginTool,
    looksLikeAgentPluginToolName,
    normalizePluginAgentToolResult,
    readAgentPluginToolDescriptor,
    withAgentProjectArgument,
    withoutAgentProjectArgument,
} from "./pluginTools";
import { AGENT_TOOLS } from "./tools";

describe("plugin tool names", () => {
    it("flatten the plugin id and the tool part, joined by a double underscore", () => {
        expect(agentPluginToolMcpName("narraleaf.gallery", "narraleaf.gallery.add_entries")).toBe("narraleaf_gallery__add_entries");
        expect(agentPluginToolMcpName("acme.my-notes", "acme.my-notes.notes.add-one")).toBe("acme_my_notes__notes_add_one");
    });

    it("refuse a name without the plugin prefix, with other characters, or too long once mapped", () => {
        expect(agentPluginToolMcpName("narraleaf.gallery", "other.plugin.list")).toBeNull();
        expect(agentPluginToolMcpName("narraleaf.gallery", "narraleaf.gallery.List")).toBeNull();
        expect(agentPluginToolMcpName("narraleaf.gallery", "narraleaf.gallery.a b")).toBeNull();
        expect(agentPluginToolMcpName("narraleaf.gallery", "narraleaf.gallery.")).toBeNull();
        expect(agentPluginToolMcpName("narraleaf.gallery", `narraleaf.gallery.${"x".repeat(60)}`)).toBeNull();
    });

    it("never take a name Studio's internal calls use: no empty plugin id, nothing starting with `__`", () => {
        expect(agentPluginToolMcpName("", ".build")).toBeNull();
        expect(agentPluginToolMcpName("", ".test")).toBeNull();
        expect(agentPluginToolMcpName("_", "_.state")).toBeNull();
        expect(agentPluginToolMcpName("-", "-.build")).toBeNull();
    });

    it("never collide with a built-in tool: no built-in name contains the separator", () => {
        for (const tool of AGENT_TOOLS) {
            expect(tool.name.includes(AGENT_PLUGIN_TOOL_SEPARATOR)).toBe(false);
            expect(AGENT_MCP_TOOL_NAME_PATTERN.test(tool.name)).toBe(true);
            expect(looksLikeAgentPluginToolName(tool.name)).toBe(false);
        }
        expect(looksLikeAgentPluginToolName("narraleaf_gallery__list")).toBe(true);
    });
});

describe("plugin tool schemas", () => {
    it("accept the subset the argument checker understands", () => {
        expect(checkAgentPluginToolSchema({
            type: "object",
            properties: {
                ids: { type: "array", items: { type: "string" } },
                kind: { type: "string", enum: ["cg", "music"] },
                count: { type: "integer", minimum: 1, maximum: 10 },
            },
            required: ["ids"],
            additionalProperties: false,
        })).toEqual([]);
    });

    it("refuse a root that is not an object, an unknown keyword, and a `project` property", () => {
        expect(checkAgentPluginToolSchema({ type: "string" })).toHaveLength(1);
        expect(checkAgentPluginToolSchema({ type: "object", properties: { a: { type: "string", pattern: "^x" } } })[0]).toContain("pattern");
        expect(checkAgentPluginToolSchema({ type: "object", properties: { project: { type: "string" } } })[0]).toContain("project");
        expect(checkAgentPluginToolSchema({ type: "object", required: ["missing"], properties: {} })[0]).toContain("missing");
    });

    it("add `project` for the advertised copy and take it out of the handler's arguments", () => {
        const advertised = withAgentProjectArgument({ type: "object", properties: { a: { type: "string" } } });
        expect(Object.keys(advertised.properties ?? {})).toEqual(["a", "project"]);
        expect(withoutAgentProjectArgument({ a: 1, project: "/p" })).toEqual({ a: 1 });
    });
});

describe("reported descriptors", () => {
    const good = {
        name: "narraleaf_gallery__list",
        title: "Read the gallery",
        description: "Lists it.",
        side: "workspace",
        write: false,
        inputSchema: withAgentProjectArgument({ type: "object", properties: {} }),
        pluginId: "narraleaf.gallery",
        pluginName: "Gallery",
        pluginToolName: "narraleaf.gallery.list",
    };

    it("are accepted when every field checks out", () => {
        expect(readAgentPluginToolDescriptor(good)?.name).toBe("narraleaf_gallery__list");
    });

    it("are dropped when the advertised name does not follow from the plugin's own, or names a built-in", () => {
        expect(readAgentPluginToolDescriptor({ ...good, name: "narraleaf_gallery__other" })).toBeNull();
        expect(readAgentPluginToolDescriptor({ ...good, name: "story_apply" })).toBeNull();
        expect(readAgentPluginToolDescriptor({ ...good, title: "" })).toBeNull();
        expect(readAgentPluginToolDescriptor({ ...good, inputSchema: { type: "object", properties: {} } })).toBeNull();
    });

    it("are dropped for an empty plugin id or a name Studio's internal calls use", () => {
        expect(readAgentPluginToolDescriptor({ ...good, pluginId: "", pluginToolName: ".build", name: "__build" })).toBeNull();
        expect(readAgentPluginToolDescriptor({ ...good, pluginId: "", pluginToolName: ".test", name: "__test" })).toBeNull();
        expect(readAgentPluginToolDescriptor({ ...good, name: "__state" })).toBeNull();
    });
});

describe("reported descriptors against the installed plugins", () => {
    const reported = readAgentPluginToolDescriptor({
        name: "narraleaf_gallery__add",
        title: "Add to the gallery",
        description: "Adds entries.",
        side: "workspace",
        write: true,
        inputSchema: withAgentProjectArgument({ type: "object", properties: {} }),
        pluginId: "narraleaf.gallery",
        pluginName: "Whatever the window said",
        pluginToolName: "narraleaf.gallery.add",
    })!;
    const gallery = (overrides: { enabled?: boolean; write?: boolean; name?: string } = {}) => ({
        pluginId: "narraleaf.gallery",
        enabled: overrides.enabled ?? true,
        manifest: {
            name: "Gallery",
            contributes: { agentTools: [{ name: overrides.name ?? "narraleaf.gallery.add", write: overrides.write ?? true }] },
        },
    });

    it("keep a tool an enabled plugin declares with the same write flag, under the manifest's name for the plugin", () => {
        expect(checkReportedAgentPluginTool(reported, [gallery()])).toMatchObject({ name: "narraleaf_gallery__add", pluginName: "Gallery", write: true });
    });

    it("drop a tool the plugin does not declare, declares the other way, or that belongs to no enabled plugin", () => {
        expect(checkReportedAgentPluginTool(reported, [gallery({ name: "narraleaf.gallery.list" })])).toBeNull();
        expect(checkReportedAgentPluginTool(reported, [gallery({ write: false })])).toBeNull();
        expect(checkReportedAgentPluginTool(reported, [gallery({ enabled: false })])).toBeNull();
        expect(checkReportedAgentPluginTool(reported, [])).toBeNull();
        expect(checkReportedAgentPluginTool({ ...reported, pluginId: "acme.other" }, [gallery()])).toBeNull();
    });

    it("drop an empty plugin id or an internal name even if some manifest matched it", () => {
        const internal = { ...reported, pluginId: "", name: "__build", pluginToolName: ".build" };
        expect(checkReportedAgentPluginTool(internal, [{ pluginId: "", enabled: true, manifest: { name: "x", contributes: { agentTools: [{ name: ".build", write: true }] } } }])).toBeNull();
    });
});

describe("plugin tool answers", () => {
    it("take a bare string as text and an error object as a refusal with a plugin-allowed code", () => {
        expect(normalizePluginAgentToolResult("done", "t")).toEqual({ ok: true, content: [{ type: "text", text: "done" }] });
        const refused = normalizePluginAgentToolResult({ error: { code: "frozen", message: "no" } }, "t");
        expect(refused).toEqual({ ok: false, error: { code: "unavailable", message: "no", hint: undefined } });
        expect(normalizePluginAgentToolResult({ error: { code: "not_found", message: "gone", hint: "list" } }, "t"))
            .toEqual({ ok: false, error: { code: "not_found", message: "gone", hint: "list" } });
    });

    it("cut long text, drop oversized data, and pass at most one well-formed image", () => {
        const long = normalizePluginAgentToolResult({ text: "x".repeat(AGENT_PLUGIN_TOOL_TEXT_MAX + 10) }, "t");
        expect(long.ok && long.content[0].type === "text" ? long.content[0].text.length : 0).toBeLessThanOrEqual(AGENT_PLUGIN_TOOL_TEXT_MAX);
        const big = normalizePluginAgentToolResult({ text: "ok", data: { blob: "y".repeat(70_000) } }, "t");
        expect(big.ok ? big.structured : "x").toBeUndefined();
        const image = normalizePluginAgentToolResult({ text: "ok", image: { mimeType: "image/png", data: "AAAA" } }, "t");
        expect(image.ok ? image.content.map(part => part.type) : []).toEqual(["text", "image"]);
        const badImage = normalizePluginAgentToolResult({ text: "ok", image: { mimeType: "image/gif", data: "AAAA" } }, "t");
        expect(badImage.ok ? badImage.content.map(part => part.type) : []).toEqual(["text"]);
    });

    it("report anything else as the plugin's own failure", () => {
        expect(normalizePluginAgentToolResult(42, "t")).toMatchObject({ ok: false, error: { code: "internal" } });
        expect(normalizePluginAgentToolResult({ data: {} }, "t")).toMatchObject({ ok: false, error: { code: "internal" } });
    });
});
