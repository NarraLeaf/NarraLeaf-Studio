import { describe, expect, it, vi } from "vitest";
import { UIStore } from "./UIStore";
import { TextEditorContributionService } from "./TextEditorContributionService";
import type {
    PluginTextEditorActionDef,
    PluginTextEditorLanguageDef,
    PluginTextEditorPreviewDef,
} from "./textEditorContributions";
import { createPluginApp } from "@/lib/plugins/pluginRuntime";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { PluginApp } from "@/plugin";
import type { WorkspacePluginDescriptor } from "@shared/types/plugins";

/**
 * Studio registers nothing into this registry - the whole point of the phase is that the Markdown
 * grammar, preview and commands are a plugin's job. So the only way to know the seam works is to
 * drive it the way a plugin does: through `createPluginApp`, and then look at what the host can
 * actually see.
 */

const descriptor = {
    plugin: { id: "test-plugin", version: "1.0.0" },
    manifest: {
        manifestVersion: 2,
        id: "test-plugin",
        name: "Test",
        version: "1.0.0",
        entries: { studio: "main.js" },
        // Deliberately no text-editor entry: these contributions are imperative, exactly like
        // `ui.panels`, and registering one must not require a manifest declaration.
        contributes: { blueprintNodes: [], widgets: [], locales: [] },
        permissions: [],
    },
    entryUrl: "app://plugins/test-plugin/main.js",
} as unknown as WorkspacePluginDescriptor;

function createHost() {
    const store = new UIStore();
    const textEditor = new TextEditorContributionService(store);
    const uiService = {
        textEditor,
        panels: { register: vi.fn(() => vi.fn()), unregister: vi.fn() },
        getStore: () => store,
        editor: { open: vi.fn() },
        keybindings: { register: vi.fn(() => vi.fn()), registerMany: vi.fn(() => vi.fn()) },
        notifications: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    };
    const services = new Map<Services, unknown>([
        [Services.UI, uiService],
        [Services.Assets, { getAssets: vi.fn(() => ({})), fetch: vi.fn() }],
        [Services.ServiceAssets, { readStore: vi.fn(), writeStore: vi.fn() }],
        [Services.BlueprintNodeCatalog, {
            register: vi.fn(),
            registerMany: vi.fn(),
            registerDynamicSelectOptionsSource: vi.fn(() => vi.fn()),
            notifyDynamicSelectOptionsChanged: vi.fn(),
        }],
        [Services.Story, { registerPluginAction: vi.fn(() => vi.fn()) }],
    ]);
    const ctx = {
        services: { get: (service: Services) => services.get(service) },
    } as unknown as WorkspaceContext;
    return { ctx, store, textEditor };
}

const language: PluginTextEditorLanguageDef = {
    id: "test-plugin.mermaid",
    extensions: [".mmd", "MMD2"],
    monarch: { tokenizer: {} },
};

const preview: PluginTextEditorPreviewDef = {
    id: "test-plugin.markdown-preview",
    extensions: ["md", ".markdown"],
    title: "Preview",
    component: () => null,
};

const action: PluginTextEditorActionDef = {
    id: "test-plugin.uppercase",
    title: "Uppercase",
    run: ctx => ctx.setText(ctx.getText().toUpperCase()),
};

