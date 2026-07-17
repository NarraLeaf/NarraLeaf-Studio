import { FileText, Image, Music, PanelsTopLeft, User } from "lucide-react";
import { createElement, type ReactNode } from "react";
import type { EditorGroup, EditorLayout, EditorTabDefinition } from "@/apps/workspace/registry/types";
import { welcomeModule } from "@/apps/workspace/modules/welcome";
import { BlueprintEntryTab } from "@/apps/workspace/modules/blueprint-lite/editors/BlueprintEntryTab";
import {
    getBlueprintEntryTabId,
    type BlueprintEntryTabPayload,
} from "@/apps/workspace/modules/blueprint-lite/blueprintEntryTabId";
import { UISurfaceEditorTab } from "@/apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab";
import { CharacterEditor } from "@/apps/workspace/modules/characters/editors/CharacterEditor";
import { ImagePreviewEditor } from "@/apps/workspace/modules/assets/editors/ImagePreviewEditor";
import { AudioPreviewEditor } from "@/apps/workspace/modules/assets/editors/AudioPreviewEditor";
import { StorySceneEditorTab } from "@/apps/workspace/modules/story/scene-editor/StorySceneEditorTab";
import {
    getStorySceneEditorTabId,
    type StorySceneEditorTabPayload,
} from "@/apps/workspace/modules/story/scene-editor/storySceneEditorTabId";
import { createStoryMotionEditorTab } from "@/apps/workspace/modules/story-motion/StoryMotionEditorTab";
import type { StoryMotionEditorPayload } from "@/apps/workspace/modules/story-motion/storyMotionTypes";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { stableProjectKeyToken } from "@shared/utils/stableKeyHash";
import { createDashboardTab } from "@/apps/workspace/modules/dashboard/openDashboardTab";
import { DASHBOARD_TAB_ID } from "@/apps/workspace/modules/dashboard/dashboardTabId";

/** Legacy global settings key; stored in Electron userData/state/global.json. */
export const WORKSPACE_EDITOR_SESSION_SETTINGS_KEY = "ui.editor.session";
const WORKSPACE_EDITOR_SESSION_SETTINGS_KEY_PREFIX = `${WORKSPACE_EDITOR_SESSION_SETTINGS_KEY}.project`;

const WELCOME_TAB_ID = "narraleaf-studio:welcome";
const SURFACE_TAB_PREFIX = "ui-editor:surface:";
const CHARACTER_TAB_PREFIX = "narraleaf-studio:character-editor-";
const IMAGE_PREVIEW_PREFIX = "narraleaf-studio:assets:image-preview-";
const AUDIO_PREVIEW_PREFIX = "narraleaf-studio:assets:audio-preview-";
const STORY_SCENE_TAB_PREFIX = "story:scene:";
const STORY_MOTION_TAB_PREFIX = "story-motion:";
const BLUEPRINT_ENTRY_OWNER_KINDS = new Set([
    "globalMain",
    "surfaceMain",
    "widgetMain",
    "widgetValue",
    "componentWidgetMain",
]);

export type SerializedTab =
    | { kind: "welcome" }
    | { kind: "dashboard" }
    | { kind: "surface"; surfaceId: string }
    | { kind: "blueprint"; title: string; payload: BlueprintEntryTabPayload }
    | { kind: "character"; characterId: string }
    | { kind: "assetImage"; assetId: string; title: string }
    | { kind: "assetAudio"; assetId: string; title: string }
    | { kind: "storyScene"; title: string; payload: StorySceneEditorTabPayload }
    | { kind: "storyMotion"; title: string; payload: StoryMotionEditorPayload };

export type WorkspaceEditorSessionV1 = {
    version: 1;
    groupId: string;
    focus: string | null;
    tabs: SerializedTab[];
};

export type WorkspaceEditorSessionProjectRef = {
    projectPath: string;
    projectIdentifier?: string | null;
};

export function getWorkspaceEditorSessionSettingsKey(projectRef: WorkspaceEditorSessionProjectRef): string {
    return `${WORKSPACE_EDITOR_SESSION_SETTINGS_KEY_PREFIX}.${stableProjectKeyToken(projectRef)}`;
}

