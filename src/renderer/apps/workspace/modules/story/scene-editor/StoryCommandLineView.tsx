import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from "react";
import type { StoryBlock, StoryScene, StorySceneId } from "@shared/types/story";
import { storyVariableRefKey } from "@shared/types/story";
import { useWorkspace } from "@/apps/workspace/context";
import { useHideParamNames } from "@/apps/workspace/hooks/useHideParamNames";
import { useCommandTranslation } from "@/lib/i18n";
import { useProjectAudioTracks } from "@/lib/story/useProjectAudioTracks";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
import { ACTION_TRIGGER, ALT_ACTION_TRIGGER, toDisplayedCommandLine } from "./commandTrigger";
import { getCommandSegments, type StoryCommandRole } from "./storyCommandHighlight";
import type { StoryCommandContext } from "./storyCommandValues";
import { projectStoryCommandLine, type StoryCommandLineEdit, type StoryCommandLineOrnament, type StoryCommandLineProjection } from "./storyCommandLine";
import { characterRowLookup } from "./storySceneBlockUtils";
import { useStoryMotionNames } from "./useStoryMotionNames";
import type { StoryRowLookups } from "@/lib/story/storyRowProjection";

/**
 * A command line, coloured by role — the one renderer for both halves of the editor's life: the line
 * being typed and the row it commits to.
 *
 * Four roles, one colour each (see `storyCommandHighlight`), because the eye has to be able to answer
 * "which word is the verb" without reading:
 *
 *  - **verb** — the accent. The anchor of the sentence, and the only token in the author's chosen
 *    accent colour, so a scene scrolls as a column of verbs.
 *  - **target** — the thing acted on. A warm hue-shift of the anchor, low saturation.
 *  - **value** — enums and numbers alike. One colour for both: `fade` and `1` are the same *kind* of
 *    thing (what the modifier is set to), and splitting them would say they are not.
 *  - **scaffold** — the trigger, the `=`, the param keys. Muted, and the keys most of all: a Chinese
 *    key (`持续时间`) is four full-width glyphs and would out-shout the value it introduces.
 *
 * The committed row uses the same colours at a lower opacity rather than a second palette — same
 * skeleton, only dimmed, which is what makes a row read as the line that produced it.
 *
 * The one place the two halves are allowed to differ is `editor.hideParamNames`, which prints a
 * committed row's modifiers as bare values (`@hide Anyo fade`). A row can afford that and the live
 * field cannot: the field's copy is a mirror sitting on a textarea, so every glyph it declines to draw
 * is a glyph the caret still walks through. It is a cut in the RENDER — the projection underneath
 * keeps the whole line, which is what lets the row go on being the line it came from.
 */

/** Tailwind classes per role. `text-primary` is the user's accent, which is where the verb belongs. */
const ROLE_CLASS: Record<StoryCommandRole, string> = {
    verb: "text-primary font-medium",
    target: "text-syntax-target",
    value: "text-syntax-value",
    scaffold: "text-fg-subtle",
};


/**
 * The trigger character to DISPLAY, and the lookups a row needs to read itself back as a line.
 *
 * A context rather than props threaded through the row tree, and rather than each row calling the
 * hooks itself: `useSlashAtAlias` and `useProjectAudioTracks` each cost an IPC round trip or a service
 * subscription per mount, and a scene is hundreds of rows. Resolved once by the editor tab.
 */
export type StoryCommandLineContextValue = {
    trigger: "/" | "@";
    /**
     * Print committed rows with the values alone — `@hide Anyo fade` for `@hide Anyo t=fade`.
     *
     * Rides in the context for the same reason the trigger does (one read per editor tab, not one per
     * row), and belongs to the ROW: the live field is a mirror sitting over a textarea, and a mirror
     * that drops glyphs the textarea still holds walks the colours off the caret.
     */
    hideParamNames?: boolean;
    audioTrackName?: (trackId: string) => string | null;
    assetName?: (assetId: string) => string | null;
    appearanceName?: (characterId: string, refId: string) => string | null;
    appearanceOptions?: (characterId: string) => readonly { id: string; name: string; axisId?: string }[];
    /**
     * The name of a project-level (`saved` / `persistent`) variable — the scopes whose declarations
     * live in the project registry rather than in the story document.
     *
     * Derived from {@link commandContext} rather than from a registry subscription per row, exactly
     * like the appearance table below it: the context IS the view a typed line resolves against, so a
     * committed `/set` row names its variable with the very word the line would have used.
     */
    projectVariableName?: StoryRowLookups["projectVariableName"];
    /**
     * The name of a build variant, for the rows that name one. Derived from {@link commandContext} for
     * the same reason as the two tables above it.
     */
    appTagName?: StoryRowLookups["appTagName"];
    /** What a name on a line could refer to — the picker lists for every subject a row names. */
    commandContext?: StoryCommandContext;
};

