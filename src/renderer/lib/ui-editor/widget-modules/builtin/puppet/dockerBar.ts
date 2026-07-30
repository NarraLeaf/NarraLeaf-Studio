import { translate } from "@/lib/i18n";
import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import { createRectangleDockerBarItems } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleDockerBar";
import { getPuppetProps, patchPuppetProps } from "./helpers";

/**
 * A "clear the pose" button, then the shared chrome items (radius / border).
 *
 * Neither the model nor the backend is here. `DockerBarItem` has only `button | select | number |
 * separator` - no popup-capable kind - and `DockerBarContext` carries neither an assets service nor
 * the project, so a bundle picker and a "which runtimes are installed" list cannot be expressed as
 * docker items at all. Both live in the inspector, exactly as `nl.image` and `nl.video` put their
 * assets there.
 *
 * Resetting the pose *is* expressible, and is the one puppet action worth a single click: it is how an
 * author gets back to the model's rest pose after trying motions, and typing three empty strings into
 * the inspector to do it is the kind of chore a docker bar exists to remove.
 */
export function createPuppetDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
    const { element, documentService } = ctx;
    const props = getPuppetProps(element);
    const posed = props.motion !== null
        || props.expression !== null
        || props.skin !== null
        || Object.keys(props.params).length > 0
        || Object.keys(props.slots).length > 0;

    return [
        {
            kind: "button",
            id: "docker-puppet-clear-state",
            label: translate("widgets.puppet.clearState"),
            tooltip: translate("widgets.puppet.clearStateHint"),
            disabled: !posed,
            onClick: () => {
                const live = documentService.getDocument().elements[element.id] ?? element;
                // The whole state, because the engine's is applied whole: `null` clears rather than
                // "leave as-is", and dropping `params` / `slots` here is what "cleared" means for them.
                documentService.updateElementProps(live.id, patchPuppetProps(live, {
                    motion: null,
                    expression: null,
                    skin: null,
                    params: {},
                    slots: {},
                }));
            },
        },
        {
            kind: "separator",
            id: "docker-puppet-sep-state",
        },
        ...createRectangleDockerBarItems(ctx),
    ];
}
