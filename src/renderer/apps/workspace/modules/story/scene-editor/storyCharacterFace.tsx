import { useCallback } from "react";
import type { StoryBlock, StoryCharacterTagSelection } from "@shared/types/story";
import { representativeAssetId } from "@shared/utils/characterVariant";
import { HeadThumbnail } from "@/apps/workspace/modules/characters/editors/components/HeadThumbnail";
import { useWorkspace } from "@/apps/workspace/context";
import { useCompositedSprite } from "@/lib/workspace/hooks/useCompositedSprite";
import type { NormalizedCrop } from "@/lib/utils/headCrop";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { Character } from "@/lib/workspace/services/character/Character";
import { Services } from "@/lib/workspace/services/services";
import { useBadgeImageUrl, type BadgeImageSource } from "./storyBadgeImageCache";
import type { CharacterAppearanceRef } from "./storySceneEditorTypes";

/**
 * Whose face a row draws, and where.
 *
 * The two surfaces resolve DIFFERENT rows, which is the whole point of naming them:
 *
 *  - **`plate`** — the row's leading box. Only a dialogue row keeps a face there, because on a
 *    dialogue row the plate IS the attribution: the face, the name column and the words are one
 *    sentence read left to right.
 *  - **`inline`** — a face drawn in the middle of the words, immediately before the name it belongs
 *    to. That is where a character *command* pictures itself (`/show Anyo …`), so its plate is free to
 *    carry the command's own glyph like every other directive's — a row of commands then reads down
 *    as a column of verbs instead of a column of portraits, and the face still sits on the one token
 *    it is about.
 */
export type StoryFaceSurface = "plate" | "inline";

/**
 * Which character and appearance a row pictures on `surface`, and whether to resolve a
 * differential-specific sprite (vs. fall straight through to the profile thumbnail).
 *
 * A character action row (`/show`, `/face`…) pictures its own payload's form/variants — inline only. A
 * dialogue row pictures the speaker's accumulated appearance — on its plate only, and only when
 * one exists; a speaker who has not been shown keeps the plain thumbnail, so a line before any `/show`
 * does not invent a look.
 */
function getFaceSpec(
    block: StoryBlock,
    appearance: CharacterAppearanceRef | undefined,
    surface: StoryFaceSurface,
): { characterId: string; pose?: string; tags?: StoryCharacterTagSelection; resolveVariant: boolean } | null {
    if (surface === "inline") {
        return block.kind === "action" && block.payload.action === "character" && block.payload.characterId
            ? { characterId: block.payload.characterId, pose: block.payload.pose, tags: block.payload.tags, resolveVariant: true }
            : null;
    }
    if (block.kind === "nodeAction" && block.payload.action === "dialogue" && block.payload.characterId) {
        // Only a *shown* appearance pictures an avatar — a placement-only appearance (a `/move` on a
        // never-shown speaker, used by the group-header dropdown) must not invent a look.
        return { characterId: block.payload.characterId, pose: appearance?.pose, tags: appearance?.tags, resolveVariant: appearance?.shown === true };
    }
    return null;
}

/**
 * Longest edge of a composited face sprite. The plate itself tops out at 40px (the comfortable
 * density) and the head crop reads a sub-rectangle of it, so this is the largest useful size at 2x.
 */
const FACE_COMPOSITE_PX = 96;

/**
 * The sprite `Asset` + portrait frame a character face should picture, resolved against the same
 * rule the runtime uses (shared `representativeAssetId`). The frame is the pose's own portrait
 * override, else the profile default; `undefined` lets the face fall back to the automatic head
 * crop. The `Asset` object (not just its id) is returned because a sprite is a *project* asset and
 * loads through the asset library, not the editor store.
 *
 * A layered character has no single sprite: this returns its bottom-most drawing layer, which the
 * face uses only until the composite of the whole stack arrives (and as the fallback when the
 * compositor cannot draw). See {@link useCharacterFace}.
 */
function resolveCharacterFaceImage(
    character: Character,
    pose: string | undefined,
    tags: StoryCharacterTagSelection | undefined,
    lookupAsset: (assetId: string) => Asset<AssetType.Image> | null,
): { asset: Asset<AssetType.Image> | null; frame?: NormalizedCrop } {
    const appearance = character.profile.appearance;
    const summary = appearance.getKind() === "preset"
        ? { kind: "preset" as const, poses: appearance.getPoses().map(p => ({ id: p.id, name: p.name, assetId: p.assetId })), defaultPoseId: appearance.getDefaultPoseId() }
        : { kind: "layered" as const, canvas: appearance.getCanvas(), axes: appearance.getAxes(), layers: appearance.getLayers() };
    const assetId = representativeAssetId(summary, { poseId: pose, tags });
    const frame = (pose ? appearance.getPose(pose)?.portrait : undefined) ?? character.profile.getPortrait();
    return { asset: assetId ? lookupAsset(assetId) : null, frame };
}

/**
 * The framed avatar a row pictures on `surface`: the differential sprite when a look applies (loaded
 * from the project asset library, framed on the face), else the character thumbnail (an editor asset,
 * already a square crop). Both share the id-keyed object-URL cache so one sprite is read — and its
 * head located — once no matter how many rows show it.
 */
