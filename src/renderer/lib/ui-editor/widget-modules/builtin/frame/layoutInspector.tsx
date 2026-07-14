import { Maximize2 } from "lucide-react";
import type {
    FieldDefinition,
    InlineRowFieldDefinition,
    InlineRowItemContext,
} from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import type {
    LayoutSizeFieldContext,
    UIInspectorData,
} from "@/lib/ui-editor/widget-modules/types";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIAppSurface, UIElement } from "@shared/types/ui-editor/document";
import { i18nStore } from "@/lib/i18n";
import { getFrameProps } from "./helpers";

type ReadDocumentService = Pick<UIDocumentService, "getDocument">;
type WriteDocumentService = Pick<UIDocumentService, "getDocument" | "updateElementLayout">;

function roundLayoutNumber(value: number): number {
    return Math.round(value * 100) / 100;
}

export function resolveFrameTargetPage(input: {
    element: Pick<UIElement, "props">;
    documentService: ReadDocumentService;
}): UIAppSurface | null {
    const targetSurfaceId = getFrameProps(input.element).targetSurfaceId;
    if (!targetSurfaceId) {
        return null;
    }
    const target = input.documentService
        .getDocument()
        .surfaces.find(surface => surface.id === targetSurfaceId);
    return target?.kind === "appSurface" ? target : null;
}

export function getFrameScalePercent(input: {
    element: UIElement;
    documentService: ReadDocumentService;
}): number | null {
    const target = resolveFrameTargetPage(input);
    const targetWidth = target?.designSize.width ?? 0;
    if (!target || !Number.isFinite(targetWidth) || targetWidth <= 0) {
        return null;
    }
    const width = Math.abs(input.element.layout.width);
    if (!Number.isFinite(width)) {
        return null;
    }
    return roundLayoutNumber((width / targetWidth) * 100);
}

export function applyFrameScalePercent(input: {
    element: UIElement;
    documentService: WriteDocumentService;
    percent: number;
}): void {
    const target = resolveFrameTargetPage(input);
    if (!target || !Number.isFinite(input.percent)) {
        return;
    }
    const scale = Math.max(0, input.percent) / 100;
    input.documentService.updateElementLayout(input.element.id, {
        width: roundLayoutNumber(target.designSize.width * scale),
        height: roundLayoutNumber(target.designSize.height * scale),
        lockAspectRatio: true,
    });
}

export function createFrameLayoutSizeField(
    _context: LayoutSizeFieldContext,
): FieldDefinition<UIInspectorData> {
    const { t } = i18nStore.getTranslator();
    const field: InlineRowFieldDefinition<UIInspectorData> = {
        id: "layout.frameScale",
        type: "inlineRow",
        label: t("widgets.frame.scale"),
        gap: 8,
        wrap: false,
        items: [
            {
                id: "layout.frameScaleValue",
                className: "min-w-0 flex-1 basis-0",
                render: ({ data, onSaving }: InlineRowItemContext<UIInspectorData>) => {
                    const scale = getFrameScalePercent({
                        element: data.element,
                        documentService: data.documentService,
                    });
                    const targetSurfaceId = getFrameProps(data.element).targetSurfaceId ?? "none";
                    const disabled = scale === null;

                    return (
                        <NumericDraftEnhancedInput
                            committedDisplay={scale === null ? "" : String(scale)}
                            draftResetKey={`${data.element.id}:frame-scale:${targetSurfaceId}`}
                            onFiniteNumber={value => {
                                onSaving(true);
                                try {
                                    applyFrameScalePercent({
                                        element: data.element,
                                        documentService: data.documentService,
                                        percent: value,
                                    });
                                } finally {
                                    onSaving(false);
                                }
                            }}
                            inputMode="numeric"
                            type="number"
                            min={0}
                            precision={2}
                            unit="%"
                            leftIcon={<Maximize2 className="w-4 h-4 text-fg-muted" />}
                            className="w-full min-w-0"
                            disabled={disabled}
                            placeholder={t("widgets.frame.selectPage")}
                            selectAllOnFocus
                            aria-label={t("widgets.frame.scale")}
                        />
                    );
                },
            },
        ],
        order: 1,
    };
    return field;
}
