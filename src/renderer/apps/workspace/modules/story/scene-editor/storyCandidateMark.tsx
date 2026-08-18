import { useMemo } from "react";
import {
    AlignHorizontalJustifyCenter,
    AlignHorizontalJustifyEnd,
    AlignHorizontalJustifyStart,
    AlignJustify,
    Aperture,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    AudioLines,
    Ban,
    Blend,
    Braces,
    Calculator,
    Circle,
    Clock,
    Columns2,
    Contrast,
    DoorOpen,
    Droplet,
    Fan,
    Film,
    Flag,
    Grip,
    Hash,
    Image as ImageIcon,
    Layers,
    List,
    MessageSquare,
    MonitorPlay,
    MousePointerClick,
    Move,
    MoveHorizontal,
    Music,
    Package,
    PaintBucket,
    Palette,
    Moon,
    Puzzle,
    Replace,
    RotateCcw,
    RotateCw,
    Scaling,
    Sigma,
    SlidersHorizontal,
    Smile,
    Focus,
    PersonStanding,
    Shirt,
    SunDim,
    Timer,
    ToggleLeft,
    ToggleRight,
    Type,
    UserRound,
    UserRoundPlus,
    Variable,
    Video,
    Wind,
    ZoomIn,
} from "lucide-react";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { Character } from "@/lib/workspace/services/character/Character";
import { Services } from "@/lib/workspace/services/services";
import { useWorkspace } from "@/apps/workspace/context";
import { HeadThumbnail } from "@/apps/workspace/modules/characters/editors/components/HeadThumbnail";
import { useBadgeImageUrl } from "./storyBadgeImageCache";
import { useCharacterAvatar } from "./storyCharacterFace";
import { getCommandGroup, subjectGroupId, type StoryCommandGroupId } from "./storyCommandCategories";
import type { StoryCandidateMark } from "./storyCommandCandidates";
import type { StoryCommandStageObjectKind } from "./storyCommandValues";

/**
 * The leading mark of a command-line candidate: a picture where the thing HAS one, a glyph otherwise.
 *
 * Why a picture at all. The command line's whole bet is that a line of words beats a form, and the
 * one thing words are worse at is identity: `Anyo` `Inko` `Hya` is three strings to recognise, three
 * faces is a glance. The same holds for a background (`forest_day` vs. the forest) and for an
 * appearance (`平常` vs. the actual expression). So anything backed by an image draws it, and
 * everything else draws the glyph that says what *kind* of thing it is — which is the answer to the
 * second question a candidate list gets asked ("what am I even picking here?").
 *
 * Two colour rules, both inherited rather than invented:
 *  - a candidate that names a SUBJECT (a character, an image, a scene, a sound) wears that subject's
 *    hue from {@link getCommandGroup} — the command menu's own rule, so a candidate and the verb that
 *    will consume it agree about what colour that subject is;
 *  - a candidate that is a piece of GRAMMAR (a word from a list, a number, a boolean) stays neutral.
 *    Colouring those would say "subject" about something that is not one, and a menu where every row
 *    is coloured is a menu where colour means nothing.
 */

/** The box every mark occupies, picture or glyph, so the labels line up in one column. */
const MARK_BOX = "flex h-5 w-5 shrink-0 items-center justify-center";
const GLYPH = "h-4 w-4 shrink-0";

/**
 * The glyph for a word that means itself: an enum option or a keyword.
 *
 * Keyed on the CANONICAL value the grammar declares (never on the locale's spelling), which is what
 * lets 向左滑动 and `slide-left` draw the same arrow. A word with no entry simply keeps the generic
 * list glyph — this table is an aid to reading, not a registry anything has to be added to.
 */
const WORD_GLYPHS: Readonly<Record<string, typeof Hash>> = {
    // Placements (`at=`, and `/camera pan`'s knob).
    left: AlignHorizontalJustifyStart,
    center: AlignHorizontalJustifyCenter,
    right: AlignHorizontalJustifyEnd,
    // The unified transition vocabulary. Each glyph draws the SHAPE of the change, so a list of
    // fifteen words reads as a list of fifteen looks.
    fade: Blend,
    slide: MoveHorizontal,
    "slide-left": ArrowLeft,
    "slide-right": ArrowRight,
    "slide-up": ArrowUp,
    "slide-down": ArrowDown,
    circle: Circle,
    wipe: Columns2,
    iris: Aperture,
    blur: Droplet,
    blinds: AlignJustify,
    "barn-door": DoorOpen,
    clock: Clock,
    fan: Fan,
    dots: Grip,
    black: PaintBucket,
    darkness: Moon,
    zoom: ZoomIn,
    scale: Scaling,
    rotate: RotateCw,
    opacity: Contrast,
    darken: SunDim,
    none: Ban,
    // `/camera`'s operations (zoom · rotate · darken are the transition words above).
    pan: Move,
    motion: Film,
    reset: RotateCcw,
    // A variable declaration's `type=`.
    boolean: ToggleLeft,
    number: Hash,
    string: Type,
    json: Braces,
    // `/wait click`.
    click: MousePointerClick,
};

