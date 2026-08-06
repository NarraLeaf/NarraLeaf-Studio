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
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
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
    const [busy, setBusy] = useState(false);
    // The slider is a controlled input: without a live draft React re-renders it
    // back to the persisted value on every change, so the thumb never follows
    // the drag and the commit reads the old number.
    const [insetDraft, setInsetDraft] = useState<number | null>(null);
    // Same reason as the inset draft: the picker's own colour has to survive the
    // re-bake, or the swatch flicks back to the previous one on commit.
    const [backgroundDraft, setBackgroundDraft] = useState<string | null>(null);
    const urlsRef = useRef<string[]>([]);

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
    const refresh = useCallback(async (next?: ProjectIconSet) => {
        setBusy(true);
        try {
            let persisted = projectService.getProjectIconSet();
            if (isDeferredWriteAllowed(freeze.frozen)) {
                const report = await bakeProjectIcons(projectService, next ?? persisted);
                persisted = await projectService.updateProjectIconSet(() => report.set);
            }
            setSet(persisted);
            onConfigChange(projectService.getProjectConfig());

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
        } catch (error) {
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        } finally {
            setBusy(false);
        }
    }, [freeze.frozen, onConfigChange, projectService, releaseUrls, uiService]);

    useEffect(() => {
        void refresh();
        return releaseUrls;
    }, [refresh, releaseUrls]);

    const importInto = useCallback(async (slot: "master" | ProjectIconTarget) => {
        setBusy(true);
        try {
            const imported = await projectService.importProjectIconSource(slot);
            if (!imported) {
                return;
            }
            const current = projectService.getProjectIconSet();
            await refresh(slot === "master"
                ? { ...current, master: imported.source }
                : withSpec(current, slot, { override: imported.source }));
        } catch (error) {
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        } finally {
            setBusy(false);
        }
    }, [projectService, refresh, uiService]);

    const editSpec = useCallback((target: ProjectIconTarget, patch: Partial<ProjectIconSpec>) => {
        return refresh(withSpec(projectService.getProjectIconSet(), target, patch));
    }, [projectService, refresh]);

    if (!set) {
        return null;
    }

    // Importing a master or an override opens a file dialog and copies into the project; the inset,
    // background and clear controls all re-bake. `busy` stays folded in so a control mid-write still
    // says so rather than blaming the freeze. Selecting a platform tile is a read and is untouched.
    const frozen = freeze.writes(busy);

    const spec = selected ? set.specs[selected] : null;

    return (
        <SettingsGroup
            title={t("project.group.icons")}
            helpTopic="icons"
            trailing={<HelpTrigger topic="icons" />}
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
                    : busy
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
                        onClick={() => {
                            setInsetDraft(null);
                            setBackgroundDraft(null);
                            setSelected(selected === target ? null : target);
                        }}
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
                                    onClick={() => editSpec(selected, { override: null })}
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
                            value={insetDraft ?? Math.round(spec.inset * 100)}
                            min={0}
                            max={Math.round(MAX_ICON_INSET * 100)}
                            step={1}
                            disabled={frozen.disabled}
                            onValueChange={setInsetDraft}
                            onValueCommit={value => {
                                // The draft outlives the commit on purpose. Clearing it
                                // here would show the *old* persisted inset until the
                                // re-bake lands - a visible bounce back to where the
                                // thumb started, for as long as the bake takes.
                                setInsetDraft(value);
                                void editSpec(selected, { inset: value / 100 })
                                    .finally(() => setInsetDraft(null));
                            }}
                            aria-label={t("project.assets.inset")}
                        />
                        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-fg-muted">
                            {insetDraft ?? Math.round(spec.inset * 100)}%
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
                                value={{ hex: backgroundDraft ?? spec.background ?? DEFAULT_OPAQUE_BACKGROUND }}
                                displayMode="icon-hex"
                                allowOpacity={false}
                                disabled={frozen.disabled}
                                onChange={value => setBackgroundDraft(value.hex)}
                                onCommit={value => {
                                    const hex = value.hex.toUpperCase();
                                    setBackgroundDraft(hex);
                                    void editSpec(selected, { background: hex })
                                        .finally(() => setBackgroundDraft(null));
                                }}
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
