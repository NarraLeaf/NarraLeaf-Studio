import {
    Children,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type FocusEvent,
    type FormEvent,
    type KeyboardEvent,
} from "react";
import { motion } from "motion/react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { colorValueToCss } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { useEditorFontFamily } from "@/lib/workspace/hooks/useEditorFontFamily";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import {
    lineWrapCss,
    textVerticalAlignToJustifyContent,
} from "@/lib/ui-editor/widget-modules/shared/text/textLayoutCss";
import {
    buttonResolvedVisualToRectangleLike,
    resolveButtonAppearanceTransitions,
    resolveButtonVisualProps,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import {
    useWidgetRuntimeElementState,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { useEditorAppearanceInspectorVariant } from "@/lib/ui-editor/hooks/useEditorAppearanceInspectorVariant";
import { toRuntimeMotionTransition } from "@/lib/ui-editor/widget-modules/shared/appearance/appearanceMotion";
import { firstTransitionForKeys } from "@/lib/ui-editor/widget-modules/shared/appearance/runtimeMotionHelpers";
import { RectangleChromeRenderer } from "@/lib/ui-editor/widget-modules/shared/chrome/RectangleChromeRenderer";
import { getButtonProps } from "./helpers";
import type { UIListElementExtra } from "@shared/types/ui-editor/list";

export function ButtonRenderer(props: WidgetRendererProps) {
    const { element, children, surface, hostAdapter, useAppearanceInspectorPreview } = props;
    const stateService = UIEditorStateService.getInstance();
    const documentService = UIDocumentService.getInstance();
    const [interactionOverride, setInteractionOverride] = useState(() => stateService.getInteractionOverride());
    const draftRef = useRef("");
    const skipBlurCommitRef = useRef(false);

    useEffect(() => {
        return stateService.on("interactionOverrideChanged", payload => {
            const { previous, next } = payload;
            setInteractionOverride(next);

            const wasHere =
                previous?.kind === "textEdit" &&
                previous.surfaceId === surface.id &&
                previous.elementId === element.id;
            const isHere =
                next?.kind === "textEdit" &&
                next.surfaceId === surface.id &&
                next.elementId === element.id;

            if (isHere && !wasHere) {
                const docEl = documentService.getDocument().elements[element.id];
                draftRef.current = docEl ? getButtonProps(docEl).label : "";
            }

            if (wasHere && !isHere) {
                if (skipBlurCommitRef.current) {
                    skipBlurCommitRef.current = false;
                } else {
                    const docEl = documentService.getDocument().elements[element.id];
                    if (docEl) {
                        documentService.updateElementProps(element.id, {
                            ...docEl.props,
                            label: draftRef.current,
                        });
                    }
                }
            }
        });
    }, [stateService, documentService, element.id, surface.id]);

    const isEditing =
        interactionOverride?.kind === "textEdit" &&
        interactionOverride.surfaceId === surface.id &&
        interactionOverride.elementId === element.id;

    useLayoutEffect(() => {
        if (!isEditing) {
            return;
        }
        const docEl = documentService.getDocument().elements[element.id];
        draftRef.current = docEl ? getButtonProps(docEl).label : "";
    }, [isEditing, documentService, element.id]);

    const inspectorVariantId = useEditorAppearanceInspectorVariant(element.id, useAppearanceInspectorPreview === true);
    const p = getButtonProps(element);
    const interactionDisabled = Boolean(p.interactionDisabled);
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
    const rt = hostAdapter.blueprintRuntime;
    const canDispatchClick = Boolean(rt && !interactionDisabled);
    const dispatchClick =
        canDispatchClick && !isEditing
            ? () => {
                  void rt!.dispatchElementBlueprintEvent(element.id, "click");
              }
            : undefined;

    /** Padded shell: stretch children so label column can fill width/height. */
    const paddedShell: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        minHeight: 0,
    };

    const legacyChildrenCenter: CSSProperties = {
        flex: 1,
        minHeight: 0,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
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

    const onKeyDown = dispatchClick
        ? (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  dispatchClick();
              }
          }
        : undefined;

    const showLabel = p.label.trim().length > 0;
    const hasChildNodes = children != null && Children.count(children) > 0;

    const color = colorValueToCss({ hex: p.color, alpha: 1 });
    const { cssFamily: editorFontFamily } = useEditorFontFamily(p.fontAssetId);
    const labelTypography: CSSProperties = {
        margin: 0,
        width: "100%",
        boxSizing: "border-box",
        fontSize: p.fontSize,
        fontWeight: p.fontWeight,
        color,
        textAlign: p.textAlign,
        lineHeight: p.lineHeight,
        ...lineWrapCss(p.textWrapMode),
        overflow: "hidden",
        ...(editorFontFamily ? { fontFamily: editorFontFamily } : {}),
    };

    const labelColumnStyle: CSSProperties = {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: textVerticalAlignToJustifyContent(p.textVerticalAlign),
        alignItems: "stretch",
    };

    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const commitLabelAndClose = useCallback(
        (nextLabel: string) => {
            documentService.updateElementProps(element.id, {
                ...element.props,
                label: nextLabel,
            });
            stateService.setInteractionOverride(null);
        },
        [documentService, element.id, element.props, stateService],
    );

    useEffect(() => {
        if (!isEditing) {
            return;
        }
        const el = textareaRef.current;
        if (!el) {
            return;
        }
        el.focus();
        el.select();
    }, [isEditing]);

    const handleTextareaInput = useCallback((e: FormEvent<HTMLTextAreaElement>) => {
        draftRef.current = e.currentTarget.value;
    }, []);

    const handleTextareaKeyDown = useCallback(
        (e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === "Escape") {
                e.preventDefault();
                skipBlurCommitRef.current = true;
                stateService.setInteractionOverride(null);
            }
        },
        [stateService],
    );

    const handleTextareaBlur = useCallback(
        (e: FocusEvent<HTMLTextAreaElement>) => {
            if (skipBlurCommitRef.current) {
                skipBlurCommitRef.current = false;
                return;
            }
            commitLabelAndClose(e.target.value);
        },
        [commitLabelAndClose],
    );

    const labelBlock =
        showLabel || isEditing ? (
            <div style={labelColumnStyle}>
                {isEditing ? (
                    <textarea
                        ref={textareaRef}
                        defaultValue={p.label}
                        style={{
                            ...labelTypography,
                            flex: 1,
                            minHeight: 0,
                            resize: "none",
                            background: "transparent",
                            border: "none",
                            outline: "none",
                            ...(p.textWrapMode === "nowrap" ? { overflowX: "auto", overflowY: "hidden" } : {}),
                            ...(!editorFontFamily ? { fontFamily: "inherit" } : {}),
                        }}
                        onInput={handleTextareaInput}
                        onBlur={handleTextareaBlur}
                        onKeyDown={handleTextareaKeyDown}
                        onClick={e => e.stopPropagation()}
                        onMouseDown={e => e.stopPropagation()}
                    />
                ) : (
                    <p style={{ ...labelTypography, flexShrink: 0 }}>{p.label}</p>
                )}
            </div>
        ) : null;

    const innerContent =
        showLabel || isEditing ? (
            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                }}
            >
                {labelBlock}
                {hasChildNodes ? (
                    <div style={{ flexShrink: 0, minWidth: 0, display: "flex", justifyContent: "center", width: "100%" }}>
                        {children}
                    </div>
                ) : null}
            </div>
        ) : (
            <div style={legacyChildrenCenter}>{children}</div>
        );

    return (
        <RectangleChromeRenderer
            {...props}
            rectangleLike={rl}
            clipContent={v.clipContent}
            appearanceTransitions={appearanceTransitions}
            rootOpacityFactor={interactionDisabled ? 0.45 : 1}
            extraRootStyle={{
                cursor: canDispatchClick ? "pointer" : interactionDisabled ? "not-allowed" : "default",
            }}
            extraRootProps={{
                role: canDispatchClick ? ("button" as const) : ("presentation" as const),
                tabIndex: canDispatchClick ? 0 : undefined,
                onKeyDown,
            }}
        >
            {paddingMotionActive ? (
                <motion.div style={paddedShell} animate={innerAnimate} transition={innerTransition}>
                    {innerContent}
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
                    {innerContent}
                </div>
            )}
        </RectangleChromeRenderer>
    );
}
