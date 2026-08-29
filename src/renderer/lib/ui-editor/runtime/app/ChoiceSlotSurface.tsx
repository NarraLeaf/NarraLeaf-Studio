import { useEffect, useId, useMemo, useRef } from "react";
import { GameMenu, Script, Word, useUIMenuContext, type ChoiceEvaluated } from "narraleaf-react";
import type { UIStageSurface } from "@shared/types/ui-editor/document";
import { BLUEPRINT_GAME_CHOICE_COUNT_STATE_KEY } from "@shared/types/blueprint/hostApi";
import type { ChoiceMenus, ChoiceSlotItem, ChoiceSlotRuntime } from "./choiceMenus";
import {
    collectSurfaceElementIdsByType,
    StageSlotSurfaceBody,
    stageSlotWidgetRuntimeKey,
    useStageSlotSurfaceRuntime,
    type GameUiSlotHostOptions,
} from "./StageSlotSurfaceShell";

const CHOICE_LIST_WIDGET_TYPE = "nl.choice.list";

/**
 * Runtime bridge registered while a NarraLeaf choice menu is mounted, and one option on it.
 *
 * Declared beside the registry that holds them ({@link ChoiceMenus}) because more than one menu can
 * be on the stage at once; re-exported here, where they were, for the callers that ask this module.
 * `items` is what is on screen; `choose` addresses the engine's own index, which is the `index`
 * field of an item and not its position in that array - a hidden option is left out of the list
 * without renumbering the ones after it.
 */
export type { ChoiceSlotItem, ChoiceSlotRuntime } from "./choiceMenus";

// `Script.getCtx`, `Word.getText`, and `Lambda.evaluate` are NarraLeaf-internal statics hidden
// from the public typings; mirror NLR's own `Item.tsx` usage through structural casts and keep
// every read defensive.
type NlrLambdaLike = {
    evaluate?: (ctx: unknown) => { value?: unknown } | undefined;
};

type NlrChoiceConfigLike = {
    hidden?: NlrLambdaLike | null;
    disabled?: NlrLambdaLike | null;
};

const NlrScript = Script as unknown as {
    getCtx?: (input: { gameState: unknown }) => unknown;
};

const NlrWord = Word as unknown as {
    getText?: (words: unknown) => string;
};

function getChoiceScriptCtx(gameState: unknown): unknown {
    try {
        return NlrScript.getCtx?.({ gameState }) ?? null;
    } catch {
        return null;
    }
}

function evaluateChoiceFlags(
    choice: ChoiceEvaluated,
    ctx: unknown,
): { hidden: boolean; disabled: boolean } {
    try {
        const config = (choice as { config?: NlrChoiceConfigLike }).config ?? {};
        const hidden = config.hidden?.evaluate?.(ctx)?.value ?? false;
        const disabled = hidden !== true && (config.disabled?.evaluate?.(ctx)?.value ?? false);
        return { hidden: hidden === true, disabled: disabled === true };
    } catch {
        return { hidden: false, disabled: false };
    }
}

function choiceText(choice: ChoiceEvaluated): string {
    try {
        return NlrWord.getText?.(choice.words ?? []) ?? "";
    } catch {
        return "";
    }
}

/**
 * The voice unit id the compiler stamped on this option's prompt, or "" when it carries none.
 *
 * The engine builds a `Sentence` for a prompt handed to it as words, and only the compiler's own
 * `Sentence` carries metadata - so an option that predates a take, or a menu built by anything but
 * the story compiler, reads as unvoiced instead of failing.
 */
function choiceVoiceId(choice: ChoiceEvaluated): string {
    try {
        const voiceId = choice.prompt?.getMetadata?.()?.voiceId;
        return typeof voiceId === "string" ? voiceId : "";
    } catch {
        return "";
    }
}

/**
 * Renders the Game UI choice slot surface as the NarraLeaf menu component. NarraLeaf mounts it
 * inside a design-size container below `UIMenuContext`; `<GameMenu>` applies the ratio scale.
 * Evaluated choices are mirrored into the widget runtime list store ({ text, index, disabled },
 * hidden choices filtered out, `index` referring to the original choice index) and choosing goes
 * through the registered `ChoiceSlotRuntime` used by the `Select Choice` blueprint node.
 */
