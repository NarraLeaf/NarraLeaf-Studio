import { describe, expect, it } from "vitest";
import {
    AGENT_MCP_TOOL_NAME_PATTERN,
    AGENT_PLUGIN_TOOL_SEPARATOR,
    AGENT_PLUGIN_TOOL_TEXT_MAX,
    agentPluginToolMcpName,
    checkAgentPluginToolSchema,
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
