import { DEFAULT_APP_SURFACE_NAME, DEFAULT_UI_DOCUMENT_NAME, DEFAULT_UI_ROOT_NAME } from "../constants/ui-editor";
import type { UIDocument, UIElement, UISurface, UISurfaceDesignSize } from "../types/ui-editor/document";
import { UI_DOCUMENT_SCHEMA_VERSION } from "../types/ui-editor/document";

/**
 * The files every new project starts with, before a template lands on top of them.
 *
 * Two writers create projects: the project wizard, which writes through the renderer's file
 * service, and the agent endpoint's `project_create`, which runs in the main process because the
 * agent is not a window. Both write exactly this list, so a project an agent made is the project
 * the wizard would have made - and a directory added here reaches both.
 *
 * Paths are segment lists relative to the project root, the shape `ProjectNameConvention` uses.
 * They are spelled out rather than imported because that table lives under `renderer/lib`, where
 * neither shared code nor the main process may reach;
 * `src/renderer/apps/project-wizard/services/newProjectLayout.test.ts` holds the two to the same
 * answer, so they cannot drift apart without a red test.
 *
 * The project config (`.nlproj`) is not in the list: it is named after the project and encoded as
 * MessagePack, so each writer builds it with `encodeProjectConfig` itself.
 *
 * Comments in English per project convention.
 */

/** Directories, parents before children. */
export const NEW_PROJECT_DIRECTORIES: readonly (readonly string[])[] = [
    [".nlstudio"],
    ["assets"],
    ["assets", "content"],
    ["scripts"],
    ["editor"],
    ["editor", "assets"],
    ["editor", "services"],
    ["editor", "ui"],
    ["editor", "story"],
    ["editor", "story", "stories"],
];

/** Every asset type a project keeps a metadata shard for. */
export const NEW_PROJECT_ASSET_TYPES = ["image", "audio", "video", "json", "font", "model", "other"] as const;

/** Every section of the asset browser, which keeps its folders and row order in a shard of its own. */
export const NEW_PROJECT_ASSET_CATEGORIES = ["image", "media", "data", "font", "model", "other"] as const;

/** What a fresh row-order shard holds. */
export const NEW_PROJECT_EMPTY_ASSET_ORDER = JSON.stringify({ assetIds: [], groupIds: [] });

export type NewProjectFile = { path: readonly string[]; text: string };

/**
 * The text files of an empty project, in the order they are written.
 *
 * `createId` makes the interface document's ids; injected because the two writers run in different
 * realms and a test wants them fixed.
 */
export function newProjectFiles(designSize: UISurfaceDesignSize, createId: () => string): NewProjectFile[] {
    const files: NewProjectFile[] = [
        { path: [".nlstudio", "editor.json"], text: JSON.stringify({}) },
        // So the app surface has a page to open on.
        { path: ["editor", "ui", "uidoc.json"], text: JSON.stringify(createDefaultUIDocument(designSize, createId), null, 2) },
    ];
    for (const type of NEW_PROJECT_ASSET_TYPES) {
        files.push({ path: ["assets", `assets.metadata.${type}.json`], text: JSON.stringify({}) });
    }
    for (const category of NEW_PROJECT_ASSET_CATEGORIES) {
        files.push({ path: ["assets", `assets.groups.${category}.json`], text: JSON.stringify({}) });
        // Created here as well as on open, so a new project's first commit already has the file
        // rather than growing one in the second.
        files.push({ path: ["assets", `assets.order.${category}.json`], text: NEW_PROJECT_EMPTY_ASSET_ORDER });
    }
    return files;
}

/** One app surface holding one root element at the design size, which is a project's empty interface. */
export function createDefaultUIDocument(designSize: UISurfaceDesignSize, createId: () => string): UIDocument {
    const now = new Date().toISOString();
    const documentId = createId();
    const surfaceId = createId();
    const rootElementId = createId();

    const rootElement: UIElement = {
        id: rootElementId,
        type: "nl.root",
        name: DEFAULT_UI_ROOT_NAME,
        parentId: null,
        childrenIds: [],
        layout: {
            x: 0,
            y: 0,
            width: designSize.width,
            height: designSize.height,
            visible: true,
            opacity: 1,
        },
    };

    const surface: UISurface = {
        id: surfaceId,
        name: DEFAULT_APP_SURFACE_NAME,
        host: "app",
        kind: "appSurface",
        designSize,
        rootElementId,
    };

    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: documentId,
        name: DEFAULT_UI_DOCUMENT_NAME,
        surfaces: [surface],
        components: [],
        elements: {
            [rootElementId]: rootElement,
        },
        meta: {
            createdAt: now,
            updatedAt: now,
        },
    };
}
