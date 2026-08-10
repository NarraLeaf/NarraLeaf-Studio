import { useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { Input, InputGroup, Select, type SelectOption } from "@/lib/components/elements";
import { localeAutonym } from "@shared/types/localization";
import {
    formatStageAspectRatio,
    isStageSizeUsable,
    parseStageSize,
    stageOrientation,
    stageSizeValue,
    stageSizesEqual,
    STAGE_SIZE_MAX,
    STAGE_SIZE_MIN,
    type StageSize,
} from "@shared/types/stageSize";
import {
    allowsCustomStageSize,
    CUSTOM_STAGE_SIZE_VALUE,
    offeredStageSizes,
    stageSizeSelectOptions,
} from "../stageSizeChoice";
import { ProjectData } from "../types";

interface StageStepProps {
    projectData: ProjectData;
    updateProjectData: (updates: Partial<ProjectData>) => void;
    /** The sizes the chosen template allows; empty when it allows any. */
    templateStageSizes: StageSize[];
}

/**
 * Languages offered as the language the story is written in.
 *
 * A suggestion list, not a limit: the localization panel takes any BCP-47 code, and this is the
 * one moment where an author has no project to open that panel in. The Studio interface language
 * is prepended so the common case - writing in the language you are reading this in - is the
 * default without anybody choosing anything.
 */
const SCRIPT_LOCALE_SUGGESTIONS = ["en", "zh", "zh-TW", "ja", "ko", "es", "fr", "de", "pt-BR", "ru"];

/**
 * The stage the project is laid out in, and the language it is written in.
 *
 * **The stage size is here because it is the only creation-time answer that is genuinely
 * permanent.** It is not a rendering resolution - the engine fits its stage into whatever window
 * it is given - it is the coordinate system every surface, element position and background is
 * placed in. A project that changed it afterwards would keep every layout it already had, at the
 * wrong size, which is why the project panel offers no such setting and this page is the only
 * place the question is asked.
 *
 * When a template is chosen the list shrinks to what that template declares, for the same reason:
 * its surfaces are positioned in absolute coordinates and a size it was not drawn for puts its
 * interface off the edge of its own stage. Picking the blank entry on the first page is what
 * restores the full list.
 */
export function StageStep({ projectData, updateProjectData, templateStageSizes }: StageStepProps) {
    const { t, locale } = useTranslation();
    const offered = offeredStageSizes(templateStageSizes);
    const allowCustom = allowsCustomStageSize(templateStageSizes);

    const selected = parseStageSize(projectData.resolution);
    const matchesOffered = selected !== null && offered.some(size => stageSizesEqual(size, selected));

    // A size that parses but is not on the list can only have been typed, so the page opens in the
    // state that produced it rather than silently snapping the author back to a preset.
    const [isCustom, setIsCustom] = useState(allowCustom && selected !== null && !matchesOffered);
    const [draft, setDraft] = useState<{ width: string; height: string }>(() => ({
        width: String(selected?.width ?? ""),
        height: String(selected?.height ?? ""),
    }));

    const sizeOptions = useMemo<SelectOption[]>(() => {
        const options = stageSizeSelectOptions(offered);
        return allowCustom
            ? [...options, { value: CUSTOM_STAGE_SIZE_VALUE, label: t("wizard.stage.custom") }]
            : options;
    }, [offered, allowCustom, t]);

    const localeOptions = useMemo<SelectOption[]>(() => {
        const codes = [locale, ...SCRIPT_LOCALE_SUGGESTIONS].filter(
            (code, index, all) => all.indexOf(code) === index,
        );
        return codes.map(code => ({ value: code, label: localeAutonym(code), secondaryLabel: code }));
    }, [locale]);

    const handleSizeChange = (value: string | number) => {
        const next = String(value);
        if (next === CUSTOM_STAGE_SIZE_VALUE) {
            // Seeded from whatever was selected, so switching to custom never leaves the step
            // momentarily invalid - the author edits a real size rather than filling two blanks.
            setDraft({ width: String(selected?.width ?? ""), height: String(selected?.height ?? "") });
            setIsCustom(true);
            return;
        }
        setIsCustom(false);
        updateProjectData({ resolution: next });
    };

    const commitDraft = (width: string, height: string) => {
        setDraft({ width, height });
        const size: StageSize = { width: Number(width), height: Number(height) };
        // Cleared rather than left at the last good value: the step's validity is what stops the
        // author walking on, and a stale size behind two boxes that say something else is how a
        // project gets created at a stage nobody chose.
        updateProjectData({ resolution: isStageSizeUsable(size) ? stageSizeValue(size) : "" });
    };

    const customInvalid = isCustom && projectData.resolution === "";
    const orientationHint = selected
        ? t(stageOrientation(selected) === "portrait"
            ? "wizard.stage.orientationPortrait"
            : "wizard.stage.orientationLandscape")
        : undefined;

    return (
        <div className="h-full overflow-y-auto p-5">
            <div className="max-w-xl space-y-4">
                <InputGroup
                    label={t("wizard.fields.stageSize")}
                    required
                    error={customInvalid
                        ? t("wizard.stage.customInvalid", { min: STAGE_SIZE_MIN, max: STAGE_SIZE_MAX })
                        : undefined}
                    helper={orientationHint}
                >
                    <Select
                        options={sizeOptions}
                        value={isCustom ? CUSTOM_STAGE_SIZE_VALUE : projectData.resolution}
                        onChange={handleSizeChange}
                        placeholder={t("wizard.stage.sizePlaceholder")}
                        fullWidth
                        ariaLabel={t("wizard.fields.stageSize")}
                    />
                </InputGroup>

                {isCustom && (
                    <div className="flex items-end gap-2">
                        <InputGroup className="flex-1" label={t("wizard.stage.width")}>
                            <Input
                                type="number"
                                min={STAGE_SIZE_MIN}
                                max={STAGE_SIZE_MAX}
                                value={draft.width}
                                onChange={event => commitDraft(event.target.value, draft.height)}
                            />
                        </InputGroup>
                        <InputGroup className="flex-1" label={t("wizard.stage.height")}>
                            <Input
                                type="number"
                                min={STAGE_SIZE_MIN}
                                max={STAGE_SIZE_MAX}
                                value={draft.height}
                                onChange={event => commitDraft(draft.width, event.target.value)}
                            />
                        </InputGroup>
                        {/* The ratio is the one thing two numbers do not tell you at a glance, and
                            it is the reason a typed size is usually wrong. */}
                        <span className="pb-2 text-xs text-fg-muted">
                            {selected ? formatStageAspectRatio(selected) : ""}
                        </span>
                    </div>
                )}

                <InputGroup label={t("wizard.fields.scriptLocale")} helper={t("wizard.stage.scriptLocaleHelper")}>
                    <Select
                        options={localeOptions}
                        value={projectData.sourceLocale}
                        onChange={value => updateProjectData({ sourceLocale: String(value) })}
                        fullWidth
                        ariaLabel={t("wizard.fields.scriptLocale")}
                    />
                </InputGroup>
            </div>
        </div>
    );
}