function isBlueprintEntryPayload(value: unknown): value is BlueprintEntryTabPayload {
    if (!value || typeof value !== "object") {
        return false;
    }
    const o = value as Record<string, unknown>;
    if (typeof o.blueprintId !== "string" || typeof o.surfaceId !== "string") {
        return false;
    }
    if (typeof o.ownerKind !== "string" || !BLUEPRINT_ENTRY_OWNER_KINDS.has(o.ownerKind)) {
        return false;
    }
    if (o.componentId !== undefined && typeof o.componentId !== "string") {
        return false;
    }
    if (o.elementId !== undefined && typeof o.elementId !== "string") {
        return false;
    }
    if (o.propPath !== undefined && typeof o.propPath !== "string") {
        return false;
    }
    if (o.focusEventId !== undefined && typeof o.focusEventId !== "string") {
        return false;
    }
    if (o.focusFunctionId !== undefined && typeof o.focusFunctionId !== "string") {
        return false;
    }
    if (o.focusFieldId !== undefined && typeof o.focusFieldId !== "string") {
        return false;
    }
    if (o.focusNodeId !== undefined && typeof o.focusNodeId !== "string") {
        return false;
    }
    return true;
}

function isStorySceneEditorPayload(value: unknown): value is StorySceneEditorTabPayload {
    if (!value || typeof value !== "object") {
        return false;
    }
    const o = value as Record<string, unknown>;
    return typeof o.storyId === "string" && o.storyId.length > 0 && typeof o.sceneId === "string" && o.sceneId.length > 0;
}

function isStoryMotionEditorPayload(value: unknown): value is StoryMotionEditorPayload {
    if (!value || typeof value !== "object") {
        return false;
    }
    const o = value as Record<string, unknown>;
    if (typeof o.animationId !== "string" || o.animationId.length === 0) {
        return false;
    }
    if (o.actionContext === undefined) {
        return true;
    }
    if (!o.actionContext || typeof o.actionContext !== "object") {
        return false;
    }
    const actionContext = o.actionContext as Record<string, unknown>;
    if (
        typeof actionContext.storyId !== "string" ||
        actionContext.storyId.length === 0 ||
        typeof actionContext.sceneId !== "string" ||
        actionContext.sceneId.length === 0 ||
        typeof actionContext.blockId !== "string" ||
        actionContext.blockId.length === 0
    ) {
        return false;
    }
    if (actionContext.storyName !== undefined && typeof actionContext.storyName !== "string") {
        return false;
    }
    if (actionContext.sceneName !== undefined && typeof actionContext.sceneName !== "string") {
        return false;
    }
    return true;
}

/**
 * If a tab has no supported serialization strategy, returns null (tab is dropped from session).
 */
export function trySerializeTab(tab: EditorTabDefinition): SerializedTab | null {
    if (tab.id === WELCOME_TAB_ID) {
        return { kind: "welcome" };
    }
    if (tab.id === DASHBOARD_TAB_ID) {
        return { kind: "dashboard" };
    }
    if (tab.id.startsWith(SURFACE_TAB_PREFIX)) {
        const surfaceId = tab.id.slice(SURFACE_TAB_PREFIX.length);
        if (!surfaceId) {
            return null;
        }
        return { kind: "surface", surfaceId };
    }
    if (isBlueprintEntryPayload(tab.payload)) {
        return { kind: "blueprint", title: tab.title, payload: tab.payload };
    }
    if (tab.id.startsWith(CHARACTER_TAB_PREFIX)) {
        const characterId = tab.id.slice(CHARACTER_TAB_PREFIX.length);
        if (!characterId) {
            return null;
        }
        return { kind: "character", characterId };
    }
    if (tab.id.startsWith(IMAGE_PREVIEW_PREFIX)) {
        const assetId = tab.id.slice(IMAGE_PREVIEW_PREFIX.length);
        if (!assetId) {
            return null;
        }
        return { kind: "assetImage", assetId, title: tab.title };
    }
    if (tab.id.startsWith(AUDIO_PREVIEW_PREFIX)) {
        const assetId = tab.id.slice(AUDIO_PREVIEW_PREFIX.length);
        if (!assetId) {
            return null;
        }
        return { kind: "assetAudio", assetId, title: tab.title };
    }
    if (tab.id.startsWith(STORY_SCENE_TAB_PREFIX) && isStorySceneEditorPayload(tab.payload)) {
        return { kind: "storyScene", title: tab.title, payload: tab.payload };
    }
    if (tab.id.startsWith(STORY_MOTION_TAB_PREFIX) && isStoryMotionEditorPayload(tab.payload)) {
        return { kind: "storyMotion", title: tab.title, payload: tab.payload };
    }
    return null;
}

/**
 * Build a persistable session from the current editor layout.
 * Returns null if the root layout is not a single editor group (e.g. split root — not supported for v1).
 */