export function ChoiceSlotSurface(props: {
    options: GameUiSlotHostOptions;
    surface: UIStageSurface;
    choiceMenus: ChoiceMenus;
}) {
    const { options, surface, choiceMenus } = props;
    // Which drawing of the choice surface this is. `useId` names the drawing without side effects,
    // so the claim below can be made during render and answers the same slot however many times a
    // render is replayed; the slot itself is what everything this menu addresses is keyed by.
    const drawingId = useId();
    const slot = choiceMenus.claimSlot(drawingId);
    const { core, bundle, widgetRuntimeStore } = options;
    const menu = useUIMenuContext();
    /**
     * What this menu offers, for the host API bound to it below.
     *
     * Through a ref rather than a dependency: the options object feeds the memo that builds this
     * slot's blueprint host API, and rebuilding that every time an option's disabled state is
     * re-evaluated would throw away the running scope's API on a frame the player is looking at.
     */
    const ownRuntimeRef = useRef<ChoiceSlotRuntime | null>(null);

    /**
     * This drawing's own view of the two choice host calls.
     *
     * A graph running inside a menu means *this* menu - the row it is on belongs to this one - and
     * the host API is built per runtime scope, which is now per menu. So binding them here is all
     * it takes for `Select Choice` and `Get Choice Count` to address the menu the caller is in,
     * with no signature anywhere learning a second argument. Callers outside every menu (the skip
     * loop, Dev Mode's test controls) keep asking the registry instead.
     */
    const scopedOptions = useMemo<GameUiSlotHostOptions>(() => ({
        ...options,
        getChoiceCountInGame: () => ownRuntimeRef.current?.count ?? 0,
        selectChoiceInGame: async (index: number) => {
            const own = ownRuntimeRef.current;
            if (!own) {
                throw new Error("Select Choice: no active choice menu");
            }
            own.choose(index);
        },
    }), [options]);

    const runtime = useStageSlotSurfaceRuntime({ options: scopedOptions, surface, slotId: "choice", slot });
    const { runtimeScopeId, flushSlotElements } = runtime;

    const listElementIds = useMemo(
        () => collectSurfaceElementIdsByType(bundle.ui.uidoc, surface, CHOICE_LIST_WIDGET_TYPE),
        [bundle.ui.uidoc, surface],
    );

    const items = useMemo<ChoiceSlotItem[]>(() => {
        const ctx = getChoiceScriptCtx(menu.gameState);
        const out: ChoiceSlotItem[] = [];
        menu.evaluated.forEach((choice, index) => {
            const { hidden, disabled } = evaluateChoiceFlags(choice, ctx);
            if (hidden) {
                return;
            }
            out.push({
                text: choiceText(choice),
                index,
                disabled,
                voiceId: choiceVoiceId(choice),
            });
        });
        return out;
    }, [menu.evaluated, menu.gameState]);

    useEffect(() => {
        const choose = (index: number) => {
            const choice = menu.evaluated[index];
            if (!choice) {
                throw new Error(`Select Choice: no choice at index ${index}`);
            }
            const ctx = getChoiceScriptCtx(menu.gameState);
            const { hidden, disabled } = evaluateChoiceFlags(choice, ctx);
            if (hidden || disabled) {
                return;
            }
            menu.choose({
                ...choice,
                evaluated: choiceText(choice),
            });
        };
        const own: ChoiceSlotRuntime = { count: items.length, items, choose };
        ownRuntimeRef.current = own;
        choiceMenus.setRuntime(drawingId, own);
        return () => {
            ownRuntimeRef.current = null;
            choiceMenus.setRuntime(drawingId, null);
        };
    }, [choiceMenus, drawingId, items, menu]);

    // The slot is given back only when this drawing leaves for good, so a re-render that changes
    // the options or the menu never hands this menu's scope - and the widget keys and surface state
    // under it - to a menu standing beside it.
    useEffect(() => () => choiceMenus.release(drawingId), [choiceMenus, drawingId]);

    useEffect(() => {
        if (!core) {
            return;
        }
        for (const elementId of listElementIds) {
            widgetRuntimeStore.setListItems(stageSlotWidgetRuntimeKey(runtimeScopeId, elementId), items);
        }
        // One global, and possibly several menus. It is the answer for a graph that is not running
        // inside any of them - every graph that is has its own count bound above - so it carries the
        // newest menu on the stage, and a menu leaving hands it back to whichever is still there
        // rather than to zero.
        core.scopeBridge.globalSet(BLUEPRINT_GAME_CHOICE_COUNT_STATE_KEY, items.length);
        flushSlotElements();
        return () => {
            core.scopeBridge.globalSet(
                BLUEPRINT_GAME_CHOICE_COUNT_STATE_KEY,
                choiceMenus.current()?.count ?? 0,
            );
        };
    }, [choiceMenus, core, flushSlotElements, items, listElementIds, runtimeScopeId, widgetRuntimeStore]);

    return (
        <GameMenu className="h-full w-full">
            <StageSlotSurfaceBody options={scopedOptions} surface={surface} runtime={runtime} />
        </GameMenu>
    );
}

export function createChoiceSlotComponent(
    options: GameUiSlotHostOptions,
    surface: UIStageSurface,
    choiceMenus: ChoiceMenus,
) {
    return function ChoiceSlotGameUI(_props: { items: number[] }) {
        return (
            <ChoiceSlotSurface
                options={options}
                surface={surface}
                choiceMenus={choiceMenus}
            />
        );
    };
}