const StoryCommandLineContext = createContext<StoryCommandLineContextValue>({ trigger: ACTION_TRIGGER });

export function useStoryCommandLineContext(): StoryCommandLineContextValue {
    return useContext(StoryCommandLineContext);
}

/** Publishes the author's trigger character and the name lookups a line needs to every row below. */
export function StoryCommandLineProvider({ slashAtAlias, commandContext, children }: {
    slashAtAlias: boolean;
    /** The same view of the project a typed line resolves against — so a row names what a line would. */
    commandContext?: StoryCommandContext;
    children: ReactNode;
}) {
    const tracks = useProjectAudioTracks();
    // Read here rather than threaded from the controller: nothing but the rows below this provider
    // wants it, and this is the one place that already resolves per-tab preferences for all of them.
    const hideParamNames = useHideParamNames();
    const { context, isInitialized } = useWorkspace();
    const assets = useMemo(
        () => (context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null),
        [context, isInitialized],
    );
    // Built once per context rather than scanned per row: a project can hold hundreds of variables and
    // a scene hundreds of rows, and this is read while the author types.
    const projectVariableNames = useMemo(() => {
        const names = new Map<string, string>();
        for (const entry of commandContext?.variables ?? []) {
            if (entry.ref.scope !== "scene") {
                names.set(storyVariableRefKey(entry.ref), entry.name);
            }
        }
        return names;
    }, [commandContext]);
    const value = useMemo<StoryCommandLineContextValue>(() => ({
        trigger: slashAtAlias ? ALT_ACTION_TRIGGER : ACTION_TRIGGER,
        hideParamNames,
        projectVariableName: (scope, variableId) => projectVariableNames.get(storyVariableRefKey({ scope, variableId })) ?? null,
        audioTrackName: trackId => tracks.find(track => track.id === trackId)?.name ?? null,
        // Read through the service on every call rather than off a snapshot: an asset rename does not
        // touch the story document, so nothing here would be told to rebuild a captured table.
        assetName: assetId => {
            const table = assets?.getAssets();
            for (const type of ASSET_NAME_TYPES) {
                const found = table?.[type]?.[assetId];
                if (found) {
                    return found.name;
                }
            }
            return null;
        },
        // A pose or a tag is stored by id, so without this a `/face` row could only say whose face it
        // is. The refs come from the same context a typed line resolves against, which is the point:
        // the row names the appearance with the word the line would have used.
        appearanceName: (characterId, refId) =>
            commandContext?.appearanceByCharacterId[characterId]?.find(ref => ref.id === refId)?.name ?? null,
        appearanceOptions: characterId => commandContext?.appearanceByCharacterId[characterId] ?? [],
        // Off the same table the slot offers from, so a cut point row names its variant with the word
        // the line would have been typed with. `null` for a deleted one, which is what the row then
        // says instead.
        appTagName: appTagId => commandContext?.appTags.find(tag => tag.id === appTagId)?.name ?? null,
        commandContext,
    }), [assets, commandContext, hideParamNames, slashAtAlias, tracks]);
    return <StoryCommandLineContext.Provider value={value}>{children}</StoryCommandLineContext.Provider>;
}

/** Every library a command line can name a file from — an id is unique across them, so order is moot. */
const ASSET_NAME_TYPES = [AssetType.Image, AssetType.Audio, AssetType.Video] as const;

/**
 * Swap the canonical leading "/" for the trigger the author actually types — {@link
 * toDisplayedCommandLine}, applied to the one piece that can hold it.
 *
 * Only the first character can change (the same rule the insert slot lives by), so every span the
 * projection recorded stays valid against the displayed text — and, crucially, the PARSE still has to
 * run on the canonical form: `@隐藏 …` is not a command line to the parser, and colouring the
 * displayed string directly leaves every token scaffold-grey.
 */
