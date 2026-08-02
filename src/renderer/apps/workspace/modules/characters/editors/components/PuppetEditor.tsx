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
import {
    listProjectPuppetRuntimes,
    readPuppetRuntimeInstallState,
    type PuppetRuntimeInstallState,
} from "@/lib/workspace/services/puppet/projectPuppetRuntimes";
import { knownPuppetRuntimeFor } from "@shared/utils/puppetRuntimes";
import { getInterface } from "@/lib/app/bridge";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { PuppetRuntimeInstaller, type PuppetRuntimeInstallTarget } from "./PuppetRuntimeInstaller";
import {
    puppetChoiceOptions,
    type PuppetDescriptionRequest,
} from "@/lib/workspace/services/puppet/puppetDescriptionModel";
import { Services } from "@/lib/workspace/services/services";
import { Box, Download, FolderOpen, FolderPlus, RefreshCw, X } from "lucide-react";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    puppetDescribeStatusKey,
    puppetDescriptionRequestFor,
    usePuppetDescription,
} from "@/lib/workspace/hooks/usePuppetDescription";
import { PuppetPreview } from "./PuppetPreview";

/**
 * The asset type a model bundle is.
 *
 * Aliased once because this surface names it four times — the picker, the import, the "does this project
 * have any" count — and `AssetType.Model` reads as a detail at each of them rather than as the one idea
 * it is: a puppet's model is a directory-shaped asset.
 */
