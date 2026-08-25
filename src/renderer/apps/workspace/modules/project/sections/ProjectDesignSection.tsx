/**
 * Project -> Design: the project's palette, one row per colour, and its default font stack.
 *
 * Two parts, and the split is the model's. The colours with a plain id are the project's own and
 * are what an author decides; the ids carrying a dot are the slots each control paints with, and
 * every one of them ships pointing at one of the four above (`button.primary` is `nlbrand:primary`).
 * See `@shared/types/brand` for why that is one array and one id space rather than two tables.
 *
 * **Built on `Accordion` for the control groups, not on a card per group** - the same call
 * `ProjectAudioSection` documents at length and for the same reason: this is N of the same thing.
 * Thirteen seeded slots in four groups is already far past what a bordered card per group, each
 * with its own title and description, can hold in a panel this narrow. The four project colours are
 * not behind a disclosure, because they are the part an author came here to change.
 *
 * Nothing on this surface explains itself in prose. What a palette is and what a link does is the
 * `brand` help topic, reached by the `?` the sub-page header carries.
 *
 * Three things are load-bearing and easy to undo by accident:
 *
 * - **`serializeColorValue`, never `colorValueToCss`, on the way in.** The former keeps a
 *   `nlbrand:` link; the latter resolves it to a literal. Writing the literal is what would turn
 *   `button.primary` from "whatever the brand's primary is" into a frozen hex, silently, the first
 *   time anybody touched the row.
 * - **`brandExclude`.** An entry may not be pointed at itself, nor at anything whose own chain
 *   already passes through it, or the palette gains a ring that resolves to nothing. Offering the
 *   swatch and then refusing the pick teaches the author the control is broken, so the ids are
 *   withheld instead. See {@link brandLinkExclusions}.
 * - **`onChange` is a drag frame, `onCommit` is the edit.** The picker fires `onChange` on every
 *   pointer move across the colour map; each one would be a document revision and an autosave
 *   timer. The row keeps a draft and writes on close, the way `CharacterColorField` does.
 *
 * Comments in English per project convention.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Languages, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { Button, Checkbox, IconButton, Input, Select, useEscapeToClose } from "@/lib/components/elements";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { AnchoredPanel } from "@/lib/components/elements/HintPopover";
import { useDismissWhenHidden } from "@/lib/components/layout/hostVisibility";
import { cn } from "@/lib/utils/cn";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { useBrandColorLabel } from "@/apps/workspace/modules/properties/framework/fields/brandPalette";
import {
    colorValueToCss,
    parseColorValue,
    serializeColorValue,
} from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { EDITOR_BUILTIN_FONT_VIRTUAL_GROUP, getBuiltinEditorFontDisplayName } from "@/lib/ui-editor/fonts/builtinVirtualEditorFonts";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { useEditorFontFamily } from "@/lib/workspace/hooks/useEditorFontFamily";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { BrandService } from "@/lib/workspace/services/brand/BrandService";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import type { BrandPalette } from "@shared/brand/brandRegistry";
import { collectBrandLinkReferences, countBrandLinkReferences } from "@shared/brand/brandReferences";
import type { TranslationKey } from "@shared/i18n";
import { BRAND_CONTROL_GROUPS, type BrandColor } from "@shared/types/brand";
import { entryServesLocale, PROJECT_FONT_STACK_MAX, type ProjectFontEntry } from "@shared/types/typography";
import {
    localeAutonym,
    type LocalizationConfiguration,
    type LocalizationLocaleEntry,
} from "@shared/types/localization";
import { suggestLocalesForCoverage } from "@shared/typography/localeScripts";
import { useWorkspace } from "../../../context";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

/**
 * What the picker opens on when a row's stored value is one this parser cannot read.
 *
 * Only ever a starting point for the eye. It is never written on its own - the row commits what the
 * picker hands back, and an untouched row commits nothing - so an unreadable value stays on disk
 * exactly as it is until the author replaces it, which is what lets project check keep reporting it.
 */
const UNREADABLE_COLOR_FALLBACK: ColorValue = { hex: "#FFFFFF", alpha: 1 };

/**
 * The swatch's own box. 20px because that is the size of the hit area `ColorPickerTrigger` renders
 * in `swatch` mode, which draws no fill of its own and expects its caller to frame it (see
 * `ColorDisplayMode`). Not a control height, and deliberately not on the §3 scale: it is a dot in a
 * 28px row, centred, the same shape the settings window's accent chip uses.
 */
