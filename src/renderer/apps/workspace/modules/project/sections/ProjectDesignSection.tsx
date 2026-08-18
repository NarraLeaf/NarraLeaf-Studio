/**
 * Project -> Brand: the project's palette, one row per colour.
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { Button, IconButton, Input } from "@/lib/components/elements";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { useBrandColorLabel } from "@/apps/workspace/modules/properties/framework/fields/brandPalette";
import {
  colorValueToCss,
  parseColorValue,
  serializeColorValue
} from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { BrandService } from "@/lib/workspace/services/brand/BrandService";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { BrandPalette } from "@shared/brand/brandRegistry";
import {
  collectBrandLinkReferences,
  countBrandLinkReferences
} from "@shared/brand/brandReferences";
import type { TranslationKey } from "@shared/i18n";
import { BRAND_CONTROL_GROUPS, type BrandColor } from "@shared/types/brand";
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
const SWATCH_BOX_CLASS =
  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full" +
  " ring-1 ring-inset ring-edge-strong";

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
  const projectColors = useMemo(() => colors.filter((color) => !color.id.includes(".")), [colors]);
  const byId = useMemo(() => new Map(colors.map((color) => [color.id, color])), [colors]);

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
  const removeColor = useCallback(
    async (color: BrandColor) => {
      if (!brandService || !context) {
        return;
      }
      const name = colorLabel(color);
      const uses = countReferences(context).get(color.id) ?? 0;
      const confirmed = await uiService?.showDestructiveConfirm(
        t("brand.panel.deleteConfirm", { name }),
        uses > 0 ? tn("brand.panel.deleteDetail", uses) : t("brand.panel.deleteUnused"),
        t("brand.panel.delete")
      );
      if (confirmed) {
        brandService.deleteColor(color.id);
      }
    },
    [brandService, colorLabel, context, t, tn, uiService]
  );

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
          {projectColors.map((color) => (
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
            {BRAND_CONTROL_GROUPS.map((group) => (
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
                  "data-brand-group": group.id
                }}
                title={
                  <span className="min-w-0 truncate text-fg">{groupTitle(group.id, t, has)}</span>
                }
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
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.stopPropagation();
                    }
                  }}
                >
                  {group.slotIds.map((slotId) => {
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
    </div>
  );
}

/** The group's heading, falling back to its id so a slot seeded ahead of its translation still reads. */
function groupTitle(
  groupId: string,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
  has: (key: string) => boolean
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
  onDelete
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
    [color.id, palette]
  );

  const commit = useCallback(
    (value: ColorValue) => {
      setDraft(null);
      const next = serializeColorValue(value);
      // Opening the picker and closing it without touching anything must write nothing: the value
      // is identical, and storing it anyway would dirty the project and schedule a save over an
      // edit the author never made.
      if (next && next !== color.value) {
        service?.updateColor(color.id, { value: next });
      }
    },
    [color.id, color.value, service]
  );

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
        onCommit={(next) => service?.renameColor(color.id, next)}
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
  onCommit
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
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
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
  } catch {
    /* not loaded */
  }
  try {
    // The profile, not the `Character` wrapper: `collectBrandLinkReferences` names a reference
    // after the `id` and `name` it finds on the entry, and both live one level down.
    characters = context.services
      .get<CharacterService>(Services.Character)
      .listCharacter()
      .map((character) => character.toJSON().profile);
  } catch {
    /* not loaded */
  }

  return countBrandLinkReferences(collectBrandLinkReferences({ uidoc, characters }));
}