export function serializeEditorSession(layout: EditorLayout): WorkspaceEditorSessionV1 | null {
    if (!("tabs" in layout)) {
        return null;
    }
    const group = layout as EditorGroup;
    const tabs: SerializedTab[] = [];
    const keptTabIds: string[] = [];
    for (const tab of group.tabs) {
        const s = trySerializeTab(tab);
        if (s) {
            tabs.push(s);
            keptTabIds.push(tab.id);
        }
    }
    let focus = group.focus;
    if (focus !== null && !keptTabIds.includes(focus)) {
        focus = keptTabIds.length > 0 ? keptTabIds[keptTabIds.length - 1] : null;
    }
    return {
        version: 1,
        groupId: group.id,
        focus,
        tabs,
    };
}

function isSerializedTab(value: unknown): value is SerializedTab {
    if (!value || typeof value !== "object") {
        return false;
    }
    const o = value as Record<string, unknown>;
    const kind = o.kind;
    if (kind === "welcome" || kind === "dashboard") {
        return true;
    }
    if (kind === "surface" && typeof o.surfaceId === "string" && o.surfaceId.length > 0) {
        return true;
    }
    if (kind === "blueprint" && typeof o.title === "string" && isBlueprintEntryPayload(o.payload)) {
        return true;
    }
    if (kind === "character" && typeof o.characterId === "string" && o.characterId.length > 0) {
        return true;
    }
    if (
        kind === "assetImage" &&
        typeof o.assetId === "string" &&
        o.assetId.length > 0 &&
        typeof o.title === "string"
    ) {
        return true;
    }
    if (
        kind === "assetAudio" &&
        typeof o.assetId === "string" &&
        o.assetId.length > 0 &&
        typeof o.title === "string"
    ) {
        return true;
    }
    if (kind === "storyScene" && typeof o.title === "string" && isStorySceneEditorPayload(o.payload)) {
        return true;
    }
    if (kind === "storyMotion" && typeof o.title === "string" && isStoryMotionEditorPayload(o.payload)) {
        return true;
    }
    return false;
}

/**
 * Parse and validate stored JSON. Returns null if invalid or unsupported version.
 */
export function parseWorkspaceEditorSession(raw: unknown): WorkspaceEditorSessionV1 | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const o = raw as Record<string, unknown>;
    if (o.version !== 1) {
        return null;
    }
    if (typeof o.groupId !== "string" || !o.groupId) {
        return null;
    }
    if (o.focus !== null && typeof o.focus !== "string") {
        return null;
    }
    if (!Array.isArray(o.tabs)) {
        return null;
    }
    const tabs: SerializedTab[] = [];
    for (const item of o.tabs) {
        if (isSerializedTab(item)) {
            tabs.push(item);
        }
    }
    return {
        version: 1,
        groupId: o.groupId,
        focus: o.focus === null ? null : o.focus,
        tabs,
    };
}

function surfaceIcon(): ReactNode {
    return createElement(PanelsTopLeft, { className: "w-4 h-4" });
}

function userIcon(): ReactNode {
    return createElement(User, { className: "w-4 h-4" });
}

function imageIcon(): ReactNode {
    return createElement(Image, { className: "w-4 h-4" });
}

function audioIcon(): ReactNode {
    return createElement(Music, { className: "w-4 h-4" });
}

function storyIcon(): ReactNode {
    return createElement(FileText, { className: "w-4 h-4" });
}

/**
 * Rebuild a live tab definition from its serialized form. Null when the tab's
 * resource no longer exists (deleted scene/asset/…) — callers drop the entry.
 * Exported for the closed-tab reopen path, which shares this rebuild logic.
 */
