/**
 * Somewhere off screen to mount a page so it can be photographed.
 *
 * A page has to be rendered by the workspace's own React tree to look like the page: the brand
 * palette, the plugins' widget renderers and the asset URL resolution all arrive through providers
 * that only exist inside it. So a screenshot is a request posted here and picked up by
 * `AgentOffscreenHost`, a component mounted in the workspace layout that portals each request into a
 * box far outside the viewport - laid out and painted like any other DOM, never visible, never
 * taking a pointer. Nothing flashes in the author's window.
 *
 * Comments in English per project convention.
 */

import type { ReactElement } from "react";

export type OffscreenRenderJob = {
    id: number;
    element: ReactElement;
    width: number;
    height: number;
    /** Called by the host with the box the element was mounted in, once it is in the document. */
    mounted(box: HTMLElement): void;
};

export type OffscreenRender = {
    /** The box the element was mounted in; the page itself is its first child. */
    box: HTMLElement;
    /** Unmount it. Always call, success or not. */
    release(): void;
};

/** How long a request waits for a host to mount it before giving up. */
const MOUNT_TIMEOUT_MS = 10_000;

export class AgentOffscreenRenderer {
    private jobs: readonly OffscreenRenderJob[] = [];
    private readonly listeners = new Set<() => void>();
    private hosts = 0;
    private nextId = 1;

    /** For `useSyncExternalStore`: the jobs to mount right now. Same array until something changes. */
    public readonly getJobs = (): readonly OffscreenRenderJob[] => this.jobs;

    public readonly subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    /** A host announces itself while mounted; returns the goodbye. */
    public attachHost(): () => void {
        this.hosts += 1;
        return () => {
            this.hosts = Math.max(0, this.hosts - 1);
        };
    }

    public hasHost(): boolean {
        return this.hosts > 0;
    }

    /** Mount `element` in a box of `width` × `height` CSS pixels and wait until it is in the document. */
    public render(element: ReactElement, width: number, height: number): Promise<OffscreenRender> {
        if (!this.hasHost()) {
            return Promise.reject(new Error("The workspace is not showing its editor, so there is nowhere to render the page."));
        }
        const id = this.nextId++;
        return new Promise<OffscreenRender>((resolve, reject) => {
            let settled = false;
            const release = () => {
                this.jobs = this.jobs.filter(job => job.id !== id);
                this.emit();
            };
            const timer = window.setTimeout(() => {
                if (!settled) {
                    settled = true;
                    release();
                    reject(new Error("The page did not mount in time."));
                }
            }, MOUNT_TIMEOUT_MS);
            const job: OffscreenRenderJob = {
                id,
                element,
                width,
                height,
                mounted: box => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    window.clearTimeout(timer);
                    resolve({ box, release });
                },
            };
            this.jobs = [...this.jobs, job];
            this.emit();
        });
    }

    private emit(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }
}
