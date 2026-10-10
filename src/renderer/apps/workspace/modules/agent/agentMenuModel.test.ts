import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "@shared/i18n";
import { isActionMenuAction, isActionMenuSeparator } from "../../components/ui/actionMenuModel";
import type { ActionDefinition, ActionMenuItem, ActionSubmenu } from "../../registry/types";
import {
    AGENT_MENU_ACTIONS,
    AGENT_MENU_GROUP_ID,
    agentMenuStateKind,
    agentMenuStatusLine,
    buildAgentMenuItems,
    type AgentMenuModelInput,
} from "./agentMenuModel";

/**
 * The Agent menu as the author approved it: a read-only status line, the session switches, the log,
 * then agent access as a whole, then settings. What is pinned here is the shape and the words of the
 * status line; the native menu and the hamburger both draw from these rows.
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
        quick: { enabled: true, allowWrites: false, running: true },
        run: {
            togglePause: vi.fn(),
            toggleFollow: vi.fn(),
            openLog: vi.fn(),
            toggleEnabled: vi.fn(),
            toggleAllowWrites: vi.fn(),
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
        expect(agentMenuStatusLine(zh, "Claude Code", "working")).toBe("智能体：Claude Code · 工作中");
        expect(agentMenuStatusLine(zh, "opencode", "idle")).toBe("智能体：opencode · 空闲");
        expect(agentMenuStatusLine(zh, "Claude Code", "paused")).toBe("智能体：Claude Code · 已暂停");
        expect(agentMenuStatusLine(zh, null, "off")).toBe("智能体：未连接 · 未开启");
        expect(agentMenuStatusLine(en, null, "idle")).toBe("Agent: Not connected · Idle");
    });

    it("puts access being off before everything, then pause, then work", () => {
        const on = { enabled: true, allowWrites: true, running: true };
        expect(agentMenuStateKind({ ...on, enabled: false }, { paused: true, busy: true })).toBe("off");
        expect(agentMenuStateKind(on, { paused: true, busy: true })).toBe("paused");
        expect(agentMenuStateKind(on, { paused: false, busy: true })).toBe("working");
        expect(agentMenuStateKind(on, { paused: false, busy: false })).toBe("idle");
        // Before main has answered, nothing is claimed about access.
        expect(agentMenuStateKind(null, { paused: false, busy: false })).toBe("idle");
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
            AGENT_MENU_ACTIONS.copyConfig,
            AGENT_MENU_ACTIONS.exportSkill,
            "---",
            AGENT_MENU_ACTIONS.settings,
        ]);
    });

    it("draws the status line as a disabled row and the switches as checkboxes", () => {
        const items = buildAgentMenuItems(input({ follow: false }));
        const byId = new Map(items.filter(isActionMenuAction).map(item => [item.id, item]));
        expect(byId.get(AGENT_MENU_ACTIONS.status)).toMatchObject({ label: "智能体：Claude Code · 工作中", disabled: true });
        expect(byId.get(AGENT_MENU_ACTIONS.follow)?.checked).toBe(false);
        expect(byId.get(AGENT_MENU_ACTIONS.enable)?.checked).toBe(true);
        expect(byId.get(AGENT_MENU_ACTIONS.allowWrites)?.checked).toBe(false);
        expect(byId.get(AGENT_MENU_ACTIONS.pause)?.label).toBe("暂停智能体");
        expect(buildAgentMenuItems(input({ paused: true })).filter(isActionMenuAction).find(item => item.id === AGENT_MENU_ACTIONS.pause)?.label)
            .toBe("恢复智能体");
    });

    it("holds the access switches until main has answered", () => {
        const items = buildAgentMenuItems(input({ quick: null })).filter(isActionMenuAction);
        expect(items.find(item => item.id === AGENT_MENU_ACTIONS.enable)?.disabled).toBe(true);
        expect(items.find(item => item.id === AGENT_MENU_ACTIONS.allowWrites)?.disabled).toBe(true);
        expect(items.find(item => item.id === AGENT_MENU_ACTIONS.pause)?.disabled).toBeFalsy();
    });

    it("offers the four configurations and copies the one picked", () => {
        const model = input();
        const copy = buildAgentMenuItems(model).find(item => !isActionMenuSeparator(item) && item.id === AGENT_MENU_ACTIONS.copyConfig) as ActionSubmenu;
        expect(copy.items.map(item => (item as ActionDefinition).label)).toEqual(["Claude Code", "opencode", "JSON", "stdio（Claude Desktop）"]);
        (copy.items[3] as ActionDefinition).onClick(undefined as never);
        expect(model.run.copyConfig).toHaveBeenCalledWith("stdio");
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
