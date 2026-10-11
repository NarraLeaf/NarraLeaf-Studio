import type { Translator, TranslationKey } from "@shared/i18n";
import type { AgentCopyConfigKind, AgentQuickState } from "@shared/agent/workspaceAccess";
import { Separator, type ActionDefinition, type ActionMenuItem } from "../../registry/types";

/**
 * The Agent menu's rows, as data: a read-only line saying which agent is connected and what it is
 * doing, the author's two switches over it (pause, for this session; follow, which is the Studio-wide
 * setting of the same name in Settings ▸ Agent access), the log, and the three things that
 * belong to agent access as a whole (the endpoint, write access, connection configuration and the
 * skill), then the way to the full settings. While access is off, only the status line, the switch
 * that turns it on and the way to settings. When the endpoint had to move to another port, a second
 * read-only line under the status says so until a configuration is copied again.
 *
 * Separate from the component so the status line and the shape can be tested without a workspace.
 * The rows carry ids and `group` but never `shortcut`: a shortcut on a registered action becomes a
 * real global keybinding.
 *
 * Comments in English per project convention.
 */

/** The group's id. Exempt from the freeze in `freezeActionPolicy`: nothing here writes the project. */
export const AGENT_MENU_GROUP_ID = "narraleaf-studio:agent";

/**
 * The letter Alt reaches the menu by on the in-app bar, beside File (F), Edit (E) and Help (H): the
 * one its name starts with in English and Chinese, and free in every language. Like Alt+H, it yields
 * to the UI editor's align chord while that binding is live (see `TitleBarMenus`).
 */
export const AGENT_MENU_MNEMONIC = "A";

export const AGENT_MENU_ACTIONS = {
    status: "narraleaf-studio:agent-status",
    portMoved: "narraleaf-studio:agent-port-moved",
    pause: "narraleaf-studio:agent-pause",
    follow: "narraleaf-studio:agent-follow",
    log: "narraleaf-studio:agent-log",
    enable: "narraleaf-studio:agent-enable",
    allowWrites: "narraleaf-studio:agent-allow-writes",
    fullAccess: "narraleaf-studio:agent-full-access",
    copyConfig: "narraleaf-studio:agent-copy-config",
    exportSkill: "narraleaf-studio:agent-export-skill",
    settings: "narraleaf-studio:agent-settings",
} as const;

export type AgentMenuStateKind = "working" | "idle" | "paused" | "off";

/** What the status line says the agent is doing. `quick` is null until main has answered. */
export function agentMenuStateKind(
    quick: AgentQuickState | null,
    session: { paused: boolean; busy: boolean },
): AgentMenuStateKind {
    if (quick && !quick.enabled) {
        return "off";
    }
    if (session.paused) {
        return "paused";
    }
    return session.busy ? "working" : "idle";
}

const STATE_KEYS: Record<Exclude<AgentMenuStateKind, "off">, TranslationKey> = {
    working: "workspace.agent.appMenu.state.working",
    idle: "workspace.agent.appMenu.state.idle",
    paused: "workspace.agent.appMenu.state.paused",
};

/**
 * `Agent: Claude Code · Working`, or `Agent: Not connected · Idle`. With access off there is no
 * agent, so no client is named - not even the last one that called - only `Agent access: Off`.
 */
export function agentMenuStatusLine(t: Translator["t"], clientName: string | null, state: AgentMenuStateKind): string {
    if (state === "off") {
        return t("workspace.agent.appMenu.statusOff");
    }
    return t("workspace.agent.appMenu.status", {
        client: clientName ?? t("workspace.agent.appMenu.notConnected"),
        state: t(STATE_KEYS[state]),
    });
}

/**
 * The configurations the copy submenu offers, in its order, with the row label each takes: product
 * names, the same in every language. The stdio bridge is named for the client it is for. The order
 * and the names are the ones the Settings panel's copy buttons use.
 */
export const AGENT_MENU_COPY_KINDS: readonly { kind: AgentCopyConfigKind; label: string }[] = [
    { kind: "claudeCode", label: "Claude Code" },
    { kind: "stdio", label: "Claude Desktop" },
    { kind: "opencode", label: "opencode" },
    { kind: "json", label: "JSON" },
];

export function agentCopyKindLabel(kind: AgentCopyConfigKind): string {
    return AGENT_MENU_COPY_KINDS.find(item => item.kind === kind)?.label ?? kind;
}

