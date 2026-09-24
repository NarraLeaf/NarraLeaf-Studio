import { useCallback, useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Loader2, X } from "lucide-react";
import { Slider } from "@/lib/components/elements";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { HelpTrigger } from "@/lib/help";
import { useTranslation } from "@/lib/i18n";
import { isDeferredWriteAllowed, useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import {
    DEFAULT_OPAQUE_BACKGROUND,
    MAX_ICON_INSET,
    PROJECT_ICON_TARGETS,
    outputsForTarget,
    type ProjectIconOutputId,
    type ProjectIconSet,
    type ProjectIconSpec,
    type ProjectIconTarget,
} from "@shared/types/projectIcons";
import {
    ProjectFileAccessError,
    ProjectFileWriteError,
    type ProjectService,
} from "@/lib/workspace/services/core/ProjectService";
import { bakeProjectIcons } from "../iconBake";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

/**
 * The project's app icon: one master, and six previews of what each build
 * target will actually ship.
 *
 * The platform row is deliberately output, not input. It used to be five upload
 * slots, which asked the author to prepare a file per platform and still showed
 * them the raw image rather than the masked, inset, flattened thing that lands
 * on a launcher. Here each tile is the baked result under that platform's own
 * shape - a clipped corner or a transparent hole is visible rather than
 * described - and clicking one opens the three knobs that target supports.
 */

type TargetChrome = {
    /** The shape the platform masks its icon to, as a CSS radius. */
    radius: string;
    /** Tile-relative size of the artwork; web shows its favicon life-size. */
    scale: number;
};

const TARGET_CHROME: Record<ProjectIconTarget, TargetChrome> = {
    macos: { radius: "22%", scale: 1 },
    windows: { radius: "2px", scale: 1 },
    linux: { radius: "2px", scale: 1 },
    android: { radius: "50%", scale: 1 },
    ios: { radius: "22%", scale: 1 },
    web: { radius: "2px", scale: 0.53 },
};

const ICON_BUTTON_CLASS = controlButtonClass();
const TILE_SIZE = 60;

export function ProjectIconsSection({ projectService, uiService, onConfigChange }: ProjectSectionProps) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const [set, setSet] = useState<ProjectIconSet | null>(null);
    const [previews, setPreviews] = useState<Partial<Record<ProjectIconOutputId | "master", string>>>({});
    const [selected, setSelected] = useState<ProjectIconTarget | null>(null);
    // Bakes (and imports) queued or running. Shown as a spinner; never used to disable anything - see
    // `enqueue`.
    const [busy, setBusy] = useState(0);
    /**
     * Each target's spec as the author last set it, over the persisted one, until the bake carrying
     * it has landed.
     *
     * The slider and the picker are controlled inputs: without a live draft React re-renders them
     * back to the persisted value on every change, so the thumb never follows the drag and the commit
     * reads the old number. And a committed value has to survive its own re-bake, or the control
     * bounces back to where it started for as long as the bake takes. A clear is a draft too, so the
     * clear button goes and "transparent" shows the moment it is pressed rather than a bake later.
     */
    const [drafts, setDrafts] = useState<Partial<Record<ProjectIconTarget, Partial<ProjectIconSpec>>>>({});
    // Which commit of each target's field is the latest, so an earlier bake landing does not clear a
    // draft a later commit set.
    const draftGenerations = useRef(new Map<string, number>());
    const urlsRef = useRef<string[]>([]);
    const queue = useRef<Promise<void>>(Promise.resolve());
    const mounted = useRef(false);

    const releaseUrls = useCallback(() => {
        for (const url of urlsRef.current) {
            URL.revokeObjectURL(url);
        }
        urlsRef.current = [];
    }, []);

    /**
     * Bake, persist whatever moved, and reload the previews. Called on open as
     * well as after every edit: an up-to-date project performs reads only, so
     * the common case leaves the working tree untouched.
     *
     * "Reads only" is the common case, not the guarantee - the bake persists
     * whatever moved - so while frozen it loads the previews and skips both the
     * bake and the write. Same deferral as the character avatars; the effect
     * below re-runs on thaw because `frozen` is one of its inputs.
     */
    const bakeAndLoad = useCallback(async (edit?: (set: ProjectIconSet) => ProjectIconSet) => {
        let persisted = projectService.getProjectIconSet();
        if (isDeferredWriteAllowed(freeze.frozen)) {
            // The edit applies to the set as it stands when this bake's turn comes, not as it stood
            // when the control was touched - see `enqueue`.
            const report = await bakeProjectIcons(projectService, edit ? edit(persisted) : persisted);
            persisted = await projectService.updateProjectIconSet(() => report.set);
        }
        setSet(persisted);
        onConfigChange(projectService.getProjectConfig());
        if (!mounted.current) {
            // The bake still ran and landed - it was the author's change - but there is nobody left
            // to show the previews to, and URLs made now would outlive the release on unmount.
            return;
        }

        releaseUrls();
        const loaded: Partial<Record<ProjectIconOutputId | "master", string>> = {};
        if (persisted.master) {
            const url = await toObjectUrl(projectService, persisted.master.path, persisted.master.mediaType);
            if (url) {
                loaded.master = url;
            }
        }
        for (const [id, bake] of Object.entries(persisted.baked)) {
            const url = await toObjectUrl(projectService, bake.path, "image/png");
            if (url) {
                loaded[id as ProjectIconOutputId] = url;
            }
        }
        urlsRef.current = Object.values(loaded).filter((url): url is string => !!url);
        setPreviews(loaded);
    }, [freeze.frozen, onConfigChange, projectService, releaseUrls]);

    /**
     * Run one icon operation after the ones before it.
     *
     * A bake reads the icon set, renders every target's PNG and writes the set back; an import copies
     * a file in and then bakes. Two of them overlapping would write the same files in an order nobody
     * chose, and the later one would build on a set read before the earlier one had landed. So they
     * queue, each starting from the set the one before it left.
     *
     * Nothing is greyed out while they run. A control that turns disabled between mousedown and
     * mouseup is never sent the click, and the colour picker commits on the mousedown that closes it -
     * so "pick a background, then press the button that clears it" was one gesture whose second half
     * silently vanished while the first half baked.
     */
    const enqueue = useCallback((operation: () => Promise<void>): Promise<void> => {
        setBusy(count => count + 1);
        const run = queue.current
            .then(operation)
            .catch(error => {
                // The two failures that are the author's sentence already - an icon file that could
                // not be picked, read or written, and the project file refusing the new set - are
                // shown as they are. Anything else was never written for an author (a canvas that
                // would not draw, a decoder that threw), so it gets the section's own line.
                console.warn("[project icons] an icon operation failed", error);
                const readable = error instanceof ProjectFileAccessError || error instanceof ProjectFileWriteError;
                uiService?.showNotification(readable ? error.message : t("project.assets.failed"), "error");
            })
            .finally(() => setBusy(count => count - 1));
        queue.current = run;
        return run;
    }, [t, uiService]);

    const refresh = useCallback(
        (edit?: (set: ProjectIconSet) => ProjectIconSet) => enqueue(() => bakeAndLoad(edit)),
        [bakeAndLoad, enqueue],
    );

    useEffect(() => {
        mounted.current = true;
        void refresh();
        return () => {
            mounted.current = false;
            releaseUrls();
        };
    }, [refresh, releaseUrls]);

    const importInto = useCallback((slot: "master" | ProjectIconTarget) => enqueue(async () => {
        const imported = await projectService.importProjectIconSource(slot);
        if (!imported) {
            return;
        }
        await bakeAndLoad(current => (slot === "master"
            ? { ...current, master: imported.source }
            : withSpec(current, slot, { override: imported.source })));
    }), [bakeAndLoad, enqueue, projectService]);

    /** Show a value on a target's controls without committing it - a drag or a picker in progress. */
    const draftSpec = useCallback((target: ProjectIconTarget, patch: Partial<ProjectIconSpec>) => {
        setDrafts(current => ({ ...current, [target]: { ...current[target], ...patch } }));
    }, []);

    /** Change a target's spec: shown at once, baked in its turn, and the draft dropped once it lands. */
    const editSpec = useCallback((target: ProjectIconTarget, patch: Partial<ProjectIconSpec>) => {
        const tokens = (Object.keys(patch) as (keyof ProjectIconSpec)[]).map(field => {
            const key = `${target}:${field}`;
            const token = (draftGenerations.current.get(key) ?? 0) + 1;
            draftGenerations.current.set(key, token);
            return { field, key, token };
        });
        draftSpec(target, patch);
        return refresh(current => withSpec(current, target, patch)).finally(() => {
            const settled = tokens.filter(({ key, token }) => draftGenerations.current.get(key) === token);
            if (settled.length === 0) {
                return;
            }
            setDrafts(current => {
                const remaining = { ...current[target] };
                for (const { field } of settled) {
                    delete remaining[field];
                }
                return { ...current, [target]: remaining };
            });
        });
    }, [draftSpec, refresh]);

    if (!set) {
        return null;
    }

    // Importing a master or an override opens a file dialog and copies into the project; the inset,
    // background and clear controls all re-bake. Only the freeze turns them off - a bake in flight
    // queues the next one instead (see `enqueue`). Selecting a platform tile is a read and is untouched.
    const frozen = freeze.writes();

    const spec = selected ? { ...set.specs[selected], ...drafts[selected] } : null;

    return (
        <SettingsGroup
            title={t("project.group.icons")}
            helpTopic="icons"
            trailing={<>
                {/* The one sign a bake is running, now that nothing greys out while it does. */}
                {busy > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-subtle" /> : null}
                <HelpTrigger topic="icons" />
            </>}
        >
            <button
                type="button"
                className="mx-auto grid h-24 w-24 place-items-center overflow-hidden rounded-md border border-dashed border-edge-strong bg-fill-subtle transition-colors hover:border-primary"
                onClick={() => void importInto("master")}
                disabled={frozen.disabled}
                aria-label={t("project.assets.master")}
            >
                {previews.master
                    ? <img src={previews.master} alt="" className="h-full w-full object-contain p-1" />
                    : busy > 0
                        ? <Loader2 className="h-5 w-5 animate-spin text-fg-subtle" />
                        : <ImageIcon className="h-5 w-5 text-fg-subtle" />}
            </button>

            <div className="grid grid-cols-3 justify-items-center gap-3 border-t border-edge pt-3">
                {PROJECT_ICON_TARGETS.map(target => (
                    <TargetTile
                        key={target}
                        target={target}
                        url={previews[outputsForTarget(target)[0].id]}
                        selected={selected === target}
                        onClick={() => setSelected(selected === target ? null : target)}
                    />
                ))}
            </div>

            {selected && spec ? (
                <div className="grid gap-2.5 border-t border-edge pt-3">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-fg-muted">{t("project.assets.override")}</span>
                        <div className="flex items-center gap-1.5">
                            {spec.override ? (
                                <button
                                    type="button"
                                    className={ICON_BUTTON_CLASS}
                                    onClick={() => void editSpec(selected, { override: null })}
                                    disabled={frozen.disabled}
                                    aria-label={t("project.assets.clearOverride")}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            ) : null}
                            <button
                                type="button"
                                className="grid h-7 w-7 place-items-center overflow-hidden rounded-md border border-dashed border-edge-strong transition-colors hover:border-primary"
                                onClick={() => void importInto(selected)}
                                disabled={frozen.disabled}
                                aria-label={t("project.assets.chooseOverride")}
                            >
                                <ImageIcon className="h-3.5 w-3.5 text-fg-subtle" />
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <span className="shrink-0 text-xs text-fg-muted">{t("project.assets.inset")}</span>
                        <Slider
                            value={Math.round(spec.inset * 100)}
                            min={0}
                            max={Math.round(MAX_ICON_INSET * 100)}
                            step={1}
                            disabled={frozen.disabled}
                            onValueChange={value => draftSpec(selected, { inset: value / 100 })}
                            onValueCommit={value => void editSpec(selected, { inset: value / 100 })}
                            aria-label={t("project.assets.inset")}
                        />
                        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-fg-muted">
                            {Math.round(spec.inset * 100)}%
                        </span>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-fg-muted">{t("project.assets.background")}</span>
                        <div className="flex items-center gap-2">
                            {spec.background ? null : (
                                <span className="text-2xs text-fg-subtle">{t("project.assets.transparent")}</span>
                            )}
                            {/* The same picker the property inspector and Settings use, rather
                                than a native swatch: a second colour control would drift from
                                the first, and this one already carries hex/RGB/HSL entry. */}
                            <ColorPickerTrigger
                                value={{ hex: spec.background ?? DEFAULT_OPAQUE_BACKGROUND }}
                                displayMode="icon-hex"
                                allowOpacity={false}
                                disabled={frozen.disabled}
                                onChange={value => draftSpec(selected, { background: value.hex })}
                                onCommit={value => void editSpec(selected, { background: value.hex.toUpperCase() })}
                            />
                            {spec.background ? (
                                <button
                                    type="button"
                                    className={ICON_BUTTON_CLASS}
                                    onClick={() => void editSpec(selected, { background: null })}
                                    disabled={frozen.disabled}
                                    aria-label={t("project.assets.clearBackground")}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            ) : null}
                        </div>
                    </div>
                </div>
            ) : null}
        </SettingsGroup>
    );
}

function TargetTile({
    target,
    url,
    selected,
    onClick,
}: {
    target: ProjectIconTarget;
    url: string | undefined;
    selected: boolean;
    onClick: () => void;
}) {
    const { t } = useTranslation();
    const chrome = TARGET_CHROME[target];
    const artwork = Math.round(TILE_SIZE * chrome.scale);
    const label = t(`project.assets.target.${target}` as "project.assets.target.macos");

    return (
        <button type="button" onClick={onClick} className="grid justify-items-center gap-1">
            <span
                className={`grid place-items-center overflow-hidden border bg-surface-raised ${selected ? "border-primary" : "border-edge"}`}
                style={{ width: TILE_SIZE, height: TILE_SIZE, borderRadius: chrome.radius }}
            >
                {url
                    ? <img src={url} alt="" style={{ width: artwork, height: artwork }} className="object-contain" />
                    : <ImageIcon className="h-4 w-4 text-fg-subtle" />}
            </span>
            {/* The platform is named, not glyphed: a laptop and a tablet outline
                do not tell anyone which one is macOS and which one is iOS. */}
            <span className={`text-2xs ${selected ? "text-primary" : "text-fg-subtle"}`}>{label}</span>
        </button>
    );
}

function withSpec(set: ProjectIconSet, target: ProjectIconTarget, patch: Partial<ProjectIconSpec>): ProjectIconSet {
    return {
        ...set,
        specs: { ...set.specs, [target]: { ...set.specs[target], ...patch } },
    };
}

async function toObjectUrl(
    projectService: ProjectService,
    relativePath: string,
    mediaType: string,
): Promise<string | null> {
    const bytes = await projectService.readProjectIconFile(relativePath);
    if (!bytes) {
        return null;
    }
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return URL.createObjectURL(new Blob([buffer], { type: mediaType }));
}
