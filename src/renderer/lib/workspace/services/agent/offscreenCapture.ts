/**
 * When a page mounted off screen is finished enough to photograph, and what it is still missing.
 *
 * A freshly mounted page is not the page yet. Its pictures arrive over IPC a render or two later
 * (`useAssetObjectUrl`), a nested page frame holds its content transparent until its hidden prepaint
 * pass is over, images decode, fonts load. `ui_screenshot` used to wait a fixed 60ms and then copy
 * whatever was in the DOM, so a key art whose bytes took longer than that was simply not in the
 * picture - and since nothing had failed, nothing was reported either.
 *
 * So the page is rendered under an {@link OffscreenCapture}, which is both the asset load tracker
 * every lookup reports to and the asset resolution reporter every drawing reports its outcome to,
 * and {@link waitForOffscreenPage} waits on the page's own signals instead of a clock: no lookup in
 * flight, no prepaint pending, every image and video loaded, fonts loaded, and the DOM quiet for a
 * moment. Whatever is still outstanding at the deadline is named rather than silently dropped.
 *
 * The waits do not use timers for their ticks. A window macOS considers occluded throttles timers to
 * about one a second (and Chromium aligns chained timers in a page hidden for minutes to the
 * minute), which would turn a 50ms quiet period into a minute's wait; message-channel tasks are not
 * throttled, and they yield to the event loop so the IPC replies and React's own work still run.
 *
 * Comments in English per project convention.
 */

import type { AssetLoadTracker } from "@/lib/ui-editor/runtime/assetLoadTracker";
import { classifyAssetFailure, type AssetResolutionReport, type AssetResolutionReporter } from "@/lib/ui-editor/runtime/assetResolution";

/** How long the page must stay unchanged, with nothing outstanding, before it is photographed. */
const QUIET_MS = 80;
/** How long a page may take to finish before it is photographed as it is, outstanding items named. */
export const OFFSCREEN_READY_TIMEOUT_MS = 8000;

export class OffscreenCapture implements AssetLoadTracker {
    private readonly pending = new Map<number, string>();
    private readonly failures = new Map<string, string>();
    private nextToken = 1;
    /** Bumped on every report or lookup start/end, so a quiet period notices activity the DOM did not show. */
    private activity = 0;

    /**
     * `assetNames` is the project's `assetId -> name` table, which tells "deleted or never in this
     * project" from "in the project but unreadable", and lets the list say which picture it was.
     */
    public constructor(private readonly assetNames?: () => Readonly<Record<string, string>>) {}

    public begin(label: string): () => void {
        const token = this.nextToken++;
        this.pending.set(token, label);
        this.activity += 1;
        let ended = false;
        return () => {
            if (ended) {
                return;
            }
            ended = true;
            this.pending.delete(token);
            this.activity += 1;
        };
    }

    /** For `AssetResolutionReporterContext`: what each drawing of an asset slot came to. */
    public readonly report: AssetResolutionReporter = (report: AssetResolutionReport) => {
        this.activity += 1;
        if (report.type === "released") {
            // Not on the page any more, so not missing from its picture either.
            this.failures.delete(report.drawing);
            return;
        }
        if (report.outcome.status === "failed") {
            const { site, outcome } = report;
            const { kind, assetName } = classifyAssetFailure(outcome, this.assetNames?.());
            const subject = assetName ? `asset "${assetName}" (${outcome.requested})` : `"${outcome.requested}"`;
            const what = kind === "missing"
                ? "is not an asset of this project (deleted, or an id from elsewhere)"
                : kind === "notAsset"
                  ? "is not an asset reference"
                  : "could not be read or decoded";
            this.failures.set(report.drawing, `${site.ownerName} (${site.slot}): ${subject} ${what}`);
        } else {
            this.failures.delete(report.drawing);
        }
    };

    public getActivity(): number {
        return this.activity;
    }

    /** The asset ids still being looked up. */
    public pendingLookups(): string[] {
        return [...new Set(this.pending.values())];
    }