const displayed = toDisplayedCommandLine;

/** One coloured stretch of the line, with the offsets it occupies so a caller can find a span in it. */
export type StoryCommandLinePiece = {
    text: string;
    role: StoryCommandRole;
    start: number;
    end: number;
    /** A param key and its `=`, the one piece a surface is allowed to leave out. */
    paramKey?: true;
};

/** A run of pieces the line draws together: plain, or the whole of one click-to-edit value. */
export type StoryCommandLinePart = {
    pieces: readonly StoryCommandLinePiece[];
    /** Set when this run IS an editable value — the caller wraps it in the affordance. */
    edit?: StoryCommandLineEdit;
};

function pieces(source: string): StoryCommandLinePiece[] {
    let at = 0;
    return getCommandSegments(source).map(segment => {
        const piece: StoryCommandLinePiece = {
            text: segment.text,
            role: segment.role,
            start: at,
            end: at + segment.text.length,
            ...(segment.paramKey ? { paramKey: segment.paramKey } : {}),
        };
        at = piece.end;
        return piece;
    });
}

/**
 * The line's coloured pieces, with every quick-edit span collected into one part.
 *
 * Split out of the component and exported for its test, because the way this fails is invisible: a
 * quick value that stops matching renders as ordinary text — correct-looking, and no longer
 * clickable. That is exactly what happened when units arrived and split `1秒` into two pieces while
 * the match still demanded one. Containment, not equality, is the rule.
 *
 * `hideParamKeys` drops the `t=` pieces and keeps everything else, including the space that stood in
 * front of them. Dropped HERE, after the offsets are taken, rather than by writing a shorter line:
 * every offset the projection recorded — each quick-edit span, each face — is an offset into the full
 * source, and the value pieces they point at do not move just because a key stopped being painted.
 * The line the author would type is also, deliberately, not the line being shown any more, which is
 * exactly why this cannot happen upstream where the round-trip is guaranteed.
 */
export function storyCommandLineParts(
    source: string,
    edits: readonly StoryCommandLineEdit[] = [],
    hideParamKeys = false,
): StoryCommandLinePart[] {
    const parts: StoryCommandLinePart[] = [];
    // Safe to drop before grouping: a key span ends where its value span begins, so a key piece is
    // never one of the pieces an edit is built from.
    const segments = hideParamKeys ? pieces(source).filter(piece => !piece.paramKey) : pieces(source);
    for (let index = 0; index < segments.length; index += 1) {
        const piece = segments[index];
        const editable = edits.find(entry => entry.span.start <= piece.start && piece.end <= entry.span.end);
        if (!editable) {
            parts.push({ pieces: [piece] });
            continue;
        }
        const inside: StoryCommandLinePiece[] = [];
        while (index < segments.length && segments[index].end <= editable.span.end) {
            inside.push(segments[index]);
            index += 1;
        }
        index -= 1;
        parts.push({ pieces: inside, edit: editable });
    }
    return parts;
}

/**
 * Render a command source string as coloured spans.
 *
 * `edits` marks the value spans a click can change. A span is handed to `renderEdit` **whole**, with
 * its own colouring inside it, because an editable value is not always one coloured piece:
 * `持续时间=1秒` colours the number and mutes the unit, and the affordance covers both. Matching a span
 * against a single piece was what silently dropped the affordance the moment units arrived — the
 * token simply stopped being a button, with nothing to see.
 */