/** The subject a mark belongs to, when it names one — else `null`, which is what keeps it neutral. */
function markGroup(mark: StoryCandidateMark): StoryCommandGroupId | null {
    switch (mark.kind) {
        case "character":
        case "appearance":
        case "puppetChannel":
        case "puppetParam":
            return "character";
        // `freeName` is deliberately absent: a name with nobody behind it stays neutral, so 角色's own
        // hue keeps meaning "this is a character in your project" and picking a temp speaker never
        // looks like picking one.
        case "asset":
            return mark.assetType === "audio" ? "sound" : mark.assetType === "video" ? "video" : "image";
        case "stageObject":
            return subjectGroupId(mark.objectKind);
        case "audioTrack":
            return "sound";
        case "scene":
        case "label":
        case "choiceOption":
            return "scene";
        case "variable":
        case "blueprint":
        case "function":
        case "expression":
            return "data";
        default:
            return null;
    }
}

/** A named thing on stage, by kind — the same four-plus-two subjects the row badges already picture. */
function stageObjectGlyph(kind: StoryCommandStageObjectKind): typeof Hash {
    switch (kind) {
        case "image":
            return ImageIcon;
        case "text":
            return Type;
        case "layer":
            return Layers;
        case "video":
            return Video;
        case "audio":
            return Music;
        case "vfx":
            return Wind;
    }
}

/** The glyph for a mark that draws no picture — or that has one and could not load it. */
function markGlyph(mark: StoryCandidateMark): typeof Hash {
    switch (mark.kind) {
        case "asset":
            return mark.assetType === "audio" ? Music : mark.assetType === "video" ? Video : ImageIcon;
        case "character":
            return UserRound;
        case "freeName":
            return UserRoundPlus;
        // A stage singleton: the camera, the background, a built-in layer. One glyph for all four -
        // what they have in common (nobody made them, and they are always there) is the whole fact
        // the mark has to carry.
        case "reservedTarget":
            return Aperture;
        case "appearance":
            return Smile;
        case "puppetChannel":
            return mark.channel === "motion" ? PersonStanding : mark.channel === "skin" ? Shirt : Smile;
        case "puppetParam":
            return SlidersHorizontal;
        case "scene":
            return MonitorPlay;
        case "label":
            return Flag;
        case "choiceOption":
            return MessageSquare;
        case "audioTrack":
            return AudioLines;
        case "appTag":
            return Package;
        case "variable":
            switch (mark.valueType) {
                case "boolean":
                    return ToggleLeft;
                case "number":
                    return Hash;
                case "string":
                    return Type;
                case "json":
                    return Braces;
                default:
                    return Variable;
            }
        case "blueprint":
            return Puzzle;
        case "function":
            return Sigma;
        case "boolean":
            return mark.value ? ToggleRight : ToggleLeft;
        case "word":
            return WORD_GLYPHS[mark.value] ?? List;
        case "options":
            // The word the list leads with, which is what tells 转场= from 位置= — two rows that both
            // said "a list" were two rows saying nothing.
            return (mark.lead ? WORD_GLYPHS[mark.lead] : undefined) ?? List;
        case "stageObject":
            return stageObjectGlyph(mark.objectKind);
        case "target":
            return Focus;
        case "content":
            return Replace;
        case "number":
            return mark.duration ? Timer : Hash;
        case "color":
            return Palette;
        case "text":
            return Type;
        case "expression":
            return Calculator;
    }
}

function MarkGlyph({ mark }: { mark: StoryCandidateMark }) {
    const Glyph = markGlyph(mark);
    const group = markGroup(mark);
    return (
        <span className={MARK_BOX}>
            <Glyph
                className={[GLYPH, group ? "" : "text-fg-subtle"].join(" ")}
                style={group ? { color: getCommandGroup(group).iconColor } : undefined}
            />
        </span>
    );
}

