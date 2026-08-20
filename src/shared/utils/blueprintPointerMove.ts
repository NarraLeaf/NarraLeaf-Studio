/**
 * A Move Mouse request, executed against one window.
 *
 * Shared by Studio's main process (Dev Mode) and the packaged game's main process for the reason
 * `blueprintNetworkFetch` and `systemCursor` are shared: the author tests in one and ships the
 * other, and a coordinate conversion that differed between them would be a defect nobody could see
 * until the game was in players' hands.
 *
 * ## The conversion, and why every step of it is here
 *
 * The renderer sends CSS pixels from the top-left of the web contents. Three things stand between
 * that and a pixel on the desktop:
 *
 *  - **Where the window is.** `getContentBounds()` answers in device-independent pixels and
 *    excludes the frame, which is what makes it the right origin: the renderer's (0, 0) is the
 *    top-left of the content, not of the title bar.
 *  - **Page zoom.** A CSS pixel is a device-independent pixel times the zoom factor. Games ship at
 *    1, so the term is almost always inert; leaving it out would make the one build that sets a
 *    zoom factor land the cursor somewhere else with nothing on screen to explain it.
 *  - **Display scale.** The platform calls take physical pixels, and on a 150% display a
 *    device-independent pixel is not one. `dipToScreenPoint` knows about per-monitor scaling, which
 *    arithmetic against a single scale factor gets wrong the moment a window straddles two displays.
 *
 * ## Why the smooth travel happens here rather than in the renderer
 *
 * A renderer-driven tween would mean one round trip per animation frame, and it still could not
 * start from the right place: where the cursor is now is a fact about the desktop, and the page has
 * no way to ask. This side can - `screen.getCursorScreenPoint()` answers it without any platform
 * call at all - so the whole path is computed where both of its endpoints are known.
 *
 * The target is fixed when the move begins. A widget that moves while the cursor is travelling to
 * it will not be followed, which is the behaviour worth having: a pointer chasing an animating
 * button is a pointer the player cannot predict, and an author who wants that can move again.
 *
 * Comments in English per project convention.
 */

import {
    easeBlueprintPointerMove,
    type BlueprintPointerMoveEasing,
    type BlueprintPointerMoveRequest,
    type BlueprintPointerMoveResult,
} from "@shared/types/blueprint/pointer";
import { isSystemCursorAvailable, moveSystemCursorTo } from "./systemCursor";

/** The parts of a `BrowserWindow` this needs, named so the conversion can be tested without one. */
export type PointerMoveWindow = {
    id: number;
    isDestroyed: () => boolean;
    getContentBounds: () => { x: number; y: number; width: number; height: number };
    webContents: { getZoomFactor: () => number };
};

/** The parts of Electron's `screen` module this needs. */
export type PointerMoveScreen = {
    dipToScreenPoint: (point: { x: number; y: number }) => { x: number; y: number };
    getCursorScreenPoint: () => { x: number; y: number };
};

export type PointerMoveDeps = {
    screen: PointerMoveScreen | null;
    moveCursor?: (x: number, y: number) => Promise<BlueprintPointerMoveResult>;
    cursorAvailable?: () => Promise<boolean>;
    /** Injected by tests so a timed move does not take real time. */
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
};

/**
 * Roughly one step per display frame. Finer would be invisible and would spend platform calls; much
 * coarser and a slow move reads as a sequence of jumps rather than as travel.
 */
const STEP_INTERVAL_MS = 16;

/**
 * The move in flight per window, so a second request supersedes the first.
 *
 * Without this, two overlapping moves would interleave their steps and the cursor would shake
 * between two paths. The newer request wins because it is the more recent thing the author asked
 * for; the older one stops where it is rather than snapping back.
 */
const activeMoves = new Map<number, symbol>();

