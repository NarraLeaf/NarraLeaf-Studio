import type { Workspace } from "@/lib/workspace/workspace";
import { translate } from "@/lib/i18n";
import { Service } from "../Service";
import { Services, WorkspaceContext } from "../services";
import { UIService } from "../core/UIService";
import {
    collectPaletteCommands,
    type CommandRegistration,
    type PaletteCommand,
} from "@/apps/workspace/components/layout/commandPaletteModel";

/**
 * Command Service
 *
 * The workspace's command registry and aggregator — the single place that answers "what can the
 * user do right now?" for the command palette. Modeled on {@link KeybindingService}: a `Map` of
 * registrations with `register`/`unregister`/`getAll` and a disposer-returning API.
 *
 * Most palette entries are *not* registered here. {@link collect} converges three sources into one
 * runnable list (see {@link collectPaletteCommands}):
 *  - toolbar actions and their menu groups (the same set mirrored to the native menu bar), and
 *  - keybindings that carry a user-facing description,
 * plus any commands registered directly on this service (the escape hatch for commands that have
 * neither an action nor a shortcut).
 *
 * Registered as a top-level service so `services.get(Services.Command)` reaches it from anywhere.
 */
export class CommandService extends Service<CommandService> {
    private commands: Map<string, CommandRegistration> = new Map();

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        // collect() reads the UI service's actions, keybindings, and focus, so it must be up first.
        const uiService = ctx.services.get<UIService>(Services.UI);
        await depend([uiService]);
    }

    /**
     * Register a command. Returns a disposer that unregisters it — mirrors the keybinding API so
     * the two can be registered side by side from the same hook.
     */
    public register(command: CommandRegistration): () => void {
        this.commands.set(command.id, command);
        return () => this.unregister(command.id);
    }

    /** Register several commands at once; the returned disposer unregisters all of them. */
    public registerMany(commands: CommandRegistration[]): () => void {
        const disposers = commands.map(command => this.register(command));
        return () => {
            for (const dispose of disposers) {
                dispose();
            }
        };
    }

    public unregister(id: string): void {
        this.commands.delete(id);
    }

    /** All directly-registered commands (not the derived action/keybinding entries). */
    public getRegistered(): CommandRegistration[] {
        return Array.from(this.commands.values());
    }

    public clear(): void {
        this.commands.clear();
    }

    /**
     * Build the full, de-duplicated palette list for the current moment: registered commands plus
     * the actions, menu groups, and keybindings currently live on the UI service, filtered to the
     * present focus. `workspace` is passed in because it is created in the React layer and is what
     * action `onClick` callbacks receive.
     */
    public collect(workspace: Workspace): PaletteCommand[] {
        const uiService = this.getContext().services.get<UIService>(Services.UI);
        const store = uiService.getStore();

        return collectPaletteCommands({
            registered: this.getRegistered(),
            actions: store.getActions(),
            actionGroups: store.getActionGroups(),
            keybindings: uiService.keybindings.getAll(),
            panels: store.getPanels(),
            openBodyPanel: panelId => store.setPanelVisibility(panelId, true),
            panelCategory: translate("workspace.shell.commandPalette.categoryView"),
            workspace,
            focusContext: uiService.focus.getFocus(),
            translate,
        });
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.commands.clear();
    }
}