export function useCharacterFace(
    block: StoryBlock,
    appearance: CharacterAppearanceRef | undefined,
    characters: Character[],
    surface: StoryFaceSurface,
): { url: string | null; frame?: NormalizedCrop; showingSprite: boolean } {
    const spec = getFaceSpec(block, appearance, surface);
    const character = spec ? characters.find(next => next.profile.getId() === spec.characterId) : undefined;
    return useCharacterAvatar(character, {
        pose: spec?.pose,
        tags: spec?.tags,
        resolveVariant: spec?.resolveVariant === true,
    });
}

/**
 * The same picture, addressed by character + look rather than by row — what a *list* of characters or
 * of appearances needs, since a menu has no block to read a spec off.
 *
 * `preferThumbnail` is the one difference a list wants: a row pictures the look its payload names, but
 * a candidate list is asking "who is this", and the author-chosen avatar answers that better than a
 * head cropped out of a full-body sprite. It stays opt-in, because on a row it would be wrong twice
 * over — a `/show Alice angry` must picture *angry*, and a speaker who has never been shown must not
 * be given a look they do not have.
 */
export function useCharacterAvatar(
    character: Character | null | undefined,
    spec: {
        pose?: string;
        tags?: StoryCharacterTagSelection;
        /** Resolve the sprite for that look at all. False leaves the profile thumbnail as the only source. */
        resolveVariant: boolean;
        preferThumbnail?: boolean;
    },
): { url: string | null; frame?: NormalizedCrop; showingSprite: boolean } {
    // The appearance stores asset ids; the image cache needs the `Asset` record to fetch bytes, so
    // the id is resolved against the live library here rather than embedded in the character store
    // (which is what the old variant slots did, and what made a renamed or replaced asset go stale).
    const { context, isInitialized } = useWorkspace();
    const lookupAsset = useCallback((assetId: string): Asset<AssetType.Image> | null => {
        if (!context || !isInitialized) {
            return null;
        }
        const assets = context.services.get<AssetsService>(Services.Assets).getAssets();
        return assets?.[AssetType.Image]?.[assetId] ?? null;
    }, [context, isInitialized]);
    const thumbnailId = character?.profile.getThumbnail() ?? null;
    // The avatar the author chose wins outright when the caller asked for it, and asking the library
    // for a sprite nobody will look at is work: skip the resolve and the composite both.
    const thumbnailWins = spec.preferThumbnail === true && thumbnailId !== null;
    const pictureLook = character !== null && character !== undefined && spec.resolveVariant && !thumbnailWins;
    const resolved = character && pictureLook
        ? resolveCharacterFaceImage(character, spec.pose, spec.tags, lookupAsset)
        : { asset: null as Asset<AssetType.Image> | null, frame: undefined };
    const source: BadgeImageSource | null = resolved.asset
        ? { kind: "project", asset: resolved.asset }
        : thumbnailId
            ? { kind: "editor", fileId: thumbnailId }
            : null;
    const fallbackUrl = useBadgeImageUrl(source);
    // A layered character is a stack, so the face shows the whole thing composited. The single-asset
    // path above still runs: it is what the face shows while the composite is being drawn, which
    // keeps a scrolling list from flashing empty plates.
    const layered = character && pictureLook && character.profile.appearance.getKind() === "layered"
        ? character
        : null;
    const composite = useCompositedSprite(layered, { tags: spec.tags }, FACE_COMPOSITE_PX);
    const url = composite.url ?? fallbackUrl;
    return { url, frame: resolved.frame, showingSprite: Boolean(composite.url) || resolved.asset !== null };
}

/**
 * The face a command line draws inside itself, immediately before the name it belongs to.
 *
 * Sized in `em` and aligned to the baseline rather than given a box of its own: it is a glyph in the
 * sentence, not a column beside it. That is the whole brief — a portrait plate hoisted into the text
 * would cut the line in two exactly where the reading is meant to be continuous (`显示 [face]Anyo`),
 * so it takes the line's own metrics, follows its font size across the density tiers, and wears no
 * border. It renders nothing at all when the character has no picture, which leaves the line the plain
 * words it always was rather than a hole where a face should be.
 */
export function StoryLineCharacterFace({ block, characters }: { block: StoryBlock; characters: Character[] }) {
    const { url, frame, showingSprite } = useCharacterFace(block, undefined, characters, "inline");
    if (!url) {
        return null;
    }
    return (
        <span
            aria-hidden
            // Round, and the same round the group-expression bead already uses: a face folded into a
            // line is the same object in both places, and a circle is the one shape that reads as
            // "somebody" at 20px without also reading as a control. The row's square plate keeps its
            // own rule — that is a column of furniture, this is a glyph in a sentence.
            className="mr-[0.3em] inline-block h-[1.3em] w-[1.3em] overflow-hidden rounded-full bg-fill-subtle align-[-0.33em]"
        >
            {showingSprite ? (
                <HeadThumbnail url={url} alt="" frame={frame} className="h-full w-full" iconClassName="h-2 w-2" />
            ) : (
                <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
            )}
        </span>
    );
}
