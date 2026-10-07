/**
 * The keyboard help React Flow gives a screen reader, in the interface language.
 *
 * Every graph canvas renders the library's own sentences beside it ("Press enter or space to select a
 * node…") and points its nodes and wires at them, and announces a node moved with the arrow keys -
 * in English, whatever language Studio speaks, unless the canvas is handed these. One hook so the
 * blueprint editor, its thumbnails and the scene flow say the same thing.
 *
 * Comments in English per project convention.
 */

import { useMemo } from "react";
import type { AriaLabelConfig } from "@xyflow/react";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";

const DIRECTION_KEYS: Readonly<Record<string, TranslationKey>> = {
    up: "common.flowCanvas.up",
    down: "common.flowCanvas.down",
    left: "common.flowCanvas.left",
    right: "common.flowCanvas.right",
};

/** Pass as `<ReactFlow ariaLabelConfig>`. Stable while the language is. */
export function useFlowAriaLabels(): Partial<AriaLabelConfig> {
    const { t } = useTranslation();
    return useMemo(
        () => ({
            "node.a11yDescription.default": t("common.flowCanvas.nodeHelp"),
            "node.a11yDescription.keyboardDisabled": t("common.flowCanvas.movableNodeHelp"),
            "edge.a11yDescription.default": t("common.flowCanvas.wireHelp"),
            "node.a11yDescription.ariaLiveMessage": ({ direction, x, y }: { direction: string; x: number; y: number }) =>
                t("common.flowCanvas.nodeMoved", {
                    direction: DIRECTION_KEYS[direction] ? t(DIRECTION_KEYS[direction]) : direction,
                    x,
                    y,
                }),
        }),
        [t],
    );
}
