import type { PortraitCrop } from "@shared/types/character/model";
import { readImageDimensions } from "@shared/utils/imageDimensions";
import { AssetType } from "../assets/assetTypes";
import type { AssetsService } from "../core/AssetsService";

/**
 * The framing a `preset` pose's dialog avatar is cut with when the author framed neither this pose
 * nor the character: the framing of another pose whose picture is the same size.
 *
 * The automatic head crop locates the head from the sprite's silhouette, and for a character whose
 * silhouette tops out in hair ornaments or ears it frames those and not the face. The author fixes it
 * by framing the pose they are looking at - and the next pose they add, a second expression drawn on
 * the same canvas, came back to the automatic crop: the dialogue box showed the face for one line and
 * the top of her head for the next. A differential the same size as a framed one is that framed
 * picture with a different face, so its face is in the same place.
 *
 * Normalised crops would fit a picture of another size too, but a picture of another size is not
 * known to be the same composition - a bust-up beside a full figure - so those keep the automatic
 * crop. The default pose is asked first, then the others in their order.
 *
 * Only ever the last arm before the automatic crop: this pose's own framing and the character's
 * framing are the author's word about this picture, and both win.
 */
export function inheritedPosePortrait(input: {
    poses: readonly { id: string; assetId?: string | null; portrait?: PortraitCrop }[];
    defaultPoseId: string | null;
    poseId: string;
    /** The picture's size, or null while it is not known (which inherits nothing). */
    sizeOf: (assetId: string) => ImageSize | null | undefined;
}): PortraitCrop | undefined {
    const pose = input.poses.find(candidate => candidate.id === input.poseId);
    const size = pose?.assetId ? input.sizeOf(pose.assetId) : null;
    if (!pose || pose.portrait || !size) {
        return undefined;
    }
    const ordered = [
        ...input.poses.filter(candidate => candidate.id === input.defaultPoseId),
        ...input.poses.filter(candidate => candidate.id !== input.defaultPoseId),
    ];
    for (const candidate of ordered) {
        if (candidate.id === pose.id || !candidate.portrait || !candidate.assetId) {
            continue;
        }
        const other = input.sizeOf(candidate.assetId);
        if (other && other.width === size.width && other.height === size.height) {
            return candidate.portrait;
        }
    }
    return undefined;
}

export type ImageSize = { width: number; height: number };

/** Sizes by asset id and content hash, so a picture replaced in place is measured again. */
const measured = new Map<string, Promise<ImageSize | null>>();

/**
 * A project image's pixel size, read from its header and remembered for the session.
 *
 * Asked for every pose of a character a framing could be inherited between, by the bake and by the
 * editor surfaces that show the same avatar, so it is read once per picture rather than per render.
 */
export function measureImageAsset(assets: AssetsService, assetId: string): Promise<ImageSize | null> {
    const asset = assets.getAssets()[AssetType.Image]?.[assetId];
    if (!asset) {
        return Promise.resolve(null);
    }
    const key = `${assetId}:${asset.hash ?? ""}`;
    const known = measured.get(key);
    if (known) {
        return known;
    }
    const pending = (async (): Promise<ImageSize | null> => {
        try {
            const result = await assets.fetch(asset);
            if (!result.success || !result.data) {
                return null;
            }
            const metadata = result.data.metadata as { width?: unknown; height?: unknown } | undefined;
            if (typeof metadata?.width === "number" && typeof metadata.height === "number" && metadata.width > 0 && metadata.height > 0) {
                return { width: metadata.width, height: metadata.height };
            }
            const header = readImageDimensions(new Uint8Array(result.data.data as ArrayLike<number>));
            return header ? { width: header.width, height: header.height } : null;
        } catch {
            return null;
        }
    })();
    measured.set(key, pending);
    // A failed read is not remembered: the file may be there on the next ask.
    void pending.then(size => {
        if (!size && measured.get(key) === pending) {
            measured.delete(key);
        }
    });
    return pending;
}

/** The sizes of every pose picture a `preset` character draws, for {@link inheritedPosePortrait}. */
export async function measurePosePictures(
    assets: AssetsService,
    poses: readonly { assetId?: string | null }[],
): Promise<Record<string, ImageSize>> {
    const ids = [...new Set(poses.map(pose => pose.assetId).filter((id): id is string => Boolean(id)))];
    const sizes: Record<string, ImageSize> = {};
    await Promise.all(ids.map(async id => {
        const size = await measureImageAsset(assets, id);
        if (size) {
            sizes[id] = size;
        }
    }));
    return sizes;
}
