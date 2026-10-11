import type { Asset, AssetSource } from "@/lib/workspace/services/assets/types";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import type { CharacterPose } from "@shared/types/character/model";
import type { CharacterAppearance } from "@/lib/workspace/services/character/CharacterAppearance";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Services } from "@/lib/workspace/services/services";
import { useWorkspace } from "@/apps/workspace/context";

function FrameThumbnail({ id }: { id: string }) {
    const { url } = useAssetObjectUrl(id);
    return url ? (
        <img src={url} alt="" className="h-8 w-8 object-contain" draggable={false} />
    ) : (
        <span className="h-8 w-8" />
    );
}

export function FrameSequenceEditor({
    pose,
    appearance,
    frozen,
}: {
    pose: CharacterPose;
    appearance: CharacterAppearance;
    frozen: boolean;
}) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const current = useRef({ frozen, sequence: pose.sequence });
    current.current = { frozen, sequence: pose.sequence };
    const sequence = pose.sequence;
    const change = (frames: string[], fps = sequence?.fps ?? 12, loop = sequence?.loop ?? true) => {
        if (!current.current.frozen) appearance.setPoseSequence(pose.id, { frameAssetIds: frames, fps, loop });
    };
    const importFrames = async (files: File[]) => {
        if (!context || frozen || files.length === 0) return;
        setBusy(true);
        setError(null);
        const initial = pose.sequence;
        const assets = context.services.get<AssetsService>(Services.Assets);
        const created: Asset<AssetType.Image, AssetSource>[] = [];
        let committed = false;
        try {
            files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
            let size: { width: number; height: number } | null = null;
            for (const file of files) {
                const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
                const png = [137, 80, 78, 71, 13, 10, 26, 10];
                if (!png.every((byte, index) => bytes[index] === byte))
                    throw new Error(t("characters.editor.sequencePngOnly"));
                const bitmap = await createImageBitmap(file);
                try {
                    if (size && (bitmap.width !== size.width || bitmap.height !== size.height))
                        throw new Error(t("characters.editor.sequenceSizeMismatch"));
                    size = { width: bitmap.width, height: bitmap.height };
                } finally {
                    bitmap.close();
                }
            }
            const ids: string[] = [];
            for (const file of files) {
                if (
                    current.current.frozen ||
                    current.current.sequence !== initial ||
                    appearance.getPose(pose.id) !== pose
                )
                    return;
                const result = await assets.createLocalAssetFromBytes(
                    AssetType.Image,
                    file.name,
                    new Uint8Array(await file.arrayBuffer()),
                );
                if (!result.success) throw new Error(result.error);
                created.push(result.data);
                ids.push(result.data.id);
            }
            if (
                !current.current.frozen &&
                current.current.sequence === initial &&
                appearance.getPose(pose.id) === pose
            ) {
                change(ids);
                committed = true;
            }
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            if (!committed) for (const asset of created) await assets.deleteAsset(asset);
            setBusy(false);
        }
    };
    return (
        <div className="space-y-2 border-b border-edge p-3 text-xs" onClick={event => event.stopPropagation()}>
            <label className="flex items-center gap-2">
                <span>{t("characters.editor.sequenceImport")}</span>
                <input
                    type="file"
                    accept="image/png,.png"
                    multiple
                    disabled={frozen || busy}
                    className="min-w-0 flex-1"
                    onChange={event => {
                        const files = Array.from(event.currentTarget.files ?? []);
                        event.currentTarget.value = "";
                        void importFrames(files);
                    }}
                />
            </label>
            {error ? (
                <p role="alert" className="text-danger">
                    {error}
                </p>
            ) : null}
            {sequence ? (
                <>
                    <div className="flex items-center gap-2">
                        <label>
                            {t("characters.editor.sequenceFps")}{" "}
                            <input
                                type="number"
                                min={1}
                                max={120}
                                step={1}
                                value={sequence.fps}
                                disabled={frozen || busy}
                                className="w-16 rounded border border-edge bg-fill p-1"
                                onChange={event => {
                                    const fps = Number(event.target.value);
                                    if (Number.isFinite(fps) && fps >= 1 && fps <= 120)
                                        change(sequence.frameAssetIds, fps);
                                }}
                            />
                        </label>
                        <label>
                            <input
                                type="checkbox"
                                checked={sequence.loop}
                                disabled={frozen || busy}
                                onChange={event => change(sequence.frameAssetIds, sequence.fps, event.target.checked)}
                            />{" "}
                            {t("characters.editor.sequenceLoop")}
                        </label>
                        <button
                            disabled={frozen || busy}
                            onClick={() => appearance.setPoseAsset(pose.id, pose.assetId)}
                        >
                            {t("characters.editor.sequenceStatic")}
                        </button>
                    </div>
                    <ol className="max-h-40 space-y-1 overflow-auto">
                        {sequence.frameAssetIds.map((id, index) => (
                            <li key={`${id}:${index}`} className="flex items-center gap-2">
                                <FrameThumbnail id={id} />
                                <span className="flex-1">{index + 1}</span>
                                <button
                                    disabled={frozen || busy || index === 0}
                                    aria-label={t("characters.editor.sequenceMoveUp")}
                                    onClick={() => {
                                        const frames = [...sequence.frameAssetIds];
                                        [frames[index - 1], frames[index]] = [frames[index], frames[index - 1]];
                                        change(frames);
                                    }}
                                >
                                    ↑
                                </button>
                                <button
                                    disabled={frozen || busy || index === sequence.frameAssetIds.length - 1}
                                    aria-label={t("characters.editor.sequenceMoveDown")}
                                    onClick={() => {
                                        const frames = [...sequence.frameAssetIds];
                                        [frames[index + 1], frames[index]] = [frames[index], frames[index + 1]];
                                        change(frames);
                                    }}
                                >
                                    ↓
                                </button>
                            </li>
                        ))}
                    </ol>
                </>
            ) : null}
        </div>
    );
}
