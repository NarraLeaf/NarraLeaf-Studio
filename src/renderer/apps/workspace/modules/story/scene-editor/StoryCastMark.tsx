import type { CSSProperties } from "react";
import type { Character } from "@/lib/workspace/services/character/Character";
import { HeadThumbnail } from "@/apps/workspace/modules/characters/editors/components/HeadThumbnail";
import { useCharacterAvatar } from "./storyCharacterFace";
import { storySpeakerInitial, storySpeakerPaint, type StorySpeakerIdentity } from "./storySpeakerIdentity";

/**
 * A cast member's mark: their face when the project has one, their colour disc when it does not.
 *
 * The same two-state treatment the gutter gives a speaker, at list scale — a list of faces beside the
 * scene's own faces is how you pick a name out of it without reading; a column of coloured letters is
 * a legend you have to decode. `preferThumbnail`, because a list asks "who is this" rather than "what
 * do they look like right now": the avatar the author chose answers that better than a head cropped
 * out of whichever sprite the scene last put on stage.
 *
 * Both states are SOLID and both wear the character's own colour (gutter 规范 §3.1, §3.3) — the disc
 * as its fill, the portrait as its hairline. A face too small to recognise still says whose it is.
 *
 * `style` is laid over the mark's own, for a caller that stacks marks and has to cut one out of the
 * next (the outline's cast) — the mark itself has no opinion about its neighbours.
 */
export function StoryCastMark(props: {
    identity: StorySpeakerIdentity;
    character: Character | null;
    size: number;
    style?: CSSProperties;
}) {
    const paint = storySpeakerPaint(props.identity.paint);
    // `resolveVariant` still on under `preferThumbnail`: the thumbnail short-circuits the sprite
    // resolve when there is one, and when there is not, a head cropped from the character's default
    // sprite is a face — falling straight to the disc would blank half a cast nobody has drawn an
    // avatar for. Same pair the `/` menu's candidate list asks for, for the same reason.
    const { url, frame, showingSprite } = useCharacterAvatar(props.character, { resolveVariant: true, preferThumbnail: true });
    if (url) {
        return (
            <span
                className={`${paint.className} block shrink-0 overflow-hidden rounded-full bg-fill-subtle`}
                style={{
                    ...paint.style,
                    width: props.size,
                    height: props.size,
                    borderWidth: 1,
                    borderStyle: "solid",
                    borderColor: "var(--nl-speaker-disc)",
                    ...props.style,
                }}
            >
                {showingSprite
                    ? <HeadThumbnail url={url} alt="" frame={frame} className="h-full w-full" iconClassName="h-2 w-2" />
                    : <img src={url} alt="" draggable={false} className="h-full w-full object-cover" />}
            </span>
        );
    }
    return (
        <span
            className={`${paint.className} flex shrink-0 select-none items-center justify-center rounded-full font-medium leading-none`}
            style={{
                ...paint.style,
                width: props.size,
                height: props.size,
                // The 20px menu mark's 9px, kept in proportion: one CJK glyph (or two Latin letters)
                // fills the disc the same way at any size it is drawn.
                fontSize: Math.round(props.size * 0.45),
                backgroundColor: "var(--nl-speaker-disc)",
                color: "var(--nl-speaker-ink)",
                ...props.style,
            }}
        >
            {storySpeakerInitial(props.identity.name)}
        </span>
    );
}