const SWATCH_BOX_CLASS = "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
    + " ring-1 ring-inset ring-edge-strong";

/**
 * The specimen's own box, beside the name of the font it is set in.
 *
 * Wider than the palette's swatch and squared off rather than round, because what it holds is two
 * letters rather than a dot - and `rounded-md` is what a box of that size is, per the §3 rule that a
 * nested box never rounds further than the control scale around it.
 */
const SPECIMEN_BOX_CLASS = "inline-flex h-6 w-9 shrink-0 items-center justify-center rounded-md"
    + " ring-1 ring-inset ring-edge-strong text-xs text-fg";

/**
 * What the font picker offers besides the library: the system stacks, which need no font file.
 *
 * Deliberately not the project-default row `FontAssetField` shows - this is the surface the project
 * default is built on, and offering it here would be a stack pointing at itself.
 */
const FONT_PICKER_VIRTUAL_GROUPS = [EDITOR_BUILTIN_FONT_VIRTUAL_GROUP];

/**
 * Clamps that keep this subtree from widening the panel.
 *
 * A flex/grid item's `min-width` defaults to its min-content, and an `<input>` contributes its
 * intrinsic `size` width (~258px) to that, which `min-w-0` on the input itself does NOT remove from
 * the parent's contribution. `Accordion` owns the header's flex chain, so the clamp has to come from
 * outside via `headerClassName`; without it a long name pushes the sub-page into horizontal scroll.
 */
const HEADER_WIDTH_CLAMP = "min-w-0 [&>button]:min-w-0 [&>button>span]:min-w-0";

/**
 * A control group's rows. The last one drops its hairline because `AccordionItem` already draws one
 * under itself, and the two land adjacent - a 2px rule under the last slot of every open group.
 */
const GROUP_BODY_CLASS = "min-w-0 bg-fill-subtle px-3 [&>*:last-child]:border-b-0";

/**
 * The ids that must not be offered while editing `id`, `id` itself included.
 *
 * Pointing `x` at `y` closes a ring exactly when `y` is `x`, or when the chain out of `y` already
 * runs through `x`. Walked from each candidate rather than from `x` because that is the direction
 * a link points: `BrandPalette.chainOf` reports where a value leads, so the question "would picking
 * this come back to me" is asked of the candidate.
 *
 * Exported for its test - the failure it prevents (a palette that resolves to nothing, on every
 * surface at once) has no cheap symptom on screen.
 */
export function brandLinkExclusions(palette: BrandPalette, id: string): string[] {
    const excluded = [id];
    for (const color of palette.list()) {
        if (color.id !== id && palette.chainOf(color.id).includes(id)) {
            excluded.push(color.id);
        }
    }
    return excluded;
}

