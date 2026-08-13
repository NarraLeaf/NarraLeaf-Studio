import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import type { CharacterPose } from "@/lib/workspace/services/character/types";

/**
 * Every pose a preset character has, as pictures.
 *
 * The pane above this used to hold one image — always the default pose — and nothing else, so a
 * character with eight poses showed one of them and the only way to see the fifth was to make it the
 * default, look, and change it back. That is a real edit to the project to answer a question about
 * it.
 *
 * ## A picture and a name, and nothing else
 *
 * The cell carried two more marks: a warning triangle over a pose with no art, and a dot on the
 * default one. Both are gone. The triangle sat on top of the `ImageOff` placeholder that already
 * says the same thing, over a third statement of it as an error row in the problems list; and
 * "default" is a property the author *sets*, which happens in the pose list beside this — saying it
 * in two places is how the word ended up meaning "is default" on one surface and "make default" on
 * the other.
 */
function Frame(props: {
    pose: CharacterPose;
    active: boolean;
    onPick: () => void;
}) {
    const { url } = useAssetObjectUrl(props.pose.assetId);
    return (
        <button
            className={cn(
                "flex w-20 shrink-0 flex-col gap-1 rounded-md border p-1 text-2xs transition-colors",
                props.active ? "border-primary/60 bg-primary/10" : "border-edge hover:bg-fill-subtle",
            )}
            onClick={props.onPick}
            data-tip={props.pose.name}
        >
            <span className="grid h-16 w-full place-items-center overflow-hidden rounded-sm bg-fill">
                {url
                    ? <img src={url} alt="" draggable={false} className="h-full w-full object-contain" />
                    : <ImageOff className="h-4 w-4 text-fg-subtle" />}
            </span>
            <span className="w-full truncate text-left text-fg-muted">{props.pose.name}</span>
        </button>
    );
}

export function PoseFilmstrip(props: {
    poses: CharacterPose[];
    /** The pose the big preview is showing. */
    activePoseId: string | null;
    /** Preview only — the default pose is set from the row list, and only there. */
    onPick: (poseId: string) => void;
}) {
    if (props.poses.length === 0) {
        return null;
    }
    return (
        <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-edge px-3 py-2">
            {props.poses.map(pose => (
                <Frame
                    key={pose.id}
                    pose={pose}
                    active={pose.id === props.activePoseId}
                    onPick={() => props.onPick(pose.id)}
                />
            ))}
        </div>
    );
}
