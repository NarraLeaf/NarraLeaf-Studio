import { Sparkles } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { EditorComponentProps } from "../types";

/**
 * Welcome editor component
 * Displays a welcome screen with quick actions and getting started guide
 */
export function WelcomeEditor({ tabId, payload }: EditorComponentProps) {
    const { t } = useTranslation();
    return (
        <div className="h-full overflow-auto bg-surface">
            <div className="max-w-4xl mx-auto py-12 px-6">
                {/* Header */}
                <div className="text-center mb-12">
                    <div className="flex items-center justify-center gap-3 mb-4">
                        <Sparkles className="w-12 h-12 text-primary" />
                        <h1 className="text-4xl font-bold text-fg">{t("common.appName")}</h1>
                    </div>
                    <p className="text-lg text-fg-muted">
                        {t("welcome.tagline")}
                    </p>
                </div>

                {/* Getting Started */}
                <div className="bg-surface-sunken rounded-lg p-6 border border-edge">
                    <h2 className="text-xl font-semibold text-fg mb-4">{t("welcome.gettingStarted.title")}</h2>
                    <div className="space-y-4">
                        <GettingStartedStep
                            number={1}
                            title={t("welcome.gettingStarted.step1.title")}
                            description={t("welcome.gettingStarted.step1.description")}
                        />
                        <GettingStartedStep
                            number={2}
                            title={t("welcome.gettingStarted.step2.title")}
                            description={t("welcome.gettingStarted.step2.description")}
                        />
                        <GettingStartedStep
                            number={3}
                            title={t("welcome.gettingStarted.step3.title")}
                            description={t("welcome.gettingStarted.step3.description")}
                        />
                        <GettingStartedStep
                            number={4}
                            title={t("welcome.gettingStarted.step4.title")}
                            description={t("welcome.gettingStarted.step4.description")}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

interface GettingStartedStepProps {
    /** Step number */
    number: number;
    /** Step title */
    title: string;
    /** Step description */
    description: string;
}

/**
 * Getting started step component
 * Displays a numbered step in the getting started guide
 */
function GettingStartedStep({ number, title, description }: GettingStartedStepProps) {
    return (
        <div className="flex gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-semibold text-sm">
                {number}
            </div>
            <div>
                <h3 className="text-base font-medium text-fg mb-1">{title}</h3>
                <p className="text-sm text-fg-muted">{description}</p>
            </div>
        </div>
    );
}

