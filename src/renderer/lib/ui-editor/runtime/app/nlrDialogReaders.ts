import type { LiveGame } from "narraleaf-react";

type NlrCharacterLike = {
    state?: {
        name?: unknown;
    };
};

type NlrLiveGameWithLastDialog = LiveGame & {
    lastDialog?: {
        speaker?: unknown;
    } | null;
};

export function coerceNametagValue(value: unknown): string | null {
    if (value == null) {
        return null;
    }
    const text = String(value);
    return text.trim().length > 0 ? text : null;
}

export function readNlrCharacterName(character: unknown): string | null {
    return coerceNametagValue((character as NlrCharacterLike | null | undefined)?.state?.name);
}

export function readNlrLastDialogSpeaker(liveGame: LiveGame | null): string | null {
    const lastDialog = (liveGame as NlrLiveGameWithLastDialog | null)?.lastDialog;
    return lastDialog ? coerceNametagValue(lastDialog.speaker) : null;
}
