import { useTranslation } from "@/lib/i18n";
import type { Character } from "@/lib/workspace/services/character/Character";
import { StoryCastMark } from "../scene-editor/StoryCastMark";
import { characterIdentity } from "../scene-editor/StoryRowGutter";

/** One face in the stack: just under the row's 20px name line, so the row does not grow for it. */
const CAST_FACE_PX = 18;
/**
 * The faces of the characters a scene puts on stage, side by side, with `+N` for the ones past `max`.
 *
 * Side by side rather than stacked: overlapped at this size, the second face covered the initials of
 * the first (`Ao` read as `A`), and initials are what a character without a portrait has.
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
        <span className="flex shrink-0 items-center gap-0.5" data-tip={label} aria-label={label} role="img">
            {shown.map(member => (
                <StoryCastMark
                    key={member.id}
                    identity={characterIdentity(member.id, props.characters)}
                    character={member.character}
                    size={CAST_FACE_PX}
                />
            ))}
            {hidden > 0 ? <span className="ml-1 text-2xs tabular-nums text-fg-subtle">+{hidden}</span> : null}
        </span>
    );
}
