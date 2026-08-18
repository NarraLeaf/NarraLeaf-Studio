import type { AppearanceModel, AppearancePropertyGroup } from "@shared/types/ui-editor/appearance";
import type { UIDocument, UIElement, UILayout } from "@shared/types/ui-editor/document";
import type { UIEditorEnteredState } from "@/lib/workspace/services/services";

export type LayoutPatches = Record<string, Partial<UILayout>>;

export type EnteredStateLayoutSplit = {
    /** What still belongs to the element's own geometry. */
    layoutPatches: LayoutPatches;
    /** Element id to the appearance model that now carries the move, as an offset on the entered state. */
    appearancePatches: Record<string, AppearanceModel>;
};

/** The offset keys a move is expressible in. Size and rotation have no appearance counterpart. */
const OFFSET_KEY = { x: "transformOffsetX", y: "transformOffsetY" } as const;

function appearanceOf(element: UIElement): AppearanceModel | null {
    const model = (element.props as { appearance?: AppearanceModel | null } | undefined)?.appearance;
    return model && Array.isArray(model.variants) && model.variants.length > 0 ? model : null;
}

/**
 * The variant this element draws with while a state is entered, or undefined when it is out of scope.
 *
 * Out of scope and "entered the resting state" are different answers: the first means nothing was
 * entered above this element and its geometry is its own, the second means the author is looking at
 * the state the element rests in - which *is* its own geometry, so both end up writing the layout.
 */
function enteredVariantFor(
    document: UIDocument,
    entered: UIEditorEnteredState | null,
    elementId: string,
): string | null | undefined {
    if (!entered) {
        return undefined;
    }
    const seen = new Set<string>();
    let current: string | null | undefined = elementId;
    while (current && !seen.has(current)) {
        if (current === entered.elementId) {
            return entered.variantId;
        }
        seen.add(current);
        current = document.elements[current]?.parentId ?? null;
    }
    return undefined;
}

function readFirstRowNumber(model: AppearanceModel, variantId: string, key: string): number {
    const group = model.variants.find(v => v.id === variantId)?.propertyGroups.find(g => g.key === key);
    const value = group?.rows[0]?.value;
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function writeFirstRowNumber(
    model: AppearanceModel,
    variantId: string,
    key: string,
    value: number,
): AppearanceModel | null {
    let wrote = false;
    const variants = model.variants.map(variant => {
        if (variant.id !== variantId) {
            return variant;
        }
        const groups = variant.propertyGroups.map(group => {
            if (group.key !== key) {
                return group;
            }
            wrote = true;
            const rows = group.rows.length > 0
                ? group.rows.map((row, index) => (index === 0 ? { ...row, value } : row))
                : [{ conditions: null, value }];
            return { ...group, rows } as AppearancePropertyGroup;
        });
        return { ...variant, propertyGroups: groups };
    });
    return wrote ? { ...model, variants } : null;
}

/**
 * Sends a move to the state the author is looking at, and everything else to the element itself.
 *
 * Dragging a switch's thumb while its on state is entered has to change where the thumb sits *when
 * on*, not where it sits at rest - writing the layout would move it in both states at once and leave
 * the travel unchanged, which is the one result the gesture cannot mean. So x and y become an offset
 * on that variant, and the element's own x and y are left alone.
 *
 * Only x and y are rerouted. Width, height and rotation have no place in an appearance model, and the
 * author's ruling is that resizing inside a state edits the shared geometry rather than being refused.
 */
export function splitLayoutPatchesForEnteredState(
    document: UIDocument,
    entered: UIEditorEnteredState | null,
    patches: LayoutPatches,
): EnteredStateLayoutSplit {
    const layoutPatches: LayoutPatches = {};
    const appearancePatches: Record<string, AppearanceModel> = {};

    for (const [elementId, patch] of Object.entries(patches)) {
        const element = document.elements[elementId];
        const variantId = element ? enteredVariantFor(document, entered, elementId) : undefined;
        const model = element ? appearanceOf(element) : null;
        const movesPosition = patch.x !== undefined || patch.y !== undefined;
        const carriesVariant = Boolean(variantId && model?.variants.some(v => v.id === variantId));
        if (!element || !model || !variantId || !movesPosition || !carriesVariant) {
            layoutPatches[elementId] = patch;
            continue;
        }

        let nextModel: AppearanceModel = model;
        for (const axis of ["x", "y"] as const) {
            const target = patch[axis];
            if (target === undefined) {
                continue;
            }
            const delta = target - element.layout[axis];
            if (delta === 0) {
                continue;
            }
            const key = OFFSET_KEY[axis];
            const written = writeFirstRowNumber(
                nextModel,
                variantId,
                key,
                readFirstRowNumber(nextModel, variantId, key) + delta,
            );
            if (written) {
                nextModel = written;
            }
        }

        const rest: Partial<UILayout> = { ...patch };
        delete rest.x;
        delete rest.y;
        if (Object.keys(rest).length > 0) {
            layoutPatches[elementId] = rest;
        }
        if (nextModel !== model) {
            appearancePatches[elementId] = nextModel;
        }
    }

    return { layoutPatches, appearancePatches };
}

type LayoutCommitTarget = {
    getDocument(): UIDocument;
    updateElementLayouts(patches: LayoutPatches): void;
    updateElementProps(elementId: string, props: Record<string, unknown>): void;
    runSurfaceHistoryTransaction(surfaceId: string, action: () => void): void;
};

/**
 * One gesture, one history entry: a move that lands partly in a variant and partly in a layout still
 * has to undo in a single step.
 */
export function commitLayoutPatches(
    target: LayoutCommitTarget,
    entered: UIEditorEnteredState | null,
    patches: LayoutPatches,
    surfaceId?: string | null,
): void {
    const document = target.getDocument();
    const { layoutPatches, appearancePatches } = splitLayoutPatchesForEnteredState(document, entered, patches);
    const appearanceIds = Object.keys(appearancePatches);
    if (appearanceIds.length === 0) {
        if (Object.keys(layoutPatches).length > 0) {
            target.updateElementLayouts(layoutPatches);
        }
        return;
    }
    const apply = () => {
        if (Object.keys(layoutPatches).length > 0) {
            target.updateElementLayouts(layoutPatches);
        }
        for (const elementId of appearanceIds) {
            const element = target.getDocument().elements[elementId];
            target.updateElementProps(elementId, {
                ...(element?.props ?? {}),
                appearance: appearancePatches[elementId],
            });
        }
    };
    if (surfaceId) {
        target.runSurfaceHistoryTransaction(surfaceId, apply);
    } else {
        apply();
    }
}
