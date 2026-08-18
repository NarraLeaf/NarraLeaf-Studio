import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { Input } from "@/lib/components/elements/Input";
import { Select, type SelectOption } from "@/lib/components/elements/Select";
import { Badge } from "@/lib/components/elements/Badge";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import type { Character } from "@/lib/workspace/services/character/Character";
import {
  planPastedRows,
  speakerMemoryKey,
  splitPastedText
} from "@/lib/story/paste/storyPasteModel";
import type {
  PastePlan,
  PastePlanRow,
  PasteSeparatorChoice,
  PasteSeparatorKind,
  SpeakerMappingTarget,
  StoryPasteMemory
} from "@/lib/story/paste/storyPasteTypes";

/**
 * The wizard a multi-line prose paste opens.
 *
 * It opens **already parsed**. `inferPasteSeparator` has run before this mounts and its answer is the
 * chip that starts selected, so the first thing the author sees is their own text already split into
 * rows. The separator control exists to correct a wrong guess, never to ask the opening question -
 * an author handed "what is your separator?" has to reverse-engineer their own manuscript, while an
 * author handed a wrong preview just fixes it.
 *
 * The body is the speaker table, because who is speaking is the one question worth asking. Everything
 * else is inferred, shown, and remembered.
 */

/** The built-in chips, in the order they are offered. `none` is last: it is an assertion, not a guess. */
const SEPARATOR_KINDS: readonly Exclude<PasteSeparatorKind, "regex">[] = [
  "colon",
  "fullwidthColon",
  "dash",
  "lenticular",
  "cornerBracket",
  "tab",
  "none"
];

/** How many planned rows the preview shows. Enough to recognise the shape, short enough to read. */
const PREVIEW_ROWS = 12;

const CHIP_BASE = "cursor-default rounded-md border px-2 py-1 text-xs transition-colors";
const CHIP_ON = "border-primary/40 bg-primary/15 text-primary";
const CHIP_OFF = "border-edge bg-fill-subtle text-fg-muted hover:bg-fill hover:text-fg";

type MappingKindValue = "tempSpeaker" | "createCharacter" | "notASpeaker";

