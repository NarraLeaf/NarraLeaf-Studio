/**
 * Project -> Game -> Player defaults: what a new player's settings start at.
 *
 * Until this page existed the answer was "whatever the engine happens to default to, unless the
 * author built a blueprint that says otherwise" - one `Set ...` node per preference, wired behind
 * `App Boot`, on a page most projects never build. So text speed, the four volumes and whether
 * skipping is allowed at all were decisions nobody had made on purpose.
 *
 * Every row here is still the *player's* to change once the game runs, and what they change is kept
 * between sessions (see `preferenceRuntime`). That is why the wording throughout says "starts at":
 * this is a starting point, not a ceiling, and a settings screen the author builds keeps working
 * exactly as before.
 *
 * The rows are driven by `PLAYER_PREFERENCE_SPECS` rather than written out one by one - the spec
 * already holds the type, the default and the range, and a preference added there should appear
 * here without a second edit that could disagree with the first.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { FieldLabel, Select, Slider, type SelectOption } from "@/lib/components/elements";
import {
  PLAYER_PREFERENCE_GROUPS,
  PLAYER_PREFERENCE_SPECS,
  normalizePlayerPreferences,
  type PlayerPreferenceKey,
  type PlayerPreferenceSpec,
  type PlayerPreferences
} from "@/lib/workspace/project/configuration";
import { SettingRow, SettingShell, SettingStack } from "./settingRows";
import { NumberField } from "./NumberField";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

/**
 * A percent-edited preference, in whole percent.
 *
 * The four volumes are stored 0..1 and `gameSpeed` as a multiplier, and neither reads as a control
 * in that form - the mixer page next door already edits a bus as "72%", and a number field showing
 * `0.72` is a value the author has to translate before they can judge it.
 */
function toPercent(value: number): number {
  return Math.round(value * 100);
}

function fromPercent(percent: number): number {
  // Two decimals is exactly the granularity the field offers, and rounding here keeps the stored
  // number free of the 0.7200000000000001 that percent/100 otherwise produces.
  return Math.round(percent) / 100;
}