/**
 * The 160px disk-cached downscale of a project image, by id.
 *
 * The thumbnail rather than the asset: a menu of twenty backgrounds must not decode twenty full-size
 * images to draw twenty 20px squares, and the badge cache already renders, caches and shares exactly
 * that reading (`BadgeImageSource`). A missing asset resolves to `null` and the row keeps its glyph.
 */
function useImageThumbnailUrl(assetId: string | undefined): string | null {
    const { context, isInitialized } = useWorkspace();
    const asset = useMemo<Asset<AssetType.Image> | null>(() => {
        if (!assetId || !context || !isInitialized) {
            return null;
        }
        const assets = context.services.get<AssetsService>(Services.Assets).getAssets();
        return assets?.[AssetType.Image]?.[assetId] ?? null;
    }, [assetId, context, isInitialized]);
    return useBadgeImageUrl(asset ? { kind: "thumbnail", asset } : null);
}

function ImageMark({ mark }: { mark: Extract<StoryCandidateMark, { kind: "asset" }> }) {
    const url = useImageThumbnailUrl(mark.assetId);
    if (!url) {
        return <MarkGlyph mark={mark} />;
    }
    return (
        <span className={MARK_BOX}>
            {/* `cover` on a square: a background is 16:9 and a sprite is tall, and letterboxing either
                into a 20px box leaves a picture too small to recognise. The centre is what identifies
                the image at this size. */}
            <img src={url} alt="" draggable={false} className="h-5 w-5 rounded-sm object-cover" />
        </span>
    );
}

/**
 * A character, or one of their looks.
 *
 * Round and head-cropped, which is the treatment a face already gets inside a committed line
 * (`StoryLineCharacterFace`): the same object should not be a circle in the row and a square in the
 * menu that inserts it. A character with no picture at all falls back to the glyph rather than to an
 * empty circle — a hole where a face should be reads as a failure to load.
 */
function CharacterMark({
    mark,
    character,
}: {
    mark: Extract<StoryCandidateMark, { kind: "character" | "appearance" }>;
    character: Character | undefined;
}) {
    // An appearance names one look and must picture THAT look; a bare character name is asking "who",
    // which the author's own avatar answers best.
    const appearance = mark.kind === "appearance" ? mark : null;
    const { url, frame, showingSprite } = useCharacterAvatar(character, {
        pose: appearance && !appearance.axisId ? appearance.refId : undefined,
        tags: appearance?.axisId && appearance.refId ? { [appearance.axisId]: appearance.refId } : undefined,
        resolveVariant: true,
        preferThumbnail: appearance === null,
    });
    if (!url) {
        return <MarkGlyph mark={mark} />;
    }
    return (
        <span className={[MARK_BOX, "overflow-hidden rounded-full bg-fill-subtle"].join(" ")}>
            {showingSprite
                ? <HeadThumbnail url={url} alt="" frame={frame} className="h-full w-full" iconClassName="h-2 w-2" />
                : <img src={url} alt="" draggable={false} className="h-full w-full object-cover" />}
        </span>
    );
}

/**
 * The same mark for a caller that already holds the character record — the speaker picker, whose
 * candidates carry the object rather than an id.
 *
 * It exists so the two menus that open in the SAME slot draw a speaker the same way. They are meant to
 * read as one menu whose contents follow the caret (see this file's neighbour,
 * `StoryCommandCandidateMenu`), and a list of faces next to a list of `#` glyphs reads as two.
 */
export function StoryCandidateSpeakerMark({ character }: { character: Character | null }) {
    return character
        ? <CharacterMark mark={{ kind: "character", characterId: character.profile.getId() }} character={character} />
        : <MarkGlyph mark={{ kind: "freeName" }} />;
}

export function StoryCandidateMarkView({ mark, characters }: { mark: StoryCandidateMark; characters: readonly Character[] }) {
    if (mark.kind === "asset" && mark.assetType === "image" && mark.assetId) {
        return <ImageMark mark={mark} />;
    }
    if ((mark.kind === "character" || mark.kind === "appearance") && mark.characterId) {
        const characterId = mark.characterId;
        return <CharacterMark mark={mark} character={characters.find(entry => entry.profile.getId() === characterId)} />;
    }
    return <MarkGlyph mark={mark} />;
}
