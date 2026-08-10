import { ToggleLeft, ToggleRight } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import { getSwitchProps, patchSwitchProps } from "./helpers";

/**
 * One button, and it edits the document.
 *
 * `props.checked` is the *authored* starting state - the one the canvas draws and the one a fresh
 * session starts from. It is not what the player flipped: that lives in `WidgetRuntimeStateStore`
 * and is never written back here. So this button is how an author checks their `on` looks without
 * leaving the canvas, and the label says "by default" for exactly that reason.
 */
export function createSwitchDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
    const { element, documentService } = ctx;
    const props = getSwitchProps(element);

    return [
        {
            kind: "button",
            id: "docker-switch-default-checked",
            icon: props.checked ? ToggleRight : ToggleLeft,
            tooltip: translate("widgets.switch.defaultCheckedHint"),
            active: props.checked,
            onClick: () => {
                const live = documentService.getDocument().elements[element.id] ?? element;
                documentService.updateElementProps(
                    live.id,
                    patchSwitchProps(live, { checked: !getSwitchProps(live).checked }),
                );
            },
        },
    ];
}
