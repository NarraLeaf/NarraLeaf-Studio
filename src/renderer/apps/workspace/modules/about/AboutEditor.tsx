import { useCallback } from "react";
import { Globe, Info, Users } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { EditorComponentProps } from "../types";

/** The NarraLeaf Project home page; opened in the system browser via `app.openExternal`. */
const OWNER_URL = "https://www.narraleaf.com";
const OWNER_NAME = "NarraLeaf Project";
const OWNER_DOMAIN = "narraleaf.com";

/**
 * Contributors, taken from the git history. Names are proper nouns, so they stay verbatim
 * rather than going through i18n. Add new maintainers here as the credit list grows.
 */
const CONTRIBUTORS = ["WangZixu", "helloyork"];

/**
 * About editor component.
 *
 * A static credits page: who owns NarraLeaf Studio and who has contributed to it. Reached from
 * Help ▸ About (the in-app menu on Windows/Linux, the native menu on macOS).
 */
export function AboutEditor(_: EditorComponentProps) {
    const { t } = useTranslation();

    const handleOpenWebsite = useCallback(() => {
        void getInterface().app.openExternal(OWNER_URL);
    }, []);

    return (
        <div className="h-full overflow-auto bg-surface">
            <div className="max-w-2xl mx-auto py-12 px-6">
                {/* Header */}
                <div className="text-center mb-10">
                    <div className="flex items-center justify-center gap-3 mb-3">
                        <Info className="w-10 h-10 text-primary" />
                        <h1 className="text-3xl font-bold text-fg">{t("common.appName")}</h1>
                    </div>
                    <p className="text-base text-fg-muted">{t("about.tagline")}</p>
                </div>

                {/* Owner */}
                <div className="bg-surface-raised rounded-lg p-6 border border-edge mb-4">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3">
                        {t("about.ownerLabel")}
                    </h2>
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="text-base font-medium text-fg">{OWNER_NAME}</p>
                            <p className="text-sm text-fg-muted">{OWNER_DOMAIN}</p>
                        </div>
                        <button
                            type="button"
                            onClick={handleOpenWebsite}
                            className="flex items-center gap-1.5 h-8 px-3 rounded-md text-sm text-fg-muted hover:bg-fill hover:text-fg transition-colors cursor-default shrink-0"
                            title={t("about.visitWebsite")}
                        >
                            <Globe className="w-4 h-4" />
                            <span>{t("about.visitWebsite")}</span>
                        </button>
                    </div>
                </div>

                {/* Contributors */}
                <div className="bg-surface-raised rounded-lg p-6 border border-edge">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3">
                        {t("about.contributorsLabel")}
                    </h2>
                    <ul className="flex flex-col gap-2">
                        {CONTRIBUTORS.map((name) => (
                            <li key={name} className="flex items-center gap-2 text-sm text-fg">
                                <Users className="w-4 h-4 text-fg-subtle shrink-0" />
                                <span>{name}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
}
