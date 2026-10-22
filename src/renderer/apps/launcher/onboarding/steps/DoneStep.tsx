import { ExternalLink } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { Button } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { studioDocsUrl } from "@shared/utils/docsSite";

const BILIBILI_URL = "https://go.mewbaka.cn/bili";
const YOUTUBE_URL = "https://www.youtube.com/@narraleaf";

/** The platforms' own marks (simple-icons paths), in the button's text colour rather than the brand's. */
function BrandMark({ path }: { path: string }) {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d={path} />
        </svg>
    );
}

const BILIBILI_PATH = "M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373Z";
const YOUTUBE_PATH = "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z";

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
                <BrandMark path={BILIBILI_PATH} />
                {t("onboarding.done.bilibili")}
            </Button>
            <Button variant="ghost" onClick={() => open(YOUTUBE_URL)}>
                <BrandMark path={YOUTUBE_PATH} />
                {t("onboarding.done.youtube")}
            </Button>
        </div>
    );
}
