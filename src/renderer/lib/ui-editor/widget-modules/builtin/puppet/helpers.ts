import type { PuppetSize, PuppetState } from "narraleaf-react";
import type { UIElement } from "@shared/types/ui-editor/document";
import {
    defaultPuppetWidgetProps,
    isPuppetWidgetConfigured,
    normalizePuppetProps,
    type UIPuppetWidgetProps,
} from "@shared/types/ui-editor/puppet";
import type { SurfacePuppetRequest } from "@/lib/ui-editor/runtime/game/surfacePuppetSession";

export function getPuppetProps(element: UIElement): UIPuppetWidgetProps {
    return normalizePuppetProps({
        ...defaultPuppetWidgetProps,
        ...(element.props ?? {}),
    });
}

export function patchPuppetProps(
    element: UIElement,
    partial: Partial<UIPuppetWidgetProps>,
): Record<string, unknown> {
    const current = getPuppetProps(element);
    return {
        ...(element.props ?? {}),
        ...current,
        ...partial,
    };
}

/**
 * The widget's pose, as the engine's own `PuppetState`.
 *
 * The return type is the assertion: `UIPuppetWidgetProps` claims to carry `PuppetState` field for
 * field, and this is where the compiler checks it. If the engine adds a field, this stops compiling
 * rather than quietly applying a state that is missing one - which would matter, because a state is
 * applied *whole* and a missing field is read as "cleared".
 */
export function puppetWidgetState(props: UIPuppetWidgetProps): PuppetState {
    return {
        motion: props.motion,
        expression: props.expression,
        skin: props.skin,
        params: props.params,
        slots: props.slots,
    };
}

/**
 * Which model, drawn by which runtime — or null when the author has not said yet.
 *
 * Null rather than a request with empty fields: the mount machine treats null as "this widget is not
 * asking", which costs no module load and no WebGL context, and is the state most puppet widgets are
 * in for most of their authoring life.
 *
 * `entry` is always null. This widget's schema has no entry override, so a bundle whose
 * entry file cannot be resolved unambiguously reaches `no-model` here where a *character* could point
 * past it.
 */
export function puppetWidgetRequest(props: UIPuppetWidgetProps): SurfacePuppetRequest | null {
    if (!isPuppetWidgetConfigured(props)) {
        return null;
    }
    return {
        assetId: props.assetId,
        backend: props.backend,
        entry: null,
        options: props.options,
    };
}

/**
 * The box the model draws into: the element's own layout, and nothing else.
 *
 * Clamped to at least one pixel because a backend sizing a canvas from this would come up zero-sized
 * and draw nothing, and because `width` can legitimately be mid-drag negative while the author is
 * pulling a handle backwards through the origin.
 */
export function puppetWidgetSize(element: UIElement): PuppetSize {
    return {
        width: Math.max(1, Math.round(Math.abs(element.layout.width))),
        height: Math.max(1, Math.round(Math.abs(element.layout.height))),
    };
}
