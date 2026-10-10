/**
 * What a driver reads of a running game between two acts (`GameAppTestControls.readState`), put
 * together from the engine's own signals.
 *
 * ⚠ The line is NOT read from the Game UI dialogue mirror (`DialogStateBridge`) and its identity is
 * NOT the engine's current action. Both were, and an agent's play-test reported every line one step
 * late: after a click the engine runs the rows between two lines (`/show … d=0.4`, `/sound`), the
 * current action id changes with each of them, and the mirror still holds the line just clicked
 * past - whole, `done` - because the box stays on the stage until the next line mounts. A driver
 * read "a new action, a whole line" and stopped on the old words while the next line was typing
 * underneath. So:
 *
 * - **Is a line on screen, and is it shown in full** comes from the engine's dialog state
 *   (`DevTools.getCurrentDialog`): set as a `say` action starts, `ended` once its typewriter has
 *   run out (that is exactly when a click stops completing and starts advancing), and cleared the
 *   moment the click that reads on settles it. Between two lines it is null, whatever is still drawn.
 * - **Which line** is the count of the engine's character prompts. The engine emits one per line,
 *   synchronously before it begins that line's dialog state, in both ADV and NVL - so while a dialog
 *   is current, the newest prompt is its line. A line repeated word for word is a new prompt.
 * - **What it says, and who says it** is the prompt's own payload, which is the same evaluated words
 *   the box draws.
 *
 * Pure, so the rules are pinned by tests without an engine.
 *
 * Comments in English per project convention.
 */

/** The engine's answer for the line on screen (`DevTools.getCurrentDialog`). */
export type EngineDialogSnapshot = {
    actionId: string | null;
    /** The typewriter has finished (ADV), or the NVL line is waiting for its advance. */
    ended: boolean;
};

/** The newest line the engine announced (`LiveGame.onCharacterPrompt`). */
export type DialogPrompt = {
    /** Rises with every prompt in this app; tells two lines with the same words apart. */
    serial: number;
    /** Who says it, by the name the box shows; null for narration. */
    speaker: string | null;
    text: string;
};

/** See `GameAppTestControls.readState`. */
export type GameTestState = {
    inGame: boolean;
    /** Times a story has been entered (started or loaded) in this app. */
    entries: number;
    /** Which line is on screen (`line-<prompt serial>`), or null with no line. */
    lineId: string | null;
    line: { speaker: string | null; text: string; complete: boolean } | null;
    /** `index` is the engine's own, which `choose` takes; the array is in screen order. */
    choices: { index: number; text: string; disabled: boolean }[] | null;
    /**
     * Whether the engine reports its dialog state. When it does, `line: null` in a story means no
     * line is on screen (between two lines, a transition, a pause); when it does not (an engine build
     * without `DevTools.getCurrentDialog`) it means "cannot tell", and a driver has to pace itself.
     */
    readable: boolean;
    /** `/ending` rows reached in this app; rises as one runs, before the page it opens is up. */
    endings: number;
    /** The display name of the last ending reached, or null when none was (or it has no name). */
    lastEnding: string | null;
    /** The page on screen by name - the title, an ending page - when no story is. */
    page: string | null;
    /**
     * The story is stopped on a `/wait click` row: no line, no menu, and nothing moves until the
     * player clicks. Read off the play head - the row the engine is executing - since the screen
     * shows nothing that says so.
     */
    waitingForClick: boolean;
    /**
     * What the story is holding on by itself, with no line on screen: a timed `/wait` (`ms` long, as
     * written) or a `/video` it waits out. Null otherwise. Read off the play head, like
     * {@link waitingForClick}.
     */
    pausedBy: { kind: "timed"; ms: number } | { kind: "video" } | null;
};

export type GameTestStateInputs = {
    inGame: boolean;
    entries: number;
    /** `undefined` when the engine cannot be asked; `null` when it says no line is on screen. */
    dialog: EngineDialogSnapshot | null | undefined;
    prompt: DialogPrompt | null;
    choices: GameTestState["choices"];
    endings: number;
    lastEnding: string | null;
    page: string | null;
    /** The engine's current action is a `/wait click` row's; see {@link GameTestState.waitingForClick}. */
    waitingForClick?: boolean;
    /** See {@link GameTestState.pausedBy}. */
    pausedBy?: GameTestState["pausedBy"];
};

export function buildGameTestState(inputs: GameTestStateInputs): GameTestState {
    const { inGame, dialog, prompt } = inputs;
    const line = inGame && dialog && prompt
        ? { speaker: prompt.speaker, text: prompt.text, complete: dialog.ended }
        : null;
    return {
        inGame,
        entries: inputs.entries,
        lineId: line && prompt ? `line-${prompt.serial}` : null,
        line,
        choices: inGame ? inputs.choices : null,
        readable: dialog !== undefined,
        endings: inputs.endings,
        lastEnding: inputs.lastEnding,
        page: inGame ? null : inputs.page,
        waitingForClick: Boolean(inGame && inputs.waitingForClick && !line && !inputs.choices),
        pausedBy: inGame && !line && !inputs.choices && inputs.pausedBy ? inputs.pausedBy : null,
    };
}

/**
 * The engine's dialog state, asked through its semi-public DevTools reader - guarded the way
 * `createNlrDialogReadHooks` guards it, so an engine build without the reader reads as "cannot
 * tell" rather than throwing.
 */
export function readEngineDialog(
    tools: { getCurrentDialog?: (gameState: never) => { actionId: string | null; ended: boolean } | null },
    gameState: unknown,
): EngineDialogSnapshot | null | undefined {
    if (!gameState || typeof tools.getCurrentDialog !== "function") {
        return undefined;
    }
    const dialog = tools.getCurrentDialog(gameState as never);
    return dialog ? { actionId: dialog.actionId ?? null, ended: dialog.ended === true } : null;
}
