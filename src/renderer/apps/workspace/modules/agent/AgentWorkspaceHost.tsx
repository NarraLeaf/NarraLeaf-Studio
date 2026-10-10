import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { AgentBridgeService } from "@/lib/workspace/services/agent/AgentBridgeService";
import type { AgentFollowService, AgentWriteTarget } from "@/lib/workspace/services/agent/AgentFollowService";
import type { AgentOffscreenRenderer, OffscreenRenderJob } from "@/lib/workspace/services/agent/agentOffscreenRenderer";
import { useWorkspace } from "../../context";
import { createComponentEditorTab, createSurfaceEditorTab } from "../ui-editor/UISurfacesPanel";
import { createStorySceneEditorTab } from "../story/scene-editor/openStorySceneEditorTab";
import { getStorySceneEditorTabId } from "../story/scene-editor/storySceneEditorTabId";
import type { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import { parseBlueprintOwnerKey } from "@/lib/workspace/services/search/blueprintOwnerKey";
import { createBlueprintEntryEditorTab, showBlueprintEntryEditorTab } from "../blueprint-lite/openBlueprintEditorTab";
import { blueprintOwnerOpenTarget } from "../search/blueprintJumpTarget";

/**
 * The parts of an agent's session that have to live in the workspace's React tree.
 *
 * - The offscreen host `ui_screenshot` renders pages into, so they get the brand palette, the
 *   plugins' renderers and the asset resolution the editor's own canvas gets.
 * - Follow mode: when an agent writes, the editor tab it wrote to is opened or brought forward, and
 *   what changed is outlined for a moment. Inside Studio only - nothing here focuses a window - and
 *   a tab the author is typing in is not taken away from them: the agent's tab then opens behind it.
 *
 * Mounted once, in the workspace layout. Comments in English per project convention.
 */
export function AgentWorkspaceHost() {
    const { context } = useWorkspace();
    if (!context) {
        return null;
    }
    let bridge: AgentBridgeService;
    let follow: AgentFollowService;
    try {
        bridge = context.services.get<AgentBridgeService>(Services.AgentBridge);
        follow = context.services.get<AgentFollowService>(Services.AgentFollow);
    } catch {
        return null;
    }
    return (
        <>
            <AgentOffscreenHost renderer={bridge.getOffscreenRenderer()} />
            <AgentFollowHost context={context} follow={follow} />
        </>
    );
}

/**
 * Far outside the viewport, laid out and painted like any DOM, never visible and never hit by the
 * pointer. Each box is exactly the page's design size, so the page draws at 1:1.
 */
function AgentOffscreenHost({ renderer }: { renderer: AgentOffscreenRenderer }) {
    const jobs = useSyncExternalStore(renderer.subscribe, renderer.getJobs);
    useEffect(() => renderer.attachHost(), [renderer]);
    if (jobs.length === 0) {
        return null;
    }
    return createPortal(
        <div data-agent-offscreen="" aria-hidden className="pointer-events-none fixed" style={{ left: -100000, top: 0 }}>
            {jobs.map(job => <OffscreenBox key={job.id} job={job} />)}
        </div>,
        document.body,
    );
}

function OffscreenBox({ job }: { job: OffscreenRenderJob }) {
    const ref = useCallback((node: HTMLDivElement | null) => {
        if (node) {
            job.mounted(node);
        }
    }, [job]);
    return (
        <div ref={ref} style={{ position: "relative", width: job.width, height: job.height, overflow: "hidden", contain: "strict" }}>
            {job.element}
        </div>
    );
}

/** How long a change stays outlined. */
const HIGHLIGHT_MS = 1500;
/** How long after opening a tab its content is looked for: one commit and a layout, with room to spare. */
const HIGHLIGHT_DELAY_MS = 350;

type Highlight = { id: number; rects: { left: number; top: number; width: number; height: number }[] };

/** Whether the author is typing somewhere in Studio right now. */
function authorIsTyping(): boolean {
    const active = document.activeElement as HTMLElement | null;
    if (!active) {
        return false;
    }
    return active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT";
}

/** Open the tab a write landed in, or bring it forward. Returns false when there is nothing to show. */
function revealWrite(context: WorkspaceContext, target: AgentWriteTarget): boolean {
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
    }
}

/** Where on screen the things a write changed are drawn: the biggest visible drawing of each. */
function measureChanged(target: AgentWriteTarget): Highlight["rects"] {
    const ids = target.kind === "surface" || target.kind === "component"
        ? target.elementIds ?? []
        : target.kind === "scene" ? target.blockIds ?? [] : [];
    const attribute = target.kind === "scene" ? "data-story-row-block-id" : "data-ui-element-id";
    const rects: Highlight["rects"] = [];
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

function AgentFollowHost({ context, follow }: { context: WorkspaceContext; follow: AgentFollowService }) {
    const [highlights, setHighlights] = useState<Highlight[]>([]);

    useEffect(() => {
        let nextId = 1;
        const timers = new Set<number>();
        const later = (ms: number, run: () => void) => {
            const timer = window.setTimeout(() => {
                timers.delete(timer);
                run();
            }, ms);
            timers.add(timer);
        };
        const unsubscribe = follow.onWrote(target => {
            if (!follow.getState().follow || !revealWrite(context, target)) {
                return;
            }
            later(HIGHLIGHT_DELAY_MS, () => {
                const rects = measureChanged(target);
                if (rects.length === 0) {
                    return;
                }
                const id = nextId++;
                setHighlights(current => [...current, { id, rects }]);
                later(HIGHLIGHT_MS, () => setHighlights(current => current.filter(item => item.id !== id)));
            });
        });
        return () => {
            unsubscribe();
            timers.forEach(timer => window.clearTimeout(timer));
            timers.clear();
            setHighlights([]);
        };
    }, [context, follow]);

    if (highlights.length === 0) {
        return null;
    }
    return createPortal(
        <div aria-hidden className="pointer-events-none fixed inset-0 z-50">
            {highlights.flatMap(highlight => highlight.rects.map((rect, index) => (
                <div
                    key={`${highlight.id}-${index}`}
                    className="absolute rounded-md ring-2 ring-primary"
                    style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
                />
            )))}
        </div>,
        document.body,
    );
}
