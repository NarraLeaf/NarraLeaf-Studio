/**
 * Dock layout model - the single source of truth for how the workspace shell sizes its
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
 *    small window grows back toward its intent when space returns - killing the old
 *    "shrink-only, never-restore" behaviour.
 *
 * 3. The editor has a logical FLOOR ({@link EDITOR_FLOOR}). The solver protects it for the
 *    sidebars (`clamp`) but lets the bottom panel cover it (`clip`). The floor is also applied
 *    as a CSS `min-width`/`min-height` on the editor content box: that CSS floor - not this
 *    solver - is the real anti-deform guarantee. When the editor's layout box is smaller than
 *    the floor, the content renders at the floor and is cropped, never squished. The solver's
 *    job is only to give sensible drag bounds.
 */

export type DockRegion = "left" | "right" | "bottom";

export type DockAxis = "horizontal" | "vertical";

/**
 * `clamp` - the region may never push the editor below its floor (used by the sidebars).
 * `clip`  - the region may grow past the editor floor and cover it; the editor keeps its
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
 * Chrome reserved outside the resizable regions. These are approximate - the CSS editor floor
 * is the actual guarantee - so being a few px off (e.g. selector rail width) is harmless.
 */
export const TITLE_BAR_HEIGHT = 40;
export const RAIL_SELECTOR_WIDTH = 48;

/**
 * Horizontal padding inside a selector rail (`px-1`), so a rail ITEM's x can be derived rather than
 * eyeballed. Both selector rails centre a 40px item in the 48px column.
 */
export const RAIL_ITEM_INSET = 4;

/**
 * Where each fixed column of the horizontal chain starts, in window px.
 *
 * The flex row places the top-docked columns implicitly, by stacking them. The BOTTOM dock's selector
 * cannot be in that row - it has to sit in the same column as the left selector, just above the
 * status bar - so it is absolutely positioned and therefore has to be TOLD. It was told `left: 0`,
 * which was correct until a column appeared to the left of the selector rail: measured in the running
 * app, the bottom triggers had drifted into the version rail's column while the left dock's own
 * triggers stayed in the selector rail, one column over.
 *
 * So both come from here. One column holds all of the selector rail's items, top-docked and
 * bottom-docked; the version rail is a column of its own and does not adopt them.
 */
export interface RailColumnOffsets {
    /** The version rail, when it is a column at all. Always the window's left edge. */
    versionRail: number;
    /** The selector column: the left dock's rail AND the bottom dock's, at one x. */
    sidebarRail: number;
}

export function railColumnOffsets(env: Pick<DockEnv, "versionRailWidth">): RailColumnOffsets {
    return { versionRail: 0, sidebarRail: env.versionRailWidth };
}

/** Where a rail item's left edge lands, given the x of the column holding it. */
export function railItemLeft(columnLeft: number): number {
    return columnLeft + RAIL_ITEM_INSET;
}

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
    /**
     * Width of the version rail, the fixed column left of the left selector rail - 0 when it is not
     * shown at all, {@link VERSION_RAIL_COLLAPSED_WIDTH} collapsed, {@link VERSION_RAIL_EXPANDED_WIDTH}
     * expanded (see ./versionRailModel).
     *
     * **Required, not optional.** A column the solver does not know about is the exact failure this
     * field exists to prevent: the sidebars would size themselves as if the space were theirs, push
     * the editor below {@link EDITOR_FLOOR}, and the editor's CSS floor would then overflow its
     * container - which produces a scrollbar, which shrinks the container, which re-clamps the
     * overlay, which loops (docs/plans/2026-07-28-002 §3). Making it optional would let a future
     * caller reintroduce that silently; making it required means the compiler asks.
     */
    versionRailWidth: number;
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
 * Every fixed column in the horizontal chain: both selector rails plus the version rail. The one
 * place the count lives, so a new fixed column is added once instead of in three ceilings.
 */
function fixedColumnsWidth(env: DockEnv): number {
    return 2 * RAIL_SELECTOR_WIDTH + env.versionRailWidth;
}

/**
 * Largest a sidebar may be while still leaving the editor its floor width (and the other
 * sidebar its space, when visible). Never returns below the region's own `min`.
 */
export function maxSidebarWidth(side: "left" | "right", env: DockEnv, otherEffective: number): number {
    const otherVisible = side === "left" ? env.rightVisible : env.leftVisible;
    const other = otherVisible ? otherEffective : 0;
    const available = env.windowWidth - fixedColumnsWidth(env) - EDITOR_FLOOR.width - other;
    return Math.max(DOCK_REGIONS[side].min, available);
}

/**
 * What the editor's layout box is actually given, once every fixed column and both visible sidebars
 * have taken theirs. Negative when the region minima alone no longer fit - which is when the CSS
 * floor takes over and crops instead of squishing.
 *
 * Exported because it is how the accounting gets PROVEN rather than asserted: a test can feed it the
 * solver's own output and check the floor holds at every rail width, which is the balance §3 of the
 * plan says has to hold before a new leftmost column is allowed to exist.
 */
export function residualEditorWidth(env: DockEnv, sizes: DockSizes): number {
    const left = env.leftVisible ? sizes.left : 0;
    const right = env.rightVisible ? sizes.right : 0;
    return env.windowWidth - fixedColumnsWidth(env) - left - right;
}

/**
 * Largest the bottom panel may be. It is a `clip` region, so it is allowed to cover the editor
 * entirely - only the title bar (which lives outside the center column) is reserved.
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
        env.windowWidth - fixedColumnsWidth(env) - EDITOR_FLOOR.width,
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
