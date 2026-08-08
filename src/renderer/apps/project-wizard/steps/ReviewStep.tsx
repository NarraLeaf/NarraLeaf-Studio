import { useTranslation } from "@/lib/i18n";
import { localeAutonym } from "@shared/types/localization";
import { formatStageSize, parseStageSize } from "@shared/types/stageSize";
import { ProjectData, ProjectTemplate } from "../types";

interface ReviewStepProps {
    projectData: ProjectData;
    /** The template entry the author picked, when the list has finished loading. */
    template: ProjectTemplate | null;
}

/**
 * The last look before anything is written.
 *
 * **Only what cannot be taken back.** Every row here is either impossible to change afterwards
 * (app id, stage size), or is where the files land, or is a thing pressing Create does beyond
 * writing them (version control). The optional details are deliberately absent: restating a
 * description the author can edit in the project panel a minute later turns the page that exists
 * to catch mistakes into a page that is skimmed.
 */
export function ReviewStep({ projectData, template }: ReviewStepProps) {
    const { t } = useTranslation();
    const stageSize = parseStageSize(projectData.resolution);
    const templateName = template
        ? (template.nameKey ? t(template.nameKey) : template.name)
        : projectData.template;

    const rows: { label: string; value: string }[] = [
        { label: t("wizard.review.template"), value: templateName },
        { label: t("wizard.project.name"), value: projectData.name },
        { label: t("wizard.fields.appId"), value: projectData.appId },
        { label: t("wizard.fields.stageSize"), value: stageSize ? formatStageSize(stageSize) : "" },
        {
            label: t("wizard.fields.scriptLocale"),
            value: projectData.sourceLocale ? localeAutonym(projectData.sourceLocale) : "",
        },
        { label: t("wizard.fields.location"), value: projectData.location },
        {
            label: t("wizard.fields.versionControl"),
            value: projectData.versionControl === "none" ? t("common.none") : "Lore",
        },
    ];

    return (
        <div className="h-full overflow-y-auto p-5">
            <div className="max-w-xl overflow-hidden rounded-md border border-edge">
                {rows.map((row, index) => (
                    <div
                        key={row.label}
                        className={`flex items-baseline justify-between gap-4 px-3 py-2 text-sm ${
                            index > 0 ? "border-t border-edge" : ""
                        }`}
                    >
                        <span className="shrink-0 text-fg-muted">{row.label}</span>
                        <span className="min-w-0 break-all text-right text-fg">
                            {row.value || t("wizard.review.notSpecified")}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
