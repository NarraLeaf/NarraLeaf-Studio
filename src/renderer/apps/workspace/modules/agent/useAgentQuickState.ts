import { useSyncExternalStore } from "react";
import { getInterface } from "@/lib/app/bridge";
import type { AppEventToken } from "@shared/types/app";
import type { AgentQuickState } from "@shared/agent/workspaceAccess";

/**
 * Agent access as main reports it - whether it is on, writes or full access are allowed and the
 * endpoint listens - shared by everything in this window that draws the agent: the Agent menu, the
 * status bar cell and the status bar's wash. Null until main answers.
 *
 * One subscription to main for the window however many readers there are, kept current by main's
 * broadcast, which follows every change - from an Agent menu in any window, the Settings window, or
 * the endpoint starting or failing. Dropped when the last reader goes, so a window that never draws
 * the agent holds nothing open.
 *
 * Comments in English per project convention.
 */

let current: AgentQuickState | null = null;
let token: AppEventToken | null = null;
const listeners = new Set<() => void>();

function publish(state: AgentQuickState | null): void {
    current = state;
    for (const listener of listeners) {
        listener();
    }
}

function start(): void {
    const agent = getInterface().agent;
    // A broadcast that lands before the first answer is newer than it, and wins.
    let broadcastSeen = false;
    const started = agent.onQuickStateChanged(next => {
        broadcastSeen = true;
        publish(next);
    });
    token = started;
    void agent.getQuickState().then(result => {
        if (token === started && !broadcastSeen && result.success) {
            publish(result.data);
        }
    }).catch(() => undefined);
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (!token) {
        start();
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && token) {
            token.cancel();
            token = null;
            current = null;
        }
    };
}

function getSnapshot(): AgentQuickState | null {
    return current;
}

/** Adopt main's answer to a switch flipped here, without waiting for its broadcast. */
export function adoptAgentQuickState(state: AgentQuickState): void {
    if (token) {
        publish(state);
    }
}

/**
 * Agent access is known to be off. Not "not known to be on": before main has answered nothing is
 * claimed, and what an agent already did in this session stays drawn.
 */
export function agentAccessOff(quick: AgentQuickState | null): boolean {
    return quick !== null && !quick.enabled;
}

export function useAgentQuickState(): AgentQuickState | null {
    return useSyncExternalStore(subscribe, getSnapshot);
}
