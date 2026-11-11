import { useTranslation } from "@/lib/i18n";
import { Button } from "@/lib/components/elements";

export function SettingSaveFailure({ retry }: { retry(): void }) {
    const { t } = useTranslation();
    return (
        <div role="alert" className="flex items-center gap-2 text-xs text-danger">
            <span>{t("settings.persistFailed")}</span>
            <Button size="sm" variant="ghost" onClick={retry}>{t("common.retry")}</Button>
        </div>
    );
}
