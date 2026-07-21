import { describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { EditorGroup, EditorLayout } from "@/apps/workspace/registry/types";
import { EDITOR_SPLIT_RATIO_EPSILON } from "@/lib/workspace/services/ui/UIStore";
import {
    getWorkspaceEditorSessionSettingsKey,
    parseWorkspaceEditorSession,
    restoreWorkspaceEditorSession,
    serializeEditorSession,
    type WorkspaceEditorSessionV2,
} from "./workspaceEditorSession";

function createDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc-1",
        name: "Document",
        surfaces: [
            {
                id: "surface-1",
                name: "App Surface",
                host: "app",
                kind: "appSurface",
                designSize: { width: 1280, height: 720 },
                rootElementId: "root-1",
            },
        ],
        components: [
            {
                id: "component-1",
                name: "Component",
                rootElementId: "component-root-1",
                elements: {
                    "component-root-1": {
                        id: "component-root-1",
                        type: "nl.root",
                        parentId: null,
                        childrenIds: ["component-widget-1"],
                        layout: { x: 0, y: 0, width: 100, height: 100 },
                    },
                    "component-widget-1": {
                        id: "component-widget-1",
                        type: "nl.button",
                        parentId: "component-root-1",
                        childrenIds: [],
                        layout: { x: 0, y: 0, width: 100, height: 40 },
                    },
                },
            },
        ],
        elements: {
            "root-1": {
                id: "root-1",
                type: "nl.root",
                parentId: null,
                childrenIds: ["widget-1"],
                layout: { x: 0, y: 0, width: 1280, height: 720 },
            },
            "widget-1": {
                id: "widget-1",
                type: "nl.button",
                parentId: "root-1",
                childrenIds: [],
                layout: { x: 10, y: 10, width: 120, height: 40 },
            },
        },
    };
}

function createRestoreHarness(options: { blueprints?: Record<string, unknown>; storyExists?: boolean; motionExists?: boolean } = {}) {
    const document = createDocument();
    const services = {
        get: vi.fn((service: Services) => {
            if (service === Services.UIDocument) {
                return { getDocument: () => document };
            }
            if (service === Services.LocalBlueprint) {
                return {
                    getBlueprintDocument: () => ({
                        blueprints: options.blueprints ?? {},
                    }),
                };
            }
            if (service === Services.Story) {
                return {
                    getStoryEntry: () => (options.storyExists ? { id: "story-1", name: "Story" } : undefined),
                    listAnimationAssets: () => options.motionExists
                        ? [{ id: "motion-1", name: "Motion", targetKind: "image", updatedAt: "2026-07-01T00:00:00.000Z" }]
                        : [],
                };
            }
            throw new Error(`Unexpected service: ${service}`);
        }),
    };
    const context = {
        project: { getConfig: () => ({ projectPath: "/tmp/project-a" }) },
        services,
    } as unknown as WorkspaceContext;
    const store = {
        openEditorTabInGroup: vi.fn(),
        setActiveEditorTabInGroup: vi.fn(),
        restoreEditorLayout: vi.fn(),
    };
    const uiService = {
        getStore: () => store,
        focus: { setFocus: vi.fn() },
    };
    return { context, store, uiService };
}

/** The layout `restoreEditorLayout` was handed, or null when restore bailed before installing one. */
function restoredLayout(store: { restoreEditorLayout: { mock: { calls: unknown[][] } } }): EditorLayout | null {
    const call = store.restoreEditorLayout.mock.calls[0];
    return call ? (call[0] as EditorLayout) : null;
}

function restoredGroups(store: Parameters<typeof restoredLayout>[0]): EditorGroup[] {
    const layout = restoredLayout(store);
    if (!layout) {
        return [];
    }
    const walk = (node: EditorLayout): EditorGroup[] =>
        "tabs" in node ? [node] : [...walk(node.first), ...walk(node.second)];
    return walk(layout);
}

