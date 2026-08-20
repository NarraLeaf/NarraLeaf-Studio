import type {
    AppearanceFieldTransition,
    AppearanceModel,
    AppearancePropertyGroup,
    AppearanceVariant,
} from "@shared/types/ui-editor/appearance";
import type { UIDocument, UIElement, UILayout } from "@shared/types/ui-editor/document";
import { getStateMotions, type UIStateMotion } from "@shared/types/ui-editor/stateMotion";
import type { UIEditorEnteredState } from "@/lib/workspace/services/services";
import { ensureVariantExists } from "./appearancePatch";
import { isUsableAppearanceModel } from "./initialAppearanceModel";
import { stateScopedMoveTarget, type StateHost } from "./stateHost";

/** The two channels a position in a state is carried on. */
const OFFSET_KEY = { x: "transformOffsetX", y: "transformOffsetY" } as const;

export type LayoutPatches = Record<string, Partial<UILayout>>;

export type StateAwareLayoutSplit = {
    /** What still belongs to the element's own geometry, in every state. */
    layoutPatches: LayoutPatches;
    /** Element id to the appearance model that now carries its position in the entered state. */
    appearancePatches: Record<string, AppearanceModel>;
    /** Host element id to the state motions left after the ones this move replaces were folded in. */
    stateMotionPatches: Record<string, UIStateMotion[]>;
};

function appearanceOf(element: UIElement): AppearanceModel | null {
    const model = (element.props as { appearance?: AppearanceModel | null } | undefined)?.appearance;
    return isUsableAppearanceModel(model) ? model : null;
}

