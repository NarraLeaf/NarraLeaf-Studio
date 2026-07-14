import { Texts } from "narraleaf-react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { useLiveTextStyles } from "@/lib/ui-editor/widget-modules/shared/text/useLiveTextStyles";
import { TextRenderer } from "../text/renderer";

function isLiveDialogRuntime(props: WidgetRendererProps): boolean {
    return props.hostAdapter.gameUiRuntime?.slotId === "dialog";
}

function LiveSentenceRenderer(props: WidgetRendererProps) {
    const { outerStyle, textStyle, textAppearanceProps } = useLiveTextStyles(props);
    return (
        <div style={outerStyle}>
            <Texts {...textAppearanceProps} style={textStyle} />
        </div>
    );
}

export function DialogSentenceRenderer(props: WidgetRendererProps) {
    if (!isLiveDialogRuntime(props)) {
        return <TextRenderer {...props} />;
    }
    return <LiveSentenceRenderer {...props} />;
}
