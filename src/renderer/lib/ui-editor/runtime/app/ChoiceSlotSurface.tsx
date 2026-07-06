import { useEffect, useMemo } from "react";
import { GameMenu, Script, Word } from "narraleaf-react";
import type { UIStageSurface } from "@shared/types/ui-editor/document";
import { BLUEPRINT_GAME_CHOICE_COUNT_STATE_KEY } from "@shared/types/blueprint/hostApi";
import {
    collectSurfaceElementIdsByType,
    StageSlotSurfaceBody,
    stageSlotWidgetRuntimeKey,
    useStageSlotSurfaceRuntime,
    type GameUiSlotHostOptions,
} from "./StageSlotSurfaceShell";

// TODO(nlr-gameui): restore the real imports once NLR publishes the Game UI Menu API.
// `useUIMenuContext` and `ChoiceEvaluated` are not exported by narraleaf-react@0.10.0 yet (that
// API is developed locally and unpublished). These local fallbacks keep Studio typechecking and
// make the choice slot surface INERT (empty list, no-op choose) instead of crashing; delete them
// and re-add the named imports above when the dependency ships.
type ChoiceEvaluated = { words?: unknown; config?: unknown; [key: string]: unknown };
type UIMenuContextLike = {
    gameState: unknown;
    evaluated: ChoiceEvaluated[];
    choose: (choice: unknown) => void;
};
function useUIMenuContext(): UIMenuContextLike {
    return { gameState: null, evaluated: [], choose: () => {} };
}

const CHOICE_LIST_WIDGET_TYPE = "nl.choice.list";

/** Runtime bridge registered while a NarraLeaf choice menu is mounted. */
export type ChoiceSlotRuntime = {
    count: number;
    choose: (index: number) => void;
};

type ChoiceSlotItem = {
    text: string;
    index: number;
    disabled: boolean;
};

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
 * Renders the Game UI choice slot surface as the NarraLeaf menu component. NarraLeaf mounts it
 * inside a design-size container below `UIMenuContext`; `<GameMenu>` applies the ratio scale.
 * Evaluated choices are mirrored into the widget runtime list store ({ text, index, disabled },
 * hidden choices filtered out, `index` referring to the original choice index) and choosing goes
 * through the registered `ChoiceSlotRuntime` used by the `Select Choice` blueprint node.
 */
export function ChoiceSlotSurface(props: {
    options: GameUiSlotHostOptions;
    surface: UIStageSurface;
    setChoiceRuntime: (runtime: ChoiceSlotRuntime | null) => void;
}) {
    const { options, surface, setChoiceRuntime } = props;
    const runtime = useStageSlotSurfaceRuntime({ options, surface, slotId: "choice" });
    const { core, bundle, widgetRuntimeStore } = options;
    const { runtimeScopeId, flushSlotElements } = runtime;
    const menu = useUIMenuContext();

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
        setChoiceRuntime({ count: items.length, choose });
        return () => setChoiceRuntime(null);
    }, [items.length, menu, setChoiceRuntime]);

    useEffect(() => {
        if (!core) {
            return;
        }
        for (const elementId of listElementIds) {
            widgetRuntimeStore.setListItems(stageSlotWidgetRuntimeKey(runtimeScopeId, elementId), items);
        }
        core.scopeBridge.globalSet(BLUEPRINT_GAME_CHOICE_COUNT_STATE_KEY, items.length);
        flushSlotElements();
        return () => {
            core.scopeBridge.globalSet(BLUEPRINT_GAME_CHOICE_COUNT_STATE_KEY, 0);
        };
    }, [core, flushSlotElements, items, listElementIds, runtimeScopeId, widgetRuntimeStore]);

    return (
        <GameMenu className="h-full w-full">
            <StageSlotSurfaceBody options={options} surface={surface} runtime={runtime} />
        </GameMenu>
    );
}

export function createChoiceSlotComponent(
    options: GameUiSlotHostOptions,
    surface: UIStageSurface,
    setChoiceRuntime: (runtime: ChoiceSlotRuntime | null) => void,
) {
    return function ChoiceSlotGameUI(_props: { items: number[] }) {
        return (
            <ChoiceSlotSurface
                options={options}
                surface={surface}
                setChoiceRuntime={setChoiceRuntime}
            />
        );
    };
}