export type AgentMenuModelInput = {
    t: Translator["t"];
    clientName: string | null;
    state: AgentMenuStateKind;
    paused: boolean;
    follow: boolean;
    /** Null until main has answered; the access switches are disabled until then. */
    quick: AgentQuickState | null;
    run: {
        togglePause(): void;
        toggleFollow(): void;
        openLog(): void;
        toggleEnabled(): void;
        toggleAllowWrites(): void;
        toggleFullAccess(): void;
        copyConfig(kind: AgentCopyConfigKind): void;
        exportSkill(): void;
        openSettings(): void;
    };
};

export function buildAgentMenuItems(input: AgentMenuModelInput): ActionMenuItem[] {
    const { t, quick, run } = input;
    const action = (definition: Omit<ActionDefinition, "group">): ActionDefinition => ({ ...definition, group: AGENT_MENU_GROUP_ID });
    const status = action({
        id: AGENT_MENU_ACTIONS.status,
        label: agentMenuStatusLine(t, input.clientName, input.state),
        disabled: true,
        onClick: () => undefined,
    });
    // HTTP clients configured before the endpoint moved name the old port; copying a configuration
    // from this menu or Settings answers it, and main clears it.
    const movedToPort = quick?.movedToPort ?? null;
    const portMoved = movedToPort !== null
        ? [action({
            id: AGENT_MENU_ACTIONS.portMoved,
            label: t("settings.agent.portMoved", { port: movedToPort }),
            disabled: true,
            onClick: () => undefined,
        })]
        : [];
    const enable = action({
        id: AGENT_MENU_ACTIONS.enable,
        labelKey: "workspace.agent.appMenu.enable",
        label: t("workspace.agent.appMenu.enable"),
        checked: quick?.enabled ?? false,
        disabled: quick === null,
        onClick: run.toggleEnabled,
    });
    const settings = action({
        id: AGENT_MENU_ACTIONS.settings,
        labelKey: "workspace.agent.appMenu.settings",
        label: t("workspace.agent.appMenu.settings"),
        onClick: run.openSettings,
    });
    // While access is off there is no agent to pause or follow and nothing to connect to, so the
    // menu holds only the way to turn it on and the way to its settings. Before main has answered,
    // nothing is known to be off, and the full menu shows with its switches held.
    if (quick !== null && !quick.enabled) {
        return [status, Separator, enable, Separator, settings];
    }
    return [
        status,
        ...portMoved,
        Separator,
        action({
            id: AGENT_MENU_ACTIONS.pause,
            labelKey: input.paused ? "workspace.agent.menu.resume" : "workspace.agent.menu.pause",
            label: t(input.paused ? "workspace.agent.menu.resume" : "workspace.agent.menu.pause"),
            onClick: run.togglePause,
        }),
        action({
            id: AGENT_MENU_ACTIONS.follow,
            labelKey: "workspace.agent.menu.follow",
            label: t("workspace.agent.menu.follow"),
            checked: input.follow,
            onClick: run.toggleFollow,
        }),
        action({
            id: AGENT_MENU_ACTIONS.log,
            labelKey: "workspace.agent.appMenu.log",
            label: t("workspace.agent.appMenu.log"),
            onClick: run.openLog,
        }),
        Separator,
        enable,
        // Full access lets writes through on its own, so while it is on the write row shows them
        // allowed and cannot be switched: turning it off would change nothing.
        action({
            id: AGENT_MENU_ACTIONS.allowWrites,
            labelKey: "workspace.agent.appMenu.allowWrites",
            label: t("workspace.agent.appMenu.allowWrites"),
            checked: (quick?.allowWrites ?? false) || (quick?.fullAccess ?? false),
            disabled: quick === null || quick.fullAccess,
            onClick: run.toggleAllowWrites,
        }),
        action({
            id: AGENT_MENU_ACTIONS.fullAccess,
            labelKey: "workspace.agent.appMenu.fullAccess",
            label: t("workspace.agent.appMenu.fullAccess"),
            checked: quick?.fullAccess ?? false,
            disabled: quick === null,
            onClick: run.toggleFullAccess,
        }),
        {
            id: AGENT_MENU_ACTIONS.copyConfig,
            labelKey: "workspace.agent.appMenu.copyConfig",
            label: t("workspace.agent.appMenu.copyConfig"),
            items: AGENT_MENU_COPY_KINDS.map(entry => action({
                id: `${AGENT_MENU_ACTIONS.copyConfig}-${entry.kind}`,
                label: entry.label,
                onClick: () => run.copyConfig(entry.kind),
            })),
        },
        action({
            id: AGENT_MENU_ACTIONS.exportSkill,
            labelKey: "workspace.agent.appMenu.exportSkill",
            label: t("workspace.agent.appMenu.exportSkill"),
            onClick: run.exportSkill,
        }),
        Separator,
        settings,
    ];
}