export function StoryCommandLineText(props: {
    source: string;
    trigger: "/" | "@";
    edits?: readonly StoryCommandLineEdit[];
    /**
     * Print the values without the keys that introduce them (`editor.hideParamNames`).
     *
     * Never set on the live field: that copy has to occupy the same width as the textarea under it,
     * character for character, and a key it refuses to draw is a run of glyphs the caret still walks
     * through.
     */
    hideParamNames?: boolean;
    /** Wraps one editable value in its affordance. Absent on the live field, which is already text. */
    renderEdit?: (edit: StoryCommandLineEdit, content: ReactNode) => ReactNode;
    ornaments?: readonly StoryCommandLineOrnament[];
    /**
     * Draws one picture the line carries inside itself — a speaker's face before their name.
     *
     * Absent on the live field on purpose: that copy is a mirror sitting on top of a textarea and has
     * to occupy the same width character for character, so anything drawn between the glyphs would
     * walk the colours off the caret.
     */
    renderOrnament?: (ornament: StoryCommandLineOrnament) => ReactNode;
}) {
    const { t: ct } = useCommandTranslation();
    // The one memo worth having on this path: the projection above is string building, but this is a
    // parse, and a scene is hundreds of rows. `ct` is a dependency because the command locale decides
    // whether `转场=` names a slot — the same hidden input the ghost hint declares.
    const parts = useMemo(
        () => storyCommandLineParts(props.source, props.renderEdit ? props.edits : [], props.hideParamNames),
        [ct, props.edits, props.hideParamNames, props.renderEdit, props.source],
    );
    // The trigger is swapped at the last moment, on the one piece that can hold it.
    const paint = (piece: StoryCommandLinePiece) => (
        <span key={piece.start} className={ROLE_CLASS[piece.role]}>
            {piece.start === 0 ? displayed(piece.text, props.trigger) : piece.text}
        </span>
    );
    return (
        <>
            {parts.map(part => {
                const painted = part.pieces.map(paint);
                const key = part.pieces[0]?.start ?? 0;
                const token = part.edit && props.renderEdit
                    ? props.renderEdit(part.edit, painted)
                    : painted;
                // Outside the token, never inside it: an editable value wears a dotted underline, and
                // an underline running under a face is the seam this whole arrangement exists to
                // avoid. Adjacent is enough to read as one thing.
                const ornament = props.renderOrnament ? props.ornaments?.find(entry => entry.at === key) : undefined;
                return (
                    <span key={key}>
                        {ornament ? props.renderOrnament?.(ornament) : null}
                        {token}
                    </span>
                );
            })}
        </>
    );
}

/**
 * The projection for a committed row, or `null` when no command owns it — the hook form, so a row
 * component gets the block's line without knowing which lookups it takes.
 *
 * `useCommandTranslation` is subscribed to rather than called: every word in the line resolves
 * through the imperative `translateCommand`, which is a snapshot with no way to tell React it went
 * stale. Without it a command-language switch would leave every committed row in the old vocabulary.
 */
export function useStoryCommandLine(
    block: StoryBlock,
    characters: Character[],
    scene: StoryScene | undefined,
    scenes: Record<StorySceneId, StoryScene> | undefined,
): StoryCommandLineProjection | null {
    // Read for its subscription only — see the note above.
    useCommandTranslation();
    const motionName = useStoryMotionNames();
    const { audioTrackName, assetName, appearanceName, appearanceOptions, commandContext, projectVariableName } = useStoryCommandLineContext();
    // Deliberately not memoized: this is string building, and every input that could invalidate a memo
    // (an asset rename, a character rename) lives outside the story document, so a dependency array
    // would be a promise this cannot keep. The parse it feeds IS memoized, on the string it produces.
    return projectStoryCommandLine(block, {
        character: characterRowLookup(characters),
        scene,
        scenes,
        motionName,
        audioTrackName,
        assetName,
        appearanceName,
        appearanceOptions,
        commandContext,
        projectVariableName,
    });
}

/**
 * Shared line box: one line, truncating, in the editor's own text metrics.
 *
 * The pieces sit in an INLINE child rather than directly in the flex box. A flex container blockifies
 * its children, and a block box drops its leading and trailing whitespace — which is exactly what the
 * spaces between a line's tokens are, so the line came out as `@隐藏Anyo持续时间=1`. Keeping them in one
 * inline flow is what makes the spaces the projection wrote survive to the screen.
 */
export function StoryCommandLineBox(props: { style?: CSSProperties; className?: string; children: ReactNode }) {
    return (
        <span
            className={["flex min-h-[var(--nl-story-row-box)] min-w-0 flex-1 items-center text-sm", props.className].filter(Boolean).join(" ")}
            style={props.style}
        >
            <span className="min-w-0 truncate">{props.children}</span>
        </span>
    );
}
