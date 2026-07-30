import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { encodeStableJson } from "@shared/utils/stableJson";
import type { TranslationKey } from "@shared/i18n";
import { useTranslation } from "@/lib/i18n";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { RectangleChromeRenderer } from "@/lib/ui-editor/widget-modules/shared/chrome/RectangleChromeRenderer";
import { useSurfacePuppetSession } from "@/lib/workspace/hooks/useSurfacePuppetSession";
import {
    SURFACE_PUPPET_CONTEXT_BUDGET,
    useSurfacePuppetContextLease,
} from "@/lib/ui-editor/runtime/game/surfacePuppetContextBudget";
import { getPuppetProps, puppetWidgetRequest, puppetWidgetSize, puppetWidgetState } from "./helpers";

/**
 * The model's box. Absolute inside the chrome so corner radius, border, fill and opacity are the
 * chrome's job, exactly as for `nl.video` - a second box built here would have to re-derive all of
 * that and would drift from the rest of the Surface.
 */
const MOUNT_STYLE: CSSProperties = {
    position: "absolute",
    inset: 0,
    borderRadius: "inherit",
    // The model is a picture, not a control. Phase two's interaction nodes can lift this.
    pointerEvents: "none",
};

/**
 * Mount just before the box scrolls into view rather than at the moment it does.
 *
 * A model takes a visible moment to load, so waiting for the box to be on screen would show an empty
 * frame every time the author scrolls. One screenful of slack is enough to hide it and still keeps a
 * long Surface's off-screen widgets out of the context budget.
 */
const PREMOUNT_MARGIN = "100%";

/**
 * Whether this box is near enough to the viewport to be worth a WebGL context.
 *
 * An `IntersectionObserver` rather than a scroll listener because it also answers the cases a scroll
 * position cannot: a widget inside a collapsed or `display:none` ancestor, and one clipped away by a
 * scroll container several levels up. Both are "not visible" and neither moves the canvas's scroll.
 */
function useNearViewport(node: HTMLElement | null): boolean {
    const [near, setNear] = useState(false);

    useEffect(() => {
        if (!node) {
            setNear(false);
            return;
        }
        if (typeof IntersectionObserver === "undefined") {
            // A host with no observer (jsdom) must not be a host where nothing ever draws.
            setNear(true);
            return;
        }
        const observer = new IntersectionObserver(
            entries => { setNear(entries.some(entry => entry.isIntersecting)); },
            { rootMargin: PREMOUNT_MARGIN },
        );
        observer.observe(node);
        return () => { observer.disconnect(); };
    }, [node]);

    return near;
}

/**
 * Why nothing is drawn, in one line, or null when a model is up.
 *
 * Every branch is a sentence an author can act on. None of them is an alarm except `error`, which the
 * engine reserves for a runtime that was found and then misbehaved - a project carrying no puppet
 * runtime at all is the normal case and must not look like a fault.
 */
function placeholderKey(input: {
    configured: boolean;
    denied: boolean;
    status: string;
    reason: string | null;
}): TranslationKey | null {
    if (!input.configured) {
        return "widgets.puppet.placeholderUnconfigured";
    }
    if (input.denied) {
        return "widgets.puppet.placeholderBudget";
    }
    switch (input.status) {
        case "loading":
            return "widgets.puppet.placeholderLoading";
        case "error":
            return "widgets.puppet.placeholderError";
        case "missing-backend":
            return input.reason === "no-model"
                ? "widgets.puppet.placeholderNoModel"
                : "widgets.puppet.placeholderBackendMissing";
        case "ready":
            return null;
        default:
            // `unmounted` - off screen, or hidden. Deliberately silent: the box cannot be seen, and a
            // label there would only ever be read as an error by someone scrolling past.
            return null;
    }
}

/**
 * The "you supply the renderer" line, only where it is the actual answer.
 *
 * Not under Loading, not under the budget notice, and not under an error: there the author's problem
 * is something else and repeating the legal note would bury it.
 */
const RUNTIME_NOTE_KEYS: ReadonlySet<string> = new Set([
    "widgets.puppet.placeholderUnconfigured",
    "widgets.puppet.placeholderBackendMissing",
]);

export function PuppetRenderer(props: WidgetRendererProps): ReactElement {
    const { element, hostAdapter, instanceKey } = props;
    const { t } = useTranslation();
    const puppetProps = getPuppetProps(element);
    const [box, setBox] = useState<HTMLDivElement | null>(null);

    /**
     * `blueprintRuntime` is what tells the two hosts apart - the packaged game and Dev Mode install
     * one, the editor canvas never does. The same signal `video/renderer.tsx` and `slider/renderer.tsx`
     * use.
     */
    const isLiveHost = Boolean(hostAdapter.blueprintRuntime);

    const request = puppetWidgetRequest(puppetProps);
    const configured = request !== null;

    /**
     * One key per rendered instance, not per element: a `nl.list` item template renders the same
     * element once per row, and each row is its own model holding its own context.
     */
    const leaseKey = instanceKey ? `${element.id}#${instanceKey}` : element.id;
    const nearViewport = useNearViewport(box);
    const visible = element.layout.visible !== false;
    const wantsContext = configured && visible && nearViewport;
    const leased = useSurfacePuppetContextLease(leaseKey, wantsContext);
    const denied = wantsContext && !leased;

    const size = puppetWidgetSize(element);
    const stateKey = encodeStableJson(puppetWidgetState(puppetProps));
    /**
     * Keyed on the encoding rather than on the five fields, because the normalizer rebuilds `params`
     * and `slots` on every render - a reference dependency would re-`apply()` the pose on every
     * keystroke anywhere in the inspector. Safe against staleness by construction: the state is a pure
     * function of the key, so an object kept from an earlier render is an equal object.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value; see above
    const state = useMemo(() => puppetWidgetState(puppetProps), [stateKey]);

    const puppet = useSurfacePuppetSession({
        host: box,
        enabled: leased,
        request,
        state,
        size,
    });

    const key = placeholderKey({
        configured,
        denied,
        status: puppet.status,
        reason: puppet.reason,
    });

    /**
     * The placeholder is authoring furniture and never ships.
     *
     * A player must never read "choose a model bundle" - in a shipped game an unconfigured or
     * unresolvable puppet draws nothing at all, which is the engine's own degradation contract for a
     * stage puppet whose backend nobody answers to.
     */
    const showPlaceholder = !isLiveHost && key !== null;

    return (
        <RectangleChromeRenderer {...props}>
            <div
                ref={setBox}
                style={MOUNT_STYLE}
                data-ui-puppet="true"
                data-ui-puppet-status={puppet.status}
                data-ui-puppet-backend={puppetProps.backend}
            />
            {showPlaceholder ? (
                <div
                    className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center"
                    data-ui-puppet-placeholder="true"
                >
                    <span className="text-2xs leading-snug text-fg-subtle">
                        {t(key, {
                            backend: puppetProps.backend,
                            error: puppet.error ?? "",
                            limit: SURFACE_PUPPET_CONTEXT_BUDGET,
                        })}
                    </span>
                    {/* Repeated on the box, because "supply your own renderer" is the single thing an
                        author has to know about this widget and the inspector may not be open. */}
                    {RUNTIME_NOTE_KEYS.has(key) ? (
                        <span className="text-2xs leading-snug text-fg-subtle/70">
                            {t("widgets.puppet.placeholderRuntimeNote")}
                        </span>
                    ) : null}
                </div>
            ) : null}
        </RectangleChromeRenderer>
    );
}
