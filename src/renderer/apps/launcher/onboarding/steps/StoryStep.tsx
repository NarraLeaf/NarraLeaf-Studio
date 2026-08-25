import { FieldLabel, Slider, Switch } from "@/lib/components/elements";
import { SettingFontPicker } from "@/apps/settings/components/SettingFontPicker";
import { useTranslation } from "@/lib/i18n";
import {
    EDITOR_FONT_FAMILY_PRESETS,
    EDITOR_FONT_PRESET_STACKS,
    EDITOR_FONT_SIZE_MAX,
    EDITOR_FONT_SIZE_MIN,
} from "@/lib/settings/editorFontOptions";
import { STORY_ROW_HIGHLIGHT_OPTIONS } from "@/lib/settings/storyRowHighlightOptions";
import type { TranslationKey } from "@shared/i18n";
import { useOnboardingPreferences } from "../onboardingPreferences";
import { OptionList } from "./OptionList";

/**
 * The six preferences that decide how a scene reads and what the editor accepts.
 *
 * They are grouped here rather than spread over three screens because they answer one question
 * between them - how do I want to read and type a scene - and because the pane beside them can show
 * all six at once. Every one has a row in Settings under the same label, which is why this screen
 * spells none of them out a second time.
 *
 * The font picker is the settings window's own control, installed families and all, rather than a
 * list of the four presets: a face is chosen by looking at it, and the picker is the thing that can
 * draw each row in the face it names.
 */
const HIGHLIGHT_LABEL_KEYS: Record<string, TranslationKey> = {
    none: "settings.items.storyRowHighlight.options.none",
    script: "settings.items.storyRowHighlight.options.script",
    command: "settings.items.storyRowHighlight.options.command",
};

const FONT_PRESET_LABEL_KEYS: Record<string, TranslationKey> = {
    "Default": "settings.items.editorFontFamily.options.default",
    "Sans Serif": "settings.items.editorFontFamily.options.sansSerif",
    "Serif": "settings.items.editorFontFamily.options.serif",
    "Monospace": "settings.items.editorFontFamily.options.monospace",
};

export function StoryStep() {
    const { t } = useTranslation();
    const { story, setStory } = useOnboardingPreferences();

    return (
        <div className="space-y-5">
            <div>
                <FieldLabel as="div">{t("settings.items.storyRowHighlight.label")}</FieldLabel>
                <OptionList
                    label={t("settings.items.storyRowHighlight.label")}
                    value={story.rowHighlight}
                    options={STORY_ROW_HIGHLIGHT_OPTIONS.map(option => ({
                        value: option,
                        label: t(HIGHLIGHT_LABEL_KEYS[option]),
                    }))}
                    onChange={value => setStory("rowHighlight", value as typeof story.rowHighlight)}
                />
            </div>

            <div>
                <div className="flex items-baseline justify-between">
                    <FieldLabel as="div">{t("settings.items.editorFontSize.label")}</FieldLabel>
                    <span className="text-xs tabular-nums text-fg-muted">{story.fontSize}</span>
                </div>
                <Slider
                    value={story.fontSize}
                    min={EDITOR_FONT_SIZE_MIN}
                    max={EDITOR_FONT_SIZE_MAX}
                    step={1}
                    aria-label={t("settings.items.editorFontSize.label")}
                    onValueChange={value => setStory("fontSize", value)}
                />
            </div>

            <div>
                <FieldLabel as="div">{t("settings.items.editorFontFamily.label")}</FieldLabel>
                <SettingFontPicker
                    value={story.fontFamily}
                    presets={EDITOR_FONT_FAMILY_PRESETS}
                    presetLabels={Object.fromEntries(
                        EDITOR_FONT_FAMILY_PRESETS.map(preset => [preset, t(FONT_PRESET_LABEL_KEYS[preset])]),
                    )}
                    presetStacks={EDITOR_FONT_PRESET_STACKS}
                    onChange={value => setStory("fontFamily", value)}
                    ariaLabel={t("settings.items.editorFontFamily.label")}
                />
            </div>

            {/* Three switches, because all three are things you turn on and stop thinking about
                (docs/design-system.md §7: a setting is a Switch, a checkbox is set membership). */}
            <div className="space-y-2.5">
                <SwitchRow
                    label={t("settings.items.slashAtAlias.label")}
                    checked={story.slashAtAlias}
                    onChange={next => setStory("slashAtAlias", next)}
                />
                <SwitchRow
                    label={t("settings.items.localizedCommands.label")}
                    checked={story.localizedCommands}
                    onChange={next => setStory("localizedCommands", next)}
                />
                <SwitchRow
                    label={t("settings.items.hideParamNames.label")}
                    checked={story.hideParamNames}
                    onChange={next => setStory("hideParamNames", next)}
                />
            </div>
        </div>
    );
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 text-sm text-fg-muted">{label}</span>
            <Switch checked={checked} onCheckedChange={onChange} size="sm" aria-label={label} />
        </div>
    );
}
