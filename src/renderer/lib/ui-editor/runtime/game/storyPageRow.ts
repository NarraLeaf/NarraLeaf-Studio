import type { StoryLiteralValue, StoryVariableValueType } from "@shared/types/story";

/**
 * What a `/page` row asks of the running game: open a page over the stage, wait for it to close, and
 * take it down again when the story is rolled back past the row.
 *
 * Supplied by `GameApp`, which owns the layer stack `Show Layer` draws on, so a page opened from a
 * story row is the same layer a page opened from a blueprint is - it closes itself with
 * `Close This Layer`, and what it closes with is the row's answer.
 *
 * Comments in English per project convention.
 */
export type StoryPageHost = {
    /** Open the page as a layer and return its handle, or `null` when no page answers to the id. */
    open(surfaceId: string): string | null;
    /**
     * Resolves with what the page closed with. `null` when it closed without one, and at once when the
     * handle names nothing - a layer the stack has already dropped.
     */
    wait(handle: string): Promise<unknown>;
    /** Take the page down without an answer. Harmless on a handle that is already gone. */
    close(handle: string): void;
};

/**
 * What a page's result becomes in the row's variable, or `undefined` for "write nothing".
 *
 * A page closed with no result - `null`, which is also what Back on a dismissible page and a cleared
 * stack answer - writes nothing, so a variable a cancelled page never answered keeps the value it had.
 *
 * Otherwise the value is converted to the variable's own type, because the page is a separate
 * document whose `Close This Layer` pin can be wired to anything, and a variable handed a value its
 * declaration forbids is a fault an `/if` finds three scenes later. A value that cannot be read as
 * the type (the text "soon" for a number) writes nothing rather than a guess.
 */
export function coerceStoryPageResult(
    result: unknown,
    valueType: StoryVariableValueType,
): StoryLiteralValue | undefined {
    if (result === null || result === undefined) {
        return undefined;
    }
    switch (valueType) {
        case "boolean":
            if (typeof result === "boolean") return result;
            if (typeof result === "number") return result !== 0;
            if (typeof result === "string") {
                const text = result.trim().toLowerCase();
                if (text === "true") return true;
                if (text === "false") return false;
                return undefined;
            }
            return undefined;
        case "number":
            if (typeof result === "number") return Number.isFinite(result) ? result : undefined;
            if (typeof result === "boolean") return result ? 1 : 0;
            if (typeof result === "string" && result.trim() !== "") {
                const value = Number(result);
                return Number.isFinite(value) ? value : undefined;
            }
            return undefined;
        case "string":
            if (typeof result === "string") return result;
            if (typeof result === "number" || typeof result === "boolean") return String(result);
            return toJsonLiteral(result) === undefined ? undefined : JSON.stringify(result);
        case "json":
            return toJsonLiteral(result);
    }
}

/** The value as plain JSON, or `undefined` when it does not survive a round trip through it. */
function toJsonLiteral(value: unknown): StoryLiteralValue | undefined {
    try {
        const text = JSON.stringify(value);
        return text === undefined ? undefined : JSON.parse(text) as StoryLiteralValue;
    } catch {
        return undefined;
    }
}
