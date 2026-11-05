import type { CSSProperties } from "react";
import { useTranslation } from "@/lib/i18n";
import type { Character } from "@/lib/workspace/services/character/Character";
import { StoryCastMark } from "../scene-editor/StoryCastMark";
import { characterIdentity } from "../scene-editor/StoryRowGutter";

/** One face in the stack: just under the row's 20px name line, so the row does not grow for it. */
const CAST_FACE_PX = 18;
/** How far each face slides under the one before it. */
const CAST_OVERLAP_PX = 5;
/** The sliver of background left between two overlapping faces. */
const CAST_GAP_PX = 1.5;

/**
 * The gap between a face and the one before it, cut out of the later face rather than drawn as a ring
 * in the row's colour. A ring has to know what is behind the row, and the outline can sit on the
 * panel colour, on its hover fill, or on a custom background picture; a cut-out shows whichever it is.
 */
const CAST_CUTOUT = (() => {
    const radius = CAST_FACE_PX / 2 + CAST_GAP_PX;
    const mask = `radial-gradient(circle at ${CAST_OVERLAP_PX - CAST_FACE_PX / 2}px 50%, transparent ${radius}px, #000 ${radius + 0.5}px)`;
    return { marginLeft: -CAST_OVERLAP_PX, maskImage: mask, WebkitMaskImage: mask } satisfies CSSProperties;
})();

/**
 * The faces of the characters a scene puts on stage, overlapped, with `+N` for the ones past `max`.
 *
 * Ids that name no character in this project draw nothing: there is no face or name to give them, and
 * the scene editor already reports them. The tooltip names the whole cast, hidden ones included.
 */
export function StoryOutlineCast(props: { characterIds: readonly string[]; characters: Character[]; max: number }) {
    const { t, formatList } = useTranslation();
    const members = props.characterIds.flatMap(id => {
        const character = props.characters.find(candidate => candidate.profile.getId() === id);
        return character ? [{ id, character }] : [];
    });
    if (members.length === 0) {
        return null;
    }
    const shown = members.slice(0, props.max);
    const hidden = members.length - shown.length;
    const label = t("story.panel.castLabel", { names: formatList(members.map(member => member.character.profile.getName()), { style: "narrow" }) });
    return (
        <span className="flex shrink-0 items-center" data-tip={label} aria-label={label} role="img">
            {shown.map((member, index) => (
                <StoryCastMark
                    key={member.id}
                    identity={characterIdentity(member.id, props.characters)}
                    character={member.character}
                    size={CAST_FACE_PX}
                    style={index > 0 ? CAST_CUTOUT : undefined}
                />
            ))}
            {hidden > 0 ? <span className="ml-1 text-2xs tabular-nums text-fg-subtle">+{hidden}</span> : null}
        </span>
    );
}