describe("TextEditorContributionService", () => {
    it("resolves contributions by extension, in either spelling", () => {
        const { textEditor } = createHost();
        textEditor.registerLanguage(language);
        textEditor.registerPreview(preview);

        // Registered with a dot, asked without one - and the other way round.
        expect(textEditor.languageForExtension("mmd")?.id).toBe(language.id);
        expect(textEditor.languageForExtension(".MMD2")?.id).toBe(language.id);
        expect(textEditor.languageForExtension("md")).toBeUndefined();

        expect(textEditor.previewsForExtension("markdown").map(def => def.id)).toEqual([preview.id]);
        expect(textEditor.previewsForExtension("txt")).toEqual([]);
    });

    it("offers an action with no extensions on every document, and a scoped one only where it applies", () => {
        const { textEditor } = createHost();
        textEditor.registerAction(action);
        textEditor.registerAction({ ...action, id: "test-plugin.toc", extensions: ["md"] });

        expect(textEditor.actionsForExtension("txt").map(def => def.id)).toEqual(["test-plugin.uppercase"]);
        expect(textEditor.actionsForExtension("md").map(def => def.id)).toEqual([
            "test-plugin.uppercase",
            "test-plugin.toc",
        ]);
        // A document with no extension at all still gets the unscoped action.
        expect(textEditor.actionsForExtension("").map(def => def.id)).toEqual(["test-plugin.uppercase"]);
    });

    it("replaces a re-registered id in place rather than stacking a duplicate", () => {
        const { textEditor } = createHost();
        textEditor.registerPreview(preview);
        textEditor.registerPreview({ ...preview, title: "Second" });

        expect(textEditor.getPreviews()).toHaveLength(1);
        expect(textEditor.getPreviews()[0].title).toBe("Second");
    });

    it("notifies subscribers on every mutation", () => {
        const { store, textEditor } = createHost();
        const seen: number[] = [];
        store.getEvents().on("stateChanged", changes => {
            if (changes.textEditorPreviews) {
                seen.push(changes.textEditorPreviews.length);
            }
        });

        const dispose = textEditor.registerPreview(preview);
        dispose();

        expect(seen).toEqual([1, 0]);
    });
});

describe("app.services.textEditor", () => {
    it("lands a plugin's language, preview and action in the host registry", () => {
        const { ctx, textEditor } = createHost();
        const { app } = createPluginApp(ctx, descriptor, {} as PluginApp["privileged"]);

        app.services.textEditor.registerLanguage(language);
        app.services.textEditor.registerPreview(preview);
        app.services.textEditor.registerAction(action);

        expect(textEditor.getLanguages()).toEqual([language]);
        expect(textEditor.getPreviews()).toEqual([preview]);
        expect(textEditor.getActions()).toEqual([action]);
    });

    it("reclaims every text-editor registration when the plugin unloads", () => {
        const { ctx, textEditor } = createHost();
        const { app, dispose } = createPluginApp(ctx, descriptor, {} as PluginApp["privileged"]);

        app.services.textEditor.registerLanguage(language);
        app.services.textEditor.registerPreview(preview);
        app.services.textEditor.registerAction(action);

        // The host's own bag, not the plugin's cleanup: a plugin that never calls the returned
        // disposer must still not leave a preview toggle behind for a component that is gone.
        dispose();

        expect(textEditor.getLanguages()).toEqual([]);
        expect(textEditor.getPreviews()).toEqual([]);
        expect(textEditor.getActions()).toEqual([]);
    });

    it("honours the disposer it hands back", () => {
        const { ctx, textEditor } = createHost();
        const { app } = createPluginApp(ctx, descriptor, {} as PluginApp["privileged"]);

        const removePreview = app.services.textEditor.registerPreview(preview);
        app.services.textEditor.registerAction(action);
        void removePreview();

        expect(textEditor.getPreviews()).toEqual([]);
        expect(textEditor.getActions()).toEqual([action]);
    });

    it("rejects ids that are not namespaced under the plugin id", () => {
        const { ctx, textEditor } = createHost();
        const { app } = createPluginApp(ctx, descriptor, {} as PluginApp["privileged"]);

        expect(() => app.services.textEditor.registerLanguage({ ...language, id: "mermaid" }))
            .toThrow(/must be prefixed with/);
        expect(() => app.services.textEditor.registerPreview({ ...preview, id: "other-plugin.preview" }))
            .toThrow(/must be prefixed with/);
        expect(() => app.services.textEditor.registerAction({ ...action, id: "uppercase" }))
            .toThrow(/must be prefixed with/);

        expect(textEditor.getLanguages()).toEqual([]);
        expect(textEditor.getPreviews()).toEqual([]);
        expect(textEditor.getActions()).toEqual([]);
    });
});
