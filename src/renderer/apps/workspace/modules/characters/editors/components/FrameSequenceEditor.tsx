import { ChevronDown, ChevronUp, ImagePlus, X } from "lucide-react";
import { Button } from "@/lib/components/elements/Button";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { Input } from "@/lib/components/elements/Input";
import { SectionCard } from "@/lib/components/elements/SectionCard";
import { Switch } from "@/lib/components/elements/Switch";
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
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { ICON_BTN } from "./iconButton";

function FrameThumbnail({ id }: { id: string }) {
    const { url } = useAssetObjectUrl(id);
    return url ? (
        <img src={url} alt="" className="h-8 w-8 shrink-0 rounded-sm bg-fill object-contain" draggable={false} />
    ) : (
        <span className="h-8 w-8 shrink-0 rounded-sm bg-fill" />
    );
}

/** The previewed pose's PNG frames, as a card in the inspector beside the pose list. */
export function FrameSequenceEditor({
    pose,
    appearance,
}: {
    pose: CharacterPose;
    appearance: CharacterAppearance;
}) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const frozen = freeze.frozen;
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
    const fileInput = useRef<HTMLInputElement>(null);
    const pickFrames = () => fileInput.current?.click();
    const importLabel = t("characters.editor.sequenceImport");
    const move = (index: number, to: number) => {
        if (!sequence) return;
        const frames = [...sequence.frameAssetIds];
        [frames[to], frames[index]] = [frames[index], frames[to]];
        change(frames);
    };
    return (
        <SectionCard
            title={t("characters.editor.sequenceTitle")}
            bodyClassName="space-y-2"
            actions={sequence ? (
                <div className="flex items-center gap-0.5">
                    <button
                        className={ICON_BTN}
                        onClick={pickFrames}
                        aria-label={importLabel}
                        {...freeze.writes(busy, importLabel)}
                    >
                        <ImagePlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                        className={ICON_BTN}
                        onClick={() => appearance.setPoseAsset(pose.id, pose.assetId)}
                        aria-label={t("characters.editor.sequenceStatic")}
                        {...freeze.writes(busy, t("characters.editor.sequenceStatic"))}
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            ) : null}
        >
            <input
                ref={fileInput}
                type="file"
                accept="image/png,.png"
                multiple
                hidden
                onChange={event => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = "";
                    void importFrames(files);
                }}
            />
            {sequence ? (
                <>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                            <FieldLabel as="span" className="mb-0">{t("characters.editor.sequenceFps")}</FieldLabel>
                            <Input
                                aria-label={t("characters.editor.sequenceFps")}
                                size="sm"
                                type="number"
                                min={1}
                                max={120}
                                step={1}
                                value={sequence.fps}
                                className="w-16"
                                {...freeze.writes(busy)}
                                onChange={event => {
                                    const fps = Number(event.target.value);
                                    if (Number.isFinite(fps) && fps >= 1 && fps <= 120)
                                        change(sequence.frameAssetIds, fps);
                                }}
                            />
                        </div>
                        {/* A `div` rather than a wrapping `label`: the shared `Switch` is a `<button>`. */}
                        <div className="flex items-center gap-2">
                            <Switch
                                size="sm"
                                checked={sequence.loop}
                                aria-label={t("characters.editor.sequenceLoop")}
                                {...freeze.writes(busy)}
                                onCheckedChange={loop => change(sequence.frameAssetIds, sequence.fps, loop)}
                            />
                            <FieldLabel as="span" className="mb-0">{t("characters.editor.sequenceLoop")}</FieldLabel>
                        </div>
                    </div>
                    <ol className="max-h-48 space-y-1 overflow-y-auto">
                        {sequence.frameAssetIds.map((id, index) => (
                            <li
                                key={`${id}:${index}`}
                                className="group flex items-center gap-2 rounded-md border border-edge bg-fill-subtle px-2 py-1 text-xs"
                            >
                                <FrameThumbnail id={id} />
                                <span className="flex-1 tabular-nums text-fg-muted">{index + 1}</span>
                                <button
                                    className={ICON_BTN}
                                    aria-label={t("characters.editor.sequenceMoveUp")}
                                    onClick={() => move(index, index - 1)}
                                    {...freeze.writes(busy || index === 0)}
                                >
                                    <ChevronUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    className={ICON_BTN}
                                    aria-label={t("characters.editor.sequenceMoveDown")}
                                    onClick={() => move(index, index + 1)}
                                    {...freeze.writes(busy || index === sequence.frameAssetIds.length - 1)}
                                >
                                    <ChevronDown className="w-3.5 h-3.5" />
                                </button>
                            </li>
                        ))}
                    </ol>
                </>
            ) : (
                <Button size="sm" className="w-full" onClick={pickFrames} {...freeze.writes(busy)}>
                    <ImagePlus className="w-3.5 h-3.5" />
                    {importLabel}
                </Button>
            )}
            {error ? (
                <p role="alert" className="text-2xs text-danger">
                    {error}
                </p>
            ) : null}
        </SectionCard>
    );
}