export function ProjectDesignSection({ uiService }: ProjectSectionProps) {
    const { t, tn, has } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const freeze = useFreezeGuard();
    const colorLabel = useBrandColorLabel();

    const brandService = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return context.services.get<BrandService>(Services.Brand);
    }, [context, isInitialized]);

    const [colors, setColors] = useState<BrandColor[]>([]);

    useEffect(() => {
        if (!brandService) {
            setColors([]);
            return;
        }
        setColors(brandService.listColors());
        return brandService.onColorsChanged(setColors);
    }, [brandService]);

    /**
     * The live palette, which is the module-level one every colour field in Studio paints from.
     *
     * Read on each render rather than memoized: `getActiveBrandPalette` hands back a cached
     * instance and only builds a new one when a host publishes different colours, so the identity
     * changes exactly when the rows below need to recompute and never in between.
     */
    const palette = brandService?.getPalette() ?? null;

    // Ids with no dot. That is the model's own distinction between a colour the author decided and
    // a slot a control consumes, and taking it from the id keeps this list and `BRAND_CONTROL_GROUPS`
    // reading the same array (see `@shared/types/brand`).
    const projectColors = useMemo(() => colors.filter(color => !color.id.includes(".")), [colors]);
    const byId = useMemo(() => new Map(colors.map(color => [color.id, color])), [colors]);

    const addColor = useCallback(() => {
        // A name is passed rather than left to the service, which deliberately invents none: the
        // row would otherwise show its generated id as a placeholder.
        brandService?.createColor({ name: t("brand.panel.newColorName") });
    }, [brandService, t]);

    /**
     * Delete, once the author has been told what points at the colour.
     *
     * The scan runs here rather than in an effect over the id set. `ProjectAudioSection` counts in
     * an effect because its scan is asynchronous (it loads every story document) and the number is
     * on screen beside the button; this one is synchronous and the number is only ever read by the
     * confirmation, so counting on the click costs one scan per delete instead of one per colour
     * edit - and cannot be stale, which an effect racing an edit could be.
     */
    const removeColor = useCallback(async (color: BrandColor) => {
        if (!brandService || !context) {
            return;
        }
        const name = colorLabel(color);
        const uses = countReferences(context).get(color.id) ?? 0;
        const confirmed = await uiService?.showDestructiveConfirm(
            t("brand.panel.deleteConfirm", { name }),
            uses > 0 ? tn("brand.panel.deleteDetail", uses) : t("brand.panel.deleteUnused"),
            t("brand.panel.delete"),
        );
        if (confirmed) {
            brandService.deleteColor(color.id);
        }
    }, [brandService, colorLabel, context, t, tn, uiService]);

    return (
        // The same grid the multi-part sub-pages use, so the two headings sit at the spacing every
        // other project page has. `SettingsGroup` drops its own top rule on the first child, which
        // is why the parts have to be direct children of this element rather than wrapped further.
        <div className="grid gap-3 [&>*]:min-w-0">
            <SettingsGroup title={t("project.group.brandColors")}>
                {/* The top rule is the list's own edge: every row carries a bottom hairline, so
                    without it the list is bounded below and open above - the same edge the control
                    groups' accordion draws for itself. */}
                <div className="min-w-0 border-t border-edge">
                    {projectColors.map(color => (
                        <ColorRow
                            key={color.id}
                            color={color}
                            service={brandService}
                            palette={palette}
                            label={colorLabel(color)}
                            // Only the author's own colours. The four seeded ones are what every
                            // control slot points at and what the panel is built from, and
                            // `BrandService.deleteColor` refuses them anyway.
                            onDelete={color.builtin ? undefined : () => void removeColor(color)}
                        />
                    ))}
                </div>
                <div className="flex min-w-0">
                    <Button size="sm" onClick={addColor} {...freeze.writes(!brandService)}>
                        <Plus className="h-3.5 w-3.5" />
                        {t("brand.panel.add")}
                    </Button>
                </div>
            </SettingsGroup>

            <SettingsGroup title={t("project.group.brandControls")}>
                <div className="min-w-0 border-t border-edge">
                    {/* Collapsed by default, all of them. A control group is where an author goes
                        to override one slot, not what they scan; open they are thirteen rows
                        between them, and the four colours above scroll off the top. */}
                    <Accordion className="min-w-0" multiple>
                        {BRAND_CONTROL_GROUPS.map(group => (
                            <AccordionItem
                                key={group.id}
                                id={group.id}
                                className="min-w-0"
                                headerClassName={HEADER_WIDTH_CLAMP}
                                contentClassName="min-w-0"
                                headerProps={{
                                    // The row's handle: verification, and anything that later has to
                                    // find a group on screen, reads this rather than matching a
                                    // translated label.
                                    "data-brand-group": group.id,
                                }}
                                title={<span className="min-w-0 truncate text-fg">{groupTitle(group.id, t, has)}</span>}
                            >
                                {/*
                                  * `Accordion` listens for Enter/Space on `window` to toggle the
                                  * focused row, and its only exemption is for real
                                  * `input`/`textarea`/`select` elements. The swatch is a `button`,
                                  * so without this a Space on it would open the picker and collapse
                                  * the group underneath it at the same time. Scoped to the two keys
                                  * the accordion consumes, so application keybindings still reach
                                  * the window from inside an open group.
                                  */}
                                <div
                                    className={GROUP_BODY_CLASS}
                                    onKeyDown={event => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.stopPropagation();
                                        }
                                    }}
                                >
                                    {group.slotIds.map(slotId => {
                                        const color = byId.get(slotId);
                                        return color ? (
                                            <ColorRow
                                                key={slotId}
                                                color={color}
                                                service={brandService}
                                                palette={palette}
                                                label={colorLabel(color)}
                                                // No delete: which slots exist is decided by the
                                                // controls that consume them, not here.
                                            />
                                        ) : null;
                                    })}
                                </div>
                            </AccordionItem>
                        ))}
                    </Accordion>
                </div>
            </SettingsGroup>

            <FontStackGroup service={brandService} />
        </div>
    );
}