const MODEL_ASSET_TYPE = AssetType.Model;

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
    // Both arms write the character's default state, so both go off while frozen - the dropdown dead
    // rather than merely inert, because picking is the only thing it is for. The free-text arm is
    // `readOnly` instead: the name the author typed is part of what a past version says.
    const freeze = useFreezeGuard();
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
                    readOnly={freeze.frozen}
                    title={freeze.frozen ? freeze.reason : undefined}
                />
            </Field>
        );
    }
    return (
        <Field label={props.label}>
            <Select
                disabled={freeze.frozen}
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

    const freeze = useFreezeGuard();

    const [picking, setPicking] = useState(false);
    const [backends, setBackends] = useState<string[]>([]);
    const [installState, setInstallState] = useState<PuppetRuntimeInstallState>({ status: "absent" });
    const [installing, setInstalling] = useState<PuppetRuntimeInstallTarget | null>(null);
    /** Bumped after an install so the two disk reads below run again. */
    const [diskVersion, setDiskVersion] = useState(0);
    const anchorRef = useRef<HTMLElement | null>(null);
    const anchorMemo = useMemo(() => ({ current: anchorRef.current }), [picking]);

    const puppet = appearance.getPuppet();
    const defaultState: PuppetDefaultState = appearance.getPuppetDefaultState();
    /** The product this character was created for, when it was created for one. */
    const runtime = knownPuppetRuntimeFor(appearance.getKind());

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
    }, [context, diskVersion]);

    /**
     * Whether *this character's* runtime is there, which is a different question from what the project
     * carries: a character created for Live2D on another machine names a backend this project may not
     * have, and the honest answer to that is "not installed here", not an empty dropdown.
     */
    useEffect(() => {
        if (!context || !puppet?.backend) {
            setInstallState({ status: "absent" });
            return;
        }
        let cancelled = false;
        void readPuppetRuntimeInstallState(context.project, puppet.backend).then(state => {
            if (!cancelled) setInstallState(state);
        }).catch(() => {
            if (!cancelled) setInstallState({ status: "absent" });
        });
        return () => { cancelled = true; };
    }, [context, puppet?.backend, diskVersion]);

    const modelAssetCount = useMemo(() => {
        if (!context) {
            return 0;
        }
        const assets = context.services.get<AssetsService>(Services.Assets).getAssets();
        return Object.keys(assets[MODEL_ASSET_TYPE] ?? {}).length;
    }, [context, diskVersion, puppet?.assetId]);

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

    /**
     * Import a model bundle straight from here.
     *
     * A directory picker rather than a file one, because a model *is* a directory — a manifest plus the
     * textures and motions it names — which is also why the asset panel switches to one for this type.
     * Offered here because the alternative was an asset picker with nothing in it: the author who has
     * just made their first Live2D character has no model assets yet, and nothing on this surface said
     * where they come from.
     */
    const importModel = useCallback(async () => {
        if (!context) return;
        const picked = await getInterface().fs.selectDirectory(true);
        if (!picked.success || !picked.data.ok || picked.data.data.length === 0) {
            return;
        }
        const assetsService = context.services.get<AssetsService>(Services.Assets);
        const imported = await assetsService.importFromPaths(MODEL_ASSET_TYPE, picked.data.data);
        const first = imported.success ? imported.data.find(entry => entry.success) : undefined;
        if (first?.success) {
            // Selected as well as imported: the author asked for a model for *this* character, and
            // making them then find it in a picker would be the same gap one step later.
            appearance.setPuppetAsset(first.data.id);
        }
        setDiskVersion(version => version + 1);
    }, [appearance, context]);

    const onInstalled = useCallback((backend: string) => {
        // A runtime that registers a different name than its folder is filed under the registered one,
        // so the character follows what actually landed rather than what was asked for.
        if (puppet && puppet.backend !== backend) {
            appearance.setPuppetBackend(backend);
        }
        setDiskVersion(version => version + 1);
    }, [appearance, puppet]);

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

    /**
     * The two things that have to be true before anything else on this surface means something.
     *
     * A puppet with no runtime cannot be described, previewed or drawn, and a puppet with no model has
     * nothing to describe. The state controls below are filled *from the model*, so showing them first —
     * as this surface used to, as seven equal rows — presented five inert fields as if they were the
     * work. They are hidden until the two are satisfied, and this is what stands in their place.
     */
    const runtimeReady = installState.status === "installed";
    const setupDone = runtimeReady && Boolean(puppet.assetId);

    const runtimeStatusLabel = !puppet.backend
        ? t("characters.editor.puppet.runtimeUnchosen")
        : installState.status === "installed"
            ? t("characters.editor.puppet.runtimeInstalled")
            : installState.status === "incomplete"
                ? t("characters.editor.puppet.runtimeIncomplete")
                : t("characters.editor.puppet.runtimeMissing");

    const installTarget: PuppetRuntimeInstallTarget = runtime
        ? { kind: "known", id: runtime.id }
        : { kind: "custom", suggestedName: puppet.backend };
    const installLabel = runtimeReady
        ? t("characters.editor.puppet.reinstall")
        : t("characters.editor.puppet.install");

    const runtimeRow = (
        <Field label={t("characters.editor.puppet.stepRuntime")}>
            {runtime ? (
                // A named runtime does not get a dropdown: the character was created for this product,
                // and the only question left is whether it is installed.
                <span className="min-w-0 flex-1 truncate">{runtime.productName}</span>
            ) : backendOptions.length === 0 ? (
                // "You have not chosen one" and "there are none to choose" are different situations,
                // and one label for both told the author the project carried no runtimes while two sat
                // in the dropdown. Only the empty list says "installed", and it says where to put one.
                <span
                    className="min-w-0 flex-1 truncate text-fg-subtle"
                    title={t("characters.editor.puppet.noBackendInstalledHint")}
                >
                    {t("characters.editor.puppet.noBackendInstalled")}
                </span>
            ) : (
                // Which runtime draws this character is written onto the appearance, so the dropdown
                // is dead while frozen rather than open-but-inert: the list is the project's runtime
                // folders, not project data, and there is nothing in it to read.
                <Select
                    options={backendOptions}
                    value={puppet.backend}
                    placeholder={t("characters.editor.puppet.chooseBackend")}
                    size="sm"
                    fullWidth
                    portalMenu
                    disabled={freeze.frozen}
                    onChange={value => appearance.setPuppetBackend(String(value))}
                />
            )}
            <span className={runtimeReady ? "shrink-0 text-2xs text-primary" : "shrink-0 text-2xs text-fg-subtle"}>
                {runtimeStatusLabel}
            </span>
            <button
                className={ICON_BTN}
                aria-label={installLabel}
                onClick={() => setInstalling(installTarget)}
                // The freeze guard owns `title` so a frozen workspace can say why the button is off.
                // It writes into `runtimes/`, which is versioned, so an unguarded click would be a
                // silent no-op rather than an install.
                {...freeze.writes(false, installLabel)}
            >
                <Download className="w-3.5 h-3.5" />
            </button>
        </Field>
    );

    const modelRow = (
        <Field label={t("characters.editor.puppet.stepModel")}>
            <span className="min-w-0 flex-1 truncate">
                {modelName ?? <span className="text-fg-subtle">{t("characters.editor.puppet.noModel")}</span>}
            </span>
            {/* An empty picker is not an answer. A project with no model assets gets the import instead,
                because that is the step the author is actually missing. */}
            {modelAssetCount === 0 && !puppet.assetId ? (
                <button
                    className={ICON_BTN}
                    aria-label={t("characters.editor.puppet.importModel")}
                    onClick={() => void importModel()}
                    {...freeze.writes(false, t("characters.editor.puppet.importModel"))}
                >
                    <FolderPlus className="w-3.5 h-3.5" />
                </button>
            ) : (
                <button
                    className={ICON_BTN}
                    aria-label={t("characters.editor.puppet.selectModel")}
                    onClick={event => { anchorRef.current = event.currentTarget; setPicking(true); }}
                    // The picker it opens exists only to set the model on the appearance, so it is
                    // guarded like its two siblings rather than opened onto a confirm that is refused.
                    {...freeze.writes(false, t("characters.editor.puppet.selectModel"))}
                >
                    <FolderOpen className="w-3.5 h-3.5" />
                </button>
            )}
            {puppet.assetId && (
                <button
                    className={ICON_BTN}
                    aria-label={t("characters.editor.puppet.clearModel")}
                    onClick={() => appearance.setPuppetAsset(null)}
                    {...freeze.writes()}
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            )}
        </Field>
    );

    const installer = (
        <PuppetRuntimeInstaller
            visible={installing !== null}
            target={installing ?? installTarget}
            onClose={() => setInstalling(null)}
            onInstalled={onInstalled}
        />
    );

    if (!setupDone) {
        return (
            <div className="space-y-1.5">
                <p className="px-1 text-2xs tracking-wide text-fg-muted">
                    {t("characters.editor.puppet.setupTitle")}
                </p>
                {runtimeRow}
                {modelRow}
                <p className="px-1 text-2xs text-fg-subtle">
                    {modelAssetCount === 0
                        ? t("characters.editor.puppet.noModelAssets")
                        : t("characters.editor.puppet.modelHint")}
                </p>
                {installer}
                <AssetSelector
                    visible={picking}
                    assetType={MODEL_ASSET_TYPE}
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

    return (
        <div className="space-y-1.5">
            <PuppetPreview request={request} state={defaultState} />

            {modelRow}
            {runtimeRow}

            <Field label={t("characters.editor.puppet.entry")}>
                {/* Free text: which files a bundle holds is only knowable after parsing the one
                    it declares as its entry, which is the model runtime's job and not Studio's.
                    It writes the appearance on every keystroke, so a frozen workspace makes it
                    `readOnly` - the path stays legible and selectable, and no edit is taken. */}
                <Input
                    size="sm"
                    fullWidth
                    value={puppet.entry ?? ""}
                    placeholder={t("characters.editor.puppet.entryDefault")}
                    onChange={event => appearance.setPuppetEntry(event.target.value)}
                    readOnly={freeze.frozen}
                    title={freeze.frozen ? freeze.reason : undefined}
                />
            </Field>

            {/* Half a size has no meaning, so emptying either box rewrites the whole box - which on a
                frozen project meant a stray keystroke wiped the declared size on screen and lost it
                again on thaw. `readOnly` for the same reason as the entry above: the numbers are what
                a reader of a past version came to check. */}
            <Field label={t("characters.editor.puppet.size")}>
                <Input
                    size="sm"
                    type="number"
                    min={1}
                    className="w-20"
                    value={puppet.size?.width ?? ""}
                    placeholder={t("characters.editor.puppet.sizeStage")}
                    onChange={event => setDimension("width", event.target.value)}
                    readOnly={freeze.frozen}
                    title={freeze.frozen ? freeze.reason : undefined}
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
                    readOnly={freeze.frozen}
                    title={freeze.frozen ? freeze.reason : undefined}
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

            {installer}

            <AssetSelector
                visible={picking}
                assetType={MODEL_ASSET_TYPE}
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
