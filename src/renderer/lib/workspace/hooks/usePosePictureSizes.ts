import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { measurePosePictures, type ImageSize } from "@/lib/workspace/services/character/poseFraming";

/**
 * The pixel size of every pose picture in `poses`, by asset id, as far as it has been read.
 *
 * For the surfaces that show a `preset` pose's dialog avatar and so have to agree with the bake about
 * which framing it inherits (`inheritedPosePortrait`): the character editor's avatar card and the
 * story rows' faces. Empty until the sizes are read, which inherits nothing - the automatic crop is
 * what shows for that moment, as it did before.
 */
export function usePosePictureSizes(
    poses: readonly { assetId?: string | null }[] | null | undefined,
): Readonly<Record<string, ImageSize>> {
    const { context, isInitialized } = useWorkspace();
    const [sizes, setSizes] = useState<Record<string, ImageSize>>({});
    // Keyed by the asset ids, not the array: the appearance hands back a new array on every read.
    const key = useMemo(() => (poses ?? []).map(pose => pose.assetId ?? "").join("|"), [poses]);
    useEffect(() => {
        if (!context || !isInitialized || !key) {
            return;
        }
        let alive = true;
        const assets = context.services.get<AssetsService>(Services.Assets);
        void measurePosePictures(assets, key.split("|").map(assetId => ({ assetId }))).then(next => {
            if (alive) {
                setSizes(current => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
            }
        });
        return () => {
            alive = false;
        };
    }, [context, isInitialized, key]);
    return sizes;
}