/**
 * Project -> Design: the fonts text is set in, in priority order.
 *
 * The list *is* the feature. A widget that has chosen no font of its own is set in this stack, and a
 * widget that has chosen one falls through to it for the characters its own typeface has no glyph
 * for - so the order of these rows is what the rest of the project inherits, and moving a row is the
 * edit an author comes here to make. See `@shared/types/typography` for why nothing is written into
 * a widget to make that happen.
 *
 * Not an accordion, unlike the control slots above: a stack is two or three rows and all of them are
 * what the author came for. Not confirmed on delete either - a removed font is one press of Add away,
 * and the palette's confirmation exists because a deleted colour leaves broken links behind, which a
 * removed font cannot do.
 *
 * ## The language half appears only when there is a language
 *
 * A rung may be restricted to some of the project's languages, which is how a project sets Japanese
 * in one face and Simplified Chinese in another without anybody maintaining a table. But a project
 * with fewer than two languages has no axis to restrict along, so **every language control here is
 * absent** in one: the rows are exactly what they were before the feature existed. Adding a second
 * language is what makes the controls appear, and it never asks the author to fill anything in - an
 * unrestricted rung already serves the new language.
 *
 * The preview picker does not filter the list. It dims the rows the chosen language does not use, so
 * what that language resolves to is the undimmed rows read top to bottom - and a restriction that is
 * wrong is still on screen, one press from being fixed. Hiding those rows would mean an author had
 * to guess which language to preview before they could edit the row they came for.
 */
function FontStackGroup({ service }: { service: BrandService | null }) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const freeze = useFreezeGuard();
    const [fonts, setFonts] = useState<ProjectFontEntry[]>([]);
    const [pickerOpen, setPickerOpen] = useState(false);
    const addRef = useRef<HTMLDivElement | null>(null);
    const { locales, sourceLocale } = useProjectLocales(context);
    const [previewLocale, setPreviewLocale] = useState("");

    useEffect(() => {
        if (!service) {
            setFonts([]);
            return;
        }
        setFonts(service.listFonts());
        return service.onFontsChanged(setFonts);
    }, [service]);

    /**
     * The preview follows the project's source language until the author picks another.
     *
     * That is what the editor resolves fonts in everywhere else (see `BrandService`'s locale watch),
     * so opening this group shows the stack the canvas beside it is already using rather than an
     * arbitrary first entry. A language that has been removed falls back the same way.
     */
    useEffect(() => {
        setPreviewLocale(current => (
            locales.some(locale => locale.code === current) ? current : sourceLocale
        ));
    }, [locales, sourceLocale]);

    const assetsService = useMemo(() => {
        try {
            return context?.services.get<AssetsService>(Services.Assets) ?? null;
        } catch {
            return null;
        }
    }, [context]);

    /**
     * What a row is called: the built-in stack's name, or the library's name for the asset.
     *
     * A font the library no longer has is named as missing rather than falling back to the generic
     * word for a typeface. The stack keeps the id - an asset can come back, and dropping the row
     * would lose an ordering the author set - so the row has to be able to say what it is holding.
     */
    const fontLabel = useCallback((assetId: string): string => {
        const builtin = getBuiltinEditorFontDisplayName(assetId);
        if (builtin) {
            return builtin;
        }
        const asset = assetsService?.getAssets()[AssetType.Font]?.[assetId];
        return asset?.name ?? t("brand.fonts.missing");
    }, [assetsService, t]);

    /**
     * Add the fonts the picker handed back, restricted to whatever they turn out to be for.
     *
     * The suggestion is the point of the whole language half: the author is not asked to compose a
     * table, they are shown an answer the font itself gave and left to correct it. It is refused far
     * more often than it is made - see `suggestLocalesForCoverage` - and a refusal adds the rung
     * unrestricted, which is the state every rung had before this existed.
     *
     * Resolved before the rung is added rather than added and then amended: a row that appears
     * unrestricted and acquires a language a moment later is an edit nobody made.
     */
    const handleConfirm = useCallback((assets: Asset[]) => {
        setPickerOpen(false);
        void (async () => {
            for (const asset of assets) {
                service?.addFont(asset.id, await suggestRestriction(assetsService, asset, locales));
            }
        })();
    }, [assetsService, locales, service]);

    const full = fonts.length >= PROJECT_FONT_STACK_MAX;
    const selectedIds = useMemo(() => fonts.map(entry => entry.assetId), [fonts]);
    // Fewer than two and there is nothing to choose between; see the note on this component.
    const multilingual = locales.length >= 2;
    const previewName = locales.find(locale => locale.code === previewLocale)?.displayName ?? previewLocale;

    return (
        <SettingsGroup
            title={t("project.group.typography")}
            description={t("brand.fonts.description")}
            trailing={multilingual ? (
                <Select
                    size="sm"
                    value={previewLocale}
                    ariaLabel={t("brand.fonts.preview")}
                    options={locales.map(locale => ({ value: locale.code, label: locale.displayName }))}
                    onChange={next => setPreviewLocale(String(next))}
                />
            ) : undefined}
        >
            {fonts.length > 0 ? (
                <div className="min-w-0 border-t border-edge">
                    {fonts.map((entry, index) => (
                        <FontRow
                            key={entry.assetId}
                            entry={entry}
                            label={fontLabel(entry.assetId)}
                            service={service}
                            first={index === 0}
                            last={index === fonts.length - 1}
                            locales={multilingual ? locales : []}
                            excludedFrom={
                                multilingual && previewLocale && !entryServesLocale(entry, previewLocale)
                                    ? previewName
                                    : null
                            }
                        />
                    ))}
                </div>
            ) : null}
            <div className="flex min-w-0" ref={addRef}>
                <Button size="sm" onClick={() => setPickerOpen(true)} {...freeze.writes(!service || full)}>
                    <Plus className="h-3.5 w-3.5" />
                    {t("brand.fonts.add")}
                </Button>
            </div>

            <AssetSelector
                visible={pickerOpen}
                assetType={AssetType.Font}
                virtualGroups={FONT_PICKER_VIRTUAL_GROUPS}
                virtualGroupsPlacement="before"
                anchorRef={addRef}
                title={t("brand.fonts.add")}
                multiple={false}
                // The stack's own ids, so a font already on it reads as taken rather than as a fresh
                // pick that silently does nothing - `addFont` refuses a duplicate.
                selectedIds={selectedIds}
                onClose={() => setPickerOpen(false)}
                onConfirm={handleConfirm}
            />
        </SettingsGroup>
    );
}