export function ProjectPreferencesSection({
  projectService,
  uiService,
  config,
  onConfigChange
}: ProjectSectionProps) {
  const { t } = useTranslation();
  const [preferences, setPreferences] = useState<PlayerPreferences>(() =>
    normalizePlayerPreferences(config.app?.preferences)
  );
  const [saving, setSaving] = useState<PlayerPreferenceKey | null>(null);

  // The panel is keep-alive and the config can be replaced underneath it (a VCS restore, another
  // surface writing the same file), so the stored value stays the source of truth for the rows.
  useEffect(() => {
    setPreferences(normalizePlayerPreferences(config.app?.preferences));
  }, [config]);

  const commit = useCallback(
    async (key: PlayerPreferenceKey, value: PlayerPreferences[PlayerPreferenceKey]) => {
      if (saving) {
        return;
      }
      const previous = preferences;
      setSaving(key);
      setPreferences((current) => ({ ...current, [key]: value }));
      try {
        const updated = await projectService.updatePlayerPreferences({ [key]: value });
        setPreferences(normalizePlayerPreferences(updated.app?.preferences));
        onConfigChange(updated);
      } catch (error) {
        setPreferences(previous);
        uiService?.showNotification(
          error instanceof Error ? error.message : String(error),
          "error"
        );
      } finally {
        setSaving(null);
      }
    },
    [onConfigChange, preferences, projectService, saving, uiService]
  );

  return (
    // The one line that used to be a paragraph at the top of a page of its own. It is the
    // group's expectation now, on the heading, because "starts at" is the whole reason these
    // rows are not the player's settings screen.
    <SettingsGroup
      title={t("project.group.playerDefaults")}
      description={t("project.preferences.intro")}
    >
      {/* Wider than the gap between the rows inside a group, or the eyebrow that starts a
                group would read as belonging to the row above it. */}
      <div className="grid gap-4 [&>*]:min-w-0">
        {PLAYER_PREFERENCE_GROUPS.map((group) => (
          <section key={group.id} className="grid gap-2 [&>*]:min-w-0">
            <FieldLabel as="div" className="mb-0">
              {t(`project.preferences.group.${group.id}`)}
            </FieldLabel>
            <div className="grid gap-3 [&>*]:min-w-0">
              {group.keys.map((key) => (
                <PreferenceRow
                  key={key}
                  spec={PLAYER_PREFERENCE_SPECS[key]}
                  preferences={preferences}
                  saving={saving === key}
                  onCommit={(value) => void commit(key, value)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </SettingsGroup>
  );
}

function PreferenceRow({
  spec,
  preferences,
  saving,
  onCommit
}: {
  spec: PlayerPreferenceSpec;
  preferences: PlayerPreferences;
  saving: boolean;
  onCommit: (value: PlayerPreferences[PlayerPreferenceKey]) => void;
}) {
  const { t } = useTranslation();
  // `SettingRow` reads the freeze itself; the fields below sit in bare shells and need their own.
  const freeze = useFreezeGuard();
  const title = t(`project.preferences.${spec.key}.title`);
  const description = t(`project.preferences.${spec.key}.description`);

  if (spec.kind === "boolean") {
    return (
      <SettingRow
        title={title}
        description={description}
        checked={preferences[spec.key] as boolean}
        loading={saving}
        onChange={onCommit}
      />
    );
  }

  if (spec.kind === "enum") {
    const options: SelectOption[] = spec.options.map((option) => ({
      value: option,
      label: t(`project.preferences.voiceEndMode.option.${option}`)
    }));
    return (
      <SettingStack title={title} description={description} tooltip={freeze.writes()["data-tip"]}>
        <Select
          size="sm"
          fullWidth
          portalMenu
          className="min-w-0"
          options={options}
          value={preferences[spec.key] as string}
          disabled={freeze.writes(saving).disabled}
          ariaLabel={title}
          onChange={(value) => onCommit(String(value) as PlayerPreferences[PlayerPreferenceKey])}
        />
      </SettingStack>
    );
  }

  const stored = preferences[spec.key] as number;

  if (spec.display.control === "slider") {
    return (
      <PercentSlider
        title={title}
        description={description}
        stored={stored}
        min={toPercent(spec.min)}
        max={toPercent(spec.max)}
        disabled={freeze.writes(saving).disabled}
        tooltip={freeze.writes()["data-tip"]}
        onCommit={(percent) => onCommit(fromPercent(percent))}
      />
    );
  }

  const percentEdited = spec.display.unit === "percent";
  return (
    <SettingShell title={title} description={description} tooltip={freeze.writes()["data-tip"]}>
      <NumberField
        value={percentEdited ? toPercent(stored) : Math.round(stored)}
        min={percentEdited ? toPercent(spec.min) : spec.min}
        max={percentEdited ? toPercent(spec.max) : spec.max}
        unit={t(`project.preferences.unit.${spec.display.unit}`)}
        disabled={freeze.writes(saving).disabled}
        ariaLabel={title}
        onCommit={(value) => onCommit(percentEdited ? fromPercent(value) : value)}
      />
    </SettingShell>
  );
}

/**
 * A volume, as a slider and its reading.
 *
 * The draft is held here rather than pushed through the commit path on every pointer move: each
 * commit writes `project.json`, and a drag across the track would otherwise be sixty writes and
 * sixty document revisions. `onValueCommit` fires once, when the drag settles.
 */
function PercentSlider({
  title,
  description,
  stored,
  min,
  max,
  disabled,
  tooltip,
  onCommit
}: {
  title: string;
  description: string;
  stored: number;
  min: number;
  max: number;
  disabled: boolean;
  tooltip?: string;
  onCommit: (percent: number) => void;
}) {
  const { t } = useTranslation();
  const storedPercent = toPercent(stored);
  const [draft, setDraft] = useState(storedPercent);

  useEffect(() => {
    setDraft(storedPercent);
  }, [storedPercent]);

  return (
    <SettingStack title={title} description={description} tooltip={tooltip}>
      <div className="flex min-w-0 items-center gap-2">
        <Slider
          className="min-w-0 flex-1"
          value={draft}
          min={min}
          max={max}
          step={1}
          disabled={disabled}
          data-tip={tooltip}
          aria-label={title}
          onValueChange={setDraft}
          onValueCommit={onCommit}
        />
        <span className="w-9 shrink-0 text-right tabular-nums text-2xs text-fg-muted">
          {draft}
          {t("project.preferences.unit.percent")}
        </span>
      </div>
    </SettingStack>
  );
}
