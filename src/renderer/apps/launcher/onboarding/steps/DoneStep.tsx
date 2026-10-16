import { ExternalLink } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { Button } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { studioDocsUrl } from "@shared/utils/docsSite";

const BILIBILI_URL = "https://go.mewbaka.cn/bili";
const YOUTUBE_URL = "https://www.youtube.com/@narraleaf";

/**
 * The closing screen's only content: the way to the manual, and where NarraLeaf posts.
 *
 * Not a tutorial. Setup owns two preferences and nothing else it could teach, so the last screen
 * points rather than explains - the same reason there is no tips dialog anywhere in Studio
 * (docs/help-system.md §5).
 *
 * It pointed at three help topics inside Studio and now points at the site instead. One manual
 * link rather than three: a list of three at the end of a run of eight screens is a fourth decision
 * to make on the way out, and the manual's own front page is a better index of itself than any
 * three entries picked here. The URL follows the interface language where the site publishes it -
 * see {@link studioDocsUrl}, which the model-runtime links already go through. The two channel
 * links sit beside it as secondary buttons; neither is a step, and both open in the browser.
 */
export function DoneStep() {
    const { t, locale } = useTranslation();
    const open = (url: string) => void getInterface().app.openExternal(url);

    return (
        <div className="flex flex-col items-start gap-2">
            <Button variant="secondary" onClick={() => open(studioDocsUrl(locale))}>
                <ExternalLink className="h-4 w-4" />
                {t("onboarding.done.docs")}
            </Button>
            <Button variant="ghost" onClick={() => open(BILIBILI_URL)}>
                <ExternalLink className="h-4 w-4" />
                {t("onboarding.done.bilibili")}
            </Button>
            <Button variant="ghost" onClick={() => open(YOUTUBE_URL)}>
                <ExternalLink className="h-4 w-4" />
                {t("onboarding.done.youtube")}
            </Button>
        </div>
    );
}