    /** Asset slots that asked for something and did not get it. */
    public failedSlots(): string[] {
        return [...new Set(this.failures.values())];
    }
}

export type OffscreenReadiness = {
    /** What was still outstanding when the deadline passed; empty when the page finished. */
    outstanding: string[];
    elapsedMs: number;
};

/**
 * Wait until the page in `box` has finished arriving (see the module note), or `timeoutMs` passes.
 * `describe` names an element for the outstanding list (its page path), or null.
 */
export async function waitForOffscreenPage(
    box: HTMLElement,
    capture: OffscreenCapture,
    options: { timeoutMs?: number; describe?: (node: Element) => string | null } = {},
): Promise<OffscreenReadiness> {
    const start = performance.now();
    const deadline = start + (options.timeoutMs ?? OFFSCREEN_READY_TIMEOUT_MS);
    let mutations = 0;
    const observer = new MutationObserver(records => {
        mutations += records.length;
    });
    observer.observe(box, { subtree: true, childList: true, attributes: true, characterData: true });
    // Load and error events are what most of the outstanding items end with; listening in the
    // capture phase on the box catches them for every image and video below it.
    const onResourceEvent = () => {
        mutations += 1;
    };
    for (const type of ["load", "error", "loadeddata"]) {
        box.addEventListener(type, onResourceEvent, true);
    }
    try {
        let quietSince: number | null = null;
        let seen = { mutations: -1, activity: -1 };
        for (;;) {
            await yieldFor(16);
            const outstanding = outstandingItems(box, capture, options.describe);
            const now = performance.now();
            const unchanged = seen.mutations === mutations && seen.activity === capture.getActivity();
            seen = { mutations, activity: capture.getActivity() };
            if (outstanding.length > 0 || !unchanged) {
                quietSince = null;
            } else {
                quietSince ??= now;
                if (now - quietSince >= QUIET_MS) {
                    return { outstanding: [], elapsedMs: now - start };
                }
            }
            if (now >= deadline) {
                return { outstanding, elapsedMs: now - start };
            }
        }
    } finally {
        observer.disconnect();
        for (const type of ["load", "error", "loadeddata"]) {
            box.removeEventListener(type, onResourceEvent, true);
        }
    }
}

function outstandingItems(box: HTMLElement, capture: OffscreenCapture, describe?: (node: Element) => string | null): string[] {
    const items: string[] = [];
    const where = (node: Element, fallback: string) => describe?.(node) ?? fallback;
    for (const id of capture.pendingLookups()) {
        items.push(`asset ${id} (still loading)`);
    }
    for (const node of Array.from(box.querySelectorAll("[data-ui-surface-prepaint='pending']"))) {
        items.push(`${where(node, "a nested page")} (not revealed yet)`);
    }
    for (const image of Array.from(box.querySelectorAll("img"))) {
        if (image.getAttribute("src") && !image.complete) {
            items.push(`${where(image, "an image")} (still decoding)`);
        }
    }
    for (const video of Array.from(box.querySelectorAll("video"))) {
        // HAVE_CURRENT_DATA: a frame exists to be drawn. A video with no source has nothing to wait for.
        if ((video.currentSrc || video.getAttribute("src")) && video.readyState < 2 && !video.error) {
            items.push(`${where(video, "a video")} (no frame yet)`);
        }
    }
    if (typeof document !== "undefined" && document.fonts?.status === "loading") {
        items.push("fonts (still loading)");
    }
    return items;
}

/**
 * Give the event loop at least `ms` of turns. Message-channel tasks rather than timers: see the module
 * note on why a timer is the wrong clock in a window that is not on screen.
 */
function yieldFor(ms: number): Promise<void> {
    const until = performance.now() + ms;
    return new Promise(resolve => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            if (performance.now() >= until) {
                channel.port1.close();
                resolve();
            } else {
                channel.port2.postMessage(null);
            }
        };
        channel.port2.postMessage(null);
    });
}
