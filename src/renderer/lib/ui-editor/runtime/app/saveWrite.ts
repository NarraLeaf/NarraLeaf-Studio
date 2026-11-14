import { autoSaveSuperseded } from "./autoSaveScheduler";

/** Serialize on the current playthrough and mark the progress included in that snapshot. */
export function serializeGameSave<T>(
    game: { serialize: () => T },
    captured?: () => void,
    isCurrent?: () => boolean,
): T {
    if (isCurrent && !isCurrent()) {
        throw autoSaveSuperseded();
    }
    const savedGame = game.serialize();
    captured?.();
    return savedGame;
}
