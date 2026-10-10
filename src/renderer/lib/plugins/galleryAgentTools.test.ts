/**
 * The Gallery, the reference plugin for agent tools, run through the host's facade the way a loaded
 * plugin is: a write tool is one undo step that puts the catalog back and has the store re-read it,
 * and the unlock the guide teaches is a graph `blueprint_apply` accepts.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { PluginApp } from "@/plugin";
import { createGalleryAgentTools } from "../../../builtin-plugins/gallery/agentTools";
import { createGalleryStore } from "../../../builtin-plugins/gallery/store";
import { checkBlueprintSource } from "@/lib/agent-core";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import { registerBuiltInPluginBlueprintNodes } from "@/lib/blueprint-cli/builtinPluginNodes";
import { PluginAgentToolRegistry } from "@/lib/workspace/services/agent/pluginToolRegistry";
import { createPluginAgentFacade, type PluginAgentHistory } from "./pluginAgentTools";

function loadGallery() {
    const stores = new Map<string, unknown>();
    const pushed: Parameters<PluginAgentHistory["pushCommand"]>[0][] = [];
    let reloader: (() => Promise<void> | void) | null = null;
    const registry = new PluginAgentToolRegistry();
    const storage = {
        read: async (namespace: string) => (stores.has(namespace) ? JSON.parse(JSON.stringify(stores.get(namespace))) : null),
        write: async (namespace: string, data: unknown) => {
            stores.set(namespace, JSON.parse(JSON.stringify(data)));
        },
        remove: async (namespace: string) => {
            stores.delete(namespace);
        },
    };
    const agent = createPluginAgentFacade({
        pluginId: "narraleaf.gallery",
        pluginName: "Gallery",
        declared: [
            { name: "narraleaf.gallery.list", write: false },
            { name: "narraleaf.gallery.add_entries", write: true },
            { name: "narraleaf.gallery.update_entries", write: true },
            { name: "narraleaf.gallery.remove_entries", write: true },
            { name: "narraleaf.gallery.set_groups", write: true },
            { name: "narraleaf.gallery.set_settings", write: true },
        ],
        registry,
        track: () => undefined,
        storage,
        history: () => ({ pushCommand: request => pushed.push(request) }),
        reload: async () => {
            await reloader?.();
        },
    });
    const app = {
        services: {
            storage: {
                readJson: storage.read,
                // The facade's watch in front of the store, as `createPluginApp` wires it.
                writeJson: async (namespace: string, data: unknown) => {
                    const settle = await agent.beforeStorageWrite(namespace);
                    await storage.write(namespace, data);
                    settle?.(data);
                },
            },
            workspace: {
                frozen: false,
                registerReloader: (reload: () => Promise<void>) => {
                    reloader = reload;
                    return () => undefined;
                },
            },
            blueprintNodes: { notifyDynamicSelectOptionsChanged: () => undefined },
            i18n: { createTranslator: () => ({ locale: "en", t: (key: string) => key }) },
            assets: { list: (type: string) => (type === "image" ? [{ id: "img-a", name: "cg_a.png", type }] : []) },
            voice: { listUnits: async () => [] },
            story: { listStories: () => [], listScenes: async () => [] },
        },
    } as unknown as PluginApp;
    const store = createGalleryStore(app, async () => null);
    return { app, store, agent, registry, pushed, stores };
}

describe("the Gallery's agent tools through the host", () => {
    it("make one add_entries call one undo step, which undo and redo replay and the store re-reads", async () => {
        const { app, store, agent, registry, pushed } = loadGallery();
        await store.load();
        app.services.workspace.registerReloader(() => store.reload());
        agent.service.registerTools(createGalleryAgentTools(app, store));
        expect(registry.list().map(tool => tool.name)).toEqual([
            "narraleaf_gallery__add_entries",
            "narraleaf_gallery__list",
            "narraleaf_gallery__remove_entries",
            "narraleaf_gallery__set_groups",
            "narraleaf_gallery__set_settings",
            "narraleaf_gallery__update_entries",
        ]);

        const result = await registry.get("narraleaf_gallery__add_entries")!.run(
            { entries: [{ kind: "cg", group: "Chapter 1", variants: [{ image: "cg_a" }] }], project: "/game" },
            { clientName: "claude-code" },
        );
        expect(result.ok).toBe(true);
        expect(store.getItems()).toHaveLength(1);
        expect(pushed).toHaveLength(1);

        await pushed[0]!.undo();
        expect(store.getItems()).toHaveLength(0);
        expect(store.getGroups()).toHaveLength(0);
        await pushed[0]!.redo();
        expect(store.getItems().map(item => item.variants[0]?.imageAssetId)).toEqual(["img-a"]);
        expect(store.getGroups().map(group => group.name)).toEqual(["Chapter 1"]);
    });

    it("keep the list tool reading: it answers without writing or recording anything", async () => {
        const { app, store, agent, registry, pushed, stores } = loadGallery();
        await store.load();
        agent.service.registerTools(createGalleryAgentTools(app, store));
        const listed = await registry.get("narraleaf_gallery__list")!.run({}, { clientName: null });
        expect(listed.ok).toBe(true);
        expect(pushed).toHaveLength(0);
        expect(stores.size).toBe(0);
    });
});

describe("unlocking a CG, as the Gallery's guide teaches it", () => {
    // The catalogue Studio's blueprint tools check against: the host's nodes and, as in a workspace
    // with the Gallery loaded, the Gallery's.
    beforeAll(() => {
        registerCoreBlueprintNodes();
        registerBuiltInPluginBlueprintNodes();
    });

    it("is a graph blueprint_apply accepts: a page's open event, a persistent flag, an If, Unlock Gallery", () => {
        const source = [
            "blueprint Title owner=surfaceMain surface=title-page",
            "",
            "event \"Collect seen CGs\"",
            "    open: blueprint.event.head.surfaceInit",
            "    seen: blueprint.persistent.get",
            "        persistentVariableId = seen-cg-rooftop",
            "    check: if",
            "    unlock: narraleaf.gallery.add",
            "        galleryItemId = narraleaf.gallery.entry-1",
            "    everything: narraleaf.gallery.unlockAll",
            "",
            "    open.then -> seen.in",
            "    seen.next -> check.in",
            "    seen.value -> check.condition",
            "    check.true -> unlock.in",
            "    unlock.next -> everything.in",
            "",
        ].join("\n");
        const check = checkBlueprintSource(source, null);
        const errors = check.diagnostics.filter(diagnostic => diagnostic.severity === "error");
        expect(errors).toEqual([]);
        expect(check.ok).toBe(true);
        const written = JSON.stringify(check.blueprints);
        expect(written).toContain("\"narraleaf.gallery.add\"");
        expect(written).toContain("\"narraleaf.gallery.unlockAll\"");
    });
});