/**
 * The project's languages, and which of them it is written in.
 *
 * Subscribed rather than read once: adding the project's second language is exactly what makes the
 * controls in this group appear, and an author who has just added one should not have to reopen the
 * panel to see them.
 *
 * A window without the service - and there are several that carry only part of the service set -
 * reads no languages, which is the state a project that never configured localization is in and
 * draws the same rows.
 */
function useProjectLocales(context: WorkspaceContext | null): {
    locales: LocalizationLocaleEntry[];
    sourceLocale: string;
} {
    const [config, setConfig] = useState<{ locales: LocalizationLocaleEntry[]; sourceLocale: string }>({
        locales: [],
        sourceLocale: "",
    });

    useEffect(() => {
        let service: LocalizationService | null = null;
        try {
            service = context?.services.get<LocalizationService>(Services.Localization) ?? null;
        } catch {
            service = null;
        }
        if (!service) {
            return;
        }
        const publish = (next: LocalizationConfiguration): void => setConfig({
            locales: next.locales,
            sourceLocale: next.sourceLocale,
        });
        publish(service.getConfiguration());
        return service.onConfigChanged(publish);
    }, [context]);

    return config;
}

/**
 * The languages a font should be restricted to when it is added, or nothing.
 *
 * Nothing is the usual answer and the safe one: an unrestricted rung serves every language, so a
 * refusal costs the author one edit while a wrong guess silently removes a font from the language it
 * was bought for. A font that cannot be read at all - a WOFF2 on a host with no Brotli decompressor,
 * a file that is not a font - is a refusal too, for the same reason.
 */
async function suggestRestriction(
    assetsService: AssetsService | null,
    asset: Asset,
    locales: readonly LocalizationLocaleEntry[],
): Promise<string[] | undefined> {
    const fontService = assetsService?.fontService;
    if (!fontService || locales.length < 2 || asset.type !== AssetType.Font) {
        return undefined;
    }
    const coverage = await fontService.readCoverage(asset as Asset<AssetType.Font>);
    if (!coverage.ok) {
        return undefined;
    }
    const suggested = suggestLocalesForCoverage(coverage.coverage, locales.map(locale => locale.code));
    return suggested.length > 0 ? suggested : undefined;
}

