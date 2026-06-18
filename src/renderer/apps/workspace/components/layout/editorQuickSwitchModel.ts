import type { EditorGroup, EditorLayout, EditorTabDefinition } from "../../registry/types";

export interface EditorQuickSwitchCandidate {
    key: string;
    tabId: string;
    groupId: string;
    tab: EditorTabDefinition<any>;
    layoutIndex: number;
}

export interface EditorQuickSwitchOrder {
    candidates: EditorQuickSwitchCandidate[];
    groupCount: number;
}

export function getEditorQuickSwitchKey(groupId: string, tabId: string): string {
    return `${groupId}:${tabId}`;
}

export function collectEditorQuickSwitchCandidates(layout: EditorLayout): EditorQuickSwitchOrder {
    const candidates: EditorQuickSwitchCandidate[] = [];
    const groupIds = new Set<string>();

    const visit = (node: EditorLayout) => {
        if ("tabs" in node) {
            groupIds.add(node.id);
            for (const tab of node.tabs) {
                candidates.push({
                    key: getEditorQuickSwitchKey(node.id, tab.id),
                    tabId: tab.id,
                    groupId: node.id,
                    tab,
                    layoutIndex: candidates.length,
                });
            }
            return;
        }

        visit(node.first);
        visit(node.second);
    };

    visit(layout);
    return { candidates, groupCount: groupIds.size };
}

export function collectFocusedEditorQuickSwitchKeys(layout: EditorLayout): string[] {
    const keys: string[] = [];

    const visit = (node: EditorLayout) => {
        if ("tabs" in node) {
            if (node.focus && node.tabs.some(tab => tab.id === node.focus)) {
                keys.push(getEditorQuickSwitchKey(node.id, node.focus));
            }
            return;
        }

        visit(node.first);
        visit(node.second);
    };

    visit(layout);
    return keys;
}

export function pruneEditorQuickSwitchMru(
    mruKeys: readonly string[],
    candidates: readonly EditorQuickSwitchCandidate[]
): string[] {
    const candidateKeys = new Set(candidates.map(candidate => candidate.key));
    const seen = new Set<string>();
    const pruned: string[] = [];

    for (const key of mruKeys) {
        if (!candidateKeys.has(key) || seen.has(key)) {
            continue;
        }
        seen.add(key);
        pruned.push(key);
    }

    return pruned;
}

export function recordEditorQuickSwitchMru(
    mruKeys: readonly string[],
    key: string | null | undefined,
    candidates: readonly EditorQuickSwitchCandidate[]
): string[] {
    if (!key) {
        return pruneEditorQuickSwitchMru(mruKeys, candidates);
    }

    return pruneEditorQuickSwitchMru(
        [key, ...mruKeys.filter(existingKey => existingKey !== key)],
        candidates
    );
}

export function buildEditorQuickSwitchOrder(
    layout: EditorLayout,
    mruKeys: readonly string[],
    activeKey?: string | null
): EditorQuickSwitchOrder {
    const collected = collectEditorQuickSwitchCandidates(layout);
    const byKey = new Map(collected.candidates.map(candidate => [candidate.key, candidate]));
    const seen = new Set<string>();
    const ordered: EditorQuickSwitchCandidate[] = [];

    const add = (candidate: EditorQuickSwitchCandidate | undefined) => {
        if (!candidate || seen.has(candidate.key)) {
            return;
        }
        seen.add(candidate.key);
        ordered.push(candidate);
    };

    add(activeKey ? byKey.get(activeKey) : undefined);

    for (const key of mruKeys) {
        add(byKey.get(key));
    }

    for (const candidate of collected.candidates) {
        add(candidate);
    }

    return {
        candidates: ordered,
        groupCount: collected.groupCount,
    };
}

export function findEditorQuickSwitchGroup(
    layout: EditorLayout,
    groupId: string
): EditorGroup | null {
    if ("tabs" in layout) {
        return layout.id === groupId ? layout : null;
    }

    return (
        findEditorQuickSwitchGroup(layout.first, groupId) ??
        findEditorQuickSwitchGroup(layout.second, groupId)
    );
}
