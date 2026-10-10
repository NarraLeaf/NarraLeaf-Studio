import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { AgentBridgeService } from "@/lib/workspace/services/agent/AgentBridgeService";
import type { AgentFollowService, AgentWriteTarget } from "@/lib/workspace/services/agent/AgentFollowService";
import type { AgentOffscreenRenderer, OffscreenRenderJob } from "@/lib/workspace/services/agent/agentOffscreenRenderer";
import { useWorkspace } from "../../context";
import { measureAgentWrite, revealAgentWrite, type AgentHighlightRect } from "./revealAgentWrite";

/**
 * The parts of an agent's session that have to live in the workspace's React tree.
 *
 * - The offscreen host `ui_screenshot` renders pages into, so they get the brand palette, the
 *   plugins' renderers and the asset resolution the editor's own canvas gets.
 * - Follow mode, a Studio-wide setting that is on by default: when an agent writes, the editor tab it
 *   wrote to is opened or brought forward, and what changed is outlined for a moment - every write,
 *   so the author sees what the agent does without reading its transcript. The two things it leaves
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

/** How long a change stays outlined. */
const HIGHLIGHT_MS = 1500;
/** How long after opening a tab its content is looked for: one commit and a layout, with room to spare. */
const HIGHLIGHT_DELAY_MS = 350;

type Highlight = { id: number; rects: AgentHighlightRect[] };

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
        const highlight = (target: AgentWriteTarget) => {
            later(HIGHLIGHT_DELAY_MS, () => {
                const rects = measureAgentWrite(target);
                if (rects.length === 0) {
                    return;
                }
                const id = nextId++;
                setHighlights(current => [...current, { id, rects }]);
                later(HIGHLIGHT_MS, () => setHighlights(current => current.filter(item => item.id !== id)));
            });
        };
        const unsubscribe = follow.onWrote(target => {
            if (!follow.getState().follow || !revealAgentWrite(context, target)) {
                return;
            }
            highlight(target);
        });
        // Asked for by the Agent log, which has already opened the tab; drawn whether or not follow is on.
        const unsubscribeRequests = follow.onHighlightRequested(highlight);
        return () => {
            unsubscribe();
            unsubscribeRequests();
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
