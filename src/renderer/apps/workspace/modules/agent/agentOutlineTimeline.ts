import type { AgentWriteTarget } from "@/lib/workspace/services/agent/AgentFollowService";

/**
 * How long the outline follow mode draws around what an agent changed stays on screen, and what
 * takes it away - kept apart from the host that draws it so the timing can be tested without a DOM.
 *
 * Follow mode exists so the author can see what the agent is doing, often glancing over from
 * something else. So an outline stays until the agent's next write lands somewhere else or
 * {@link AGENT_OUTLINE_VISIBLE_MS} pass, whichever is first, and then fades
 * ({@link AGENT_OUTLINE_FADE_MS}). The author's own click or keystroke takes every outline away at
 * once: they have seen it, or they are busy with something else and it is in the way.
 *
 * An outline is "pending" from the write until what it outlines is first measured on screen - the tab
 * may still be opening - and its time starts only then, so a slow tab does not eat it. One that
 * never shows within {@link AGENT_OUTLINE_PENDING_MS} is dropped.
 *
 * Comments in English per project convention.
 */

/** How long an outline stays once it is on screen, unless the next write lands elsewhere first. */
export const AGENT_OUTLINE_VISIBLE_MS = 4000;
/** The fade at the end; the host's `duration-200` transition lasts the same. */
export const AGENT_OUTLINE_FADE_MS = 200;
/** How long what a write changed is looked for on screen before the outline is given up. */
export const AGENT_OUTLINE_PENDING_MS = 2000;

/** A rectangle in viewport coordinates. */
export type AgentHighlightRect = { left: number; top: number; width: number; height: number };

export type AgentOutlinePhase = "pending" | "shown" | "leaving";

export type AgentOutline = {
    id: number;
    /** Where the write landed; a later write with the same key is the same place. */
    key: string;
    target: AgentWriteTarget;
    rects: readonly AgentHighlightRect[];
    phase: AgentOutlinePhase;
};

/** The elements or rows a write changed, which are what gets outlined. Empty for the other kinds. */
export function agentWriteOutlineIds(target: AgentWriteTarget): readonly string[] {
    if (target.kind === "surface" || target.kind === "component") {
        return target.elementIds ?? [];
    }
    return target.kind === "scene" ? target.blockIds ?? [] : [];
}

/** Where a write landed: the page, scene or table, and the very elements or rows in it. */
export function agentWritePlaceKey(target: AgentWriteTarget): string {
    const where = (() => {
        switch (target.kind) {
            case "surface":
                return target.surfaceId;
            case "component":
                return target.componentId;
            case "scene":
                return `${target.storyId}/${target.sceneId}`;
            case "blueprint":
                return target.blueprintId;
            case "translation":
            case "voice":
                return `${target.locale}/${target.unitId}`;
        }
    })();
    return `${target.kind}:${where}:${[...agentWriteOutlineIds(target)].sort().join(",")}`;
}

function sameRects(a: readonly AgentHighlightRect[], b: readonly AgentHighlightRect[]): boolean {
    return a.length === b.length && a.every((rect, index) => {
        const other = b[index];
        return rect.left === other.left && rect.top === other.top && rect.width === other.width && rect.height === other.height;
    });
}

export class AgentOutlineTimeline {
    private outlines: AgentOutline[] = [];
    private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
    private nextId = 1;

    public constructor(private readonly onChange: (outlines: readonly AgentOutline[]) => void) {}

    public get(): readonly AgentOutline[] {
        return this.outlines;
    }

    /**
     * A write landed (or the Agent log asked for one to be shown again). Every outline somewhere else
     * starts to fade; one already on this very place stays and its time starts over. A write with
     * nothing to outline - a blueprint, a translation - still ends what is outlined elsewhere.
     */
    public add(target: AgentWriteTarget): void {
        const key = agentWritePlaceKey(target);
        const same = this.outlines.find(outline => outline.key === key && outline.phase !== "leaving");
        for (const outline of this.outlines) {
            if (outline !== same && outline.phase !== "leaving") {
                this.leave(outline.id);
            }
        }
        if (same) {
            this.patch(same.id, { target });
            if (same.phase === "shown") {
                this.schedule(same.id, AGENT_OUTLINE_VISIBLE_MS, () => this.leave(same.id));
            }
        } else if (agentWriteOutlineIds(target).length > 0) {
            const id = this.nextId++;
            this.outlines = [...this.outlines, { id, key, target, rects: [], phase: "pending" }];
            this.schedule(id, AGENT_OUTLINE_PENDING_MS, () => this.remove(id));
        }
        this.emit();
    }

    /**
     * Where each outlined thing is drawn now. Called every frame while there are outlines, so an
     * outline follows its row through a scroll or a re-layout, and is not drawn while its tab is
     * behind another. A pending outline that is found starts its time.
     */
    public measure(measureTarget: (target: AgentWriteTarget) => AgentHighlightRect[]): void {
        let changed = false;
        this.outlines = this.outlines.map(outline => {
            const rects = measureTarget(outline.target);
            let next = outline;
            if (!sameRects(rects, outline.rects)) {
                next = { ...next, rects };
                changed = true;
            }
            if (next.phase === "pending" && rects.length > 0) {
                next = { ...next, phase: "shown" };
                changed = true;
                const id = next.id;
                this.schedule(id, AGENT_OUTLINE_VISIBLE_MS, () => this.leave(id));
            }
            return next;
        });
        if (changed) {
            this.emit();
        }
    }

    /** The author clicked or typed: every outline goes at once, without a fade. */
    public clear(): void {
        if (this.outlines.length === 0) {
            return;
        }
        this.clearTimers();
        this.outlines = [];
        this.emit();
    }

    public dispose(): void {
        this.clearTimers();
        this.outlines = [];
    }

    private leave(id: number): void {
        const outline = this.outlines.find(item => item.id === id);
        if (!outline || outline.phase === "leaving") {
            return;
        }
        if (outline.phase === "pending") {
            // Never drawn, so there is nothing to fade.
            this.remove(id);
            return;
        }
        this.patch(id, { phase: "leaving" });
        this.schedule(id, AGENT_OUTLINE_FADE_MS, () => this.remove(id));
        this.emit();
    }

    private remove(id: number): void {
        this.cancel(id);
        const before = this.outlines.length;
        this.outlines = this.outlines.filter(item => item.id !== id);
        if (this.outlines.length !== before) {
            this.emit();
        }
    }

    private patch(id: number, patch: Partial<AgentOutline>): void {
        this.outlines = this.outlines.map(item => (item.id === id ? { ...item, ...patch } : item));
    }

    private schedule(id: number, ms: number, run: () => void): void {
        this.cancel(id);
        this.timers.set(id, setTimeout(() => {
            this.timers.delete(id);
            run();
        }, ms));
    }

    private cancel(id: number): void {
        const timer = this.timers.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.timers.delete(id);
        }
    }

    private clearTimers(): void {
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
    }

    private emit(): void {
        this.onChange(this.outlines);
    }
}
