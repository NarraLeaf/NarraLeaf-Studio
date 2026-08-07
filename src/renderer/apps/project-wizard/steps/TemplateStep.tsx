import { useTranslation } from "@/lib/i18n";
import { Card, CardDescription, CardTitle } from "@/lib/components/elements";
import { useMemo, useState } from "react";
import { ProjectData } from "../types";
import { projectTemplates } from "../constants";
import { useBundledProjectTemplates } from "../bundledProjectTemplates";

interface TemplateStepProps {
    projectData: ProjectData;
    updateProjectData: (updates: Partial<ProjectData>) => void;
}

/**
 * Template selection step for project wizard
 */
export function TemplateStep({ projectData, updateProjectData }: TemplateStepProps) {
    const { t } = useTranslation();
    const [focusedTemplate, setFocusedTemplate] = useState<string | null>(null);
    const bundled = useBundledProjectTemplates();

    /**
     * Blank first, then whatever this build ships, then the two bring-one-in cards.
     *
     * The page asks "where is this project coming from", and the templates are all
     * answers of the same kind as "blank" - something made here, now - so they
     * belong beside it rather than after the cards about projects that already exist.
     */
    const cards = useMemo(() => {
        const [empty, ...rest] = projectTemplates;
        return empty ? [empty, ...bundled, ...rest] : [...bundled, ...projectTemplates];
    }, [bundled]);

    const handleTemplateSelect = (templateId: string) => {
        updateProjectData({
            template: templateId,
            // Cleared, not left behind: picking "Empty" after a template must not
            // still scaffold that template's content.
            contentTemplateId: cards.find(card => card.id === templateId)?.contentTemplateId,
        });
    };

    const handleFocus = (templateId: string) => {
        setFocusedTemplate(templateId);
    };

    const handleBlur = () => {
        setFocusedTemplate(null);
    };

    return (
        <div className="p-6">
            <div className="space-y-6">
                <div className="space-y-2">
                    <h2 className="text-lg font-semibold text-fg">{t("wizard.template.title")}</h2>
                    <p className="text-sm text-fg-muted">
                        {t("wizard.template.subtitle")}
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
                    {cards.map((template) => (
                        <Card
                            key={template.id}
                            variant="default"
                            className={`
                                template-hover
                                ${projectData.template === template.id ? "template-selected" : ""}
                                ${focusedTemplate === template.id ? "template-focused" : ""}
                                h-full relative overflow-hidden
                            `}
                            onClick={() => handleTemplateSelect(template.id)}
                            onFocus={() => handleFocus(template.id)}
                            onBlur={handleBlur}
                        >
                            {/*
                              * The icon is a backdrop, not a label. It says nothing the title does
                              * not, so instead of sitting in a corner competing with the words it
                              * runs off the card's own edge at the same faint opacity as the
                              * workspace logo watermark - readable as a shape, never as content.
                              */}
                            <template.icon
                                aria-hidden
                                strokeWidth={1}
                                className="pointer-events-none absolute -bottom-8 -right-8 w-40 h-40 text-fg opacity-5"
                            />

                            {/* Content area */}
                            <div className="relative h-full flex items-center justify-center p-4">
                                <div className="text-center w-full">
                                    <CardTitle className="text-lg mb-2">{template.nameKey ? t(template.nameKey) : template.name}</CardTitle>
                                    <CardDescription className="text-sm">
                                        {template.descriptionKey ? t(template.descriptionKey) : template.description}
                                    </CardDescription>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>

                {/* {projectData.template && (
                    <div className="mt-6 p-4 bg-primary/10 border border-primary/30 rounded-lg shadow-lg shadow-primary/10">
                        <div className="flex items-start gap-3">
                            <div className="text-primary mt-0.5">
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="text-sm font-medium text-primary">
                                        ✓ {projectTemplates.find(t => t.id === projectData.template)?.name}
                                    </h3>
                                    <span className="text-xs text-primary bg-primary/20 px-2 py-1 rounded-full">
                                        Template Selected
                                    </span>
                                </div>
                                <p className="text-sm text-fg-muted">
                                    {projectTemplates.find(t => t.id === projectData.template)?.description}
                                </p>
                            </div>
                        </div>
                    </div>
                )} */}
            </div>
        </div>
    );
}