export function buildTabDefinition(ctx: WorkspaceContext, entry: SerializedTab): EditorTabDefinition | null {
    if (entry.kind === "welcome") {
        return {
            id: welcomeModule.metadata.id,
            title: welcomeModule.metadata.title,
            icon: welcomeModule.metadata.icon,
            component: welcomeModule.component as EditorTabDefinition["component"],
            closable: welcomeModule.metadata.closable,
        };
    }
    if (entry.kind === "dashboard") {
        return createDashboardTab();
    }
    if (entry.kind === "surface") {
        const documentService = ctx.services.get<UIDocumentService>(Services.UIDocument);
        const doc = documentService.getDocument();
        const surface = doc.surfaces.find(s => s.id === entry.surfaceId);
        if (!surface) {
            return null;
        }
        const tabId = `${SURFACE_TAB_PREFIX}${entry.surfaceId}`;
        return {
            id: tabId,
            title: surface.name,
            icon: surfaceIcon(),
            component: UISurfaceEditorTab,
            payload: { surfaceId: entry.surfaceId },
            closable: true,
        };
    }
    if (entry.kind === "blueprint") {
        const p = entry.payload;
        const documentService = ctx.services.get<UIDocumentService>(Services.UIDocument);
        const localBlueprintService = ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const document = documentService.getDocument();
        const blueprintDocument = localBlueprintService.getBlueprintDocument();
        if (!blueprintDocument.blueprints[p.blueprintId]) {
            return null;
        }
        if (!document.surfaces.some(surface => surface.id === p.surfaceId)) {
            return null;
        }
        if (p.ownerKind === "componentWidgetMain") {
            const component = p.componentId
                ? document.components?.find(item => item.id === p.componentId)
                : undefined;
            if (!component || !p.elementId || !component.elements[p.elementId]) {
                return null;
            }
        } else if (p.ownerKind === "widgetMain" || p.ownerKind === "widgetValue") {
            if (!p.elementId || !document.elements[p.elementId]) {
                return null;
            }
            if (p.ownerKind === "widgetValue" && !p.propPath) {
                return null;
            }
        }
        const tabId = getBlueprintEntryTabId({
            blueprintId: p.blueprintId,
            surfaceId: p.surfaceId,
            elementId: p.elementId,
            propPath: p.propPath,
        });
        return {
            id: tabId,
            title: entry.title,
            component: BlueprintEntryTab,
            payload: p,
            closable: true,
        };
    }
    if (entry.kind === "character") {
        const characterService = ctx.services.get<CharacterService>(Services.Character);
        const character = characterService.getCharacter(entry.characterId);
        if (!character) {
            return null;
        }
        const profile = character.profile.getProfile();
        return {
            id: `${CHARACTER_TAB_PREFIX}${entry.characterId}`,
            title: profile.name,
            icon: userIcon(),
            component: CharacterEditor,
            closable: true,
            payload: { character },
        };
    }
    if (entry.kind === "assetImage") {
        const assetsService = ctx.services.get<AssetsService>(Services.Assets);
        const asset = assetsService.getAssets()[AssetType.Image][entry.assetId] as Asset<AssetType.Image> | undefined;
        if (!asset) {
            return null;
        }
        return {
            id: `${IMAGE_PREVIEW_PREFIX}${entry.assetId}`,
            title: entry.title,
            icon: imageIcon(),
            component: ImagePreviewEditor,
            closable: true,
            payload: { asset },
        };
    }
    if (entry.kind === "assetAudio") {
        const assetsService = ctx.services.get<AssetsService>(Services.Assets);
        const asset = assetsService.getAssets()[AssetType.Audio][entry.assetId] as Asset<AssetType.Audio> | undefined;
        if (!asset) {
            return null;
        }
        return {
            id: `${AUDIO_PREVIEW_PREFIX}${entry.assetId}`,
            title: entry.title,
            icon: audioIcon(),
            component: AudioPreviewEditor,
            closable: true,
            payload: { asset },
        };
    }
    if (entry.kind === "storyScene") {
        const storyService = ctx.services.get<StoryService>(Services.Story);
        if (!storyService.getStoryEntry(entry.payload.storyId)) {
            return null;
        }
        return {
            id: getStorySceneEditorTabId(entry.payload.storyId, entry.payload.sceneId),
            title: entry.title,
            icon: storyIcon(),
            component: StorySceneEditorTab,
            closable: true,
            payload: entry.payload,
        };
    }
    if (entry.kind === "storyMotion") {
        const storyService = ctx.services.get<StoryService>(Services.Story);
        if (!storyService.listAnimationAssets().some(animation => animation.id === entry.payload.animationId)) {
            return null;
        }
        return {
            ...createStoryMotionEditorTab(entry.payload),
            title: entry.title,
        };
    }
    return null;
}

/**
 * Restore editor tabs from a validated session. Skips tabs that cannot be deserialized (missing resources).
 */
export function restoreWorkspaceEditorSession(
    ctx: WorkspaceContext,
    session: WorkspaceEditorSessionV1,
    uiService: UIService,
): number {
    const store = uiService.getStore();
    const groupId = session.groupId;
    const openedIds: string[] = [];

    for (const entry of session.tabs) {
        const def = buildTabDefinition(ctx, entry);
        if (!def) {
            continue;
        }
        store.openEditorTabInGroup(def, groupId, false);
        openedIds.push(def.id);
    }

    const focus = session.focus;
    const resolvedFocus =
        focus && openedIds.includes(focus) ? focus : openedIds.length > 0 ? openedIds[openedIds.length - 1] : null;

    if (resolvedFocus) {
        store.setActiveEditorTabInGroup(resolvedFocus, groupId);
        uiService.focus.setFocus(FocusArea.Editor, resolvedFocus);
    }
    return openedIds.length;
}
