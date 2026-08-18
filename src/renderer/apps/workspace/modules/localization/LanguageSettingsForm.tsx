/**
 * The two fields a language has beyond its code: the name players see, and the language to try
 * when this one has no translation for an entry.
 *
 * The form owns its selection and reports it upward: the dialog's footer buttons are snapshotted
 * when the dialog opens and cannot read React state (same arrangement as TranslationExportForm).
 *
 * A candidate that leads back to the language being edited is listed but not selectable. Such a
 * fallback is not an error the runtime would ever raise - `resolveLocaleChain` stops at the second
 * visit and simply never reads it - so the author would have gone away believing they had set
 * something up. Refusing the row at the moment of choosing is the only place that reads as an
 * answer; the service refuses it again on the way to disk.
 *
 * Both controls take the default `md` height, which is the dialog tier (docs/design-system.md §3).
 *
 * Comments in English per project convention.
 */

import { useCallback, useState } from "react";
import { FieldLabel, Input, Select, type SelectOption } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";

/** One language offered as a fallback, with whether picking it would close a loop. */
export type FallbackCandidate = {
  code: string;
  displayName: string;
  /** Following this language's own fallbacks leads back to the language being edited. */
  loops: boolean;
};

export type LanguageSettingsFormProps = {
  /** The language being edited; also the display-name placeholder, since a blank name renders as the code. */
  code: string;
  initialDisplayName: string;
  /** Empty string means no fallback. */
  initialFallback: string;
  candidates: readonly FallbackCandidate[];
  onChange: (displayName: string, fallback: string) => void;
};

export function LanguageSettingsForm({
  code,
  initialDisplayName,
  initialFallback,
  candidates,
  onChange
}: LanguageSettingsFormProps) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [fallback, setFallback] = useState(initialFallback);

  const changeDisplayName = useCallback(
    (next: string) => {
      setDisplayName(next);
      onChange(next, fallback);
    },
    [onChange, fallback]
  );

  const changeFallback = useCallback(
    (next: string) => {
      setFallback(next);
      onChange(displayName, next);
    },
    [onChange, displayName]
  );

  const fallbackOptions: SelectOption[] = [
    { value: "", label: t("common.none") },
    ...candidates.map((candidate) => ({
      value: candidate.code,
      label: candidate.displayName,
      secondaryLabel: candidate.loops
        ? `${candidate.code} · ${t("workspace.localization.settings.fallbackLoops")}`
        : candidate.code,
      // The one already stored stays pickable even if it loops, so a configuration
      // hand-edited into a loop can still be read back and corrected here.
      disabled: candidate.loops && candidate.code !== initialFallback
    }))
  ];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <FieldLabel as="div">{t("workspace.localization.settings.displayNameLabel")}</FieldLabel>
        <Input
          value={displayName}
          placeholder={code}
          onChange={(event) => changeDisplayName(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          aria-label={t("workspace.localization.settings.displayNameLabel")}
          fullWidth
          autoFocus
        />
      </div>
      <div>
        <FieldLabel as="div">{t("workspace.localization.settings.fallbackLabel")}</FieldLabel>
        <Select
          options={fallbackOptions}
          value={fallback}
          onChange={(value) => changeFallback(String(value))}
          ariaLabel={t("workspace.localization.settings.fallbackLabel")}
          fullWidth
          portalMenu
        />
        <p className="mt-1.5 text-xs leading-snug text-fg-subtle">
          {t("workspace.localization.settings.fallbackHint")}
        </p>
      </div>
    </div>
  );
}
