import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { useWorkspace } from "@/apps/workspace/context";
import { Input } from "@/lib/components/elements/Input";
import { Select } from "@/lib/components/elements/Select";
import { useTranslation } from "@/lib/i18n";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { CharacterAppearance } from "@/lib/workspace/services/character/CharacterAppearance";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { Services } from "@/lib/workspace/services/services";
import { Box, FolderOpen, X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ROW = "flex items-center gap-2 rounded-md border border-edge bg-fill-subtle px-2 py-1.5 text-xs";
const ICON_BTN = "p-1 rounded-md text-fg-muted hover:text-fg hover:bg-fill transition-colors";
const LABEL = "w-16 shrink-0 text-2xs text-fg-muted";

function Field(props: { label: string; children: React.ReactNode }) {
    return (
        <div className={ROW}>
            <span className={LABEL}>{props.label}</span>
            {props.children}
        </div>
    );
}

/**
 * The inspector for a character an author-supplied runtime draws.
 *
 * Four values and nothing else, because four values are the whole of what Studio knows about a
 * puppet: which model, which runtime draws it, which file in the bundle to enter through, and how
 * big the box is. What the model can *do* — its motions, its skins, its parameters — is the
 * backend's vocabulary, readable only from a mounted instance, so it is not enumerated here.
 */
export function PuppetEditor(props: { appearance: CharacterAppearance }) {
    const { appearance } = props;
    const { t } = useTranslation();
    const { context } = useWorkspace();

    const [picking, setPicking] = useState(false);
    const [backends, setBackends] = useState<string[]>([]);
    const anchorRef = useRef<HTMLElement | null>(null);
    const anchorMemo = useMemo(() => ({ current: anchorRef.current }), [picking]);

    const puppet = appearance.getPuppet();

    /**
     * The runtimes the project actually carries — one directory per backend under
     * `runtimes/puppet/`, the same place Dev Mode loads them from. Read from disk rather than from a
     * registry because there is no registry: a runtime is a folder the author dropped in, and the
     * only authority on what is installed is the folder itself.
     */
    useEffect(() => {
        if (!context) {
            return;
        }
        let cancelled = false;
        const filesystem = context.services.get<FileSystemService>(Services.FileSystem);
        void filesystem.list(context.project.resolve(ProjectNameConvention.PuppetRuntimes)).then(result => {
            if (cancelled) {
                return;
            }
            // No such directory is the normal case: most projects use no puppet runtime at all.
            setBackends(result.ok
                ? result.data.filter(entry => entry.type === "directory").map(entry => entry.fileName)
                : []);
        }).catch(() => {
            if (!cancelled) setBackends([]);
        });
        return () => { cancelled = true; };
    }, [context]);

    const modelName = useMemo(() => {
        if (!context || !puppet?.assetId) {
            return null;
        }
        const assets = context.services.get<AssetsService>(Services.Assets).getAssets();
        for (const type of Object.values(AssetType)) {
            const asset = assets[type]?.[puppet.assetId] as Asset | undefined;
            if (asset) {
                return asset.name;
            }
        }
        return null;
    }, [context, puppet?.assetId]);

    const confirmAsset = useCallback((assets: Asset[]) => {
        appearance.setPuppetAsset(assets[0]?.id ?? null);
        setPicking(false);
    }, [appearance]);

    const setDimension = useCallback((dimension: "width" | "height", raw: string) => {
        const value = Number(raw);
        const current = appearance.getPuppet()?.size ?? null;
        if (!Number.isFinite(value) || value <= 0) {
            // Clearing either dimension clears the box: a half-declared size has no meaning, and
            // null is the engine's own default (the stage size) rather than a missing value.
            appearance.setPuppetSize(null);
            return;
        }
        appearance.setPuppetSize({
            width: dimension === "width" ? value : current?.width ?? value,
            height: dimension === "height" ? value : current?.height ?? value,
        });
    }, [appearance]);

    if (!puppet) {
        return null;
    }

    // A backend the project does not carry stays selectable: the runtime is not installed on every
    // machine the story is written on, and dropping the name would rewrite the character silently.
    const backendOptions = [
        ...(puppet.backend && !backends.includes(puppet.backend) ? [puppet.backend] : []),
        ...backends,
    ].map(name => ({ value: name, label: name }));

    return (
        <div className="space-y-1.5">
            <Field label={t("characters.editor.puppet.model")}>
                <span className="min-w-0 flex-1 truncate">
                    {modelName ?? <span className="text-fg-subtle">{t("characters.editor.puppet.noModel")}</span>}
                </span>
                <button
                    className={ICON_BTN}
                    aria-label={t("characters.editor.puppet.selectModel")}
                    onClick={event => { anchorRef.current = event.currentTarget; setPicking(true); }}
                >
                    <FolderOpen className="w-3.5 h-3.5" />
                </button>
                {puppet.assetId && (
                    <button
                        className={ICON_BTN}
                        aria-label={t("characters.editor.puppet.clearModel")}
                        onClick={() => appearance.setPuppetAsset(null)}
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}
            </Field>

            <Field label={t("characters.editor.puppet.backend")}>
                <Select
                    options={backendOptions}
                    value={puppet.backend}
                    placeholder={t("characters.editor.puppet.noBackend")}
                    size="sm"
                    fullWidth
                    portalMenu
                    onChange={value => appearance.setPuppetBackend(String(value))}
                />
            </Field>

            <Field label={t("characters.editor.puppet.entry")}>
                {/* Free text: which files a bundle holds is only knowable after parsing the one
                    it declares as its entry, which is the model runtime's job and not Studio's. */}
                <Input
                    size="sm"
                    fullWidth
                    value={puppet.entry ?? ""}
                    placeholder={t("characters.editor.puppet.entryDefault")}
                    onChange={event => appearance.setPuppetEntry(event.target.value)}
                />
            </Field>

            <Field label={t("characters.editor.puppet.size")}>
                <Input
                    size="sm"
                    type="number"
                    min={1}
                    className="w-20"
                    value={puppet.size?.width ?? ""}
                    placeholder={t("characters.editor.puppet.sizeStage")}
                    onChange={event => setDimension("width", event.target.value)}
                />
                <Box className="w-3 h-3 shrink-0 text-fg-subtle" />
                <Input
                    size="sm"
                    type="number"
                    min={1}
                    className="w-20"
                    value={puppet.size?.height ?? ""}
                    placeholder={t("characters.editor.puppet.sizeStage")}
                    onChange={event => setDimension("height", event.target.value)}
                />
            </Field>

            <AssetSelector
                visible={picking}
                assetType={AssetType.Model}
                selectedIds={puppet.assetId ? [puppet.assetId] : []}
                onClose={() => setPicking(false)}
                onConfirm={confirmAsset}
                anchorRef={anchorMemo}
                title={t("characters.editor.puppet.selectModel")}
                multiple={false}
            />
        </div>
    );
}
