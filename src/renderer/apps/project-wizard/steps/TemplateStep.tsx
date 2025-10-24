import { Card, CardDescription, CardTitle } from "@/lib/components/elements";
import { useState } from "react";
import { ProjectData, projectTemplates } from "../ProjectWizardApp";

interface TemplateStepProps {
    projectData: ProjectData;
    updateProjectData: (updates: Partial<ProjectData>) => void;
}

/**
 * Template selection step for project wizard
 */
export function TemplateStep({ projectData, updateProjectData }: TemplateStepProps) {
    const [focusedTemplate, setFocusedTemplate] = useState<string | null>(null);

    const handleTemplateSelect = (templateId: string) => {
        updateProjectData({
            template: templateId,
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
                    <h2 className="text-lg font-semibold text-gray-200">Choose a Project Template</h2>
                    <p className="text-sm text-gray-400">
                        Select a project template to get started quickly with pre-configured structure and settings.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
                    {projectTemplates.map((template) => (
                        <Card
                            key={template.id}
                            variant="default"
                            className={`
                                template-hover
                                ${projectData.template === template.id ? "template-selected" : ""}
                                ${focusedTemplate === template.id ? "template-focused" : ""}
                                h-full relative
                            `}
                            onClick={() => handleTemplateSelect(template.id)}
                            onFocus={() => handleFocus(template.id)}
                            onBlur={handleBlur}
                        >
                            {/* Icon in top-left corner */}
                            <div className="absolute top-2 left-2 text-gray-400 z-10">
                                <template.icon className="w-5 h-5" />
                            </div>

                            {/* Content area */}
                            <div className="h-full flex items-center justify-center p-4">
                                <div className="text-center w-full">
                                    <CardTitle className="text-lg mb-2">{template.name}</CardTitle>
                                    <CardDescription className="text-sm">
                                        {template.description}
                                    </CardDescription>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>

                {/* {projectData.template && (
                    <div className="mt-6 p-4 bg-[#40a8c4]/10 border border-[#40a8c4]/30 rounded-lg shadow-lg shadow-[#40a8c4]/10">
                        <div className="flex items-start gap-3">
                            <div className="text-[#40a8c4] mt-0.5">
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="text-sm font-medium text-[#40a8c4]">
                                        ✓ {projectTemplates.find(t => t.id === projectData.template)?.name}
                                    </h3>
                                    <span className="text-xs text-[#40a8c4] bg-[#40a8c4]/20 px-2 py-1 rounded-full">
                                        Template Selected
                                    </span>
                                </div>
                                <p className="text-sm text-gray-300">
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