/**
 * One rung: a specimen set in that font alone, its name, the languages it is for, and its place in
 * the order.
 *
 * `followProjectDefault: false` on the specimen is load-bearing. The default resolution appends the
 * whole project stack to whatever it is asked for, which is right everywhere else and wrong here:
 * every row would preview through the same fallbacks and a row whose own font failed to load would
 * look exactly like one that worked.
 *
 * The second line and the language button are drawn only when there is something to say - a rung
 * nobody restricted is one line, exactly as it was before languages existed, and `locales` is empty
 * for a project that has fewer than two of them.
 */
function FontRow({
    entry,
    label,
    service,
    first,
    last,
    locales,
    excludedFrom,
}: {
    entry: ProjectFontEntry;
    label: string;
    service: BrandService | null;
    first: boolean;
    last: boolean;
    /** The project's languages, or empty when it has too few for the question to mean anything. */
    locales: readonly LocalizationLocaleEntry[];
    /** The previewed language's name, when this rung is not part of that language's stack. */
    excludedFrom: string | null;
}) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const { cssFamily } = useEditorFontFamily(entry.assetId, { followProjectDefault: false });
    const [localesOpen, setLocalesOpen] = useState(false);
    const localesRef = useRef<HTMLButtonElement | null>(null);

    const restriction = useMemo(() => entry.locales ?? [], [entry.locales]);
    const restrictionLabel = restriction
        .map(code => locales.find(locale => locale.code === code)?.displayName ?? localeAutonym(code))
        .join(" · ");

    return (
        <div
            className={cn(
                "flex min-w-0 items-center gap-2 border-b border-edge py-1.5",
                excludedFrom ? "opacity-50" : undefined,
            )}
            data-tip={excludedFrom ? t("brand.fonts.excluded", { language: excludedFrom }) : undefined}
        >
            <span className={SPECIMEN_BOX_CLASS} style={cssFamily ? { fontFamily: cssFamily } : undefined}>
                Aa
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-fg">{label}</span>
                {restrictionLabel ? (
                    <span className="block truncate text-2xs text-fg-subtle">{restrictionLabel}</span>
                ) : null}
            </span>
            {locales.length > 0 ? (
                <IconButton
                    ref={localesRef}
                    size="sm"
                    aria-label={t("brand.fonts.locales.edit", { name: label })}
                    className="shrink-0"
                    onClick={() => setLocalesOpen(open => !open)}
                    {...freeze.writes(!service)}
                >
                    <Languages className="h-3.5 w-3.5" />
                </IconButton>
            ) : null}
            <IconButton
                size="sm"
                aria-label={t("brand.fonts.moveUp", { name: label })}
                className="shrink-0"
                onClick={() => service?.moveFont(entry.assetId, -1)}
                {...freeze.writes(!service || first)}
            >
                <ChevronUp className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
                size="sm"
                aria-label={t("brand.fonts.moveDown", { name: label })}
                className="shrink-0"
                onClick={() => service?.moveFont(entry.assetId, 1)}
                {...freeze.writes(!service || last)}
            >
                <ChevronDown className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
                size="sm"
                aria-label={t("brand.fonts.remove", { name: label })}
                className="shrink-0 hover:text-danger"
                onClick={() => service?.removeFont(entry.assetId)}
                {...freeze.writes(!service)}
            >
                <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
            {localesOpen ? (
                <FontLocalesPopover
                    anchorRef={localesRef}
                    locales={locales}
                    selected={restriction}
                    onToggle={(code, member) => service?.setFontLocales(
                        entry.assetId,
                        member ? [...restriction, code] : restriction.filter(existing => existing !== code),
                    )}
                    onClose={() => setLocalesOpen(false)}
                />
            ) : null}
        </div>
    );
}

/** How wide the language popover is. Two words and a tick, in the widest language a project lists. */
const LOCALE_POPOVER_WIDTH_PX = 176;