export function StoryPasteWizardModal(props: {
  open: boolean;
  /** The pasted text, verbatim. Identity change re-seeds the whole wizard. */
  text: string;
  /** The separator the model inferred for {@link text}; the chip that starts selected. */
  inferred: PasteSeparatorChoice;
  characters: Character[];
  memory: StoryPasteMemory;
  onSaveSeparator: (name: string, choice: PasteSeparatorChoice) => void;
  onForgetSeparator: (name: string) => void;
  onCancel: () => void;
  /**
   * The rows to create, and - separately - the speaker decisions **the author actually made**.
   *
   * The second argument is not the mapping table: it is the subset that differs from what the wizard
   * computed, and it is what gets remembered. See {@link authoredMappings}.
   */
  onConfirm: (plan: PastePlan, authoredMappings: Record<string, SpeakerMappingTarget>) => void;
}) {
  const { t, tn } = useTranslation();
  const [choice, setChoice] = useState<PasteSeparatorChoice>(props.inferred);
  const [regexSource, setRegexSource] = useState(
    props.inferred.kind === "regex" ? props.inferred.source : ""
  );
  /**
   * Only the decisions the author actually made. Everything else is derived per render from the
   * label, the cast and the memory - so changing the separator re-derives the whole table without
   * stranding a stale mapping for a label that no longer exists.
   */
  const [overrides, setOverrides] = useState<Record<string, SpeakerMappingTarget>>({});
  const [presetName, setPresetName] = useState("");

  // A second paste while this is open would otherwise keep the first paste's answers. Same shape the
  // insert slot uses for re-seeding: adjust state during render rather than in an effect, so the
  // wizard never paints one frame of the previous paste.
  const [seededText, setSeededText] = useState(props.text);
  if (seededText !== props.text) {
    setSeededText(props.text);
    setChoice(props.inferred);
    setRegexSource(props.inferred.kind === "regex" ? props.inferred.source : "");
    setOverrides({});
    setPresetName("");
  }

  /**
   * Focus lands in the dialog when it opens.
   *
   * Not (only) an a11y nicety: `Modal`'s Escape listener sits on `document` and bubbles, so whatever
   * held the caret when the paste arrived answers the key FIRST. Over an insert slot Escape discards
   * the draft line; over a row being edited it *commits* - a `recordHistory` plus an `updateBlock` -
   * so cancelling the wizard wrote to the document. Taking the caret is what makes Escape mean
   * "close this dialog" and nothing else, and it is done here rather than in `Modal` so no other
   * caller's focus behaviour changes.
   */
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (props.open) {
      surfaceRef.current?.focus();
    }
  }, [props.open]);

  const split = useMemo(() => splitPastedText(props.text, choice), [props.text, choice]);

  /** What each label maps to before the author touches it - the row the table opens showing. */
  const defaults = useMemo(() => {
    const next: Record<string, SpeakerMappingTarget> = {};
    for (const tally of split.speakers) {
      next[speakerMemoryKey(tally.label)] = defaultTargetFor(
        tally.label,
        props.characters,
        props.memory
      );
    }
    return next;
  }, [split.speakers, props.characters, props.memory]);

  const mappings = useMemo(() => {
    const next = { ...defaults };
    for (const [key, target] of Object.entries(overrides)) {
      // Only for labels this split still has: changing the separator must not strand a decision
      // made about a label that no longer exists.
      if (key in next) {
        next[key] = target;
      }
    }
    return next;
  }, [defaults, overrides]);

  /**
   * The decisions, as opposed to the table.
   *
   * A computed default is a guess the author never looked at, and writing guesses to the project's
   * paste memory had two consequences that never expired: a label the inference invented was
   * remembered forever, and - because memory is consulted ahead of the name match - a character
   * created later was permanently shadowed by the "Name only" that had been guessed in its place,
   * with nothing in the UI able to clear it. Re-picking the value already shown is not a decision
   * either; it says nothing the wizard did not already know.
   */
  const authoredMappings = useMemo(() => {
    const next: Record<string, SpeakerMappingTarget> = {};
    for (const [key, target] of Object.entries(mappings)) {
      if (!sameTarget(target, defaults[key])) {
        next[key] = target;
      }
    }
    return next;
  }, [defaults, mappings]);

  const plan = useMemo(() => planPastedRows({ split, mappings }), [split, mappings]);

  const characterNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const character of props.characters) {
      names.set(character.profile.getId(), character.profile.getName());
    }
    return names;
  }, [props.characters]);

  const targetOptions = useMemo<SelectOption[]>(
    () => [
      { value: "tempSpeaker", label: t("story.paste.target.tempSpeaker") },
      { value: "createCharacter", label: t("story.paste.target.createCharacter") },
      { value: "notASpeaker", label: t("story.paste.target.notASpeaker") },
      ...props.characters.map((character) => ({
        value: `character:${character.profile.getId()}`,
        label: character.profile.getName(),
        secondaryLabel: t("story.paste.target.existing")
      }))
    ],
    [props.characters, t]
  );

  const setChoiceKind = (kind: Exclude<PasteSeparatorKind, "regex">) => setChoice({ kind });
  const setRegexChoice = (source: string) => {
    setRegexSource(source);
    setChoice({ kind: "regex", source });
  };

  return (
    <Modal
      isOpen={props.open}
      onClose={props.onCancel}
      title={t("story.paste.title")}
      helpTopic="storyScript"
      size="xl"
      footer={
        <div className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
            {t("story.paste.totals", {
              dialogue: plan.counts.dialogue,
              narration: plan.counts.narration,
              created: plan.charactersToCreate.length
            })}
          </span>
          <button
            type="button"
            className={dialogFooterButtonClass({ variant: "secondary" })}
            onClick={props.onCancel}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={dialogFooterButtonClass({
              variant: "primary",
              disabled: plan.rows.length === 0
            })}
            onClick={() => props.onConfirm(plan, authoredMappings)}
            disabled={plan.rows.length === 0}
          >
            {t("story.paste.action")}
          </button>
        </div>
      }
    >
      {/* `tabIndex={-1}` so the dialog itself can hold the caret: it is not a control, it just
                has to be somewhere focus can land that is not the editor underneath. */}
      <div ref={surfaceRef} tabIndex={-1} className="flex flex-col gap-3 outline-none">
        {/* Separator: compact, at the top, above the thing it changes. */}
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1">
            {SEPARATOR_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={choice.kind === kind}
                className={[CHIP_BASE, choice.kind === kind ? CHIP_ON : CHIP_OFF].join(" ")}
                onClick={() => setChoiceKind(kind)}
              >
                {t(`story.paste.separator.${kind}` as TranslationKey)}
              </button>
            ))}
            {props.memory.separators.map((preset) => (
              <span key={preset.name} className="inline-flex items-center">
                <button
                  type="button"
                  aria-pressed={sameChoice(choice, preset.choice)}
                  className={[
                    CHIP_BASE,
                    "rounded-r-none",
                    sameChoice(choice, preset.choice) ? CHIP_ON : CHIP_OFF
                  ].join(" ")}
                  onClick={() => {
                    setChoice(preset.choice);
                    if (preset.choice.kind === "regex") {
                      setRegexSource(preset.choice.source);
                    }
                  }}
                >
                  {preset.name}
                </button>
                <button
                  type="button"
                  data-tip={t("story.paste.forgetPreset")}
                  aria-label={t("story.paste.forgetPreset")}
                  className={[CHIP_BASE, "rounded-l-none border-l-0", CHIP_OFF].join(" ")}
                  onClick={() => props.onForgetSeparator(preset.name)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              aria-pressed={choice.kind === "regex"}
              className={[CHIP_BASE, choice.kind === "regex" ? CHIP_ON : CHIP_OFF].join(" ")}
              onClick={() => setRegexChoice(regexSource)}
            >
              {t("story.paste.separator.regex")}
            </button>
          </div>
          {choice.kind === "regex" ? (
            <div className="flex flex-col gap-1">
              <Input
                size="sm"
                fullWidth
                spellCheck={false}
                value={regexSource}
                variant={split.problem ? "error" : "default"}
                placeholder={t("story.paste.regexPlaceholder")}
                onChange={(event) => setRegexChoice(event.target.value)}
              />
              {split.problem ? (
                <span className="px-1 text-2xs text-danger">
                  {t(`story.paste.problem.${split.problem}` as TranslationKey)}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-center gap-1">
            <Input
              size="sm"
              className="max-w-[200px]"
              value={presetName}
              placeholder={t("story.paste.presetNamePlaceholder")}
              onChange={(event) => setPresetName(event.target.value)}
            />
            <button
              type="button"
              disabled={!presetName.trim()}
              className={[
                CHIP_BASE,
                CHIP_OFF,
                "disabled:cursor-not-allowed disabled:opacity-40"
              ].join(" ")}
              onClick={() => {
                props.onSaveSeparator(presetName, choice);
                setPresetName("");
              }}
            >
              {t("story.paste.savePreset")}
            </button>
          </div>
        </div>

        {/* The speaker table - the body, and the point of the wizard. */}
        {split.speakers.length === 0 ? (
          <p className="rounded-md border border-edge bg-fill-subtle px-2 py-1.5 text-xs text-fg-subtle">
            {t("story.paste.noSpeakers")}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {split.speakers.map((tally) => {
              const key = speakerMemoryKey(tally.label);
              const target = mappings[key];
              return (
                <div
                  key={key}
                  data-story-paste-speaker={key}
                  className="flex items-center gap-2 rounded-md border border-edge bg-fill-subtle px-2 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">
                    {tally.label}
                  </span>
                  <Badge>{tn("story.paste.lineCount", tally.count)}</Badge>
                  <Select
                    className="w-[220px] shrink-0"
                    size="sm"
                    portalMenu
                    ariaLabel={t("story.paste.targetFor", { label: tally.label })}
                    options={targetOptions}
                    value={targetToValue(target)}
                    onChange={(value) =>
                      setOverrides((current) => ({
                        ...current,
                        [key]: valueToTarget(String(value))
                      }))
                    }
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Preview: a dialogue row and a narration row have to be tellable apart at a glance,
                    so this mirrors the editor's own columns - name, then words. */}
        <div className="flex flex-col gap-0.5 rounded-md border border-edge bg-surface-sunken px-2 py-1.5">
          {plan.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
            <PreviewRow key={index} row={row} characterNames={characterNames} />
          ))}
          {plan.rows.length > PREVIEW_ROWS ? (
            <span className="px-1 pt-1 text-2xs text-fg-subtle">
              {tn("story.paste.moreRows", plan.rows.length - PREVIEW_ROWS)}
            </span>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function PreviewRow(props: { row: PastePlanRow; characterNames: Map<string, string> }) {
  const { t } = useTranslation();
  const { row } = props;
  if (row.kind === "narration") {
    return (
      <div className="flex items-baseline gap-2 text-xs">
        <span className="w-[104px] shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate italic text-fg-muted">{row.text}</span>
      </div>
    );
  }
  const name = row.characterId
    ? (props.characterNames.get(row.characterId) ?? row.characterId)
    : (row.pendingCharacterName ?? row.speakerName ?? "");
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span
        className={[
          "w-[104px] shrink-0 truncate text-right font-medium",
          row.pendingCharacterName ? "text-success" : "text-primary"
        ].join(" ")}
        data-tip={row.pendingCharacterName ? t("story.paste.willBeCreated") : undefined}
      >
        {name}
      </span>
      <span className="min-w-0 flex-1 truncate text-fg">{row.text}</span>
    </div>
  );
}

/**
 * What a label maps to before the author touches it.
 *
 * Memory first: an author who said "this is not a speaker" in chapter one meant it, and a character
 * whose name happens to collide must not overturn that. A remembered character that has since been
 * deleted falls through rather than pointing at nothing, and a remembered `createCharacter` is
 * downgraded - the character it named exists by now, or the author changed their mind, and either way
 * silently creating one is what this default must never do.
 *
 * Memory only ever holds decisions the author made (see {@link authoredMappings}), which is what makes
 * "memory first" safe: a guess can no longer get in front of the name match and shadow a character
 * created in a later chapter.
 */
function defaultTargetFor(
  label: string,
  characters: Character[],
  memory: StoryPasteMemory
): SpeakerMappingTarget {
  const remembered = memory.speakers[speakerMemoryKey(label)];
  if (remembered) {
    if (
      remembered.kind === "character" &&
      characters.some((c) => c.profile.getId() === remembered.characterId)
    ) {
      return remembered;
    }
    if (remembered.kind === "tempSpeaker" || remembered.kind === "notASpeaker") {
      return remembered;
    }
  }
  const normalized = speakerMemoryKey(label);
  const match = characters.find((character) => {
    const profile = character.profile;
    return (
      speakerMemoryKey(profile.getName()) === normalized ||
      profile.getNicknames().some((nickname) => speakerMemoryKey(nickname) === normalized)
    );
  });
  return match
    ? { kind: "character", characterId: match.profile.getId() }
    : { kind: "tempSpeaker" };
}

/** Two targets are the same decision when they name the same thing, character id included. */
function sameTarget(
  a: SpeakerMappingTarget | undefined,
  b: SpeakerMappingTarget | undefined
): boolean {
  if (!a || !b) {
    return a === b;
  }
  return (
    a.kind === b.kind &&
    (a.kind !== "character" || a.characterId === (b as { characterId?: string }).characterId)
  );
}

function targetToValue(target: SpeakerMappingTarget | undefined): string {
  if (!target) {
    return "tempSpeaker";
  }
  return target.kind === "character" ? `character:${target.characterId}` : target.kind;
}

function valueToTarget(value: string): SpeakerMappingTarget {
  if (value.startsWith("character:")) {
    return { kind: "character", characterId: value.slice("character:".length) };
  }
  return { kind: value as MappingKindValue };
}

function sameChoice(a: PasteSeparatorChoice, b: PasteSeparatorChoice): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  return a.kind !== "regex" || a.source === (b as { source: string }).source;
}
