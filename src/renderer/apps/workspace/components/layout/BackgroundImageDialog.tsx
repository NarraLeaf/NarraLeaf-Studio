import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "../../context";
import { getInterface } from "@/lib/app/bridge";
import { Services } from "@/lib/workspace/services/services";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { Slider } from "@/lib/components/elements/Slider";
import { useTranslation } from "@/lib/i18n";
import {
    BACKGROUND_ANCHORS,
    BACKGROUND_FILLS,
    BACKGROUND_KEYS,
    DEFAULT_BACKGROUND,
    readBackgroundSettings,
    type BackgroundAnchor,
    type BackgroundFill,
    type BackgroundSettings,
} from "@/lib/workspace/services/ui/backgroundSettings";

/**
 * The background-image dialog, modeled on the JetBrains one: pick a file, set how strongly it
 * shows through, choose how it fills the window and where it sits. Every control writes global
 * state immediately so the change previews live behind the dialog — Cancel restores the values
 * the dialog opened with, which is why the entry snapshot is kept.
 *
 * The setting is global (one background for the whole app), so there is no per-project scope and
 * no separate targets to configure.
 */
export function BackgroundImageDialog() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [open, setOpen] = useState(false);
    const [entry, setEntry] = useState<BackgroundSettings>(DEFAULT_BACKGROUND);
    const [current, setCurrent] = useState<BackgroundSettings>(DEFAULT_BACKGROUND);

    const write = useCallback(<K extends keyof BackgroundSettings>(key: K, value: BackgroundSettings[K]) => {
        setCurrent(previous => ({ ...previous, [key]: value }));
        // `image` is nullable (cleared background); the global-state signature takes any JSON value.
        void getInterface().app.state.setGlobalState(BACKGROUND_KEYS[key], value as never);
    }, []);

    const openDialog = useCallback(() => {
        if (!context) {
            return;
        }
        const settings = context.services.get<GlobalSettingsService>(Services.GlobalSettings);
        const snapshot = readBackgroundSettings(key => settings.getSync(key));
        setEntry(snapshot);
        setCurrent(snapshot);
        setOpen(true);
    }, [context]);

    // Palette entry.
    useEffect(() => {
        if (!context) {
            return;
        }
        const commandService = context.services.get<CommandService>(Services.Command);
        return commandService.register({
            id: "workspace:background-image",
            titleKey: "workspace.shell.background.command",
            categoryKey: "workspace.shell.commandPalette.categoryView",
            run: () => openDialog(),
        });
    }, [context, openDialog]);

    // The Settings window's button reaches this window through main, like keybindings.
    useEffect(() => {
        const token = getInterface().workspace.onOpenViewRequest(view => {
            if (view === "backgroundImage") {
                openDialog();
            }
        });
        return () => token.cancel();
    }, [openDialog]);

    const cancel = useCallback(() => {
        for (const key of Object.keys(BACKGROUND_KEYS) as Array<keyof BackgroundSettings>) {
            if (current[key] !== entry[key]) {
                void getInterface().app.state.setGlobalState(BACKGROUND_KEYS[key], entry[key] as never);
                setCurrent(previous => ({ ...previous, [key]: entry[key] }));
            }
        }
        setOpen(false);
    }, [current, entry]);

    const clearAndClose = useCallback(() => {
        void getInterface().app.state.setGlobalState(BACKGROUND_KEYS.image, null);
        setCurrent(previous => ({ ...previous, image: null }));
        setOpen(false);
    }, []);

    const browse = useCallback(async () => {
        const result = await getInterface().app.pickBackgroundImage();
        if (result.success && result.data.file) {
            write("image", result.data.file);
        }
    }, [write]);

    if (!open) {
        return null;
    }

    const fillLabels: Record<BackgroundFill, string> = {
        cover: t("workspace.shell.background.fill.cover"),
        contain: t("workspace.shell.background.fill.contain"),
        tile: t("workspace.shell.background.fill.tile"),
        center: t("workspace.shell.background.fill.center"),
    };
    // Anchoring only means something when the image does not cover the window.
    const anchorEnabled = current.fill !== "cover" && current.fill !== "tile";

    return (
        <Modal
            isOpen
            onClose={cancel}
            size="md"
            title={t("workspace.shell.background.title")}
            footer={
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={cancel} className={dialogFooterButtonClass({ variant: "secondary" })}>
                        {t("workspace.shell.background.cancel")}
                    </button>
                    <button
                        type="button"
                        onClick={clearAndClose}
                        disabled={!current.image}
                        className={dialogFooterButtonClass({ variant: "secondary", disabled: !current.image })}
                    >
                        {t("workspace.shell.background.clear")}
                    </button>
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        className={dialogFooterButtonClass({ variant: "primary" })}
                    >
                        {t("workspace.shell.background.apply")}
                    </button>
                </div>
            }
        >
            <div className="flex flex-col gap-5 text-sm">
                <label className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-fg-muted">{t("workspace.shell.background.image")}</span>
                    <input
                        type="text"
                        readOnly
                        value={current.image ?? ""}
                        placeholder={t("workspace.shell.background.imagePlaceholder")}
                        className="min-w-0 flex-1 rounded-md border border-edge bg-fill-subtle px-3 py-1.5 text-fg placeholder:text-fg-subtle focus:outline-none"
                    />
                    <button
                        type="button"
                        onClick={browse}
                        className="shrink-0 rounded-md border border-edge px-3 py-1.5 text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                    >
                        {t("workspace.shell.background.browse")}
                    </button>
                </label>

                <label className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-fg-muted">{t("workspace.shell.background.opacity")}</span>
                    <Slider
                        className="min-w-0 flex-1"
                        value={current.opacity}
                        min={2}
                        max={40}
                        step={1}
                        onValueChange={value => write("opacity", value)}
                    />
                    <span className="w-12 shrink-0 text-right tabular-nums text-fg-muted">{current.opacity}%</span>
                </label>

                <div className="flex items-start gap-3">
                    <span className="w-24 shrink-0 pt-1.5 text-fg-muted">{t("workspace.shell.background.fillMode")}</span>
                    <div className="flex flex-wrap gap-1.5">
                        {BACKGROUND_FILLS.map(fill => (
                            <button
                                key={fill}
                                type="button"
                                onClick={() => write("fill", fill)}
                                className={`rounded-md border px-3 py-1.5 transition-colors ${
                                    current.fill === fill
                                        ? "border-primary bg-primary/15 text-fg"
                                        : "border-edge text-fg-muted hover:bg-fill hover:text-fg"
                                }`}
                            >
                                {fillLabels[fill]}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex items-start gap-3">
                    <span className="w-24 shrink-0 pt-1 text-fg-muted">{t("workspace.shell.background.anchor")}</span>
                    <div
                        className={`grid grid-cols-3 gap-1 ${anchorEnabled ? "" : "pointer-events-none opacity-40"}`}
                        role="radiogroup"
                        aria-label={t("workspace.shell.background.anchor")}
                    >
                        {BACKGROUND_ANCHORS.map((anchor: BackgroundAnchor) => (
                            <button
                                key={anchor}
                                type="button"
                                role="radio"
                                aria-checked={current.anchor === anchor}
                                aria-label={anchor}
                                onClick={() => write("anchor", anchor)}
                                className={`h-7 w-7 rounded border transition-colors ${
                                    current.anchor === anchor
                                        ? "border-primary bg-primary/25"
                                        : "border-edge bg-fill-subtle hover:bg-fill"
                                }`}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