/**
 * Which languages a rung is for: one tick per language of the project.
 *
 * A checkbox rather than a switch because the question is membership of a set, not a preference -
 * the distinction `Checkbox` documents and the rest of Studio keeps. Nothing ticked means every
 * language, and that is named at the foot of the panel rather than left as a blank list: an author
 * who has just unticked the last language has to be able to see what they now have.
 *
 * Portalled through `AnchoredPanel` for the reason every floating panel in this app is - the sidebar
 * it opens from is `overflow-hidden` and would clip it - and dismissed three ways, because a body
 * portal outlives things its host does not: a click elsewhere, Escape, and the host panel being
 * switched away from, which would otherwise leave this on screen over whatever replaced it.
 */
function FontLocalesPopover({
    anchorRef,
    locales,
    selected,
    onToggle,
    onClose,
}: {
    anchorRef: React.MutableRefObject<HTMLButtonElement | null>;
    locales: readonly LocalizationLocaleEntry[];
    selected: readonly string[];
    onToggle: (code: string, member: boolean) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const panelRef = useRef<HTMLDivElement | null>(null);

    useEscapeToClose(true, onClose);
    useDismissWhenHidden(onClose);

    useEffect(() => {
        const onPointerDown = (event: MouseEvent): void => {
            const target = event.target as Node | null;
            if (panelRef.current?.contains(target as Node) || anchorRef.current?.contains(target as Node)) {
                return;
            }
            onClose();
        };
        // Capture, so a click landing on a control that stops propagation still closes this.
        document.addEventListener("mousedown", onPointerDown, true);
        return () => document.removeEventListener("mousedown", onPointerDown, true);
    }, [anchorRef, onClose]);

    const anchor = useCallback(() => anchorRef.current?.getBoundingClientRect() ?? null, [anchorRef]);

    return (
        <AnchoredPanel
            anchor={anchor}
            width={LOCALE_POPOVER_WIDTH_PX}
            role="dialog"
            panelRef={panelRef}
            className="z-[110] grid gap-1 rounded-lg border border-edge bg-surface-overlay p-2 shadow-2xl"
        >
            <FieldLabel as="div">{t("brand.fonts.locales.title")}</FieldLabel>
            {locales.map(locale => (
                <Checkbox
                    key={locale.code}
                    className="text-xs text-fg"
                    checked={selected.includes(locale.code)}
                    onCheckedChange={member => onToggle(locale.code, member)}
                >
                    {locale.displayName}
                </Checkbox>
            ))}
            {selected.length === 0 ? (
                <span className="text-2xs text-fg-subtle">{t("brand.fonts.locales.all")}</span>
            ) : null}
        </AnchoredPanel>
    );
}

/** The group's heading, falling back to its id so a slot seeded ahead of its translation still reads. */
function groupTitle(
    groupId: string,
    t: (key: TranslationKey, params?: Record<string, string | number>) => string,
    has: (key: string) => boolean,
): string {
    const key = `brand.group.${groupId}`;
    return has(key) ? t(key as TranslationKey) : groupId;
}

/**
 * One palette entry: what it paints as, what it is called, and - for an author's own - a way out.
 *
 * The whole row is one `size="sm"` scale, so the input decides the height and the delete button
 * matches it; the swatch is a dot inside that row rather than a control on the scale (see
 * {@link SWATCH_BOX_CLASS}).
 */
function ColorRow({
    color,
    service,
    palette,
    label,
    onDelete,
}: {
    color: BrandColor;
    service: BrandService | null;
    palette: BrandPalette | null;
    label: string;
    onDelete?: () => void;
}) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const edit = freeze.writes(!service, t("brand.panel.editColor", { name: label }));

    /**
     * What the picker is showing, which is the stored value except while its panel is open.
     *
     * Not memoized on `color.value`: a linked entry's resolved hex changes when the colour it points
     * at changes, and the string it is stored as does not.
     */
    const stored = parseColorValue(color.value, UNREADABLE_COLOR_FALLBACK);
    const [draft, setDraft] = useState<ColorValue | null>(null);
    const shown = draft ?? stored;

    const exclusions = useMemo(
        () => (palette ? brandLinkExclusions(palette, color.id) : [color.id]),
        [color.id, palette],
    );

    const commit = useCallback((value: ColorValue) => {
        setDraft(null);
        const next = serializeColorValue(value);
        // Opening the picker and closing it without touching anything must write nothing: the value
        // is identical, and storing it anyway would dirty the project and schedule a save over an
        // edit the author never made.
        if (next && next !== color.value) {
            service?.updateColor(color.id, { value: next });
        }
    }, [color.id, color.value, service]);

    return (
        // No horizontal padding of its own: the flat list runs to the section's own edges, and a
        // group's rows take their inset from the disclosure body they sit in.
        <div className="flex min-w-0 items-center gap-2 border-b border-edge py-1.5">
            {/* The fill lives on the frame, not on the trigger: in `swatch` mode the trigger is a
                bare hit area with no paint of its own. Author data, not a theme colour, so the
                value goes through `colorValueToCss` - the paint function - rather than a token. */}
            <span
                className={SWATCH_BOX_CLASS}
                style={{ backgroundColor: colorValueToCss(shown) }}
                data-tip={edit["data-tip"]}
            >
                {/* Frozen maps to `readOnly`, not to `writes().disabled`. A disabled trigger cannot
                    be opened, and the panel is the only place a colour is legible - a swatch shows
                    that this row is teal, not whether it is #40A8C4. Reading is exactly what the
                    freeze guard's own doc says it has no business blocking; `disabled` stays for
                    the case where there is no service to read from either. */}
                <ColorPickerTrigger
                    value={shown}
                    displayMode="swatch"
                    allowOpacity
                    brandPalette
                    brandExclude={exclusions}
                    disabled={!service}
                    readOnly={freeze.frozen}
                    ariaLabel={edit["data-tip"]}
                    onChange={setDraft}
                    onCommit={commit}
                />
            </span>

            <NameField
                name={color.name ?? ""}
                placeholder={label}
                disabled={edit.disabled}
                title={edit["data-tip"]}
                onCommit={next => service?.renameColor(color.id, next)}
            />

            {onDelete ? (
                <IconButton
                    size="sm"
                    aria-label={t("brand.panel.deleteColor", { name: label })}
                    className="shrink-0 hover:text-danger"
                    onClick={onDelete}
                    {...freeze.writes(!service)}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
            ) : null}
        </div>
    );
}