function clampToContent(value: number, min: number, extent: number): number {
    // The window's own edges, not the desktop's. A request that would land the pointer outside the
    // game is either a stale measurement or a stage coordinate off the surface, and in both cases
    // the nearest point inside the window is the honest reading of what was asked for. Letting it
    // through would make this a way to park the cursor anywhere on the desktop, which is a larger
    // power than the one the node is for.
    return Math.max(min, Math.min(min + Math.max(0, extent - 1), value));
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function executeBlueprintPointerMove(
    request: BlueprintPointerMoveRequest,
    window: PointerMoveWindow | null,
    deps: PointerMoveDeps,
): Promise<BlueprintPointerMoveResult> {
    const move = deps.moveCursor ?? moveSystemCursorTo;
    const available = deps.cursorAvailable ?? isSystemCursorAvailable;
    const now = deps.now ?? (() => Date.now());
    const sleep = deps.sleep ?? defaultSleep;

    if (!(await available())) {
        return { outcome: "unsupported", error: "This host cannot move the system cursor" };
    }
    if (!window || window.isDestroyed()) {
        return { outcome: "failed", error: "No window to move the cursor within" };
    }
    if (!Number.isFinite(request.clientX) || !Number.isFinite(request.clientY)) {
        return { outcome: "failed", error: "Cursor target is not a finite point" };
    }

    const toPhysical = (dip: { x: number; y: number }) => {
        if (!deps.screen) {
            return dip;
        }
        // A screen module that refuses the conversion is not a reason to give up: on the platforms
        // where it is a no-op, device-independent and physical pixels are the same number.
        try {
            const converted = deps.screen.dipToScreenPoint(dip);
            return Number.isFinite(converted?.x) && Number.isFinite(converted?.y) ? converted : dip;
        } catch {
            return dip;
        }
    };

    const bounds = window.getContentBounds();
    const rawZoom = window.webContents.getZoomFactor();
    const zoom = Number.isFinite(rawZoom) && rawZoom > 0 ? rawZoom : 1;
    const targetDip = {
        x: clampToContent(bounds.x + request.clientX * zoom, bounds.x, bounds.width),
        y: clampToContent(bounds.y + request.clientY * zoom, bounds.y, bounds.height),
    };

    const durationMs = Math.max(0, Math.round((request.durationSeconds ?? 0) * 1000));
    if (durationMs <= 0) {
        activeMoves.delete(window.id);
        return moveTo(move, toPhysical(targetDip));
    }
    return travel(request.easing ?? "easeInOut", durationMs, targetDip, window, {
        move,
        toPhysical,
        now,
        sleep,
        readCursorDip: () => deps.screen?.getCursorScreenPoint() ?? null,
    });
}

function moveTo(
    move: (x: number, y: number) => Promise<BlueprintPointerMoveResult>,
    point: { x: number; y: number },
): Promise<BlueprintPointerMoveResult> {
    return move(point.x, point.y);
}

async function travel(
    easing: BlueprintPointerMoveEasing,
    durationMs: number,
    targetDip: { x: number; y: number },
    window: PointerMoveWindow,
    io: {
        move: (x: number, y: number) => Promise<BlueprintPointerMoveResult>;
        toPhysical: (dip: { x: number; y: number }) => { x: number; y: number };
        now: () => number;
        sleep: (ms: number) => Promise<void>;
        readCursorDip: () => { x: number; y: number } | null;
    },
): Promise<BlueprintPointerMoveResult> {
    // Where the cursor is now, read once. Without a start there is nothing to interpolate, so a
    // host that will not say degrades to the instant move rather than to nothing happening.
    const startDip = io.readCursorDip();
    if (!startDip || !Number.isFinite(startDip.x) || !Number.isFinite(startDip.y)) {
        return await moveTo(io.move, io.toPhysical(targetDip));
    }
    const token = Symbol("pointerMove");
    activeMoves.set(window.id, token);
    const startedAt = io.now();
    for (;;) {
        const elapsed = io.now() - startedAt;
        const progress = easeBlueprintPointerMove(easing, elapsed / durationMs);
        const point = {
            x: startDip.x + (targetDip.x - startDip.x) * progress,
            y: startDip.y + (targetDip.y - startDip.y) * progress,
        };
        const result = await moveTo(io.move, io.toPhysical(point));
        if (result.outcome !== "moved") {
            activeMoves.delete(window.id);
            return result;
        }
        if (elapsed >= durationMs) {
            break;
        }
        await io.sleep(STEP_INTERVAL_MS);
        // Superseded by a later move, or the window went away mid-travel. Stopping here rather than
        // finishing keeps the cursor under the newest instruction instead of under two at once.
        if (activeMoves.get(window.id) !== token) {
            return { outcome: "moved" };
        }
        if (window.isDestroyed()) {
            activeMoves.delete(window.id);
            return { outcome: "failed", error: "The window closed while the cursor was moving" };
        }
    }
    if (activeMoves.get(window.id) === token) {
        activeMoves.delete(window.id);
    }
    return { outcome: "moved" };
}
