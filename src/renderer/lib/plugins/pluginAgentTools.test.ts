import { describe, expect, it, vi } from "vitest";
import type { PluginAgentToolDef } from "@shared/agent/pluginTools";
import { PluginAgentToolRegistry } from "@/lib/workspace/services/agent/pluginToolRegistry";
import { createPluginAgentFacade, PLUGIN_AGENT_HISTORY_LABEL_KEY, type PluginAgentHistory } from "./pluginAgentTools";

/**
 * A plugin's agent tools, with Studio's services stood in by maps: what registration refuses, what
 * a call is given, and the storage watch that refuses a reading tool's writes and turns a writing
 * tool's writes into one step of undo.
 */

type Pushed = Parameters<PluginAgentHistory["pushCommand"]>[0];

function harness(declared = [
    { name: "acme.notes.list", write: false },
    { name: "acme.notes.add", write: true },
]) {
    const stores = new Map<string, unknown>();
    const pushed: Pushed[] = [];
    const disposers: (() => void)[] = [];
    const reload = vi.fn(async () => undefined);
    const registry = new PluginAgentToolRegistry();
    const facade = createPluginAgentFacade({
        pluginId: "acme.notes",
        pluginName: "Notes",
        declared,
        registry,
        track: disposer => disposers.push(disposer),
        storage: {
            read: async namespace => (stores.has(namespace) ? JSON.parse(JSON.stringify(stores.get(namespace))) : null),
            write: async (namespace, data) => {
                stores.set(namespace, JSON.parse(JSON.stringify(data)));
            },
            remove: async namespace => {
                stores.delete(namespace);
            },
        },
        history: () => ({ pushCommand: request => pushed.push(request) }),
        reload,
    });
    /** What `services.storage.writeJson` does, with the watch in front of it. */
    const writeJson = async (namespace: string, data: unknown) => {
        const settle = await facade.beforeStorageWrite(namespace);
        stores.set(namespace, JSON.parse(JSON.stringify(data)));
        settle?.(data);
    };
    return { facade, registry, stores, pushed, disposers, reload, writeJson };
}

function tool(overrides: Partial<PluginAgentToolDef> = {}): PluginAgentToolDef {
    return {
        name: "acme.notes.list",
        title: "List notes",
        description: "Lists the notes.",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
        write: false,
        handler: () => "none",
        ...overrides,
    };
}

describe("registering a plugin's agent tool", () => {
    it("offers it under the flattened name, with `project` added to the schema, until it is disposed", () => {
        const { facade, registry, disposers } = harness();
        const dispose = facade.service.registerTool(tool());
        const [descriptor] = registry.list();
        expect(descriptor).toMatchObject({ name: "acme_notes__list", pluginId: "acme.notes", pluginToolName: "acme.notes.list", write: false, side: "workspace" });
        expect(Object.keys(descriptor!.inputSchema.properties ?? {})).toEqual(["query", "project"]);
        expect(disposers).toHaveLength(1);
        dispose();
        expect(registry.list()).toEqual([]);
    });

    it("throws for a name without the prefix, an undeclared tool, a write flag that disagrees, or a bad schema", () => {
        const { facade } = harness();
        expect(() => facade.service.registerTool(tool({ name: "other.list" }))).toThrow(/prefixed/);
        expect(() => facade.service.registerTool(tool({ name: "acme.notes.secret" }))).toThrow(/not declared/);
        expect(() => facade.service.registerTool(tool({ write: true }))).toThrow(/write must be false/);
        expect(() => facade.service.registerTool(tool({ inputSchema: { type: "object", properties: { project: { type: "string" } } } }))).toThrow(/project/);
        expect(() => facade.service.registerTool(tool({ title: "" }))).toThrow(/title/);
    });

    it("checks a whole batch before offering any of it", () => {
        const { facade, registry } = harness();
        expect(() => facade.service.registerTools([tool(), tool({ name: "acme.notes.nope" })])).toThrow();
        expect(registry.list()).toEqual([]);
    });

    it("refuses a name another plugin already offers, and lets the same plugin replace its own", () => {
        const { facade, registry } = harness();
        facade.service.registerTool(tool());
        const descriptor = registry.list()[0]!;
        const run = async () => ({ ok: true as const, content: [] });
        expect(() => registry.register({ descriptor: { ...descriptor, pluginId: "someone.else" }, run })).toThrow(/already offers/);
        expect(() => registry.register({ descriptor, run })).not.toThrow();
        expect(registry.get(descriptor.name)?.run).toBe(run);
    });
});

