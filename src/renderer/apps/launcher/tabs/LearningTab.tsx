import { useTranslation } from "@/lib/i18n";

export function LearningTab() {
    const { t } = useTranslation();

    return (
        <div className="h-full w-full pt-6 px-8 pb-8 text-fg">
            <div className="text-lg font-semibold mb-4">{t("launcher.nav.learning")}</div>
            <div className="text-sm text-fg-muted">{t("launcher.learning.placeholder")}</div>
        </div>
    );
}
