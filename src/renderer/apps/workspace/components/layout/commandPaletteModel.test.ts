import { describe, expect, it, vi } from "vitest";
import { collectPaletteCommands, type PaletteCommandSources } from "./commandPaletteModel";
import type { ActionDefinition, ActionGroup, PanelDefinition } from "../../registry/types";
import { PanelPosition } from "../../registry/types";
import type { FocusContext, Keybinding } from "@/lib/workspace/services/ui/types";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import type { Workspace } from "@/lib/workspace/workspace";

const context = { project: {}, services: {} };
const workspace = { getContext: () => context } as unknown as Workspace;
// Identity translate: keys are returned verbatim so assertions read clearly.
const translate = ((key: string) => key) as PaletteCommandSources["translate"];

function action(overrides: Partial<ActionDefinition> & { id: string }): ActionDefinition {
    return { onClick: () => {}, ...overrides };
}

function keybinding(overrides: Partial<Keybinding> & { id: string; key: string }): Keybinding {
    return { handler: () => {}, ...overrides };
}

const NoopPanel = () => null;

function panel(overrides: Partial<PanelDefinition> & { id: string }): PanelDefinition {
    return { title: overrides.id, icon: null, position: PanelPosition.Left, component: NoopPanel, ...overrides };
}

function build(partial: Partial<PaletteCommandSources>): PaletteCommandSources {
    return {
        registered: [],
        actions: [],
        actionGroups: [],
        keybindings: [],
        panels: [],
        openBodyPanel: () => {},
        panelCategory: "View",
        workspace,
        focusContext: { area: FocusArea.None },
        translate,
        ...partial,
    };
}

describe("collectPaletteCommands", () => {
    it("derives a command from a standalone action, carrying its shortcut", () => {
        const commands = collectPaletteCommands(
            build({ actions: [action({ id: "save", label: "Save", shortcut: "mod+s" })] }),
        );
        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({ id: "save", title: "Save", keybinding: "mod+s", source: "action" });
    });

    it("runs the action's onClick with the workspace", () => {
        const onClick = vi.fn();
        const commands = collectPaletteCommands(
            build({ actions: [action({ id: "save", label: "Save", onClick })] }),
        );
        commands[0]?.run();
        expect(onClick).toHaveBeenCalledWith(workspace);
    });

    it("uses the group label as the category for grouped actions", () => {
        const group: ActionGroup = {
            id: "edit",
            label: "Edit",
            items: [action({ id: "undo", label: "Undo" }), action({ id: "redo", label: "Redo" })],
        };
        const commands = collectPaletteCommands(build({ actionGroups: [group] }));
        expect(commands.map(c => [c.title, c.category])).toEqual([
            ["Undo", "Edit"],
            ["Redo", "Edit"],
        ]);
    });

    it("flattens submenu items under the top-level group category", () => {
        const group: ActionGroup = {
            id: "view",
            label: "View",
            items: [
                {
                    id: "appearance",
                    label: "Appearance",
                    items: [action({ id: "zoom-in", label: "Zoom In" })],
                },
            ],
        };
        const commands = collectPaletteCommands(build({ actionGroups: [group] }));
        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({ id: "zoom-in", title: "Zoom In", category: "View" });
    });

    it("resolves labelKey via translate", () => {
        const commands = collectPaletteCommands(
            build({ actions: [action({ id: "settings", labelKey: "workspace.shell.openSettings" as never })] }),
        );
        expect(commands[0]?.title).toBe("workspace.shell.openSettings");
    });

    it("skips disabled actions", () => {
        const commands = collectPaletteCommands(
            build({ actions: [action({ id: "save", label: "Save", disabled: true })] }),
        );
        expect(commands).toHaveLength(0);
    });

    it("skips actions whose `when` fails for the current focus", () => {
        const commands = collectPaletteCommands(
            build({
                actions: [action({ id: "x", label: "X", when: ctx => ctx.area === FocusArea.Editor })],
                focusContext: { area: FocusArea.None },
            }),
        );
        expect(commands).toHaveLength(0);
    });

    it("falls back to the tooltip when an icon-only action has no label", () => {
        const commands = collectPaletteCommands(
            build({ actions: [action({ id: "devmode", tooltip: "Dev Mode" })] }),
        );
        expect(commands[0]).toMatchObject({ id: "devmode", title: "Dev Mode", source: "action" });
    });

    it("prefers the label over the tooltip when both exist", () => {
        const commands = collectPaletteCommands(
            build({ actions: [action({ id: "x", label: "Real Label", tooltip: "Tip" })] }),
        );
        expect(commands[0]?.title).toBe("Real Label");
    });

    it("skips actions with neither a label nor a tooltip", () => {
        const commands = collectPaletteCommands(build({ actions: [action({ id: "iconOnly" })] }));
        expect(commands).toHaveLength(0);
    });

    it("includes a keybinding that has a description", () => {
        const commands = collectPaletteCommands(
            build({ keybindings: [keybinding({ id: "reopen", key: "mod+shift+t", description: "Reopen Closed Tab" })] }),
        );
        expect(commands[0]).toMatchObject({
            id: "reopen",
            title: "Reopen Closed Tab",
            keybinding: "mod+shift+t",
            source: "keybinding",
        });
    });

    it("skips keybindings without a description (internal bindings)", () => {
        const commands = collectPaletteCommands(
            build({ keybindings: [keybinding({ id: "internal", key: "ctrl+tab" })] }),
        );
        expect(commands).toHaveLength(0);
    });

    it("drops a keybinding whose chord an action already contributes", () => {
        const commands = collectPaletteCommands(
            build({
                actions: [action({ id: "save", label: "Save", shortcut: "mod+s" })],
                keybindings: [keybinding({ id: "save-kb", key: "mod+s", description: "Save Document" })],
            }),
        );
        expect(commands).toHaveLength(1);
        expect(commands[0]?.source).toBe("action");
    });

    it("treats reordered modifiers as the same chord when de-duplicating", () => {
        const commands = collectPaletteCommands(
            build({
                actions: [action({ id: "pal", label: "Palette", shortcut: "mod+shift+p" })],
                keybindings: [keybinding({ id: "pal-kb", key: "shift+mod+p", description: "Command Palette" })],
            }),
        );
        expect(commands).toHaveLength(1);
    });

    it("lists an id at most once (first source wins)", () => {
        const commands = collectPaletteCommands(
            build({
                registered: [{ id: "dup", title: "Registered", run: () => {} }],
                actions: [action({ id: "dup", label: "Action" })],
            }),
        );
        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({ title: "Registered", source: "registered" });
    });

    it("orders registered commands by their declared order", () => {
        const commands = collectPaletteCommands(
            build({
                registered: [
                    { id: "b", title: "B", order: 2, run: () => {} },
                    { id: "a", title: "A", order: 1, run: () => {} },
                ],
            }),
        );
        expect(commands.map(c => c.id)).toEqual(["a", "b"]);
    });

    it("keeps the neutral order: registered, actions, panels, then keybindings", () => {
        const commands = collectPaletteCommands(
            build({
                registered: [{ id: "r", title: "Reg", run: () => {} }],
                actions: [action({ id: "a", label: "Act" })],
                panels: [panel({ id: "assets", title: "Assets" })],
                keybindings: [keybinding({ id: "k", key: "f2", description: "Rename" })],
            }),
        );
        expect(commands.map(c => c.source)).toEqual(["registered", "action", "panel", "keybinding"]);
    });
});

