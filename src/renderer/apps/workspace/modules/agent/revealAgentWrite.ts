import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import type { AgentWriteTarget } from "@/lib/workspace/services/agent/AgentFollowService";
import { parseBlueprintOwnerKey } from "@/lib/workspace/services/search/blueprintOwnerKey";
import { createComponentEditorTab, createSurfaceEditorTab } from "../ui-editor/UISurfacesPanel";
import { createStorySceneEditorTab } from "../story/scene-editor/openStorySceneEditorTab";
import { getStorySceneEditorTabId } from "../story/scene-editor/storySceneEditorTabId";
import { createBlueprintEntryEditorTab, showBlueprintEntryEditorTab } from "../blueprint-lite/openBlueprintEditorTab";
import { blueprintOwnerOpenTarget } from "../search/blueprintJumpTarget";
import type { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import type { VoiceService } from "@/lib/workspace/services/voice/VoiceService";
import { createLocalizationEditorTab } from "../localization/openLocalizationEditorTab";
import { getLocalizationEditorTabId, nextTableRevealToken } from "../localization/localizationEditorTabId";
import { createVoiceEditorTab } from "../voice/openVoiceEditorTab";
import { getVoiceEditorTabId } from "../voice/voiceEditorTabId";

/**
 * Taking the author to what an agent changed: the editor tab a write landed in, and where on screen
 * the changed elements or rows are drawn.
 *
 * Two callers, one behaviour. Follow mode (`AgentWorkspaceHost`) runs it as each write lands; the
 * Agent log panel runs it when the author clicks a past write. Inside Studio only - nothing here
 * focuses a window.
 *
 * Comments in English per project convention.
 */

/** A rectangle in viewport coordinates. */
export type AgentHighlightRect = { left: number; top: number; width: number; height: number };

/** Whether the author is typing somewhere in Studio right now. */
function authorIsTyping(): boolean {
    const active = document.activeElement as HTMLElement | null;
    if (!active) {
        return false;
    }
    return active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT";
}

/**
 * Open the tab a write landed in, or bring it forward. Returns false when there is nothing to show
 * (the page, scene or blueprint is gone).
 *
 * A tab the author is typing in is not taken away from them: the agent's tab then opens behind it.
 */
export function revealAgentWrite(context: WorkspaceContext, target: AgentWriteTarget): boolean {
    const editor = context.services.get<UIService>(Services.UI).editor;
    const activate = !authorIsTyping();
    const show = (tabId: string, open: () => void) => {
        if (editor.isOpen(tabId)) {
            // Not re-opened: re-opening replaces the tab's payload, which is where it keeps its view.
            if (activate) {
                editor.setActive(tabId);
            }
        } else {
            open();
        }
    };
    switch (target.kind) {
        case "surface": {
            const surface = context.services.get<UIDocumentService>(Services.UIDocument).getDocument().surfaces.find(item => item.id === target.surfaceId);
            if (!surface) {
                return false;
            }
            const tab = createSurfaceEditorTab(surface);
            show(tab.id, () => editor.open(tab, undefined, { activate }));
            return true;
        }
        case "component": {
            const component = (context.services.get<UIDocumentService>(Services.UIDocument).getDocument().components ?? [])
                .find(item => item.id === target.componentId);
            if (!component) {
                return false;
            }
            const tab = createComponentEditorTab(component);
            show(tab.id, () => editor.open(tab, undefined, { activate }));
            return true;
        }
        case "scene": {
            const tabId = getStorySceneEditorTabId(target.storyId, target.sceneId);
            show(tabId, () => editor.open(createStorySceneEditorTab({ storyId: target.storyId, sceneId: target.sceneId }, target.name), undefined, { activate }));
            return true;
        }
        case "blueprint": {
            // Opened the way the interface panel and quick open address it, so a blueprint whose
            // editor is already open (or detached into its own window) is brought forward there.
            const document = context.services.get<UIGraphService>(Services.UIGraph).getDocument().blueprintDocument;
            const ownerKey = Object.entries(document.ownerRecords).find(([, record]) => record.blueprintId === target.blueprintId)?.[0];
            const owner = ownerKey && document.blueprints[target.blueprintId] ? parseBlueprintOwnerKey(ownerKey) : null;
            if (!owner) {
                return false;
            }
            const tab = createBlueprintEntryEditorTab(blueprintOwnerOpenTarget(target.blueprintId, owner, context));
            showBlueprintEntryEditorTab(tab, definition => show(definition.id, () => editor.open(definition, undefined, { activate })));
            return true;
        }
        case "translation":
        case "voice": {
            // A language's table, landed on the first unit the write changed. Unlike a page, the
            // table is re-opened even when it is open: the row is named by the payload's reveal, the
            // same deep link a search hit sends, and the table's own view (source, filter) survives
            // it. Not while the author is typing in it - their caret is worth more than the scroll.
            const entry = target.kind === "translation"
                ? context.services.get<LocalizationService>(Services.Localization).getConfiguration().locales.find(locale => locale.code === target.locale)
                : context.services.get<VoiceService>(Services.Voice).getConfiguration().voicedLocales.find(locale => locale.code === target.locale);
            if (!entry) {
                return false;
            }
            const tabId = target.kind === "translation" ? getLocalizationEditorTabId(target.locale) : getVoiceEditorTabId(target.locale);
            if (!activate && editor.isOpen(tabId)) {
                return true;
            }
            const reveal = { unitId: target.unitId, ...(target.storyId ? { storyId: target.storyId } : {}), token: nextTableRevealToken() };
            const title = entry.displayName || entry.code;
            editor.open(
                target.kind === "translation" ? createLocalizationEditorTab(target.locale, title, reveal) : createVoiceEditorTab(target.locale, title, reveal),
                undefined,
                { activate },
            );
            return true;
        }
    }
}

/** Where on screen the things a write changed are drawn: the biggest visible drawing of each. */
export function measureAgentWrite(target: AgentWriteTarget): AgentHighlightRect[] {
    const ids = target.kind === "surface" || target.kind === "component"
        ? target.elementIds ?? []
        : target.kind === "scene" ? target.blockIds ?? [] : [];
    const attribute = target.kind === "scene" ? "data-story-row-block-id" : "data-ui-element-id";
    const rects: AgentHighlightRect[] = [];
    for (const id of ids.slice(0, 24)) {
        let best: DOMRect | null = null;
        for (const node of Array.from(document.querySelectorAll<HTMLElement>(`[${attribute}="${CSS.escape(id)}"]`))) {
            if (node.closest("[data-agent-offscreen]")) {
                continue;
            }
            const rect = node.getBoundingClientRect();
            const onScreen = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
                && rect.top < window.innerHeight && rect.left < window.innerWidth;
            if (onScreen && (!best || rect.width * rect.height > best.width * best.height)) {
                best = rect;
            }
        }
        if (best) {
            rects.push({ left: best.left, top: best.top, width: best.width, height: best.height });
        }
    }
    return rects;
}
