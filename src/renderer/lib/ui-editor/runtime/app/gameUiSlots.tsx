import type { MutableRefObject, ReactNode } from "react";
import { Game, KeyBindingType, type AudioBusDeclaration, type LiveGame } from "narraleaf-react";
import type { DevModeBundle } from "@shared/types/devMode";
import type {
    BlueprintGameHistoryEntry,
    BlueprintGameNotification,
    BlueprintGamePreferenceKey,
    BlueprintGamePreferenceValue,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { createDialogSlotComponent } from "./DialogSlotSurface";
import { createNotificationSlotComponent } from "./NotificationSlotSurface";
import { createChoiceSlotComponent, type ChoiceSlotRuntime } from "./ChoiceSlotSurface";
import { createNvlSlotComponent } from "./NvlSlotSurface";
import { createOnStageSlotNode } from "./OnStageSlotSurface";
import type { GameUiSlotHostOptions } from "./StageSlotSurfaceShell";
import { readNlrLastDialogSpeaker } from "./nlrDialogReaders";
import { findStageSurfaceForSlot } from "./stageSlots";

/**
 * Project Game UI slot components resolved from the uidoc's stage surfaces. A missing entry means
 * the project defines no surface for that slot; `createNlrGameWithGameUi` then leaves the slot to
 * NLR's built-in default component.
 */
export type GameUiSlots = {
    dialog?: ReturnType<typeof createDialogSlotComponent>;
    notification?: ReturnType<typeof createNotificationSlotComponent>;
    menu?: ReturnType<typeof createChoiceSlotComponent>;
    nvlDialog?: ReturnType<typeof createNvlSlotComponent>;
    /** On-Stage Game UI node rendered as Player children (see NlrStageSession.onStageNode). */
    onStageNode?: ReactNode;
};

/**
 * Find each Game UI slot's stage surface in the uidoc and create the slot components against the
 * given per-session host options. Shared by GameApp (Dev Mode / standalone runtime) and the
 * workspace story preview so every host renders identical Game UI.
 */
export function createGameUiSlotComponents(input: {
    uidoc: DevModeBundle["ui"]["uidoc"];
    logLabel: string;
    slotHostOptions: GameUiSlotHostOptions;
    setDialogVirtualClickTarget: (target: HTMLElement | null) => void;
    setChoiceRuntime: (runtime: ChoiceSlotRuntime | null) => void;
}): GameUiSlots {
    const { uidoc, logLabel, slotHostOptions, setDialogVirtualClickTarget, setChoiceRuntime } = input;
    const dialogSurface = findStageSurfaceForSlot(uidoc, "dialog", logLabel);
    const notificationSurface = findStageSurfaceForSlot(uidoc, "notification", logLabel);
    const choiceSurface = findStageSurfaceForSlot(uidoc, "choice", logLabel);
    const nvlSurface = findStageSurfaceForSlot(uidoc, "nvl", logLabel);
    const onStageSurface = findStageSurfaceForSlot(uidoc, "onStage", logLabel);
    return {
        dialog: dialogSurface
            ? createDialogSlotComponent({
                  options: slotHostOptions,
                  surface: dialogSurface,
                  setDialogVirtualClickTarget,
              })
            : undefined,
        notification: notificationSurface
            ? createNotificationSlotComponent(slotHostOptions, notificationSurface)
            : undefined,
        menu: choiceSurface
            ? createChoiceSlotComponent(slotHostOptions, choiceSurface, setChoiceRuntime)
            : undefined,
        nvlDialog: nvlSurface
            ? createNvlSlotComponent(slotHostOptions, nvlSurface)
            : undefined,
        onStageNode: onStageSurface
            ? createOnStageSlotNode(slotHostOptions, onStageSurface)
            : undefined,
    };
}

/**
 * Construct an NLR `Game` with the project's Game UI slots. Slots the project does not define are
 * omitted from the config so NLR falls back to its built-in defaults per slot. The `nextAction`
 * key binding is disabled — hosts drive advancement themselves.
 */
export function createNlrGameWithGameUi(input: {
    width: number;
    height: number;
    contentContainerId: string;
    slots: GameUiSlots;
    /** Override NLR's minimum stage size (default 800×450) — needed for small embedded viewports. */
    minStageSize?: { width: number; height: number };
    /**
     * The project's mixer, as the engine's boot-time bus declaration (see `audioBusRuntime`).
     *
     * Read **once**, here: the engine realizes the tree into gain nodes when the audio subsystem
     * starts and never re-shapes it, so a host that wants the author's buses has exactly this one
     * opportunity to say so. Omitted (the story preview, which has no bundle) leaves the engine's
     * three seeded buses, which is what every game had before buses existed.
     */
    audioBuses?: readonly AudioBusDeclaration[];
    /**
     * The caller runs the skip loop itself (see `skipRunController`) and wants the engine's out of
     * the way. Only the game app does; the story preview keeps the engine's, because it has no
     * read-text record to guard against and nothing there to run a loop of its own.
     */
    hostOwnsSkipKey?: boolean;
}): Game {
    const { width, height, contentContainerId, slots, minStageSize, audioBuses, hostOwnsSkipKey } = input;
    const game = new Game({
        app: { debug: false },
        ...(audioBuses && audioBuses.length > 0 ? { audioBuses: [...audioBuses] } : {}),
        width,
        height,
        aspectRatio: width / height,
        ratioUpdateInterval: 0,
        contentContainerId,
        // NLR paces its preloader (default: 5 at a time, 100ms between batches) for games served
        // over a network. Every asset here comes off the local disk — through `nlgame://` in a
        // packaged game, the dev server in Dev Mode — so the pacing buys nothing and its idle time
        // lands squarely on the path to the first painted frame. Wider batches, no waiting.
        preloadConcurrency: 8,
        preloadDelay: 0,
        ...(minStageSize ? { minWidth: minStageSize.width, minHeight: minStageSize.height } : {}),
        ...(slots.dialog ? { dialog: slots.dialog, dialogWidth: width, dialogHeight: height } : {}),
        ...(slots.notification ? { notification: slots.notification } : {}),
        ...(slots.menu ? { menu: slots.menu } : {}),
        ...(slots.nvlDialog ? { nvlDialog: slots.nvlDialog } : {}),
    });
    game.keyMap.setKeyBinding(KeyBindingType.nextAction, null);
    // Skipping moves to Studio for the same reason advancing did, plus one of its own: the engine's
    // loop reads the `skip` preference once per press and then paces itself on a timer nothing
    // outside it can reach, which makes the `skipReadText` preference unimplementable while it owns
    // the key. The binding is copied to a Studio-owned entry rather than hard-coded here so the
    // KeyMap stays the single place a skip key is written down - see `skipRunController`.
    if (hostOwnsSkipKey) {
        game.keyMap.setKeyBinding(
            STUDIO_SKIP_KEY_BINDING,
            game.keyMap.getKeyBinding(KeyBindingType.skipAction),
        );
        game.keyMap.setKeyBinding(KeyBindingType.skipAction, null);
    }
    return game;
}

/**
 * The KeyMap entry holding the skip key while Studio drives the run.
 *
 * A plain string rather than a `KeyBindingType`: `KeyMap` is keyed by `KeyBindingType | string`
 * precisely so a host can register bindings of its own, and the engine's `skipAction` has to be
 * left empty or its announcer would run a second, unguarded loop alongside this one.
 */
export const STUDIO_SKIP_KEY_BINDING = "studio.skipAction";

export type LiveGameUiCallbackDeps = {
    /** Returns the active LiveGame or throws a `${operation}: game runtime is not available` error. */
    requireLiveGame: (operation: string) => LiveGame;
    /** Latest LiveGame or null; read lazily so callbacks stay stable across session churn. */
    getLiveGame: () => LiveGame | null;
    choiceRuntimeRef: MutableRefObject<ChoiceSlotRuntime | null>;
    /** Fallback nametag captured from `LiveGame.onCharacterPrompt` (see `wireNametagPrompt`). */
    currentDialogNametagRef: MutableRefObject<string | null>;
    /** The custom dialog surface's virtual click target (set via `createDialogSlotComponent`). */
    dialogVirtualClickTargetRef: MutableRefObject<HTMLElement | null>;
};

export type LiveGameUiCallbacks = Pick<GameUiSlotHostOptions,
    | "getCurrentNametag"
    | "getNotificationsInGame"
    | "getHistoryInGame"
    | "restoreHistoryInGame"
    | "getChoiceCountInGame"
    | "isNvlModeInGame"
    | "selectChoiceInGame"
    | "nextInGame"
    | "skipInGame"
    | "showDialogInGame"
    | "hideDialogInGame"
    | "toggleDialogDisplayInGame"
    | "setSentenceSpeedInGame"
    | "getGamePreferenceInGame"
    | "setGamePreferenceInGame"
>;

/**
 * Restore the running game to a past backlog line by token.
 *
 * Feature-detected (the same convention `fastForward` follows), so an engine build without
 * `restoreToHistory` reports failure instead of throwing and the caller can fall back. Restoring
 * re-applies the entry's own state snapshot, so it works after loading a save and costs no replay.
 */
export function restoreLiveGameToHistory(liveGame: LiveGame, token: string): boolean {
    const restoreToHistory = (liveGame as {
        restoreToHistory?: (token: string) => boolean;
    }).restoreToHistory;
    if (!token || typeof restoreToHistory !== "function") {
        return false;
    }
    return restoreToHistory.call(liveGame, token) === true;
}

/**
 * Fast-forward the running game to the next menu, preserving full history.
 *
 * Prefers the engine's `LiveGame.fastForward` primitive (feature-detected, per the same
 * convention as `restoreToHistory`). Falls back — for an engine build without it — to a
 * best-effort skip loop that stops once the choice runtime reports a menu on screen. Either way
 * the backlog accumulates because the real interpreter advances line by line.
 */
export async function fastForwardToNextChoice(
    liveGame: LiveGame,
    choiceRuntimeRef: MutableRefObject<ChoiceSlotRuntime | null>,
): Promise<void> {
    const fastForward = (liveGame as {
        fastForward?: (options?: { until?: "menu" | "end" }) => Promise<unknown>;
    }).fastForward;
    if (typeof fastForward === "function") {
        await fastForward.call(liveGame, { until: "menu" });
        return;
    }
    // Fallback for an older engine dist: drive skip until a menu is on screen (the choice runtime
    // registers while a menu is mounted) or we hit the safety bound.
    const maxSteps = 5000;
    for (let step = 0; step < maxSteps; step++) {
        if (choiceRuntimeRef.current != null) {
            return;
        }
        liveGame.skipDialog();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
}

/**
 * The LiveGame-backed subset of {@link GameUiSlotHostOptions}: everything a Game UI surface (or a
 * blueprint running inside one) may ask of the running game. Pure functions over the given refs —
 * no React state — so hosts can build them once per session.
 */
export function createLiveGameUiCallbacks(deps: LiveGameUiCallbackDeps): LiveGameUiCallbacks {
    const { requireLiveGame, getLiveGame, choiceRuntimeRef, currentDialogNametagRef, dialogVirtualClickTargetRef } = deps;

    return {
        getCurrentNametag: (): string | null => {
            const liveGameSpeaker = readNlrLastDialogSpeaker(getLiveGame());
            return liveGameSpeaker ?? currentDialogNametagRef.current;
        },

        getNotificationsInGame: (): BlueprintGameNotification[] => {
            const gameState = getLiveGame()?.getGameState?.();
            const manager = (gameState as { notificationMgr?: { toArray?: () => unknown } } | null | undefined)
                ?.notificationMgr;
            const raw = typeof manager?.toArray === "function" ? manager.toArray() : null;
            if (!Array.isArray(raw)) {
                return [];
            }
            return raw.flatMap(entry => {
                if (!entry || typeof entry !== "object") {
                    return [];
                }
                const record = entry as Record<string, unknown>;
                return [{ id: String(record.id ?? ""), message: String(record.message ?? "") }];
            });
        },

        getHistoryInGame: (): BlueprintGameHistoryEntry[] => {
            const raw = getLiveGame()?.getHistory?.();
            if (!Array.isArray(raw)) {
                return [];
            }
            return raw.flatMap(entry => {
                if (!entry || typeof entry !== "object") {
                    return [];
                }
                const record = entry as Record<string, unknown>;
                const element = (record.element ?? {}) as Record<string, unknown>;
                const isMenu = element.type === "menu";
                const text = element.text == null ? "" : String(element.text);
                return [{
                    id: String(record.token ?? ""),
                    type: isMenu ? "menu" : "say",
                    text,
                    character: !isMenu && element.character != null ? String(element.character) : null,
                    voice: !isMenu && element.voice != null ? String(element.voice) : null,
                    selected: isMenu && element.selected != null ? String(element.selected) : null,
                    isPending: record.isPending === true,
                }];
            });
        },

        restoreHistoryInGame: async (id?: string): Promise<void> => {
            const token = String(id ?? "").trim();
            const liveGame = requireLiveGame("Restore From History");
            // Snapshot-based restore works both during live play and after loading a save (where the
            // closure-based undo stack is empty). Prefer it when a specific backlog line is targeted
            // and the engine exposes it; fall back to undo otherwise (and for "go back one line").
            if (restoreLiveGameToHistory(liveGame, token)) {
                return;
            }
            liveGame.undo(token ? token : undefined);
        },

        getChoiceCountInGame: (): number => {
            return choiceRuntimeRef.current?.count ?? 0;
        },

        isNvlModeInGame: (): boolean => {
            const gameState = getLiveGame()?.getGameState?.();
            const nvlState = (gameState as { getNvlState?: () => { active?: unknown } } | null | undefined)
                ?.getNvlState?.();
            return nvlState?.active === true;
        },

        selectChoiceInGame: async (index: number): Promise<void> => {
            const runtime = choiceRuntimeRef.current;
            if (!runtime) {
                throw new Error("Select Choice: no active choice menu");
            }
            runtime.choose(index);
        },

        nextInGame: async (): Promise<void> => {
            const dialogClickTarget = dialogVirtualClickTargetRef.current;
            if (dialogClickTarget?.isConnected) {
                dialogClickTarget.click();
                return;
            }
            const liveGame = requireLiveGame("Next");
            const gameState = liveGame.getGameState();
            if (!gameState) {
                throw new Error("Next: game state is not available");
            }
            const clickTarget = gameState.mainContentNode ?? gameState.playerCurrent;
            if (!clickTarget) {
                throw new Error("Next: virtual click target is not available");
            }
            clickTarget.click();
        },

        skipInGame: async (): Promise<void> => {
            requireLiveGame("Skip").skipDialog();
        },

        showDialogInGame: async (): Promise<void> => {
            requireLiveGame("Show Dialog").game.preference.setPreference("showDialog", true);
        },

        hideDialogInGame: async (): Promise<void> => {
            requireLiveGame("Hide Dialog").game.preference.setPreference("showDialog", false);
        },

        toggleDialogDisplayInGame: async (): Promise<void> => {
            const preference = requireLiveGame("Toggle Dialog Display").game.preference;
            preference.setPreference("showDialog", preference.getPreference("showDialog") !== true);
        },

        setSentenceSpeedInGame: async (cps: number): Promise<void> => {
            const value = typeof cps === "number" ? cps : Number(cps);
            if (!Number.isFinite(value) || value <= 0) {
                throw new Error("Set Sentence Speed: CPS must be a positive number");
            }
            requireLiveGame("Set Sentence Speed").game.preference.setPreference("cps", value);
        },

        getGamePreferenceInGame: (key: BlueprintGamePreferenceKey): BlueprintGamePreferenceValue => {
            const preference = requireLiveGame(`Get ${key} Preference`).game.preference as {
                getPreference: (preferenceKey: BlueprintGamePreferenceKey) => unknown;
            };
            return preference.getPreference(key) as BlueprintGamePreferenceValue;
        },

        setGamePreferenceInGame: async (
            key: BlueprintGamePreferenceKey,
            value: BlueprintGamePreferenceValue,
        ): Promise<void> => {
            const preference = requireLiveGame(`Set ${key} Preference`).game.preference as {
                setPreference: (preferenceKey: BlueprintGamePreferenceKey, preferenceValue: BlueprintGamePreferenceValue) => void;
            };
            preference.setPreference(key, value);
        },
    };
}