describe("collectPaletteCommands — panels", () => {
    it("turns a body panel into an 'open' command with the view category", () => {
        const commands = collectPaletteCommands(
            build({ panels: [panel({ id: "assets", titleKey: "x" as never })], panelCategory: "View" }),
        );
        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({ id: "panel:assets", category: "View", source: "panel" });
    });

    it("opens a body panel by flipping its visibility", () => {
        const openBodyPanel = vi.fn();
        const commands = collectPaletteCommands(
            build({ panels: [panel({ id: "story", title: "Story" })], openBodyPanel }),
        );
        commands[0]?.run();
        expect(openBodyPanel).toHaveBeenCalledWith("story");
    });

    it("runs a rail-action panel's action with the workspace context", () => {
        const railAction = vi.fn();
        const openBodyPanel = vi.fn();
        const commands = collectPaletteCommands(
            build({
                panels: [panel({ id: "dashboard", title: "Dashboard", component: undefined, railAction })],
                openBodyPanel,
            }),
        );
        commands[0]?.run();
        expect(railAction).toHaveBeenCalledWith(context);
        expect(openBodyPanel).not.toHaveBeenCalled();
    });

    it("skips a panel that has neither a body nor a rail action", () => {
        const commands = collectPaletteCommands(
            build({ panels: [panel({ id: "empty", component: undefined })] }),
        );
        expect(commands).toHaveLength(0);
    });

    it("does not collide with an action of the same base id", () => {
        const commands = collectPaletteCommands(
            build({
                actions: [action({ id: "assets", label: "Assets Action" })],
                panels: [panel({ id: "assets", title: "Assets Panel" })],
            }),
        );
        // Action id "assets" and panel id "panel:assets" are distinct entries.
        expect(commands.map(c => c.id).sort()).toEqual(["assets", "panel:assets"]);
    });
});