/**
 * The name, committed on blur or Enter rather than per keystroke.
 *
 * Not a convenience: `renameColor` trims and refuses a blank name, so a per-keystroke commit would
 * eat the space typed in the middle of "New Color" and reject the field the moment it was cleared
 * to retype. A seeded slot has no name in the document at all, so its field is empty and its
 * translated default is the placeholder - which is also how clearing the field puts the default
 * back rather than leaving the row unlabelled.
 */
function NameField({
    name,
    placeholder,
    disabled,
    title,
    onCommit,
}: {
    name: string;
    placeholder: string;
    disabled: boolean;
    title: string | undefined;
    onCommit: (name: string) => void;
}) {
    const [draft, setDraft] = useState(name);

    useEffect(() => {
        setDraft(name);
    }, [name]);

    const commit = useCallback(() => {
        const next = draft.trim();
        if (next && next !== name) {
            onCommit(next);
        } else {
            setDraft(name);
        }
    }, [draft, name, onCommit]);

    return (
        <Input
            size="sm"
            value={draft}
            placeholder={placeholder}
            disabled={disabled}
            data-tip={title}
            aria-label={placeholder}
            className="min-w-0 flex-1"
            onChange={event => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    event.currentTarget.blur();
                } else if (event.key === "Escape") {
                    setDraft(name);
                    event.currentTarget.blur();
                }
            }}
        />
    );
}

/**
 * How many stored links point at each colour, read from the documents that can hold one.
 *
 * The in-memory documents rather than the files, so the count reflects unsaved edits. Each service
 * is read in its own guard: one that has not loaded contributes nothing rather than costing the
 * confirmation the counts the others could have provided, and a delete must never be blocked by a
 * document this panel could not read.
 */
function countReferences(context: WorkspaceContext): Map<string, number> {
    let uidoc: unknown;
    let characters: unknown;
    try {
        uidoc = context.services.get<UIDocumentService>(Services.UIDocument).getDocument();
    } catch { /* not loaded */ }
    try {
        // The profile, not the `Character` wrapper: `collectBrandLinkReferences` names a reference
        // after the `id` and `name` it finds on the entry, and both live one level down.
        characters = context.services
            .get<CharacterService>(Services.Character)
            .listCharacter()
            .map(character => character.toJSON().profile);
    } catch { /* not loaded */ }

    return countBrandLinkReferences(collectBrandLinkReferences({ uidoc, characters }));
}