describe("workspace editor session", () => {
    it("uses a project-scoped settings key", () => {
        const first = getWorkspaceEditorSessionSettingsKey({
            projectIdentifier: "com.example.same",
            projectPath: "/Users/me/Projects/First/",
        });
        const firstNormalized = getWorkspaceEditorSessionSettingsKey({
            projectIdentifier: "com.example.same",
            projectPath: "/Users/me/Projects/First",
        });
        const second = getWorkspaceEditorSessionSettingsKey({
            projectIdentifier: "com.example.same",
            projectPath: "/Users/me/Projects/Second",
        });

        expect(first).toMatch(/^ui\.editor\.session\.project\.[a-z0-9]+$/);
        expect(firstNormalized).toBe(first);
        expect(second).not.toBe(first);
    });

    it("skips restored blueprint tabs when their project resources are missing", () => {
        const { context, store, uiService } = createRestoreHarness();
        const session: WorkspaceEditorSessionV2 = {
            version: 2,
            activeGroupId: "main",
            layout: {
                kind: "group",
                id: "main",
                focus: null,
                tabs: [
                    {
                        kind: "blueprint",
                        title: "Missing Blueprint",
                        payload: {
                            blueprintId: "missing-blueprint",
                            ownerKind: "surfaceMain",
                            surfaceId: "surface-1",
                        },
                    },
                ],
            },
        };

        expect(restoreWorkspaceEditorSession(context, session, uiService as any)).toBe(0);
        expect(store.restoreEditorLayout).not.toHaveBeenCalled();
    });

    it("restores only tabs that can be resolved in the current project", () => {
        const { context, store, uiService } = createRestoreHarness({
            blueprints: { "blueprint-1": { id: "blueprint-1" } },
            motionExists: true,
        });
        const session: WorkspaceEditorSessionV2 = {
            version: 2,
            activeGroupId: "main",
            layout: {
                kind: "group",
                id: "main",
                focus: "blueprint-entry:blueprint-1:surface-1:~:~",
                tabs: [
                    { kind: "surface", surfaceId: "missing-surface" },
                    {
                        kind: "blueprint",
                        title: "Surface Logic",
                        payload: {
                            blueprintId: "blueprint-1",
                            ownerKind: "surfaceMain",
                            surfaceId: "surface-1",
                        },
                    },
                    {
                        kind: "storyScene",
                        title: "Missing Story",
                        payload: { storyId: "missing-story", sceneId: "scene-1" },
                    },
                    {
                        kind: "storyMotion",
                        title: "Story Motion",
                        payload: { animationId: "motion-1" },
                    },
                ],
            },
        };

        expect(restoreWorkspaceEditorSession(context, session, uiService as any)).toBe(2);

        const groups = restoredGroups(store);
        expect(groups).toHaveLength(1);
        expect(groups[0].tabs.map(tab => tab.id)).toEqual([
            "blueprint-entry:blueprint-1:surface-1:~:~",
            "story-motion:motion-1",
        ]);
        expect(groups[0].focus).toBe("blueprint-entry:blueprint-1:surface-1:~:~");
        expect(uiService.focus.setFocus).toHaveBeenCalledWith(
            expect.anything(),
            "blueprint-entry:blueprint-1:surface-1:~:~",
        );
    });

    it("restores a split tree with its ratios and per-pane focus", () => {
        const { context, store, uiService } = createRestoreHarness({
            blueprints: { "blueprint-1": { id: "blueprint-1" } },
            motionExists: true,
        });
        const blueprintTab = {
            kind: "blueprint" as const,
            title: "Surface Logic",
            payload: { blueprintId: "blueprint-1", ownerKind: "surfaceMain" as const, surfaceId: "surface-1" },
        };
        const session: WorkspaceEditorSessionV2 = {
            version: 2,
            activeGroupId: "group-1",
            layout: {
                kind: "split",
                id: "split-1",
                direction: "vertical",
                ratio: 0.3,
                first: { kind: "group", id: "main", focus: null, tabs: [blueprintTab] },
                second: {
                    kind: "group",
                    id: "group-1",
                    focus: "story-motion:motion-1",
                    tabs: [{ kind: "storyMotion", title: "Story Motion", payload: { animationId: "motion-1" } }],
                },
            } as WorkspaceEditorSessionV2["layout"],
        };

        expect(restoreWorkspaceEditorSession(context, session, uiService as any)).toBe(2);

        const layout = restoredLayout(store);
        if (!layout || "tabs" in layout) {
            throw new Error("Expected a split layout");
        }
        expect(layout.direction).toBe("vertical");
        expect(layout.ratio).toBe(0.3);
        expect(restoredGroups(store).map(g => g.id)).toEqual(["main", "group-1"]);
        // The pane the user left focused, not simply the first one.
        expect(uiService.focus.setFocus).toHaveBeenCalledWith(expect.anything(), "story-motion:motion-1");
    });

    it("collapses a restored pane whose tabs all failed to resolve", () => {
        const { context, store, uiService } = createRestoreHarness({ motionExists: true });
        const session: WorkspaceEditorSessionV2 = {
            version: 2,
            activeGroupId: "main",
            layout: {
                kind: "split",
                id: "split-1",
                direction: "horizontal",
                ratio: 0.5,
                first: { kind: "group", id: "main", focus: null, tabs: [{ kind: "surface", surfaceId: "gone" }] },
                second: {
                    kind: "group",
                    id: "group-1",
                    focus: null,
                    tabs: [{ kind: "storyMotion", title: "Story Motion", payload: { animationId: "motion-1" } }],
                },
            },
        };

        expect(restoreWorkspaceEditorSession(context, session, uiService as any)).toBe(1);

        const layout = restoredLayout(store);
        if (!layout || !("tabs" in layout)) {
            throw new Error("Expected the empty pane to collapse to a single group");
        }
        expect(layout.id).toBe("group-1");
    });
});

