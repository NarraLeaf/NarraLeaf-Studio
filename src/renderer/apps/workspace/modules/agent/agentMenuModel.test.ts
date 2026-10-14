import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "@shared/i18n";
import { AGENT_CLIENTS } from "@shared/agent/clients";
import { AGENT_COPY_CONFIG_KINDS } from "@shared/agent/workspaceAccess";
import { isActionMenuAction, isActionMenuSeparator } from "../../components/ui/actionMenuModel";
import type { ActionDefinition, ActionMenuItem, ActionSubmenu } from "../../registry/types";
import {
    AGENT_MENU_ACTIONS,
    AGENT_MENU_COPY_KINDS,
    AGENT_MENU_GROUP_ID,
    AGENT_MENU_MNEMONIC,
    agentMenuStateKind,
    agentMenuStatusLine,
    buildAgentMenuItems,
    type AgentMenuModelInput,
} from "./agentMenuModel";

/**
 * The Agent menu as the author approved it: a read-only status line, the session switches, the log,
 * then agent access as a whole, then settings; while access is off, only the status line, the switch
 * that turns it on and settings. What is pinned here is the shape and the words of the status line;
 * the native menu and the hamburger both draw from these rows.
 */

const zh = createTranslator("zh").t;
const en = createTranslator("en").t;

function input(overrides: Partial<AgentMenuModelInput> = {}): AgentMenuModelInput {
    return {
        t: zh,
        clientName: "Claude Code",
        state: "working",
        paused: false,
        follow: true,
        quick: { enabled: true, allowWrites: false, fullAccess: false, running: true, movedToPort: null, portUnavailable: null, setByLaunch: false },
        run: {
            togglePause: vi.fn(),
            toggleFollow: vi.fn(),
            openLog: vi.fn(),
            toggleEnabled: vi.fn(),
            toggleAllowWrites: vi.fn(),
            toggleFullAccess: vi.fn(),
            copyConfig: vi.fn(),
            exportSkill: vi.fn(),
            openSettings: vi.fn(),
        },
        ...overrides,
    };
}

function shape(items: ActionMenuItem[]): string[] {
    return items.map(item => (isActionMenuSeparator(item) ? "---" : item.id));
}

describe("the Agent menu's status line", () => {
    it("says who is connected and what it is doing", () => {
        expect(agentMenuStatusLine(zh, "Claude Code", "working")).toBe("Agent：Claude Code · 工作中");
        expect(agentMenuStatusLine(zh, "opencode", "idle")).toBe("Agent：opencode · 空闲");
        expect(agentMenuStatusLine(zh, "Claude Code", "paused")).toBe("Agent：Claude Code · 已暂停");
        expect(agentMenuStatusLine(en, null, "idle")).toBe("Agent: Not connected · Idle");
    });

    it("names no agent while access is off, not even the last one that called", () => {
        expect(agentMenuStatusLine(zh, "Claude Code (drive)", "off")).toBe("Agent 接入：未开启");
        expect(agentMenuStatusLine(zh, null, "off")).toBe("Agent 接入：未开启");
        expect(agentMenuStatusLine(en, "Claude Code", "off")).toBe("Agent access: Off");
        expect(agentMenuStatusLine(createTranslator("ja").t, "Claude Code", "off")).toBe("エージェント連携：無効");
    });

    it("puts access being off before everything, then pause, then work", () => {
        const on = { enabled: true, allowWrites: true, fullAccess: false, running: true, movedToPort: null, portUnavailable: null, setByLaunch: false };
        expect(agentMenuStateKind({ ...on, enabled: false }, { paused: true, busy: true })).toBe("off");
        expect(agentMenuStateKind(on, { paused: true, busy: true })).toBe("paused");
        expect(agentMenuStateKind(on, { paused: false, busy: true })).toBe("working");
        expect(agentMenuStateKind(on, { paused: false, busy: false })).toBe("idle");
        // Before main has answered, nothing is claimed about access.
        expect(agentMenuStateKind(null, { paused: false, busy: false })).toBe("idle");
    });
});

describe("the Agent menu's access key", () => {
    it("is a letter no other Studio menu on the bar claims, and one its name carries in English and Chinese", () => {
        // File (F) and Help (H) in `modules/actions`, Edit (E) in `WorkspaceHistoryMenu`.
        expect(["F", "E", "H"]).not.toContain(AGENT_MENU_MNEMONIC);
        expect(en("workspace.agent.appMenu.title").toUpperCase()).toContain(AGENT_MENU_MNEMONIC);
        expect(zh("workspace.agent.appMenu.title").toUpperCase()).toContain(AGENT_MENU_MNEMONIC);
    });
});

