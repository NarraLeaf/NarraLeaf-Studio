import type { ContextMenuItemDef } from "@/lib/components/elements/ContextMenu";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { translate } from "@/lib/i18n";

/**
 * The Insert submenu, shared by the canvas menu and both outline menus.
 *
 * One builder rather than three copies because of the row that is not Studio's: a widget a plugin
 * contributed says which plugin it came from, and three lists would have said it in two places and
 * forgotten the third. A menu row has no second column, so the attribution is the row's hover text
 * - the same place a disabled row states its reason.
 */
export function buildInsertWidgetSubmenu(
    widgetModules: readonly UIWidgetModule[],
    idPrefix: string,
    onInsert: (type: string) => void,
): ContextMenuItemDef[] {
    return widgetModules.map(mod => {
        const ownerPluginName = widgetModuleRegistry.getOwnerName(mod.type);
        return {
            id: `${idPrefix}${mod.type}`,
            label: mod.displayName,
            tooltip: ownerPluginName
                ? translate("widgetChrome.docker.fromPlugin", { plugin: ownerPluginName })
                : undefined,
            onClick: () => onInsert(mod.type),
        };
    });
}
