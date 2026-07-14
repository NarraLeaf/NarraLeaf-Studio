/**
 * Dock layout model — the single source of truth for how the workspace shell sizes its
 * three dock regions (left / right sidebars and the bottom panel).
 *
 * Design goals (replacing the legacy per-handler constants + `available / 2` caps):
 *
 * 1. Constraints are DATA. Each region declares its own `min` / `default` and an `overflow`
 *    policy, instead of scattered `MIN_*` / `MAX_*` module constants.
 *
 * 2. INTENT vs EFFECTIVE. Callers store the user's *intended* size (their last drag target).
 *    The rendered *effective* size is always derived from the intent via {@link resolveDock}.
 *    Nothing mutates the stored intent on window resize, so a panel that was clamped down on a
 *    small window grows back toward its intent when space returns — killing the old
 *    "shrink-only, never-restore" behaviour.
 *
 * 3. The editor has a logical FLOOR ({@link EDITOR_FLOOR}). The solver protects it for the
 *    sidebars (`clamp`) but lets the bottom panel cover it (`clip`). The floor is also applied
 *    as a CSS `min-width`/`min-height` on the editor content box: that CSS floor — not this
 *    solver — is the real anti-deform guarantee. When the editor's layout box is smaller than
 *    the floor, the content renders at the floor and is cropped, never squished. The solver's
 *    job is only to give sensible drag bounds.
 */

export type DockRegion = "left" | "right" | "bottom";

export type DockAxis = "horizontal" | "vertical";

/**
 * `clamp` — the region may never push the editor below its floor (used by the sidebars).
 * `clip`  — the region may grow past the editor floor and cover it; the editor keeps its
 *           logical size and is cropped (used by the bottom panel, so terminals/logs can
 *           fill the height without deforming the editor above).
 */
export type OverflowPolicy = "clamp" | "clip";

export interface RegionSpec {
    /** Hard floor for the region itself, in px. */
    min: number;
    /** Size used when the region is first shown / has no persisted intent, in px. */
    default: number;
    /** Axis the region resizes along. */
    axis: DockAxis;
    /** How the region behaves once it would eat into the editor floor. */
    overflow: OverflowPolicy;
}

/**
 * Logical minimum size of the editor viewport. Shared between this solver and the CSS floor
 * box wrapped around the editor content, so drag bounds and the anti-deform guarantee can
 * never drift apart.
 */
export const EDITOR_FLOOR = { width: 480, height: 240 } as const;

/**
 * Chrome reserved outside the resizable regions. These are approximate — the CSS editor floor
 * is the actual guarantee — so being a few px off (e.g. selector rail width) is harmless.
 */
export const TITLE_BAR_HEIGHT = 40;
export const RAIL_SELECTOR_WIDTH = 48;

export const DOCK_REGIONS: Record<DockRegion, RegionSpec> = {
    left: { min: 240, default: 320, axis: "horizontal", overflow: "clamp" },
    right: { min: 240, default: 320, axis: "horizontal", overflow: "clamp" },
    bottom: { min: 120, default: 256, axis: "vertical", overflow: "clip" },
};

export interface DockEnv {
    /** Full window inner width, in px. */
    windowWidth: number;
    /** Full window inner height, in px. */
    windowHeight: number;
    leftVisible: boolean;
    rightVisible: boolean;
}

export interface DockSizes {
    left: number;
    right: number;
    bottom: number;
}

/** Standard clamp. Callers always pass `hi >= lo` (region maxima are floored at the region min). */
function clamp(value: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, value));
}

/**
 * Largest a sidebar may be while still leaving the editor its floor width (and the other
 * sidebar its space, when visible). Never returns below the region's own `min`.
 */
export function maxSidebarWidth(side: "left" | "right", env: DockEnv, otherEffective: number): number {
    const otherVisible = side === "left" ? env.rightVisible : env.leftVisible;
    const other = otherVisible ? otherEffective : 0;
    const available = env.windowWidth - 2 * RAIL_SELECTOR_WIDTH - EDITOR_FLOOR.width - other;
    return Math.max(DOCK_REGIONS[side].min, available);
}

/**
 * Largest the bottom panel may be. It is a `clip` region, so it is allowed to cover the editor
 * entirely — only the title bar (which lives outside the center column) is reserved.
 */
export function maxBottomHeight(env: DockEnv): number {
    const available = env.windowHeight - TITLE_BAR_HEIGHT;
    return Math.max(DOCK_REGIONS.bottom.min, available);
}

/**
 * Derive the effective (rendered) size of each region from the user's intended sizes and the
 * current environment. Pure: same inputs → same output. Right is resolved independently of
 * left to break the mutual left/right dependency deterministically.
 */
export function resolveDock(intent: DockSizes, env: DockEnv): DockSizes {
    const rightCeiling = Math.max(
        DOCK_REGIONS.right.min,
        env.windowWidth - 2 * RAIL_SELECTOR_WIDTH - EDITOR_FLOOR.width,
    );
    const right = clamp(intent.right, DOCK_REGIONS.right.min, rightCeiling);
    const left = clamp(intent.left, DOCK_REGIONS.left.min, maxSidebarWidth("left", env, right));
    const bottom = clamp(intent.bottom, DOCK_REGIONS.bottom.min, maxBottomHeight(env));
    return { left, right, bottom };
}

/** Left grows as the pointer moves right (+delta); right/bottom grow as it moves left (-delta). */
function growthSign(region: DockRegion): 1 | -1 {
    return region === "left" ? 1 : -1;
}

export interface ResizeResult {
    /** New intended size for the region, in px. */
    next: number;
    /**
     * Position correction fed back to {@link ResizableHandle}: it advances its tracked start
     * position by this so the panel edge stays glued to the pointer only while the size is
     * actually changing (and stalls once clamped at min/max).
     */
    correction: number;
}

/**
 * Apply a pointer delta to a region's intended size, honouring its constraints.
 *
 * @param region          which dock region is being dragged
 * @param currentIntended the region's current intended size, in px
 * @param delta           raw pointer delta since the last move (clientX/clientY change)
 * @param env             current environment
 * @param otherEffective  the other sidebar's effective width (used only for L/R max; ignored for bottom)
 */
export function applyResize(
    region: DockRegion,
    currentIntended: number,
    delta: number,
    env: DockEnv,
    otherEffective: number,
): ResizeResult {
    const spec = DOCK_REGIONS[region];
    const sign = growthSign(region);
    const max = region === "bottom" ? maxBottomHeight(env) : maxSidebarWidth(region, env, otherEffective);
    const next = clamp(currentIntended + sign * delta, spec.min, max);
    const actualDelta = next - currentIntended;
    return { next, correction: sign * actualDelta - delta };
}