describe("the Agent menu's rows", () => {
    it("has the approved shape", () => {
        expect(shape(buildAgentMenuItems(input()))).toEqual([
            AGENT_MENU_ACTIONS.status,
            "---",
            AGENT_MENU_ACTIONS.pause,
            AGENT_MENU_ACTIONS.follow,
            AGENT_MENU_ACTIONS.log,
            "---",
            AGENT_MENU_ACTIONS.enable,
            AGENT_MENU_ACTIONS.allowWrites,
            AGENT_MENU_ACTIONS.fullAccess,
            AGENT_MENU_ACTIONS.copyConfig,
            AGENT_MENU_ACTIONS.exportSkill,
            "---",
            AGENT_MENU_ACTIONS.settings,
        ]);
    });

    it("says under the status line that the endpoint moved, until main clears it", () => {
        const moved = buildAgentMenuItems(input({ t: en, quick: { enabled: true, allowWrites: false, fullAccess: false, running: true, movedToPort: 47220, portUnavailable: null, setByLaunch: false } }));
        expect(shape(moved).slice(0, 3)).toEqual([AGENT_MENU_ACTIONS.status, AGENT_MENU_ACTIONS.portMoved, "---"]);
        expect(moved.filter(isActionMenuAction).find(item => item.id === AGENT_MENU_ACTIONS.portMoved)).toMatchObject({
            label: "The endpoint moved to port 47220. Copy the connection configuration again for clients set up before.",
            disabled: true,
        });
        expect(shape(buildAgentMenuItems(input()))).not.toContain(AGENT_MENU_ACTIONS.portMoved);
    });

    it("holds the access switch still in a development launch, which sets it with --agent", () => {
        const dev = { enabled: true, allowWrites: false, fullAccess: false, running: true, movedToPort: null, portUnavailable: null, setByLaunch: true };
        const items = buildAgentMenuItems(input({ quick: dev })).filter(isActionMenuAction);
        expect(items.find(item => item.id === AGENT_MENU_ACTIONS.enable)).toMatchObject({ checked: true, disabled: true });
        expect(items.find(item => item.id === AGENT_MENU_ACTIONS.allowWrites)?.disabled).toBeFalsy();
    });

    it("says under the status line that the endpoint did not start, on which port and why", () => {
        const failed = { enabled: true, allowWrites: false, fullAccess: false, running: false, movedToPort: null, setByLaunch: false } as const;
        const inUse = buildAgentMenuItems(input({ quick: { ...failed, portUnavailable: { port: 47219, reason: "inUse" } } }));
        expect(shape(inUse).slice(0, 3)).toEqual([AGENT_MENU_ACTIONS.status, AGENT_MENU_ACTIONS.portUnavailable, "---"]);
        expect(inUse.filter(isActionMenuAction).find(item => item.id === AGENT_MENU_ACTIONS.portUnavailable)).toMatchObject({
            label: "无法启动：端口 47219 已被其他程序占用",
            disabled: true,
        });
        const reserved = buildAgentMenuItems(input({ t: en, quick: { ...failed, portUnavailable: { port: 54080, reason: "reserved" } } }));
        expect(reserved.filter(isActionMenuAction).find(item => item.id === AGENT_MENU_ACTIONS.portUnavailable)?.label)
            .toBe("Could not start: Port 54080 is reserved by the system.");
        expect(shape(buildAgentMenuItems(input()))).not.toContain(AGENT_MENU_ACTIONS.portUnavailable);
    });

    it("draws the status line as a disabled row and the switches as checkboxes", () => {
        const items = buildAgentMenuItems(input({ follow: false }));
        const byId = new Map(items.filter(isActionMenuAction).map(item => [item.id, item]));
        expect(byId.get(AGENT_MENU_ACTIONS.status)).toMatchObject({ label: "Agent：Claude Code · 工作中", disabled: true });
        expect(byId.get(AGENT_MENU_ACTIONS.follow)?.checked).toBe(false);
        expect(byId.get(AGENT_MENU_ACTIONS.enable)?.checked).toBe(true);
        expect(byId.get(AGENT_MENU_ACTIONS.allowWrites)?.checked).toBe(false);
        expect(byId.get(AGENT_MENU_ACTIONS.pause)?.label).toBe("暂停 Agent");
        expect(buildAgentMenuItems(input({ paused: true })).filter(isActionMenuAction).find(item => item.id === AGENT_MENU_ACTIONS.pause)?.label)
            .toBe("恢复 Agent");
    });

    it("names the follow row as the Settings row it switches, in every language, and switches it", () => {
        // One setting with two ways in: the menu row and the Settings row must read as the same switch.
        for (const t of [en, zh, createTranslator("ja").t]) {
            expect(t("workspace.agent.menu.follow")).toBe(t("settings.items.agentFollow.label"));
        }
        const model = input();
        const row = buildAgentMenuItems(model).filter(isActionMenuAction).find(item => item.id === AGENT_MENU_ACTIONS.follow);
        expect(row).toMatchObject({ checked: true, label: "跟随 Agent 的修改" });
        row?.onClick(undefined as never);
        expect(model.run.toggleFollow).toHaveBeenCalled();
    });

    it("holds the access switches until main has answered", () => {
        const items = buildAgentMenuItems(input({ quick: null })).filter(isActionMenuAction);
        expect(items.find(item => item.id === AGENT_MENU_ACTIONS.enable)?.disabled).toBe(true);
        expect(items.find(item => item.id === AGENT_MENU_ACTIONS.allowWrites)?.disabled).toBe(true);
        expect(items.find(item => item.id === AGENT_MENU_ACTIONS.fullAccess)?.disabled).toBe(true);
        expect(items.find(item => item.id === AGENT_MENU_ACTIONS.pause)?.disabled).toBeFalsy();
    });

    it("shows writes allowed and fixed while full access is on, and flips full access from its own row", () => {
        const model = input({ quick: { enabled: true, allowWrites: false, fullAccess: true, running: true, movedToPort: null, portUnavailable: null, setByLaunch: false } });
        const items = buildAgentMenuItems(model).filter(isActionMenuAction);
        const writes = items.find(item => item.id === AGENT_MENU_ACTIONS.allowWrites);
        const full = items.find(item => item.id === AGENT_MENU_ACTIONS.fullAccess);
        expect(writes).toMatchObject({ checked: true, disabled: true });
        expect(full).toMatchObject({ checked: true, label: "允许 Agent 完全访问" });
        full?.onClick(undefined as never);
        expect(model.run.toggleFullAccess).toHaveBeenCalled();
    });

    it("takes its order from the application list in setup and Settings, one row per configuration", () => {
        const kinds = AGENT_CLIENTS.map(client => client.configKind).filter((kind, index, all) => all.indexOf(kind) === index);
        expect(AGENT_MENU_COPY_KINDS.map(entry => entry.kind)).toEqual(kinds);
        // Every application's configuration can be copied from the menu.
        for (const client of AGENT_CLIENTS) {
            expect(AGENT_COPY_CONFIG_KINDS).toContain(client.configKind);
        }
    });

    it("offers every configuration by client, in the Settings panel's order, and copies the one picked", () => {
        const model = input();
        const copy = buildAgentMenuItems(model).find(item => !isActionMenuSeparator(item) && item.id === AGENT_MENU_ACTIONS.copyConfig) as ActionSubmenu;
        expect(copy.items.map(item => (item as ActionDefinition).label)).toEqual(["Claude Code", "Claude Desktop", "Codex", "opencode", "Gemini CLI", "JSON"]);
        (copy.items[1] as ActionDefinition).onClick(undefined as never);
        expect(model.run.copyConfig).toHaveBeenCalledWith("stdio");
    });

    it("holds only the way to turn access on and its settings while access is off", () => {
        const model = input({ state: "off", quick: { enabled: false, allowWrites: true, fullAccess: false, running: false, movedToPort: null, portUnavailable: null, setByLaunch: false } });
        const items = buildAgentMenuItems(model);
        expect(shape(items)).toEqual([
            AGENT_MENU_ACTIONS.status,
            "---",
            AGENT_MENU_ACTIONS.enable,
            "---",
            AGENT_MENU_ACTIONS.settings,
        ]);
        expect(items.filter(isActionMenuAction).find(item => item.id === AGENT_MENU_ACTIONS.status)).toMatchObject({ label: "Agent 接入：未开启", disabled: true });
        const enable = items.filter(isActionMenuAction).find(item => item.id === AGENT_MENU_ACTIONS.enable);
        expect(enable).toMatchObject({ checked: false, label: "启用 Agent 接入" });
        expect(enable?.disabled).toBeFalsy();
        enable?.onClick(undefined as never);
        expect(model.run.toggleEnabled).toHaveBeenCalled();
    });

    it("never gives a row a shortcut, and claims every row for the group", () => {
        const all: ActionDefinition[] = [];
        const walk = (items: ActionMenuItem[]) => {
            for (const item of items) {
                if (isActionMenuAction(item)) {
                    all.push(item);
                } else if (!isActionMenuSeparator(item)) {
                    walk(item.items);
                }
            }
        };
        walk(buildAgentMenuItems(input()));
        expect(all.length).toBeGreaterThan(8);
        for (const action of all) {
            expect(action.shortcut).toBeUndefined();
            expect(action.group).toBe(AGENT_MENU_GROUP_ID);
        }
    });
});
