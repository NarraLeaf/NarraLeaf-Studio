import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { useWorkspace } from "@/apps/workspace/context";
import { Input } from "@/lib/components/elements/Input";
import { Select } from "@/lib/components/elements/Select";
import { useTranslation } from "@/lib/i18n";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { CharacterAppearance } from "@/lib/workspace/services/character/CharacterAppearance";
import type { PuppetDefaultState } from "@/lib/workspace/services/character/types";
import { listProjectPuppetRuntimes } from "@/lib/workspace/services/puppet/projectPuppetRuntimes";
import {
    puppetChoiceOptions,
    type PuppetDescriptionRequest,
} from "@/lib/workspace/services/puppet/puppetDescriptionModel";
import { Services } from "@/lib/workspace/services/services";
import { Box, FolderOpen, RefreshCw, X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PuppetPreview } from "./PuppetPreview";
import { puppetDescribeStatusKey, puppetDescriptionRequestFor, usePuppetDescription } from "./usePuppetDescription";

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
 * One of the three names the engine's `PuppetState` is made of.
 *
 * A `<Select>` when the model listed any, free text when it did not — decided per field, not per
 * model, because a skeleton with eleven animations and no expressions should still get a list for
 * its animations. The fallback is not a degraded mode: a backend is free to implement no
 * `describe()` at all, and typing a name has to keep working when it does.
 */
function ChoiceField(props: {
    label: string;
    placeholder: string;
    available: readonly string[];
    value: string | null;
    onChange: (value: string | null) => void;
}) {
    const { available, value } = props;
    const options = puppetChoiceOptions(available, value);
    if (options.length === 0) {
        return (
            <Field label={props.label}>
                <Input
                    size="sm"
                    fullWidth
                    value={value ?? ""}
                    placeholder={props.placeholder}
                    onChange={event => props.onChange(event.target.value)}
                />
            </Field>
        );
    }
    return (
        <Field label={props.label}>
            <Select
                options={[
                    // The empty option is the engine's `null`, which is a real state - the model
                    // rests with nothing applied - and not the absence of a choice.
                    { value: "", label: props.placeholder },
                    ...options.map(name => ({ value: name, label: name })),
                ]}
                value={value ?? ""}
                size="sm"
                fullWidth
                portalMenu
                onChange={next => props.onChange(String(next) || null)}
            />
        </Field>
    );
}

/**
 * The inspector for a character an author-supplied runtime draws.
 *
 * Studio knows four things about a puppet — which model, which runtime draws it, which file in the
 * bundle to enter through, how big the box is — and cannot know a fifth by reading the files: what
 * the model can *do* is the backend's vocabulary, locked inside a `.moc3` or a `.skel` Studio is
 * never going to learn to parse.
 *
 * So it does not parse them. It mounts the model and asks it, through the engine's
 * `PuppetInstance.describe()`, and fills the three state controls from the answer. The same mount,
 * with its container on screen, is the preview above them. When there is no answer — no runtime
 * installed, or a backend that does not describe its models — every control degrades to free text
 * and nothing else changes.
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
    const defaultState: PuppetDefaultState = appearance.getPuppetDefaultState();

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
        void listProjectPuppetRuntimes(context.project).then(names => {
            if (!cancelled) setBackends(names);
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

    /**
     * What the description lookup is asked about. Memoised on the puppet's individual fields rather
     * than on the appearance object, which is mutable and the same reference across an edit.
     */
    const request = useMemo<PuppetDescriptionRequest | null>(
        () => puppetDescriptionRequestFor(appearance),
        [appearance, puppet?.assetId, puppet?.backend, puppet?.entry, puppet?.options, puppet?.size],
    );

    const { result, loading, refresh } = usePuppetDescription(request);
    const description = result?.status === "ok" ? result.description : null;

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
            <PuppetPreview request={request} state={defaultState} />

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

            {/* The pose the character rests in, in the engine's own words. Filled from what the
                model said about itself; free text when it said nothing. */}
            <ChoiceField
                label={t("characters.editor.puppet.motion")}
                placeholder={t("characters.editor.puppet.stateNone")}
                available={description?.motions ?? []}
                value={defaultState.motion}
                onChange={value => appearance.setPuppetDefaultState("motion", value)}
            />
            <ChoiceField
                label={t("characters.editor.puppet.expression")}
                placeholder={t("characters.editor.puppet.stateNone")}
                available={description?.expressions ?? []}
                value={defaultState.expression}
                onChange={value => appearance.setPuppetDefaultState("expression", value)}
            />
            <ChoiceField
                label={t("characters.editor.puppet.skin")}
                placeholder={t("characters.editor.puppet.skinDefault")}
                available={description?.skins ?? []}
                value={defaultState.skin}
                onChange={value => appearance.setPuppetDefaultState("skin", value)}
            />

            {/* One line saying where the three lists above came from, and the way to take them
                again. A description is a reading of files that change outside Studio, so the
                author needs to be able to see that it is stale and act on it. */}
            {request && (
                <div className="flex items-center gap-2 px-2 text-2xs text-fg-subtle">
                    <span className="min-w-0 flex-1 truncate">
                        {loading
                            ? t("characters.editor.puppet.describing")
                            : t(puppetDescribeStatusKey(result?.status === "unavailable" ? result.reason : null))}
                    </span>
                    <button
                        className={ICON_BTN}
                        aria-label={t("characters.editor.puppet.redescribe")}
                        title={t("characters.editor.puppet.redescribe")}
                        onClick={refresh}
                    >
                        <RefreshCw className={`w-3 h-3${loading ? " animate-spin" : ""}`} />
                    </button>
                </div>
            )}

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
