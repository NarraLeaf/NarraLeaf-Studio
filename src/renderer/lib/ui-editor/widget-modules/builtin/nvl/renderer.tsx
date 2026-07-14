import { Texts } from "narraleaf-react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { useLiveTextStyles } from "@/lib/ui-editor/widget-modules/shared/text/useLiveTextStyles";
import { useNvlSlotItems } from "@/lib/ui-editor/runtime/game/nvlSlotItemsContext";
import { TextRenderer } from "../text/renderer";

function isLiveNvlRuntime(props: WidgetRendererProps): boolean {
    return props.hostAdapter.gameUiRuntime?.slotId === "nvl";
}

function LiveNvlTextsRenderer(props: WidgetRendererProps) {
    const { outerStyle, textStyle, textAppearanceProps } = useLiveTextStyles(props);
    const proxies = useNvlSlotItems();
    const index = props.listItemScope?.index;
    const proxy = typeof index === "number" ? proxies?.[index] : undefined;
    if (!proxy) {
        return null;
    }
    return (
        <div style={outerStyle}>
            <Texts
                {...textAppearanceProps}
                style={textStyle}
                entry={proxy.entry}
                gameState={proxy.gameState}
                words={proxy.words}
                useTypeEffect={proxy.useTypeEffect}
                isActive={proxy.isActive}
            />
        </div>
    );
}

export function NvlTextsRenderer(props: WidgetRendererProps) {
    if (!isLiveNvlRuntime(props)) {
        return <TextRenderer {...props} />;
    }
    return <LiveNvlTextsRenderer {...props} />;
}
