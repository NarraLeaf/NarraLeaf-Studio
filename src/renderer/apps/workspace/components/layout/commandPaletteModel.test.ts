import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { Keyboard, Undo2, type LucideIcon } from "lucide-react";
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

/** Whether a rendered palette icon is the given lucide glyph (icons arrive as elements, not names). */
function isElementOf(icon: ReactNode, expected: LucideIcon): boolean {
    return isValidElement(icon) && icon.type === expected;
}

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

    it("puts a standalone action in the category it declares", () => {
        const commands = collectPaletteCommands(
            build({
                actions: [action({ id: "build", tooltip: "Build project", paletteCategoryKey: "cat.run" as never })],
            }),
        );
        expect(commands[0]).toMatchObject({ title: "Build project", category: "cat.run" });
    });

    it("ignores a declared category on a grouped action - the group label wins", () => {
        const group: ActionGroup = {
            id: "file",
            label: "File",
            items: [action({ id: "open", label: "Open", paletteCategoryKey: "cat.run" as never })],
        };
        expect(collectPaletteCommands(build({ actionGroups: [group] }))[0]?.category).toBe("File");
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

describe("collectPaletteCommands - frozen workspace", () => {
    /**
     * The palette runs the SAME registrations the top bar renders. The top bar greys them out while
     * frozen, so a palette that still listed them would leave a dead button one Ctrl+P from running -
     * and what disabling them prevents is the side effects the write boundary cannot catch.
     */
    const fileGroup: ActionGroup = {
        id: "narraleaf-studio:file",
        label: "File",
        actions: [action({ id: "narraleaf-studio:file-open", label: "Open Workspace" })],
    };
    const pluginGroup: ActionGroup = {
        id: "some-plugin:tools",
        label: "Tools",
        actions: [action({ id: "some-plugin:sync", label: "Sync Now" })],
    };
    const standalone = action({ id: "narraleaf-studio:build", tooltip: "Build project" });

    it("drops standalone and non-exempt grouped actions once frozen", () => {
        const sources = { actions: [standalone], actionGroups: [fileGroup, pluginGroup] };

        const thawed = collectPaletteCommands(build({ ...sources, frozen: false }));
        expect(thawed.map(c => c.id)).toEqual([
            "narraleaf-studio:build",
            "narraleaf-studio:file-open",
            "some-plugin:sync",
        ]);

        const frozen = collectPaletteCommands(build({ ...sources, frozen: true }));
        // File survives because it is project-level navigation - and because a frozen window you
        // cannot close or leave would be a trap.
        expect(frozen.map(c => c.id)).toEqual(["narraleaf-studio:file-open"]);
    });

    it("leaves the registrations themselves alone", () => {
        collectPaletteCommands(build({ actions: [standalone], frozen: true }));
        // Registry state outlives a freeze; disabling by mutation would survive the thaw.
        expect(standalone.disabled).toBeUndefined();
    });
});

describe("collectPaletteCommands - panels", () => {
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

describe("collectPaletteCommands - keybinding catalog resolution", () => {
    // Per-tab registration ids with a stable catalog id, which is how every editor registers.
    const storyUndo = (tabId: string) =>
        keybinding({
            id: `story-scene-editor-${tabId}-undo`,
            key: "mod+z",
            catalogId: "story.undo",
            description: "Undo (internal English)",
        });

    it("titles and categorizes a catalogued binding from the catalog, not its description", () => {
        const commands = collectPaletteCommands(build({ keybindings: [storyUndo("t1")] }));
        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({
            id: "story.undo",
            title: "story.keybindings.undo",
            category: "workspace.shell.keybindings.categories.story",
        });
    });

    it("shows the user's override, which is keyed by catalog id and not by registration id", () => {
        const commands = collectPaletteCommands(
            build({
                keybindings: [storyUndo("t1")],
                keybindingOverrides: { "story.undo": "mod+alt+z" },
            }),
        );
        expect(commands[0]?.keybinding).toBe("mod+alt+z");
    });

    it("ignores an override keyed by the per-tab registration id", () => {
        const commands = collectPaletteCommands(
            build({
                keybindings: [storyUndo("t1")],
                keybindingOverrides: { "story-scene-editor-t1-undo": "mod+alt+z" },
            }),
        );
        expect(commands[0]?.keybinding).toBe("mod+z");
    });

    it("collapses the same command registered by several open tabs into one entry", () => {
        const commands = collectPaletteCommands(
            build({ keybindings: [storyUndo("t1"), storyUndo("t2"), storyUndo("t3")] }),
        );
        expect(commands).toHaveLength(1);
    });

    it("still falls back to the description for a binding with no catalog entry", () => {
        const commands = collectPaletteCommands(
            build({ keybindings: [keybinding({ id: "uncatalogued", key: "f9", description: "Do a thing" })] }),
        );
        expect(commands[0]).toMatchObject({ title: "Do a thing", category: undefined });
    });

    /*
     * The icon column is the one part of a row nothing else would catch going missing: a command
     * with no glyph still lists, still runs, and still reads correctly - it just leaves a hole
     * where every neighbouring row has a mark, which is only visible by looking at the list.
     *
     * Keybindings are the source that had no icon at all, because they are the only one that does
     * not carry its own: the glyph comes from the catalog entry, and a binding that has no entry
     * gets the generic one rather than nothing.
     */
    it("gives a catalogued binding the catalog's icon", () => {
        const commands = collectPaletteCommands(build({ keybindings: [storyUndo("t1")] }));
        expect(commands[0]?.icon).toBeTruthy();
        expect(isElementOf(commands[0]?.icon, Undo2)).toBe(true);
    });

    it("gives an uncatalogued binding the generic shortcut icon rather than a blank column", () => {
        const commands = collectPaletteCommands(
            build({ keybindings: [keybinding({ id: "uncatalogued", key: "f9", description: "Do a thing" })] }),
        );
        expect(isElementOf(commands[0]?.icon, Keyboard)).toBe(true);
    });

    it("sizes catalog icons like the action and panel registries do, since they share a column", () => {
        const commands = collectPaletteCommands(build({ keybindings: [storyUndo("t1")] }));
        expect(isValidElement(commands[0]?.icon)).toBe(true);
        expect((commands[0]?.icon as ReactElement<{ className?: string }>).props.className).toBe("w-4 h-4");
    });
});
