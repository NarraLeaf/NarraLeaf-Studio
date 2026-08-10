import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Box } from "lucide-react";
import type { UIPuppetWidgetProps } from "@shared/types/ui-editor/puppet";
import { encodeStableJson } from "@shared/utils/stableJson";
import type { TranslationKey } from "@shared/i18n";
import type { ColorValue, CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import { parseColorValue, serializeColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { useWorkspace } from "@/apps/workspace/context";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
import { Input } from "@/lib/components/elements/Input";
import { InspectOnlyButton } from "@/lib/components/elements/InspectOnlyButton";
import { Select } from "@/lib/components/elements/Select";
import { listProjectPuppetRuntimes } from "@/lib/workspace/services/puppet/projectPuppetRuntimes";
import {
    puppetChoiceOptions,
    type PuppetDescriptionRequest,
    type PuppetDescriptionUnavailableReason,
} from "@/lib/workspace/services/puppet/puppetDescriptionModel";
import { usePuppetDescription } from "@/lib/workspace/hooks/usePuppetDescription";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import { getRectangleLikeProps } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import type { InspectorContext, UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { i18nStore, useTranslation } from "@/lib/i18n";
import { getPuppetProps, patchPuppetProps, puppetWidgetSize } from "./helpers";

/** Always read through the live document: a schema closure can outlive the props it captured. */
function liveElement(data: UIInspectorData) {
    return data.documentService.getDocument().elements[data.element.id] ?? data.element;
}

function getLivePuppetProps(data: UIInspectorData): UIPuppetWidgetProps {
    return getPuppetProps(liveElement(data));
}

function patchPuppet(data: UIInspectorData, partial: Partial<UIPuppetWidgetProps>): void {
    const live = liveElement(data);
    data.documentService.updateElementProps(live.id, patchPuppetProps(live, partial));
}

function getLiveChromeProps(data: UIInspectorData): RectangleLikeProps {
    return getRectangleLikeProps(liveElement(data));
}

function patchChrome(data: UIInspectorData, partial: Partial<RectangleLikeProps>): void {
    const live = liveElement(data);
    data.documentService.updateElementProps(live.id, {
        ...(live.props ?? {}),
        ...partial,
    });
}

const ROW_LABEL = "text-xs font-medium text-fg-muted";

/** Where the three name lists came from, said in one line — the same vocabulary the character editor uses. */
function describeStatusKey(reason: PuppetDescriptionUnavailableReason | null | undefined): TranslationKey {
    switch (reason) {
        case "no-model": return "widgets.puppet.describeNoModel";
        case "no-backend": return "widgets.puppet.describeNoBackend";
        case "backend-missing": return "widgets.puppet.describeBackendMissing";
        case "not-described": return "widgets.puppet.describeNotSupported";
        case "failed": return "widgets.puppet.describeFailed";
        default: return "widgets.puppet.describeOk";
    }
}

/**
 * What this widget is, in the one place an author is looking when it draws nothing.
 *
 * Studio ships no renderer and is not allowed to: Live2D's "excluded license" clause collides
 * head-on with MPL-2.0, and Spine's terms require the integrator to hold an Editor licence (card
 * 2026-07-27-002). So the widget loads a module the *author* put in their project, and saying that
 * out loud here is the difference between an unconfigured widget and one that looks broken.
 */
function PuppetRuntimeNotice(_props: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    return (
        <p className="rounded-md border border-edge bg-fill-subtle px-2 py-1.5 text-2xs leading-snug text-fg-muted">
            {t("widgets.puppet.runtimeNotice")}
        </p>
    );
}

/**
 * The model bundle picker.
 *
 * Single-select: `AssetSelector`'s multiple mode has never actually worked, and a picker that
 * silently keeps only the first pick is worse than one that never offers the choice.
 */
function PuppetModelField(props: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const current = getLivePuppetProps(props.data);
    const [picking, setPicking] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    const assetsService = useMemo(
        () => (context ? context.services.get<AssetsService>(Services.Assets) : null),
        [context],
    );

    const assetName = useMemo(() => {
        if (!current.assetId || !assetsService) {
            return null;
        }
        return assetsService.getAssets()[AssetType.Model]?.[current.assetId]?.name ?? null;
    }, [current.assetId, assetsService]);

    // An id with no library record is a broken reference, not an empty slot - saying "None" there
    // would hide the very thing `resourceDiagnostics` is warning about.
    const valueLabel = current.assetId
        ? assetName ?? t("widgets.puppet.modelMissing", { id: current.assetId })
        : t("widgets.puppet.modelNone");

    const confirm = useCallback((assets: Asset[]) => {
        const selected = assets[0];
        if (!selected) {
            return;
        }
        patchPuppet(props.data, { assetId: selected.id });
        setPicking(false);
    }, [props.data]);

    const clear = useCallback((event: MouseEvent<HTMLSpanElement>) => {
        event.stopPropagation();
        patchPuppet(props.data, { assetId: null });
    }, [props.data]);

    return (
        <>
            <div className="flex flex-col gap-1">
                <span className={ROW_LABEL}>{t("widgets.puppet.model")}</span>
                <button
                    type="button"
                    ref={triggerRef}
                    onClick={() => setPicking(true)}
                    className="flex w-full items-center gap-2 rounded-md border border-edge bg-surface px-2 py-1.5 text-left text-xs text-fg focus:outline-none focus:ring-1 focus:ring-primary/40"
                >
                    <Box className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                    <span className="min-w-0 flex-1 truncate">{valueLabel}</span>
                    {current.assetId ? (
                        <span
                            role="button"
                            tabIndex={-1}
                            onClick={clear}
                            className="shrink-0 rounded-md px-1.5 py-0.5 text-2xs tracking-wider text-fg-subtle hover:bg-fill hover:text-fg-muted"
                        >
                            {t("common.clear")}
                        </span>
                    ) : (
                        <span className="shrink-0 text-2xs tracking-wider text-fg-subtle">
                            {t("widgets.puppet.modelChoose")}
                        </span>
                    )}
                </button>
            </div>

            <AssetSelector
                visible={picking}
                assetType={AssetType.Model}
                multiple={false}
                selectedIds={current.assetId ? [current.assetId] : []}
                anchorRef={triggerRef}
                title={t("widgets.puppet.modelChoose")}
                onClose={() => setPicking(false)}
                onConfirm={confirm}
            />
        </>
    );
}

/**
 * The runtime, as a list of what the project carries.
 *
 * A dropdown and not free text, because a name is only meaningful if a folder of that name exists -
 * one directory per backend under `runtimes/puppet/`, read from disk because there is no registry to
 * ask. A backend the *current machine* does not have stays selectable all the same: the runtime is
 * not installed everywhere the project is opened, and dropping the name would rewrite the document
 * behind the author's back.
 */
function PuppetBackendField(props: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const current = getLivePuppetProps(props.data);
    const [installed, setInstalled] = useState<string[]>([]);

    useEffect(() => {
        if (!context) {
            return;
        }
        let cancelled = false;
        void listProjectPuppetRuntimes(context.project)
            .then(names => { if (!cancelled) setInstalled(names); })
            .catch(() => { if (!cancelled) setInstalled([]); });
        return () => { cancelled = true; };
    }, [context]);

    const options = [
        ...(current.backend && !installed.includes(current.backend) ? [current.backend] : []),
        ...installed,
    ].map(name => ({ value: name, label: name }));

    return (
        <div className="flex flex-col gap-1">
            <span className={ROW_LABEL}>{t("widgets.puppet.backend")}</span>
            <Select
                options={options}
                value={current.backend}
                placeholder={t("widgets.puppet.backendNone")}
                size="sm"
                fullWidth
                portalMenu
                onChange={value => patchPuppet(props.data, { backend: String(value) })}
            />
            <span className="text-2xs leading-snug text-fg-subtle">
                {installed.length === 0
                    ? t("widgets.puppet.backendNoneInstalled")
                    : t("widgets.puppet.backendHint")}
            </span>
        </div>
    );
}

/**
 * One `PuppetState` name.
 *
 * A `<Select>` when the model listed any, free text when it did not — decided per field, not per
 * model, so a skeleton with eleven animations and no expressions still gets a list for its
 * animations. The fallback is not a degraded mode: the engine's contract says a backend may implement
 * no `describe()` at all, or reject, and typing a name has to keep working when it does.
 */
function ChoiceRow(props: {
    label: string;
    placeholder: string;
    available: readonly string[];
    value: string | null;
    onChange: (value: string | null) => void;
}) {
    const options = puppetChoiceOptions(props.available, props.value);
    return (
        <div className="flex flex-col gap-1">
            <span className={ROW_LABEL}>{props.label}</span>
            {options.length === 0 ? (
                <Input
                    size="sm"
                    fullWidth
                    value={props.value ?? ""}
                    placeholder={props.placeholder}
                    onChange={event => props.onChange(event.target.value.trim() || null)}
                />
            ) : (
                <Select
                    options={[
                        // The empty option is the engine's `null`, which is a real state - the model
                        // rests with nothing applied - and not the absence of a choice.
                        { value: "", label: props.placeholder },
                        ...options.map(name => ({ value: name, label: name })),
                    ]}
                    value={props.value ?? ""}
                    size="sm"
                    fullWidth
                    portalMenu
                    onChange={next => props.onChange(String(next) || null)}
                />
            )}
        </div>
    );
}

/**
 * Motion / expression / skin, filled from what the live model said about itself.
 *
 * One component for all three because they share one description lookup: three would mount the model
 * three times to learn the same thing.
 */
function PuppetStateField(props: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const current = getLivePuppetProps(props.data);
    const box = puppetWidgetSize(liveElement(props.data));

    /**
     * Only the values that decide what a backend would load. The pose is deliberately out: applying a
     * motion does not change which motions exist, and including it would re-mount the model every
     * time the author picked one.
     *
     * The size goes in because the description carries the model's own canvas size and a backend is
     * given the box at mount; keyed on the encoding so a drag does not re-mount per pixel.
     */
    const requestKey = encodeStableJson({
        assetId: current.assetId,
        backend: current.backend,
        options: current.options,
        box,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value; see above
    const request = useMemo<PuppetDescriptionRequest | null>(() => (
        current.assetId && current.backend
            ? {
                assetId: current.assetId,
                backend: current.backend,
                entry: null,
                options: current.options,
                size: box,
            }
            : null
    ), [requestKey]);

    const { result, loading, refresh } = usePuppetDescription(request);
    const description = result?.status === "ok" ? result.description : null;

    return (
        <div className="flex flex-col gap-2">
            <ChoiceRow
                label={t("widgets.puppet.motion")}
                placeholder={t("widgets.puppet.stateNone")}
                available={description?.motions ?? []}
                value={current.motion}
                onChange={value => patchPuppet(props.data, { motion: value })}
            />
            <ChoiceRow
                label={t("widgets.puppet.expression")}
                placeholder={t("widgets.puppet.stateNone")}
                available={description?.expressions ?? []}
                value={current.expression}
                onChange={value => patchPuppet(props.data, { expression: value })}
            />
            <ChoiceRow
                label={t("widgets.puppet.skin")}
                placeholder={t("widgets.puppet.skinDefault")}
                available={description?.skins ?? []}
                value={current.skin}
                onChange={value => patchPuppet(props.data, { skin: value })}
            />
            {/* Where the three lists came from, and the way to take them again. A description is a
                reading of files that change outside Studio, so the author has to be able to see that
                it is stale and act on it. */}
            {request ? (
                <div className="flex items-center gap-2 text-2xs text-fg-subtle">
                    <span className="min-w-0 flex-1 truncate">
                        {loading
                            ? t("widgets.puppet.describing")
                            : t(describeStatusKey(result?.status === "unavailable" ? result.reason : null))}
                    </span>
                    {/* Re-reading the model files is looking, not writing: it refreshes the three
                        lists above and leaves the element's props alone. An
                        {@link InspectOnlyButton} because the inspector clamps this field in a
                        `disabled` `<fieldset>` while the workspace is frozen, and as a `<button>`
                        this went with it - which left the author of a past version staring at a
                        stale or failed description with no way to take it again. */}
                    <InspectOnlyButton
                        className="shrink-0 rounded-md px-1.5 py-0.5 tracking-wider text-fg-subtle hover:bg-fill hover:text-fg-muted cursor-default"
                        onClick={refresh}
                    >
                        {t("widgets.puppet.redescribe")}
                    </InspectOnlyButton>
                </div>
            ) : null}
        </div>
    );
}

/**
 * `options`, edited as JSON.
 *
 * Kept as text with its own error line rather than reverting on a parse failure: the bag is the
 * author's and arbitrary, so Studio has nothing better to offer than a text box, and snapping the
 * text back to the last valid value mid-edit loses work for the sake of looking tidy. An invalid
 * draft is simply not committed.
 */
function PuppetOptionsField(props: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const current = getLivePuppetProps(props.data);
    const committed = useMemo(() => JSON.stringify(current.options, null, 2), [current.options]);
    const [draft, setDraft] = useState<string | null>(null);
    const [invalid, setInvalid] = useState(false);

    const commit = useCallback((text: string) => {
        const trimmed = text.trim();
        if (trimmed.length === 0) {
            setInvalid(false);
            setDraft(null);
            patchPuppet(props.data, { options: {} });
            return;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            setInvalid(true);
            return;
        }
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            setInvalid(true);
            return;
        }
        setInvalid(false);
        setDraft(null);
        patchPuppet(props.data, { options: parsed as Record<string, unknown> });
    }, [props.data]);

    return (
        <div className="flex flex-col gap-1">
            <span className={ROW_LABEL}>{t("widgets.puppet.options")}</span>
            <textarea
                rows={4}
                spellCheck={false}
                value={draft ?? committed}
                onChange={event => { setDraft(event.target.value); setInvalid(false); }}
                onBlur={event => commit(event.target.value)}
                className="w-full resize-none rounded-md border border-edge bg-surface px-2 py-1.5 font-mono text-2xs text-fg focus:border-primary/50 focus:outline-none"
            />
            <span className={`text-2xs leading-snug ${invalid ? "text-danger" : "text-fg-subtle"}`}>
                {invalid ? t("widgets.puppet.optionsInvalid") : t("widgets.puppet.optionsHint")}
            </span>
        </div>
    );
}

export function createPuppetInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { t } = i18nStore.getTranslator();
    const { element } = ctx;

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.puppet:${element.id}`,
        title: element.name ?? t("widgets.puppet.title"),
        fields: [],
        tabs: [
            {
                id: "properties",
                title: t("widgets.tabs.properties"),
                fields: [
                    defineField<D, any>({
                        id: "section.puppetModel",
                        type: "section",
                        title: t("widgets.puppet.sectionModel"),
                        fields: [
                            defineField<D, any>({
                                id: "puppet.runtimeNotice",
                                type: "custom",
                                component: PuppetRuntimeNotice,
                            }),
                            defineField<D, any>({
                                id: "puppet.model",
                                type: "custom",
                                component: PuppetModelField,
                            }),
                            defineField<D, any>({
                                id: "puppet.backend",
                                type: "custom",
                                component: PuppetBackendField,
                            }),
                            defineField<D, any>({
                                id: "puppet.options",
                                type: "custom",
                                component: PuppetOptionsField,
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.puppetState",
                        type: "section",
                        title: t("widgets.puppet.sectionState"),
                        fields: [
                            defineField<D, any>({
                                id: "puppet.state",
                                type: "custom",
                                component: PuppetStateField,
                            }),
                        ],
                    }),
                    /**
                     * The widget paints through `RectangleChromeRenderer`, so these are the same flat
                     * chrome props every other rectangle-like widget stores. There is no
                     * appearance-variant model on this widget - see the card's WI-1 correction.
                     */
                    defineField<D, any>({
                        id: "section.puppetBox",
                        type: "section",
                        title: t("widgets.puppet.sectionBox"),
                        collapsible: true,
                        defaultCollapsed: true,
                        fields: [
                            defineField<D, any>({
                                id: "puppet.backgroundColor",
                                type: "colorPicker",
                                label: t("widgets.puppet.backdrop"),
                                helpText: t("widgets.puppet.backdropHint"),
                                displayMode: "icon-hex",
                                allowOpacity: false,
                                brandPalette: true,
                                getValue: (d: D) => parseColorValue(getLiveChromeProps(d).backgroundColor, { hex: "#FFFFFF", alpha: 1 }),
                                setValue: (d: D, value: ColorValue) =>
                                    patchChrome(d, {
                                        backgroundColor: serializeColorValue(value),
                                        fillType: "color",
                                        fillVisible: true,
                                    }),
                            }),
                            defineField<D, any>({
                                id: "puppet.borderRadius",
                                type: "number",
                                label: t("widgets.rectangleInspector.cornerRadius"),
                                min: 0,
                                step: 1,
                                getValue: (d: D) => getLiveChromeProps(d).borderRadius,
                                setValue: (d: D, value: number) => {
                                    const chrome = getLiveChromeProps(d);
                                    const radius = Math.max(0, value);
                                    patchChrome(d, chrome.borderRadiusLinked
                                        ? {
                                            borderRadius: radius,
                                            borderRadiusTL: radius,
                                            borderRadiusTR: radius,
                                            borderRadiusBL: radius,
                                            borderRadiusBR: radius,
                                        }
                                        : { borderRadius: radius });
                                },
                            }),
                            defineField<D, any>({
                                id: "puppet.borderWidth",
                                type: "number",
                                label: t("widgets.rectangleInspector.border"),
                                min: 0,
                                step: 1,
                                getValue: (d: D) => getLiveChromeProps(d).borderWidth,
                                setValue: (d: D, value: number) =>
                                    patchChrome(d, { borderWidth: Math.max(0, value) }),
                            }),
                            defineField<D, any>({
                                id: "puppet.borderColor",
                                type: "colorPicker",
                                label: t("widgets.rectangleInspector.borderStyle"),
                                displayMode: "icon-hex",
                                allowOpacity: false,
                                brandPalette: true,
                                getValue: (d: D) => parseColorValue(getLiveChromeProps(d).borderColor, { hex: "#FFFFFF", alpha: 1 }),
                                setValue: (d: D, value: ColorValue) =>
                                    patchChrome(d, { borderColor: serializeColorValue(value), strokeVisible: true }),
                            }),
                        ],
                    }),
                ],
            },
            {
                id: "interaction",
                title: t("widgets.tabs.interaction"),
                fields: [
                    defineField<D, any>({
                        id: "interaction.blueprint.readonly",
                        type: "custom",
                        label: t("widgets.blueprint.controlLabel"),
                        component: ReadonlyBlueprintSection,
                    }),
                ],
            },
        ],
    });
}
