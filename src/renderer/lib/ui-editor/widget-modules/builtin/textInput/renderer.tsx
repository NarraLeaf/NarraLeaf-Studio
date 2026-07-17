import {
    useCallback,
    useEffect,
    useRef,
    type CSSProperties,
    type ChangeEvent,
    type KeyboardEvent,
} from "react";
import { motion } from "motion/react";
import { effectShadowStoredToCss } from "@shared/types/ui-editor/effects";
import {
    clampTextInputValue,
    resolveTextInputRuntimeValue,
    type UITextInputMode,
} from "@shared/types/ui-editor/textInput";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import {
    useWidgetRuntimeElementKey,
    useWidgetRuntimeElementState,
    useWidgetRuntimeSnapshot,
    useWidgetRuntimeStateStore,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import {
    buttonResolvedVisualToRectangleLike,
    resolveButtonAppearanceTransitions,
    resolveButtonVisualProps,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import { RectangleChromeRenderer } from "@/lib/ui-editor/widget-modules/shared/chrome/RectangleChromeRenderer";
import { toRuntimeMotionTransition } from "@/lib/ui-editor/widget-modules/shared/appearance/appearanceMotion";
import { firstTransitionForKeys } from "@/lib/ui-editor/widget-modules/shared/appearance/runtimeMotionHelpers";
import { useEditorAppearanceInspectorVariant } from "@/lib/ui-editor/hooks/useEditorAppearanceInspectorVariant";
import { useEditorFontFamily } from "@/lib/workspace/hooks/useEditorFontFamily";
import { useLocalizedWidgetText } from "@/lib/ui-editor/runtime/localization/GameLocalizationContext";
import { BLUEPRINT_EVENTS_DISABLED_ATTR } from "@/lib/ui-editor/runtime/blueprintEventTargeting";
import type { UIListElementExtra } from "@shared/types/ui-editor/list";
import { getTextInputProps } from "./helpers";

/**
 * `number` constrains the accepted characters only; `type="number"` is deliberately not used because
 * its DOM value goes empty on partial input ("-", "1.") and it paints spinners over the chrome.
 * Partial input is kept typable: a lone "-" or a trailing "." survives until the next keystroke.
 */
function coerceInputModeText(mode: UITextInputMode, raw: string): string {
    if (mode !== "number") {
        return raw;
    }
    const stripped = raw.replace(/[^0-9.-]/g, "");
    const negative = stripped.startsWith("-");
    const body = stripped.replace(/-/g, "");
    const firstDot = body.indexOf(".");
    const singleDot =
        firstDot < 0 ? body : body.slice(0, firstDot + 1) + body.slice(firstDot + 1).replace(/\./g, "");
    return negative ? `-${singleDot}` : singleDot;
}

export function TextInputRenderer(props: WidgetRendererProps) {
    const { element, hostAdapter, useAppearanceInspectorPreview } = props;
    const flushFrameRef = useRef<number | null>(null);
    const valueChangedFrameRef = useRef<number | null>(null);
    const valueChangedInFlightRef = useRef(false);
    const valueChangedPendingRef = useRef<{ value: string; previousValue: string } | null>(null);
    const runtimeStore = useWidgetRuntimeStateStore();
    const runtimeElementKey = useWidgetRuntimeElementKey(element.id);
    const snapshot = useWidgetRuntimeSnapshot();
    void snapshot;

    const p = getTextInputProps(element);
    // The player's text lives in the runtime store for the session; `props.value` is only the value
    // the author set as a starting point and is never written back to the document.
    const value = (runtimeStore?.getTextInputProperties(runtimeElementKey) ?? resolveTextInputRuntimeValue(p)).value;
    const valueRef = useRef(value);
    useEffect(() => {
        valueRef.current = value;
    }, [value]);

    const interactionDisabled = Boolean(p.disabled || p.interactionDisabled);
    const inspectorVariantId = useEditorAppearanceInspectorVariant(element.id, useAppearanceInspectorPreview === true);
    const runtimeState = useWidgetRuntimeElementState(element.id, interactionDisabled);
    const listScopedVariantId =
        typeof (element.extra as UIListElementExtra | undefined)?.runtimeVariantOverrideId === "string"
            ? (element.extra as UIListElementExtra).runtimeVariantOverrideId
            : null;
    const resolveCtx = {
        variantOverrideId: listScopedVariantId ?? runtimeState.variantOverrideId ?? inspectorVariantId ?? null,
        signals: runtimeState.signals,
    };
    const v = resolveButtonVisualProps(element, p.appearance ?? undefined, resolveCtx);
    const appearanceTransitions = resolveButtonAppearanceTransitions(p.appearance ?? undefined, resolveCtx);
    const rl = buttonResolvedVisualToRectangleLike(v);

    const blueprintRuntime = hostAdapter.blueprintRuntime;
    // The editor canvas mounts a runtime store too — `blueprintRuntime` is the editor-vs-game
    // discriminator. On the canvas the author drags and selects the field; they never type into it.
    const canRunInteraction = Boolean(blueprintRuntime && runtimeStore);

    useEffect(() => () => {
        if (flushFrameRef.current !== null) {
            window.cancelAnimationFrame(flushFrameRef.current);
            flushFrameRef.current = null;
        }
        if (valueChangedFrameRef.current !== null) {
            window.cancelAnimationFrame(valueChangedFrameRef.current);
            valueChangedFrameRef.current = null;
        }
    }, []);

    const scheduleTextInputFlush = useCallback(() => {
        if (!blueprintRuntime) {
            return;
        }
        if (flushFrameRef.current !== null) {
            return;
        }
        flushFrameRef.current = window.requestAnimationFrame(() => {
            flushFrameRef.current = null;
            void blueprintRuntime.dispatchElementBlueprintEvent(element.id, "flush", {
                element: {
                    surfaceId: blueprintRuntime.surfaceId,
                    elementId: element.id,
                    elementType: element.type,
                },
            });
        });
    }, [blueprintRuntime, element.id, element.type]);

    const dispatchCoalescedValueChanged = useCallback(() => {
        if (!blueprintRuntime) {
            valueChangedPendingRef.current = null;
            return;
        }
        if (valueChangedInFlightRef.current) {
            return;
        }
        const payload = valueChangedPendingRef.current;
        if (!payload) {
            return;
        }
        valueChangedPendingRef.current = null;
        valueChangedInFlightRef.current = true;
        void blueprintRuntime.dispatchElementBlueprintEvent(element.id, "valueChanged", payload).finally(() => {
            valueChangedInFlightRef.current = false;
            if (valueChangedPendingRef.current) {
                scheduleValueChanged();
            }
        });
    }, [blueprintRuntime, element.id]);

    const scheduleValueChanged = useCallback(() => {
        if (!blueprintRuntime) {
            valueChangedPendingRef.current = null;
            return;
        }
        if (valueChangedFrameRef.current !== null) {
            return;
        }
        valueChangedFrameRef.current = window.requestAnimationFrame(() => {
            valueChangedFrameRef.current = null;
            dispatchCoalescedValueChanged();
        });
    }, [blueprintRuntime, dispatchCoalescedValueChanged]);

    /** Coalesce a keystroke burst into one event, but keep the burst's original previous value. */
    const queueValueChanged = useCallback((nextValue: string, previousValue: string) => {
        const pending = valueChangedPendingRef.current;
        valueChangedPendingRef.current = {
            value: nextValue,
            previousValue: pending?.previousValue ?? previousValue,
        };
        scheduleValueChanged();
    }, [scheduleValueChanged]);

    const setRuntimeValue = useCallback(
        (nextValue: string, dispatchChange: boolean): string => {
            if (!runtimeStore) {
                return valueRef.current;
            }
            const previousValue = valueRef.current;
            const current = runtimeStore.setTextInputProperties(runtimeElementKey, p, { value: nextValue }).value;
            valueRef.current = current;
            if (current !== previousValue) {
                scheduleTextInputFlush();
                if (dispatchChange) {
                    queueValueChanged(current, previousValue);
                }
            }
            return current;
        },
        [p, queueValueChanged, runtimeElementKey, runtimeStore, scheduleTextInputFlush],
    );

    const handleChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>) => {
            if (!canRunInteraction) {
                return;
            }
            const next = clampTextInputValue(coerceInputModeText(p.inputMode, event.target.value), p.maxLength);
            const applied = setRuntimeValue(next, true);
            // A controlled input only re-renders when the store value actually moved, so a rejected
            // keystroke (max length reached, illegal character) would otherwise stay in the DOM.
            if (event.target.value !== applied) {
                event.target.value = applied;
            }
        },
        [canRunInteraction, p.inputMode, p.maxLength, setRuntimeValue],
    );

    const handleKeyDown = useCallback(
        (event: KeyboardEvent<HTMLInputElement>) => {
            if (!canRunInteraction || !blueprintRuntime || event.key !== "Enter") {
                return;
            }
            // No stopPropagation: the widget's own `keyDown` event is dispatched from a window
            // listener and must keep firing for authors who wired it alongside Submit.
            event.preventDefault();
            void blueprintRuntime.dispatchElementBlueprintEvent(element.id, "submit", {
                value: valueRef.current,
            });
        },
        [blueprintRuntime, canRunInteraction, element.id],
    );

    const displayPlaceholder = useLocalizedWidgetText({
        elementId: element.id,
        prop: "placeholder",
        sourceText: p.placeholder,
        localizationKey: p.placeholderLocalizationKey ?? undefined,
    });

    const { cssFamily: editorFontFamily } = useEditorFontFamily(p.fontAssetId);
    const textShadow = effectShadowStoredToCss(v.effects.effectTextShadow, "outer");
    const resolvedCursor =
        interactionDisabled
            ? "not-allowed"
            : v.cursor !== "auto"
              ? v.cursor
              : canRunInteraction
                ? "text"
                : "default";

    const paddedShell: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        minHeight: 0,
        minWidth: 0,
    };
    const innerAnimate = {
        paddingTop: v.paddingY,
        paddingBottom: v.paddingY,
        paddingLeft: v.paddingX,
        paddingRight: v.paddingX,
    };
    const paddingTransition = firstTransitionForKeys(appearanceTransitions, ["paddingX", "paddingY"]);
    const innerTransition =
        paddingTransition != null
            ? {
                  paddingTop: toRuntimeMotionTransition(paddingTransition),
                  paddingBottom: toRuntimeMotionTransition(paddingTransition),
                  paddingLeft: toRuntimeMotionTransition(paddingTransition),
                  paddingRight: toRuntimeMotionTransition(paddingTransition),
              }
            : undefined;
    const paddingMotionActive = innerTransition != null;

    const inputStyle: CSSProperties = {
        flex: 1,
        width: "100%",
        minWidth: 0,
        margin: 0,
        padding: 0,
        border: "none",
        outline: "none",
        background: "transparent",
        boxSizing: "border-box",
        fontSize: p.fontSize,
        fontWeight: p.fontWeight,
        color: p.color,
        textAlign: p.textAlign,
        lineHeight: p.lineHeight,
        cursor: "inherit",
        fontFamily: editorFontFamily ?? "inherit",
        ...(textShadow ? { textShadow } : {}),
        // Design time: the field must not eat the pointer, or the author cannot select or drag it.
        ...(canRunInteraction ? {} : { pointerEvents: "none", userSelect: "none" }),
    };

    const inputNode = (
        <input
            data-ui-text-input="true"
            type={p.inputMode === "password" ? "password" : "text"}
            inputMode={p.inputMode === "number" ? "numeric" : "text"}
            value={value}
            placeholder={displayPlaceholder}
            // Max length is measured in code points ("👍" counts once), which the DOM attribute
            // cannot express — `clampTextInputValue` owns the limit instead.
            readOnly={!canRunInteraction || p.readOnly}
            disabled={p.disabled}
            tabIndex={canRunInteraction ? undefined : -1}
            aria-hidden={canRunInteraction ? undefined : true}
            autoComplete="off"
            spellCheck={false}
            draggable={false}
            style={inputStyle}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
        />
    );

    const blueprintEventRootProps = {
        [BLUEPRINT_EVENTS_DISABLED_ATTR]: interactionDisabled ? "true" : undefined,
    } as Record<string, string | undefined>;

    return (
        <RectangleChromeRenderer
            {...props}
            rectangleLike={rl}
            clipContent={v.clipContent}
            appearanceTransitions={appearanceTransitions}
            rootOpacityFactor={interactionDisabled ? 0.45 : 1}
            extraRootStyle={{
                position: "absolute",
                inset: 0,
                cursor: resolvedCursor,
            }}
            extraRootProps={blueprintEventRootProps}
        >
            {paddingMotionActive ? (
                <motion.div style={paddedShell} animate={innerAnimate} transition={innerTransition}>
                    {inputNode}
                </motion.div>
            ) : (
                <div
                    style={{
                        ...paddedShell,
                        paddingTop: v.paddingY,
                        paddingBottom: v.paddingY,
                        paddingLeft: v.paddingX,
                        paddingRight: v.paddingX,
                    }}
                >
                    {inputNode}
                </div>
            )}
        </RectangleChromeRenderer>
    );
}
