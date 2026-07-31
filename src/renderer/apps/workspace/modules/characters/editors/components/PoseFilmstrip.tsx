import { AlertTriangle, ImageOff } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
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
 * The strip answers three questions at a glance that the row list only answers by reading: how many
 * poses there are, which one is the default, and which ones have no art yet. The last one is the one
 * that matters — a pose with no art is silent everywhere else in the editor.
 */
function Frame(props: {
    pose: CharacterPose;
    active: boolean;
    isDefault: boolean;
    onPick: () => void;
}) {
    const { t } = useTranslation();
    const { url } = useAssetObjectUrl(props.pose.assetId);
    return (
        <button
            className={[
                "group/pose flex w-20 shrink-0 flex-col gap-1 rounded-md border p-1 text-2xs transition-colors",
                props.active ? "border-primary/60 bg-primary/10" : "border-edge hover:bg-fill-subtle",
            ].join(" ")}
            onClick={props.onPick}
            title={props.pose.name}
        >
            <span className="relative grid h-16 w-full place-items-center overflow-hidden rounded-sm bg-fill">
                {url
                    ? <img src={url} alt="" draggable={false} className="h-full w-full object-contain" />
                    : <ImageOff className="h-4 w-4 text-fg-subtle" />}
                {!props.pose.assetId && (
                    <AlertTriangle
                        className="absolute right-0.5 top-0.5 h-3 w-3 text-warning"
                        aria-label={t("characters.editor.poseNoArt")}
                    />
                )}
            </span>
            <span className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-left text-fg-muted">{props.pose.name}</span>
                {props.isDefault && (
                    <span className="shrink-0 text-primary" aria-label={t("characters.variantsPanel.default")}>·</span>
                )}
            </span>
        </button>
    );
}

export function PoseFilmstrip(props: {
    poses: CharacterPose[];
    /** The pose the big preview is showing. */
    activePoseId: string | null;
    defaultPoseId: string | null;
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
                    isDefault={pose.id === props.defaultPoseId}
                    onPick={() => props.onPick(pose.id)}
                />
            ))}
        </div>
    );
}
