import { useCallback, useEffect, useMemo, useState } from "react";
import { Input, InputGroup } from "@/lib/components/elements/Input";
import { useTranslation } from "@/lib/i18n";
import { listKnownPuppetRuntimes } from "@shared/utils/puppetRuntimes";
import type { CharacterAppearanceKind } from "@/lib/workspace/services/character/types";
import { isImeKeyEvent } from "../../../components/layout/imeComposition";
import { isBrandLink } from "@shared/brand/brandLink";
import { ColorPickerTrigger } from "../../properties/framework/fields/ColorPickerField";
import { addRecentColor } from "../../properties/framework/fields/recentColors";
import {
  colorValueToCss,
  parseColorValue,
  rgbToHex,
  serializeColorValue
} from "../../properties/framework/utils/colorUtils";
import type { ColorValue } from "../../properties/framework/types";
import { StorySpeakerDiscMark } from "../../story/scene-editor/StoryRowGutterMark";
import { readableAccentColor } from "../../story/scene-editor/storySceneBlockUtils";
import {
  characterSpeakerIdentity,
  storySpeakerHash
} from "../../story/scene-editor/storySpeakerIdentity";

export type CreateCharacterDialogValue = {
  name: string;
  kind: CharacterAppearanceKind;
  /**
   * The colour as it should be stored: a literal, or a `nlbrand:` link at the project palette.
   *
   * Absent when the author left the colour alone — which is a real state, not a missing one: the
   * name hash keeps deciding, forever and in every project that spells the name the same way. So
   * the three states this dialog can produce are link, literal, and none.
   */
  color?: string;
};

export type CreateCharacterDialogHandlers = {
  /** Validate and, if the form holds, hand the value up. Driven by the dialog's Create button. */
  submit: () => void;
};

type CreateCharacterDialogContentProps = {
  defaultKind?: CharacterAppearanceKind;
  registerHandlers: (handlers: CreateCharacterDialogHandlers) => void;
  onSubmit: (value: CreateCharacterDialogValue) => void;
};

/** The two kinds Studio draws itself. Puppet kinds are built from the runtime registry below. */
const SPRITE_KINDS = ["preset", "layered"] as const;

/**
 * `hsl()` → hex, for the one colour this dialog has to hand to a picker that only speaks hex.
 *
 * Local rather than shared on purpose: nothing painted in the editor is derived from a hex computed
 * in JS (see the `--nl-speaker-*` block in styles.css for why the theme ladder has to stay in CSS),
 * so this exists only to seed a picker and must not grow consumers.
 */
function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return rgbToHex(channel(0), channel(8), channel(4));
}

/**
 * What the picker opens on for a character who has no colour of their own: the disc colour their
 * name already gives them.
 *
 * Deliberately not a fixed brand default. "Pick a colour" should start from the colour they are
 * currently wearing, so an author who opens the picker to nudge a hue is nudging the one they can
 * see rather than being dropped somewhere unrelated. The numbers are the dark theme's
 * `--nl-speaker-disc`; a seed, not a rendering.
 */
function autoAccentSeed(name: string): string {
  return hslToHex(storySpeakerHash(name), 42, 52);
}

/**
 * Everything a new character needs, asked once.
 *
 * Before this, "new character" opened a submenu of appearance kinds and *then* an input dialog with
 * one field, which put the decision the author cared least about (a kind they can read about in the
 * editor) in front of the one they came to make, and left no room at all for the colour. The colour
 * matters here specifically because it is what the gutter, the nametag and the story rows identify
 * this person by from their very first line — see {@link characterSpeakerIdentity}.
 */