describe("running a plugin's agent tool", () => {
    it("checks the arguments against the schema before the handler runs, and hands it no `project`", async () => {
        const { facade, registry } = harness();
        const handler = vi.fn(() => "ok");
        facade.service.registerTool(tool({ handler }));
        const run = registry.get("acme_notes__list")!.run;
        const refused = await run({ query: 3 }, { clientName: null });
        expect(refused).toMatchObject({ ok: false, error: { code: "invalid_args" } });
        expect(handler).not.toHaveBeenCalled();
        await run({ query: "x", project: "/game" }, { clientName: "Claude" });
        expect(handler).toHaveBeenCalledWith({ query: "x" }, { clientName: "Claude" });
    });

    it("refuses plugin storage writes while a reading tool runs, and allows them again afterwards", async () => {
        const { facade, registry, writeJson, stores } = harness();
        facade.service.registerTool(tool({
            handler: async () => {
                await writeJson("notes", { items: ["sneaky"] });
                return "wrote";
            },
        }));
        const result = await registry.get("acme_notes__list")!.run({}, { clientName: null });
        expect(result).toMatchObject({ ok: false, error: { code: "internal" } });
        expect(result.ok ? "" : result.error.message).toMatch(/reading tool/);
        expect(stores.has("notes")).toBe(false);
        await writeJson("notes", { items: ["the author's own"] });
        expect(stores.get("notes")).toEqual({ items: ["the author's own"] });
    });

    it("records a writing tool's storage writes as one undo step that undo and redo replay, then reload the plugin", async () => {
        const { facade, registry, writeJson, stores, pushed, reload } = harness();
        stores.set("notes", { items: ["a"] });
        facade.service.registerTool(tool({
            name: "acme.notes.add",
            title: "Add notes",
            write: true,
            handler: async () => {
                await writeJson("notes", { items: ["a", "b"] });
                await writeJson("notes", { items: ["a", "b", "c"] });
                await writeJson("index", { count: 3 });
                return "added";
            },
        }));
        const result = await registry.get("acme_notes__add")!.run({}, { clientName: null });
        expect(result.ok).toBe(true);
        expect(pushed).toHaveLength(1);
        expect(pushed[0]!.label).toEqual({ key: PLUGIN_AGENT_HISTORY_LABEL_KEY, params: { tool: "Add notes" } });

        await pushed[0]!.undo();
        expect(stores.get("notes")).toEqual({ items: ["a"] });
        // The namespace did not exist before the call, so undo takes it away again.
        expect(stores.has("index")).toBe(false);
        expect(reload).toHaveBeenCalledTimes(1);

        await pushed[0]!.redo();
        expect(stores.get("notes")).toEqual({ items: ["a", "b", "c"] });
        expect(stores.get("index")).toEqual({ count: 3 });
        expect(reload).toHaveBeenCalledTimes(2);
    });

    it("records nothing for a writing tool that wrote nothing new, and still records what a failing one wrote", async () => {
        const { facade, registry, writeJson, stores, pushed } = harness();
        stores.set("notes", { items: ["a"] });
        let fail = false;
        facade.service.registerTool(tool({
            name: "acme.notes.add",
            write: true,
            handler: async () => {
                await writeJson("notes", fail ? { items: ["half"] } : { items: ["a"] });
                if (fail) {
                    throw new Error("disk on fire");
                }
                return "same";
            },
        }));
        const run = registry.get("acme_notes__add")!.run;
        await run({}, { clientName: null });
        expect(pushed).toHaveLength(0);
        fail = true;
        expect(await run({}, { clientName: null })).toMatchObject({ ok: false, error: { code: "internal" } });
        expect(pushed).toHaveLength(1);
        await pushed[0]!.undo();
        expect(stores.get("notes")).toEqual({ items: ["a"] });
    });

    it("passes a plugin's refusal through and caps what it answers", async () => {
        const { facade, registry } = harness();
        let answer: unknown = { error: { code: "not_found", message: "No such note.", hint: "List them." } };
        facade.service.registerTool(tool({ handler: () => answer as never }));
        const run = registry.get("acme_notes__list")!.run;
        expect(await run({}, { clientName: null })).toEqual({ ok: false, error: { code: "not_found", message: "No such note.", hint: "List them." } });
        answer = { text: "x".repeat(70_000) };
        const long = await run({}, { clientName: null });
        expect(long.ok && long.content[0]!.type === "text" ? long.content[0]!.text.length : 0).toBeLessThanOrEqual(60_000);
    });
});
