import { Modal, dialogFooterButtonClass } from "@/lib/components/elements";
import { Input } from "@/lib/components/elements/Input";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import {
    installPrebuiltPuppetRuntime,
    installPuppetRuntimeFromSdk,
    pickPrebuiltRuntimeDirectory,
    pickPrebuiltRuntimeFile,
    pickSdkArchive,
} from "@/lib/workspace/services/puppet/installPuppetRuntime";
import {
    customPuppetRuntimeDocsUrl,
    knownPuppetRuntimeFor,
    puppetRuntimeDocsUrl,
    type KnownPuppetRuntime,
    type KnownPuppetRuntimeId,
} from "@shared/utils/puppetRuntimes";
import type { TranslationKey } from "@shared/i18n";
import { AlertTriangle, BookOpen, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

/**
 * What this dialog is being opened for.
 *
 * A known runtime installs itself the one way its licensing permits; a custom one is always a prebuilt
 * module, because Studio has no glue for a runtime it has never heard of.
 */
export type PuppetRuntimeInstallTarget =
    | { kind: "known"; id: KnownPuppetRuntimeId }
    | { kind: "custom"; suggestedName?: string };

type Phase =
    | { step: "notice" }
    | { step: "pick" }
    | { step: "working"; label: TranslationKey }
    | { step: "done"; summary: string; note?: string }
    | { step: "failed"; message: string };

/** The licence points for a runtime, as its own catalogue key. */
const TERMS_KEY: Record<KnownPuppetRuntimeId, TranslationKey> = {
    live2d: "characters.editor.runtime.live2dTerms",
    spine: "characters.editor.runtime.spineTerms",
};

const ROW = "flex items-center gap-2 rounded-md border border-edge bg-fill-subtle px-2 py-1.5 text-xs";

/**
 * The guided install for an author-supplied drawing runtime.
 *
 * This dialog exists because the answer to "how do I use Live2D in NarraLeaf" used to be a folder the
 * author was expected to have created, named in no UI. It is deliberately not a one-click affair: the
 * first step is the vendor's terms and a link to their download page, because **Studio never fetches
 * either runtime**. Fetching it would make Studio a distributor of software whose licence does not allow
 * that, so the author's own download is not a limitation to route around — it is the mechanism.
 *
 * What Studio can do, and does after the author supplies the archive, is compile the adapter here. That
 * is Live2D's only legal route: the Cubism Framework ships as TypeScript source, so no prebuilt Live2D
 * adapter may be published by anyone at all.
 */
export function PuppetRuntimeInstaller(props: {
    visible: boolean;
    target: PuppetRuntimeInstallTarget;
    onClose: () => void;
    /** Called after a successful install, with the backend name that ended up on disk. */
    onInstalled: (backend: string) => void;
}) {
    // `locale` decides which translation of the guide the links open; see puppetRuntimeDocsUrl.
    const { t, locale } = useTranslation();
    const { context } = useWorkspace();
    const runtime: KnownPuppetRuntime | null = props.target.kind === "known"
        ? knownPuppetRuntimeFor(props.target.id)
        : null;

    // A custom runtime has no terms of ours to show, so it starts at the picker.
    const [phase, setPhase] = useState<Phase>(runtime ? { step: "notice" } : { step: "pick" });
    const [agreed, setAgreed] = useState(false);
    const [customName, setCustomName] = useState(
        props.target.kind === "custom" ? props.target.suggestedName ?? "" : "",
    );

    const productName = runtime?.productName ?? t("characters.editor.kind.puppet");
    const canBuildFromSdk = runtime?.methods.includes("sdk-zip") ?? false;

    const reset = useCallback(() => {
        setPhase(runtime ? { step: "notice" } : { step: "pick" });
        setAgreed(false);
    }, [runtime]);

    const close = useCallback(() => {
        reset();
        props.onClose();
    }, [props, reset]);

    const run = useCallback(async (label: TranslationKey, work: () => Promise<{ backend: string; summary: string; note?: string }>) => {
        setPhase({ step: "working", label });
        try {
            const { backend, summary, note } = await work();
            setPhase({ step: "done", summary, note });
            props.onInstalled(backend);
        } catch (error) {
            // Verbatim. The install failures worth reporting are all "you picked the wrong file", and the
            // archive reader phrases those as the recovery step; paraphrasing them into "install failed"
            // is what leaves an author with nothing to do next.
            setPhase({ step: "failed", message: error instanceof Error ? error.message : String(error) });
        }
    }, [props]);

    const installFromSdk = useCallback(async () => {
        if (!context || !runtime) return;
        const archivePath = await pickSdkArchive();
        if (!archivePath) return;
        await run("characters.editor.runtime.building", async () => {
            const built = await installPuppetRuntimeFromSdk(context.project, runtime.id, archivePath);
            return {
                backend: built.backend,
                summary: built.sdkVersion
                    ? t("characters.editor.runtime.builtFrom", { version: built.sdkVersion })
                    : built.entryPath,
            };
        });
    }, [context, runtime, run, t]);

    const installPrebuilt = useCallback(async (pick: () => Promise<string | null>, kind: "directory" | "file") => {
        if (!context) return;
        const name = (runtime?.backend ?? customName).trim();
        if (!name) return;
        const path = await pick();
        if (!path) return;
        await run("characters.editor.runtime.copying", async () => {
            const installed = await installPrebuiltPuppetRuntime(context.project, name, { kind, path } as never);
            return {
                backend: installed.backend,
                summary: installed.registered.join(", "),
                // Said out loud rather than silently corrected: the name the author's characters must use
                // is the one the module registers, and it just changed under them.
                note: installed.renamedFrom
                    ? t("characters.editor.runtime.renamed", { backend: installed.backend })
                    : undefined,
            };
        });
    }, [context, customName, runtime, run, t]);

    const body = useMemo(() => {
        if (phase.step === "working") {
            return (
                <div className="flex items-center gap-2 px-1 py-6 text-xs text-fg-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t(phase.label)}
                </div>
            );
        }
        if (phase.step === "done") {
            return (
                <div className="space-y-2 py-2">
                    <div className="flex items-center gap-2 text-xs text-fg">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        {t("characters.editor.runtime.installed", { product: productName })}
                    </div>
                    <p className="px-1 text-2xs text-fg-subtle">{phase.summary}</p>
                    {phase.note && <p className="px-1 text-2xs text-fg-muted">{phase.note}</p>}
                </div>
            );
        }
        if (phase.step === "failed") {
            return (
                <div className="space-y-2 py-2">
                    <div className="flex items-center gap-2 text-xs text-fg">
                        <AlertTriangle className="h-4 w-4 text-warning" />
                        {t("common.error")}
                    </div>
                    {/* Wrapped rather than truncated: the archive reader's messages list what the file
                        actually held, which is the whole point of them. */}
                    <p className="whitespace-pre-wrap break-words px-1 text-2xs text-fg-muted">{phase.message}</p>
                </div>
            );
        }
        if (phase.step === "notice" && runtime) {
            return (
                <div className="space-y-3 py-1">
                    <p className="text-2xs font-medium tracking-wide text-fg-muted">
                        {t("characters.editor.runtime.licenceTitle")}
                    </p>
                    <p className="text-xs leading-relaxed text-fg-muted">{t(TERMS_KEY[runtime.id])}</p>
                    <p className="text-2xs leading-relaxed text-fg-subtle">
                        {t("characters.editor.runtime.neverDownloads")}
                    </p>
                    {/* Two links, and the order is the point: the vendor's page first, because that is
                        where the author has to go and where they accept the licence, and NarraLeaf's
                        guide second for the part that is ours to explain — what Studio does with what
                        they bring back. */}
                    <div className="space-y-1.5">
                        <button
                            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                            onClick={() => void getInterface().app.openExternal(runtime.vendorUrl)}
                        >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {t("characters.editor.runtime.vendorLink", { product: runtime.productName })}
                        </button>
                        <button
                            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                            onClick={() => void getInterface().app.openExternal(puppetRuntimeDocsUrl(runtime, locale))}
                        >
                            <BookOpen className="h-3.5 w-3.5" />
                            {t("characters.editor.runtime.docsLink", { product: runtime.productName })}
                        </button>
                    </div>
                    <label className="flex items-center gap-2 pt-1 text-xs text-fg">
                        <input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} />
                        {t("characters.editor.runtime.licenceAgree")}
                    </label>
                </div>
            );
        }
        // The picker. Which routes are offered is the registry's answer, not a preference: Spine has no
        // `sdk-zip` route because Studio holds no Spine licence and therefore carries no Spine glue.
        return (
            <div className="space-y-3 py-1">
                {!runtime && (
                    <div className={ROW}>
                        <span className="w-24 shrink-0 text-2xs text-fg-muted">
                            {t("characters.editor.runtime.customName")}
                        </span>
                        <Input
                            size="sm"
                            fullWidth
                            value={customName}
                            onChange={event => setCustomName(event.target.value)}
                        />
                    </div>
                )}
                {!runtime && (
                    <>
                        <p className="px-1 text-2xs text-fg-subtle">{t("characters.editor.runtime.customNameHint")}</p>
                        {/* A custom runtime has no vendor page and no terms of ours to show, so the
                            module contract is the only thing this step can usefully point at - and it
                            is exactly what someone here is short of. */}
                        <button
                            className="flex items-center gap-1.5 px-1 text-xs text-primary hover:underline"
                            onClick={() => void getInterface().app.openExternal(customPuppetRuntimeDocsUrl(locale))}
                        >
                            <BookOpen className="h-3.5 w-3.5" />
                            {t("characters.editor.runtime.customDocsLink")}
                        </button>
                    </>
                )}
                {canBuildFromSdk && runtime && (
                    <>
                        <p className="text-xs leading-relaxed text-fg-muted">
                            {t("characters.editor.runtime.sdkStep", { product: runtime.productName })}
                        </p>
                        <button
                            className={dialogFooterButtonClass({ variant: "primary" })}
                            onClick={() => void installFromSdk()}
                        >
                            {t("characters.editor.runtime.sdkPick")}
                        </button>
                    </>
                )}
                {!canBuildFromSdk && (
                    <>
                        <p className="text-xs leading-relaxed text-fg-muted">
                            {t("characters.editor.runtime.prebuiltStep")}
                        </p>
                        <div className="flex gap-2">
                            <button
                                className={dialogFooterButtonClass({ variant: "primary" })}
                                disabled={!runtime && !customName.trim()}
                                onClick={() => void installPrebuilt(pickPrebuiltRuntimeDirectory, "directory")}
                            >
                                {t("characters.editor.runtime.prebuiltPickFolder")}
                            </button>
                            <button
                                className={dialogFooterButtonClass({ variant: "secondary" })}
                                disabled={!runtime && !customName.trim()}
                                onClick={() => void installPrebuilt(pickPrebuiltRuntimeFile, "file")}
                            >
                                {t("characters.editor.runtime.prebuiltPickFile")}
                            </button>
                        </div>
                    </>
                )}
            </div>
        );
    }, [agreed, canBuildFromSdk, customName, installFromSdk, installPrebuilt, phase, productName, runtime, t]);

    return (
        <Modal
            isOpen={props.visible}
            onClose={close}
            title={t("characters.editor.runtime.title", { product: productName })}
            size="sm"
            footer={
                <div className="flex justify-end gap-2">
                    {phase.step === "failed" && (
                        <button className={dialogFooterButtonClass({ variant: "secondary" })} onClick={reset}>
                            {t("common.retry")}
                        </button>
                    )}
                    {phase.step === "notice" && (
                        <button
                            className={dialogFooterButtonClass({ variant: "primary", disabled: !agreed })}
                            disabled={!agreed}
                            onClick={() => setPhase({ step: "pick" })}
                        >
                            {t("common.continue")}
                        </button>
                    )}
                    <button
                        className={dialogFooterButtonClass({ variant: "secondary" })}
                        disabled={phase.step === "working"}
                        onClick={close}
                    >
                        {phase.step === "done" ? t("common.close") : t("common.cancel")}
                    </button>
                </div>
            }
        >
            {body}
        </Modal>
    );
}