function readGroupNumber(variant: AppearanceVariant | undefined, key: string): number {
    const value = variant?.propertyGroups.find(group => group.key === key)?.rows[0]?.value;
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The offsets a variant draws its element at, conditional rows excluded.
 *
 * The first row is the unconditional one. A hover row moving the element further is a different
 * question from where the author put it, and dragging edits the latter.
 */
export function readVariantOffsets(model: AppearanceModel, variantId: string): { x: number; y: number } {
    const variant = model.variants.find(item => item.id === variantId);
    return { x: readGroupNumber(variant, OFFSET_KEY.x), y: readGroupNumber(variant, OFFSET_KEY.y) };
}

function withGroupValue(variant: AppearanceVariant, key: string, value: number): AppearanceVariant {
    let found = false;
    const propertyGroups = variant.propertyGroups.map(group => {
        if (group.key !== key) {
            return group;
        }
        found = true;
        const rows = group.rows.length > 0
            ? group.rows.map((row, index) => (index === 0 ? { ...row, value } : row))
            : [{ conditions: null, value }];
        return { ...group, rows } as AppearancePropertyGroup;
    });
    if (found) {
        return { ...variant, propertyGroups };
    }
    return {
        ...variant,
        propertyGroups: [
            ...propertyGroups,
            { key, rows: [{ conditions: null, value }] } as AppearancePropertyGroup,
        ],
    };
}

function setOffsetTransitionOnAllVariants(
    model: AppearanceModel,
    transition: AppearanceFieldTransition,
): AppearanceModel {
    return {
        ...model,
        variants: model.variants.map(variant => ({
            ...variant,
            propertyGroups: variant.propertyGroups.map(group =>
                group.key === OFFSET_KEY.x || group.key === OFFSET_KEY.y
                    ? ({ ...group, transition } as AppearancePropertyGroup)
                    : group),
        })),
    };
}

function hasOffsetTransition(model: AppearanceModel): boolean {
    return model.variants.some(variant =>
        variant.propertyGroups.some(
            group => (group.key === OFFSET_KEY.x || group.key === OFFSET_KEY.y) && group.transition,
        ));
}

/** The host's motion for this part, from the shape widgets used before positions lived in states. */
function legacyMotionFor(host: StateHost, targetId: string, variantId: string): UIStateMotion | null {
    return getStateMotions(host.element.props).find(
        motion => motion.target === targetId && motion.state === variantId,
    ) ?? null;
}

/**
 * How far the state being shown moves this element from where it rests, or null when no state does.
 *
 * Null and a zero offset are different answers: null means this element's position is simply its own
 * and every reader should stay on `layout`, zero means it is in a state that happens to leave it
 * where it rests.
 */
export function currentStateOffset(
    document: UIDocument,
    entered: UIEditorEnteredState | null,
    elementId: string,
): { x: number; y: number } | null {
    const scoped = stateScopedMoveTarget(document, entered, elementId);
    const element = document.elements[elementId];
    if (!scoped || !element) {
        return null;
    }
    const legacy = legacyMotionFor(scoped.host, elementId, scoped.variantId);
    if (legacy) {
        return { x: legacy.offsetX, y: legacy.offsetY };
    }
    const model = appearanceOf(element);
    return model ? readVariantOffsets(model, scoped.variantId) : null;
}

/**
 * Where an element sits in the state being shown, as a position rather than as an offset.
 *
 * The author never sees the offset: they see the thumb at 27 when the switch is on and at 3 when it
 * is off, and the distance between those two numbers is what the widget animates. `layout` stays the
 * resting position in every state, which is why moving something while nothing is entered moves it
 * everywhere - there is nothing layered over it there.
 */
export function readStatePosition(
    document: UIDocument,
    entered: UIEditorEnteredState | null,
    elementId: string,
): { x: number; y: number } | null {
    const offset = currentStateOffset(document, entered, elementId);
    const element = document.elements[elementId];
    if (!offset || !element) {
        return null;
    }
    return { x: element.layout.x + offset.x, y: element.layout.y + offset.y };
}

/**
 * Sends a move to the state the author is looking at, and everything else to the element itself.
 *
 * Dragging a switch's thumb while its on state is entered has to change where the thumb sits *when
 * on*, not where it rests: writing the layout would move it in both states at once and leave the
 * travel unchanged, which is the one result the gesture cannot mean.
 *
 * Only x and y are rerouted. Size and rotation have no state of their own, and resizing inside a
 * state edits the shared geometry rather than being refused.
 *
 * `patch.x` is read as a position in the same space as `layout.x` - where the element should end up
 * in this state, not how far it moved - so callers that start from a rendered position must add the
 * offset the state is already applying. {@link currentStateOffset} is what they read it from.
 */
export function splitStateAwareLayoutPatches(
    document: UIDocument,
    entered: UIEditorEnteredState | null,
    patches: LayoutPatches,
): StateAwareLayoutSplit {
    const layoutPatches: LayoutPatches = {};
    const appearancePatches: Record<string, AppearanceModel> = {};
    const stateMotionPatches: Record<string, UIStateMotion[]> = {};

    for (const [elementId, patch] of Object.entries(patches)) {
        const element = document.elements[elementId];
        const scoped = element ? stateScopedMoveTarget(document, entered, elementId) : null;
        const model = element ? appearanceOf(element) : null;
        const movesPosition = patch.x !== undefined || patch.y !== undefined;
        if (!element || !model || !scoped || !movesPosition) {
            layoutPatches[elementId] = patch;
            continue;
        }

        const stateName = scoped.host.states.find(state => state.id === scoped.variantId)?.name ?? scoped.variantId;
        let next = ensureVariantExists(model, scoped.variantId, stateName);
        // A part the host still moves the old way is migrated by the first drag that lands on it:
        // leaving both in place would let the host's offset win and the drag look like it did nothing.
        const legacy = legacyMotionFor(scoped.host, elementId, scoped.variantId);
        if (legacy) {
            stateMotionPatches[scoped.host.element.id] = getStateMotions(scoped.host.element.props).filter(
                motion => !(motion.target === elementId && motion.state === scoped.variantId),
            );
            if (!hasOffsetTransition(next)) {
                next = setOffsetTransitionOnAllVariants(next, {
                    type: "tween",
                    durationMs: legacy.durationMs,
                    delayMs: 0,
                    easing: legacy.easing,
                });
            }
        }

        for (const axis of ["x", "y"] as const) {
            const target = patch[axis];
            if (target === undefined) {
                continue;
            }
            const offset = target - element.layout[axis];
            next = {
                ...next,
                variants: next.variants.map(variant =>
                    variant.id === scoped.variantId ? withGroupValue(variant, OFFSET_KEY[axis], offset) : variant),
            };
        }

        const rest: Partial<UILayout> = { ...patch };
        delete rest.x;
        delete rest.y;
        if (Object.keys(rest).length > 0) {
            layoutPatches[elementId] = rest;
        }
        if (next !== model) {
            appearancePatches[elementId] = next;
        }
    }

    return { layoutPatches, appearancePatches, stateMotionPatches };
}

type LayoutCommitTarget = {
    getDocument(): UIDocument;
    updateElementLayouts(patches: LayoutPatches): void;
    updateElementProps(elementId: string, props: Record<string, unknown>): void;
    runSurfaceHistoryTransaction(surfaceId: string, action: () => void): void;
};

/**
 * One gesture, one history entry: a move that lands partly in a state and partly in a layout still
 * has to undo in a single step.
 */
export function commitStateAwareLayoutPatches(
    target: LayoutCommitTarget,
    entered: UIEditorEnteredState | null,
    patches: LayoutPatches,
    surfaceId?: string | null,
): void {
    const document = target.getDocument();
    const split = splitStateAwareLayoutPatches(document, entered, patches);
    const appearanceIds = Object.keys(split.appearancePatches);
    const motionHostIds = Object.keys(split.stateMotionPatches);
    if (appearanceIds.length === 0 && motionHostIds.length === 0) {
        if (Object.keys(split.layoutPatches).length > 0) {
            target.updateElementLayouts(split.layoutPatches);
        }
        return;
    }
    const apply = () => {
        if (Object.keys(split.layoutPatches).length > 0) {
            target.updateElementLayouts(split.layoutPatches);
        }
        for (const elementId of appearanceIds) {
            const element = target.getDocument().elements[elementId];
            target.updateElementProps(elementId, {
                ...(element?.props ?? {}),
                appearance: split.appearancePatches[elementId],
            });
        }
        for (const hostId of motionHostIds) {
            const host = target.getDocument().elements[hostId];
            target.updateElementProps(hostId, {
                ...(host?.props ?? {}),
                stateMotions: split.stateMotionPatches[hostId],
            });
        }
    };
    if (surfaceId) {
        target.runSurfaceHistoryTransaction(surfaceId, apply);
    } else {
        apply();
    }
}