export function CreateCharacterDialogContent({
  defaultKind = "preset",
  registerHandlers,
  onSubmit
}: CreateCharacterDialogContentProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CharacterAppearanceKind>(defaultKind);
  // The colour as it will be stored: a literal, a `nlbrand:` link, or nothing.
  const [color, setColor] = useState<string | undefined>(undefined);
  // Live while the picker panel is open, settled into `color` when it closes: `onChange` fires on
  // every frame of a drag across the colour map.
  const [draft, setDraft] = useState<ColorValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const previewName = trimmed || t("characters.create.unnamed");
  // What the preview paints, which is not what gets stored: a link has to be resolved before any
  // of this can be drawn, and a drag in progress outranks the settled value. `readableAccentColor`
  // does the resolve and applies the same band the story gutter will apply to this character from
  // its very first line, so the preview cannot promise a colour the rows will then refuse.
  const previewColor = draft
    ? readableAccentColor(colorValueToCss(draft))
    : readableAccentColor(color);
  // What the picker itself opens on, which is a third thing again: no band (the picker shows what
  // it holds, readable or not), and a link read back with its id still attached so that reopening
  // the panel and nudging the opacity rewrites the link rather than freezing a hex over it.
  const pickerValue = color
    ? parseColorValue(color, { hex: autoAccentSeed(previewName), alpha: 1 })
    : null;
  // The very mark the story gutter will draw for this character, from the very same resolver — the
  // preview is not a rendition of the rule, it *is* the rule (gutter 规范 §3.3).
  const identity = characterSpeakerIdentity(previewName, {
    hasPortrait: false,
    color: previewColor
  });

  const spriteOptions = useMemo(
    () =>
      SPRITE_KINDS.map((value) => ({
        kind: value as CharacterAppearanceKind,
        label: t(`characters.editor.kind.${value}`),
        description: t(`characters.create.kindDescription.${value}`)
      })),
    [t]
  );

  // Product names come from the runtime registry, never from the catalogue: they are trademarks and
  // read the same in every language.
  const runtimeOptions = useMemo(
    () => [
      ...listKnownPuppetRuntimes().map((runtime) => ({
        kind: runtime.id as CharacterAppearanceKind,
        label: runtime.productName
      })),
      { kind: "puppet" as CharacterAppearanceKind, label: t("characters.editor.kind.puppet") }
    ],
    [t]
  );

  const submit = useCallback(() => {
    if (!trimmed) {
      setError(t("characters.create.nameRequired"));
      return;
    }
    // Literals only, and a link's resolved colour is deliberately not recorded in its place -
    // see `CharacterColorField.commit`, which makes the same call for the same reason.
    if (color && !isBrandLink(color)) {
      addRecentColor(color);
    }
    onSubmit({ name: trimmed, kind, color });
  }, [color, kind, onSubmit, t, trimmed]);

  useEffect(() => {
    registerHandlers({ submit });
  }, [registerHandlers, submit]);

  return (
    <div className="space-y-4">
      <InputGroup label={t("common.name")} required error={error ?? undefined}>
        <Input
          value={name}
          placeholder={t("characters.panel.namePlaceholder")}
          fullWidth
          autoFocus
          maxLength={100}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            // Stopped either way: the workspace's own shortcuts must not fire from a field.
            event.stopPropagation();
            // The dialog shell's Enter-to-default deliberately skips editable targets, so
            // Enter has to be honoured here or the keyboard path dead-ends in the name.
            if (event.key === "Enter" && !isImeKeyEvent(event)) {
              event.preventDefault();
              submit();
            }
          }}
        />
      </InputGroup>

      <div className="space-y-2">
        <div className="text-sm font-medium text-fg">{t("characters.create.appearanceLabel")}</div>
        <div className="grid grid-cols-2 gap-2">
          {spriteOptions.map((option) => (
            <button
              key={option.kind}
              type="button"
              onClick={() => setKind(option.kind)}
              className={`rounded-md border px-3 py-2.5 text-left transition-colors ${
                kind === option.kind
                  ? "border-primary bg-primary/10 text-fg"
                  : "border-edge text-fg-muted hover:border-edge-strong hover:bg-fill-subtle"
              }`}
            >
              <div className="text-sm font-medium text-fg">{option.label}</div>
              <div className="text-2xs text-fg-muted">{option.description}</div>
            </button>
          ))}
        </div>

        <div className="pt-1 text-2xs text-fg-subtle">{t("characters.create.runtimeGroup")}</div>
        <div className="flex flex-wrap gap-2">
          {runtimeOptions.map((option) => (
            <button
              key={option.kind}
              type="button"
              onClick={() => setKind(option.kind)}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                kind === option.kind
                  ? "border-primary bg-primary/10 text-fg"
                  : "border-edge text-fg-muted hover:border-edge-strong hover:bg-fill-subtle"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="text-2xs text-fg-subtle">{t("characters.create.runtimeHint")}</div>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium text-fg">{t("characters.create.colorLabel")}</div>
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <StorySpeakerDiscMark identity={identity} />
            <span
              className="truncate text-sm text-fg"
              style={previewColor ? { color: previewColor } : undefined}
            >
              {previewName}
            </span>
          </div>
          <ColorPickerTrigger
            value={draft ?? pickerValue ?? { hex: autoAccentSeed(previewName), alpha: 1 }}
            // The hex appears only once the author has actually chosen one. On automatic
            // the swatch still shows the colour the name gives them — that is true — but
            // printing a hex beside it would read as a value that had been *set*.
            displayMode={color ? "icon-hex" : "icon"}
            allowOpacity={false}
            brandPalette
            onChange={setDraft}
            onCommit={(next) => {
              setDraft(null);
              // Serialized, not flattened to a hex: picking a palette swatch has to
              // store the link, or the new character is frozen at whatever the brand
              // said the day they were created.
              setColor(serializeColorValue(next));
            }}
          />
          {/* Nothing in the automatic state: the hint under this row already says the name
                        decides the colour, at more length and without a label's air of being a value
                        that had been chosen. */}
          {color ? (
            <button
              type="button"
              className="text-xs text-fg-muted hover:text-fg"
              onClick={() => {
                setDraft(null);
                setColor(undefined);
              }}
            >
              {t("characters.create.colorReset")}
            </button>
          ) : null}
        </div>
        <div className="text-2xs text-fg-subtle">{t("characters.create.colorAutoHint")}</div>
      </div>
    </div>
  );
}
