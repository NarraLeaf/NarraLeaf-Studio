import { describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import {
    getWorkspaceEditorSessionSettingsKey,
    restoreWorkspaceEditorSession,
    type WorkspaceEditorSessionV1,
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

function createRestoreHarness(options: { blueprints?: Record<string, unknown>; storyExists?: boolean } = {}) {
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
    };
    const uiService = {
        getStore: () => store,
        focus: { setFocus: vi.fn() },
    };
    return { context, store, uiService };
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
        const session: WorkspaceEditorSessionV1 = {
            version: 1,
            groupId: "main",
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
        };

        expect(restoreWorkspaceEditorSession(context, session, uiService as any)).toBe(0);
        expect(store.openEditorTabInGroup).not.toHaveBeenCalled();
    });

    it("restores only tabs that can be resolved in the current project", () => {
        const { context, store, uiService } = createRestoreHarness({
            blueprints: { "blueprint-1": { id: "blueprint-1" } },
        });
        const session: WorkspaceEditorSessionV1 = {
            version: 1,
            groupId: "main",
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
            ],
        };

        expect(restoreWorkspaceEditorSession(context, session, uiService as any)).toBe(1);
        expect(store.openEditorTabInGroup).toHaveBeenCalledTimes(1);
        expect(store.openEditorTabInGroup.mock.calls[0][0]).toMatchObject({
            id: "blueprint-entry:blueprint-1:surface-1:~:~",
            title: "Surface Logic",
        });
        expect(store.setActiveEditorTabInGroup).toHaveBeenCalledWith(
            "blueprint-entry:blueprint-1:surface-1:~:~",
            "main",
        );
    });
});
