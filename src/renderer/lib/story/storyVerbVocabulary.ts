import type { StoryActionPayload } from "@shared/types/story";
import type { TranslationKey } from "@shared/i18n";

/**
 * Which command's name a committed row's verb reads as.
 *
 * The row and the action creator were saying different words for the same thing: an author typed
 * `/隐藏 Inko` and the row came back "退场", because the row named the *payload operation* out of its
 * own vocabulary (`story.describe.charOp.*`) while the menu, the manual and the parser all named the
 * *command* out of `story.command.<id>.label`. Two tables for one concept, and the one the author
 * never types was the one they had to read. Everything here exists to delete that second table: a row
 * says the word its author would type, in the command language, or it says nothing new.
 *
 * **Why a table at all.** The payload does not record which command built it — and cannot, since the
 * generic verbs (bible B3) dispatch on the target: `/show` lands on a character, an image, a text, a
 * video, a layer or an ambience overlay, and `/hide` mirrors it. The relation is genuinely many-to-one
 * in that direction, so it has to be stated somewhere. Stated ONCE, here, rather than spelled out
 * again in each of `describeStoryBlock`'s ten branches.
 *
 * **What keeps it honest.** The per-action maps are total `Record`s over their operation union, so a
 * new operation is a compile error rather than a row that silently falls back to raw English. And
 * `storyVerbVocabulary.test.ts` (which, unlike this file, may reach into the editor's command
 * registry) asserts every id below is a real spec id. This file deliberately does not import the
 * registry itself: `lib/story` is the projection layer the Dev Mode timeline reuses, and it should not
 * have to pull 45 command specs in to print a sentence.
 *
 * `null` means "no command owns this verb" — the inspector-only displayable operations, mostly. Those
 * keep whatever the caller was already saying.
 */

type OperationOf<A extends StoryActionPayload["action"]> =
    Extract<StoryActionPayload, { action: A }> extends { operation: infer O } ? O & string : never;

/** A story command's spec id — the `<id>` in `story.command.<id>.label`. Validated by the test. */
type CommandId = string;

const CHARACTER: Record<OperationOf<"character">, CommandId> = {
    enter: "show",
    exit: "hide",
    move: "move",
    expression: "face",
    setName: "rename",
    setMotion: "motion",
    setSkin: "skin",
    setParams: "param",
};

const IMAGE: Record<OperationOf<"image">, CommandId> = {
    create: "image",
    setSource: "swap",
    show: "show",
    hide: "hide",
};

const TEXT: Record<OperationOf<"text">, CommandId> = {
    create: "text",
    setText: "swap",
    show: "show",
    hide: "hide",
    // Both spellings are the one `/font` command; its size and colour are two params of one row.
    setFontSize: "font",
    setFontColor: "font",
};

const LAYER: Record<OperationOf<"layer">, CommandId> = {
    create: "layer",
    // `z=` is a param of `/layer`, not a verb of its own.
    setZIndex: "layer",
    show: "show",
    hide: "hide",
    transform: "transform",
};

const VIDEO: Record<OperationOf<"video">, CommandId> = {
    create: "video",
    show: "show",
    hide: "hide",
    play: "play",
    pause: "pause",
    resume: "resume",
    stop: "stop",
    seek: "seek",
};

const VFX: Record<OperationOf<"vfx">, CommandId> = {
    create: "vfx",
    show: "show",
    hide: "hide",
    pause: "pause",
    resume: "resume",
    setRate: "rate",
};

const AUDIO: Record<Exclude<OperationOf<"audio">, "muteSound">, CommandId> = {
    setBgm: "bgm",
    playSound: "sound",
    stopSound: "stop",
    pauseSound: "pause",
    resumeSound: "resume",
    setVolume: "volume",
    setRate: "rate",
    seekSound: "seek",
};

/**
 * Only the operations a command actually owns. The rest of this union — mask, clip, filter, backdrop,
 * blend and friends — is reached through the inspector after `/fx` or `/transform` drops the block, so
 * there is no verb the author typed and nothing here to say.
 */
const DISPLAYABLE: Partial<Record<OperationOf<"displayable">, CommandId>> = {
    show: "show",
    hide: "hide",
    transform: "transform",
};

/** The command id whose label names this payload's verb, or `null` when no command owns it. */
export function storyVerbCommandId(payload: StoryActionPayload): CommandId | null {
    switch (payload.action) {
        case "character": return CHARACTER[payload.operation] ?? null;
        case "image": return IMAGE[payload.operation] ?? null;
        case "text": return TEXT[payload.operation] ?? null;
        case "layer": return LAYER[payload.operation] ?? null;
        case "video": return VIDEO[payload.operation] ?? null;
        case "vfx": return VFX[payload.operation] ?? null;
        case "displayable": return DISPLAYABLE[payload.operation] ?? null;
        case "audio":
            // One payload, two verbs: `/mute` and `/unmute` both store `muteSound` and differ only by
            // the flag. Naming both "Mute" would misread half of them, so the flag decides.
            return payload.operation === "muteSound"
                ? (payload.muted === false ? "unmute" : "mute")
                : AUDIO[payload.operation] ?? null;
        case "setBackground": return "background";
        case "wait": return "wait";
        case "nvl": return "nvl";
        case "camera": return "camera";
        case "setVariable": return "set";
        default: return null;
    }
}

/** The `story.command.*` key naming this payload's verb, or `null`. Resolve it in the COMMAND locale. */
export function storyVerbLabelKey(payload: StoryActionPayload): TranslationKey | null {
    const id = storyVerbCommandId(payload);
    return id === null ? null : (`story.command.${id}.label` as TranslationKey);
}
