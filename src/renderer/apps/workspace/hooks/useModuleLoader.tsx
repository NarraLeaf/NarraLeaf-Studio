import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../context";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import type { RecoveryService } from "@/lib/workspace/services/core/RecoveryService";
import { builtInPanels, builtInActions, builtInActionGroups } from "../modules";
import { PANELS_UNLOCKED_BY_PROBE, recoveryPanelModule } from "../modules/recovery";
import type { PanelModule } from "../modules/types";

/**
 * Panels that read nothing from the project, so a recovery window can always offer them.
 *
 * The plugins panel is here for a stronger reason than "it happens to be safe": a misbehaving
 * plugin is the leading suspect a recovery window exists to test, and switching one off used to
 * mean leaving for the Launcher. It loads nothing here - a recovery window runs no plugins - so it
 * only edits the records the next normal open will read.
 */
const RECOVERY_ALWAYS_ON = new Set([
  "narraleaf-studio:console",
  "narraleaf-studio:notifications",
  "narraleaf-studio:plugins"
]);

/**
 * Which panels this window may register.
 *
 * An ordinary workspace registers all of them, as it always has. A recovery window registers the
 * recovery panel plus those whose subsystem has actually loaded, and that gate is not cosmetic: a
 * panel reads its service on first render, so registering one whose service never initialized puts
 * a crash behind a rail icon.
 *
 * The set grows rather than being fixed. Every load check that passes brings its panels in (see
 * `PANELS_UNLOCKED_BY_PROBE`), which is what makes "browse the parts that are still fine" real
 * rather than a promise: the author gets the actual assets browser, story outline and cast.
 */
function useRegisterablePanels(recovery: boolean): PanelModule[] {
  const { context } = useWorkspace();
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(() => new Set<string>());

  useEffect(() => {
    if (!context || !recovery) {
      return;
    }
    const service = context.services.get<RecoveryService>(Services.Recovery);
    const read = () => {
      const ids = new Set<string>();
      for (const probe of service.getProbes()) {
        if (probe.status !== "ok") {
          continue;
        }
        for (const panelId of PANELS_UNLOCKED_BY_PROBE[probe.id] ?? []) {
          ids.add(panelId);
        }
      }
      // Replaced only when the set really changed. This fires on every probe transition,
      // including the `running` flicker, and handing back a new Set each time would
      // re-register every panel and reset the sidebar's selection under the author's cursor.
      setUnlocked((previous) =>
        previous.size === ids.size && [...ids].every((id) => previous.has(id)) ? previous : ids
      );
    };
    read();
    return service.onChanged(read);
  }, [context, recovery]);

  return useMemo(() => {
    if (!recovery) {
      return builtInPanels;
    }
    return [
      recoveryPanelModule,
      ...builtInPanels.filter(
        (panel) => RECOVERY_ALWAYS_ON.has(panel.metadata.id) || unlocked.has(panel.metadata.id)
      )
    ];
  }, [recovery, unlocked]);
}

/**
 * Hook to load all built-in modules
 * Registers panels, editors, and global actions through UIService
 * All state changes are managed by UIStore as single source of truth
 * Registry context provides convenient React-based access to the same state
 */
export function useModuleLoader() {
  const { context, recovery } = useWorkspace();
  const panels = useRegisterablePanels(recovery);

  // Register all panel modules
  useEffect(() => {
    if (!context) return;

    const uiService = context.services.get<UIService>(Services.UI);
    const store = uiService.getStore();
    const cleanup: (() => void)[] = [];

    // Register panels through UIStore (single source of truth)
    panels.forEach((panelModule) => {
      // Call onLoad if provided
      if (panelModule.onLoad) {
        panelModule.onLoad();
      }

      // Register the panel via UIStore
      store.registerPanel({
        id: panelModule.metadata.id,
        title: panelModule.metadata.title,
        titleKey: panelModule.metadata.titleKey,
        icon: panelModule.metadata.icon!,
        position: panelModule.metadata.position,
        component: panelModule.component as any,
        railAction: panelModule.railAction,
        defaultVisible: panelModule.metadata.defaultVisible,
        order: panelModule.metadata.order,
        payload: panelModule.metadata.payload
      });

      // Register panel's global actions via UIStore
      if (panelModule.actions) {
        panelModule.actions.forEach((action) => {
          store.registerAction({
            id: action.id,
            label: action.label,
            labelKey: action.labelKey,
            icon: action.icon,
            tooltip: action.tooltip,
            tooltipKey: action.tooltipKey,
            onClick: action.onClick,
            order: action.order,
            disabled: action.disabled,
            visible: action.visible,
            badge: action.badge,
            when: action.when,
            paletteCategoryKey: action.paletteCategoryKey
          });
        });
      }

      // Register panel's action groups via UIStore
      if (panelModule.actionGroups) {
        panelModule.actionGroups.forEach((group) => {
          store.registerActionGroup({
            id: group.id,
            label: group.label,
            labelKey: group.labelKey,
            icon: group.icon,
            actions: group.actions,
            order: group.order,
            menuSlot: group.menuSlot
          });
        });
      }

      // Register panel's keybindings via UIService
      if (panelModule.keybindings && panelModule.keybindings.length > 0) {
        const dispose = uiService.keybindings.registerMany(panelModule.keybindings);
        cleanup.push(dispose);
      }
    });

    // Register global actions via UIStore
    builtInActions.forEach((action) => {
      store.registerAction({
        id: action.id,
        label: action.label,
        labelKey: action.labelKey,
        icon: action.icon,
        tooltip: action.tooltip,
        tooltipKey: action.tooltipKey,
        onClick: action.onClick,
        order: action.order,
        disabled: action.disabled,
        visible: action.visible,
        badge: action.badge,
        paletteCategoryKey: action.paletteCategoryKey
      });
    });

    // Register global action groups via UIStore
    builtInActionGroups.forEach((group) => {
      store.registerActionGroup({
        id: group.id,
        label: group.label,
        labelKey: group.labelKey,
        icon: group.icon,
        actions: group.actions,
        order: group.order,
        menuSlot: group.menuSlot
      });
    });

    return () => {
      cleanup.forEach((fn) => fn());
      // Call onUnload for panels
      panels.forEach((panelModule) => {
        if (panelModule.onUnload) {
          panelModule.onUnload();
        }
      });
    };
  }, [context, panels]);
}
