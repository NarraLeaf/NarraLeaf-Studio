/**
 * Cross-session "text read" tracking for the running NarraLeaf game.
 *
 * Marks a dialogue line as read the moment its text finishes displaying (ADV
 * typing done / NVL awaitAdvance), keyed by the message's stable text UUID so
 * the record survives story edits and spans every story of the project. The
 * set persists in project-level storage (save-file independent) and backs the
 * "Is Text Read" blueprint node: true while a dialog line is on screen AND its
 * message is read (seen before, or the current display finished).
 * Comments in English per project convention.
 */

import { DevTools } from "narraleaf-react";
import { BLUEPRINT_TEXT_READ_PERSISTENCE_KEY } from "@shared/types/blueprint/hostApi";
import type { NlrActionIdBinding } from "@/lib/ui-editor/runtime/game/storyCompiler";

/** Project-persistence key holding the read text UUIDs (string[]). */
export const TEXT_READ_PERSISTENCE_KEY = BLUEPRINT_TEXT_READ_PERSISTENCE_KEY;

const PERSIST_DEBOUNCE_MS = 500;

type NlrGameState = Parameters<typeof DevTools.getCurrentDialog>[0];

export type TextReadDialogSnapshot = {
    actionId: string | null;
    ended: boolean;
};

export type TextReadTrackerOptions = {
    /** Read the currently displayed dialog line, or null when none is on screen. */
    getCurrentDialog: () => TextReadDialogSnapshot | null;
    /** Subscribe to dialog line changes; the listener re-reads via getCurrentDialog. */
    subscribe: (listener: () => void) => { cancel: () => void };
    /** Project persistence (scope bridge); values are JSON-safe. */
    persistenceGetAsync: (key: string) => Promise<unknown>;
    persistenceSet: (key: string, value: unknown) => void;
    /** Mirror of "current line exists and is read" for the blueprint state fallback. */
    setMirror: (value: boolean) => void;
    /** Map an action static id to the message text UUID; null skips tracking. */
    resolveReadKey: (actionId: string) => string | null;
    /** Persist debounce in ms (tests may shorten). */
    persistDebounceMs?: number;
};

export type TextReadTracker = {
    /** Current node value: dialog line on screen && its message is read. */
    isCurrentTextRead: () => boolean;
    /** Resolves once the persisted read set has been merged in. */
    whenLoaded: Promise<void>;
    /**
     * Wipe the read record (memory + persistence). A dialog line currently on
     * screen that already finished displaying is re-marked immediately — the
     * player is looking at it, so it stays "read" by the display-finished rule.
     */
    clearAll: () => void;
    /** Cancel the subscription, flush pending writes, and reset the mirror. */
    detach: () => void;
};

function normalizePersistedReadIds(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

export function createTextReadTracker(options: TextReadTrackerOptions): TextReadTracker {
    const {
        getCurrentDialog,
        subscribe,
        persistenceGetAsync,
        persistenceSet,
        setMirror,
        resolveReadKey,
        persistDebounceMs = PERSIST_DEBOUNCE_MS,
    } = options;

    const readIds = new Set<string>();
    let currentTextRead = false;
    let detached = false;
    let dirty = false;
    let persistTimer: ReturnType<typeof setTimeout> | null = null;

    const persistNow = () => {
        if (!dirty) {
            return;
        }
        dirty = false;
        persistenceSet(TEXT_READ_PERSISTENCE_KEY, Array.from(readIds));
    };

    const schedulePersist = () => {
        dirty = true;
        if (persistTimer !== null) {
            return;
        }
        persistTimer = setTimeout(() => {
            persistTimer = null;
            persistNow();
        }, persistDebounceMs);
    };

    const refresh = () => {
        if (detached) {
            return;
        }
        const dialog = getCurrentDialog();
        const readKey = dialog?.actionId ? resolveReadKey(dialog.actionId) : null;
        if (dialog && readKey && dialog.ended && !readIds.has(readKey)) {
            readIds.add(readKey);
            schedulePersist();
        }
        const next = Boolean(dialog && readKey && readIds.has(readKey));
        if (next !== currentTextRead) {
            currentTextRead = next;
            setMirror(next);
        }
    };

    const whenLoaded = persistenceGetAsync(TEXT_READ_PERSISTENCE_KEY)
        .then(raw => {
            // Merge instead of replace: lines may complete before the load resolves.
            for (const id of normalizePersistedReadIds(raw)) {
                readIds.add(id);
            }
            refresh();
        })
        .catch(() => {
            // Unreadable storage degrades to session-only tracking.
        });

    const token = subscribe(refresh);
    setMirror(false);
    refresh();

    return {
        isCurrentTextRead: () => currentTextRead,
        whenLoaded,
        clearAll: () => {
            if (detached) {
                return;
            }
            readIds.clear();
            // Write the wipe through immediately so a pending debounced write
            // cannot resurrect the old set.
            if (persistTimer !== null) {
                clearTimeout(persistTimer);
                persistTimer = null;
            }
            dirty = true;
            persistNow();
            // Recompute; a finished line still on screen re-marks itself.
            currentTextRead = false;
            setMirror(false);
            refresh();
        },
        detach: () => {
            if (detached) {
                return;
            }
            detached = true;
            token.cancel();
            if (persistTimer !== null) {
                clearTimeout(persistTimer);
                persistTimer = null;
            }
            persistNow();
            currentTextRead = false;
            setMirror(false);
        },
    };
}

/**
 * Build a read-key resolver from the story compiler's action id bindings:
 * Studio actions map to their message text UUID; actions without a text
 * binding (or foreign ids) fall back to the raw action id so hand-authored
 * stories still track, just with weaker stability.
 */
export function createReadKeyResolver(bindings: readonly NlrActionIdBinding[]): (actionId: string) => string | null {
    const textIdByStaticId = new Map<string, string>();
    for (const binding of bindings) {
        if (binding.textId) {
            textIdByStaticId.set(binding.staticId, binding.textId);
        }
    }
    return actionId => {
        const trimmed = actionId.trim();
        if (!trimmed) {
            return null;
        }
        return textIdByStaticId.get(trimmed) ?? trimmed;
    };
}

/**
 * NarraLeaf-backed dialog hooks for {@link createTextReadTracker}, reading the
 * engine's semi-public DevTools surface (guarded so an older engine build
 * without the APIs degrades to "never read" instead of crashing).
 */
export function createNlrDialogReadHooks(gameState: NlrGameState): Pick<TextReadTrackerOptions, "getCurrentDialog" | "subscribe"> {
    const tools = DevTools as typeof DevTools & {
        getCurrentDialog?: typeof DevTools.getCurrentDialog;
        onDialogStateChange?: typeof DevTools.onDialogStateChange;
    };
    return {
        getCurrentDialog: () => {
            if (typeof tools.getCurrentDialog !== "function") {
                return null;
            }
            const dialog = tools.getCurrentDialog(gameState);
            return dialog ? { actionId: dialog.actionId, ended: dialog.ended } : null;
        },
        subscribe: listener => {
            if (typeof tools.onDialogStateChange !== "function") {
                return { cancel: () => undefined };
            }
            return tools.onDialogStateChange(gameState, listener);
        },
    };
}
