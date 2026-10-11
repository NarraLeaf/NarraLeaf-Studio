import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { AgentBridgeService } from "@/lib/workspace/services/agent/AgentBridgeService";
import type { AgentFollowService, AgentWriteTarget } from "@/lib/workspace/services/agent/AgentFollowService";
import type { AgentOffscreenRenderer, OffscreenRenderJob } from "@/lib/workspace/services/agent/agentOffscreenRenderer";
import { useWorkspace } from "../../context";
import { measureAgentWrite, revealAgentWrite } from "./revealAgentWrite";
import { AgentOutlineTimeline, type AgentOutline } from "./agentOutlineTimeline";

/**
 * The parts of an agent's session that have to live in the workspace's React tree.
 *
 * - The offscreen host `ui_screenshot` renders pages into, so they get the brand palette, the
 *   plugins' renderers and the asset resolution the editor's own canvas gets.
 * - Follow mode, a Studio-wide setting that is on by default: when an agent writes, the editor tab it
 *   wrote to is opened or brought forward, and what changed is outlined until the next write lands
 *   elsewhere or a few seconds pass (`agentOutlineTimeline`) - every write, so the author sees what
 *   the agent does without reading its transcript. The two things it leaves
 *   alone both protect typing: nothing here focuses a window, so an author typing in another
 *   application keeps the keyboard, and a text field the author is typing in inside Studio keeps
 *   its tab - the agent's tab then opens behind it.
 *   The Agent log panel asks for the same outline when the author clicks a past write
 *   (`AgentFollowService.requestHighlight`); see `revealAgentWrite` for the shared half.
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

/** Keys that only modify another: holding one is not the author typing, nor is Alt+Tab away. */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "OS"]);

function AgentFollowHost({ context, follow }: { context: WorkspaceContext; follow: AgentFollowService }) {
    const [outlines, setOutlines] = useState<readonly AgentOutline[]>([]);

    useEffect(() => {
        const timeline = new AgentOutlineTimeline(setOutlines);
        // Measured every frame while anything is outlined: the tab may still be opening, and the
        // author may scroll or switch tabs while an outline is up.
        let frame = 0;
        const tick = () => {
            frame = 0;
            timeline.measure(measureAgentWrite);
            if (timeline.get().length > 0) {
                frame = window.requestAnimationFrame(tick);
            }
        };
        const outline = (target: AgentWriteTarget) => {
            timeline.add(target);
            if (frame === 0 && timeline.get().length > 0) {
                frame = window.requestAnimationFrame(tick);
            }
        };
        const unsubscribe = follow.onWrote(target => {
            if (!follow.getState().follow || !revealAgentWrite(context, target)) {
                return;
            }
            outline(target);
        });
        // Asked for by the Agent log, which has already opened the tab; drawn whether or not follow is on.
        const unsubscribeRequests = follow.onHighlightRequested(outline);
        // The author's own click or keystroke anywhere in Studio takes the outline away at once.
        // Pointer down, not click: the click on an Agent log row that asks for an outline lands
        // before the outline does.
        const dismiss = (event: Event) => {
            if (event instanceof KeyboardEvent && MODIFIER_KEYS.has(event.key)) {
                return;
            }
            timeline.clear();
        };
        window.addEventListener("pointerdown", dismiss, true);
        window.addEventListener("keydown", dismiss, true);
        return () => {
            unsubscribe();
            unsubscribeRequests();
            window.removeEventListener("pointerdown", dismiss, true);
            window.removeEventListener("keydown", dismiss, true);
            if (frame !== 0) {
                window.cancelAnimationFrame(frame);
            }
            timeline.dispose();
            setOutlines([]);
        };
    }, [context, follow]);

    if (!outlines.some(outline => outline.rects.length > 0)) {
        return null;
    }
    return createPortal(
        <div aria-hidden className="pointer-events-none fixed inset-0 z-50">
            {outlines.flatMap(outline => outline.rects.map((rect, index) => (
                // The fade lasts AGENT_OUTLINE_FADE_MS, which is when the timeline drops it.
                <div
                    key={`${outline.id}-${index}`}
                    className={`absolute rounded-md ring-2 ring-primary transition-opacity duration-200 ${outline.phase === "leaving" ? "opacity-0" : "opacity-100"}`}
                    style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
                />
            )))}
        </div>,
        document.body,
    );
}
