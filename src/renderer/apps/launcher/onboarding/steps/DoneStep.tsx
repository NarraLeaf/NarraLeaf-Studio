import { ExternalLink } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { Button } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { studioDocsUrl } from "@shared/utils/docsSite";

/**
 * The closing screen's only content: the way to the manual.
 *
 * Not a tutorial. Setup owns two preferences and nothing else it could teach, so the last screen
 * points rather than explains - the same reason there is no tips dialog anywhere in Studio
 * (docs/help-system.md §5).
 *
 * It pointed at three help topics inside Studio and now points at the site instead. One link
 * rather than three: a list of three at the end of a run of eight screens is a fourth decision to
 * make on the way out, and the manual's own front page is a better index of itself than any three
 * entries picked here. The URL follows the interface language where the site publishes it - see
 * {@link studioDocsUrl}, which the model-runtime links already go through.
 */
export function DoneStep() {
    const { t, locale } = useTranslation();

    return (
        <Button variant="secondary" onClick={() => void getInterface().app.openExternal(studioDocsUrl(locale))}>
            <ExternalLink className="h-4 w-4" />
            {t("onboarding.done.docs")}
        </Button>
    );
}