describe("workspace editor session serialization", () => {
    const tab = (id: string) => ({
        id,
        title: id,
        component: (() => null) as never,
        payload: { animationId: id.replace("story-motion:", "") },
    });

    it("round-trips a split layout through serialize and parse", () => {
        const layout: EditorLayout = {
            id: "split-1",
            direction: "horizontal",
            ratio: 0.35,
            first: { id: "main", tabs: [tab("story-motion:a")], focus: "story-motion:a" },
            second: { id: "group-1", tabs: [tab("story-motion:b")], focus: "story-motion:b" },
        };

        const parsed = parseWorkspaceEditorSession(JSON.parse(JSON.stringify(serializeEditorSession(layout, "group-1"))));

        expect(parsed).not.toBeNull();
        expect(parsed!.activeGroupId).toBe("group-1");
        expect(parsed!.layout).toMatchObject({
            kind: "split",
            direction: "horizontal",
            ratio: 0.35,
            first: { kind: "group", id: "main", focus: "story-motion:a" },
            second: { kind: "group", id: "group-1", focus: "story-motion:b" },
        });
    });

    it("round-trips blank new-tab pages, keeping each one's identity", () => {
        const layout: EditorLayout = {
            id: "main",
            tabs: [
                { id: "narraleaf-studio:new-tab-t1", title: "New Tab", component: (() => null) as never },
                { id: "narraleaf-studio:new-tab-t2", title: "New Tab", component: (() => null) as never },
            ],
            focus: "narraleaf-studio:new-tab-t2",
        };

        const parsed = parseWorkspaceEditorSession(JSON.parse(JSON.stringify(serializeEditorSession(layout))));

        expect(parsed!.layout).toMatchObject({
            kind: "group",
            focus: "narraleaf-studio:new-tab-t2",
            tabs: [
                { kind: "newTab", token: "t1" },
                { kind: "newTab", token: "t2" },
            ],
        });
    });

    it("upgrades a stored v1 session into a single-group v2", () => {
        const parsed = parseWorkspaceEditorSession({
            version: 1,
            groupId: "main",
            focus: null,
            tabs: [{ kind: "dashboard" }],
        });

        expect(parsed).toEqual({
            version: 2,
            activeGroupId: "main",
            layout: { kind: "group", id: "main", focus: null, tabs: [{ kind: "dashboard" }] },
        });
    });

    it("rejects a malformed split rather than restoring half a tree", () => {
        expect(
            parseWorkspaceEditorSession({
                version: 2,
                activeGroupId: null,
                layout: { kind: "split", id: "s", direction: "sideways", ratio: 0.5, first: {}, second: {} },
            }),
        ).toBeNull();
    });

    it("clamps a stored ratio that would collapse a pane", () => {
        const parsed = parseWorkspaceEditorSession({
            version: 2,
            activeGroupId: null,
            layout: {
                kind: "split",
                id: "s",
                direction: "horizontal",
                ratio: 0.0001,
                first: { kind: "group", id: "a", focus: null, tabs: [{ kind: "dashboard" }] },
                second: { kind: "group", id: "b", focus: null, tabs: [{ kind: "welcome" }] },
            },
        });

        expect(parsed!.layout).toMatchObject({ ratio: EDITOR_SPLIT_RATIO_EPSILON });
    });
});
