import { useTranslation } from "@/lib/i18n";

const LOGO_MASK = "url(/img/narraleaf-studio/logo-icon-white.png)";

/**
 * The faint mark behind an idle editor canvas, shared by the empty group and the blank tab.
 *
 * The art is a flat white silhouette of the leaf, invisible against the light theme's surface, so it
 * is painted as a mask over `bg-fg` and takes the theme's foreground colour - the same way the
 * wordmark beside it follows `text-fg`. It stays the leaf whichever icon the App icon setting puts
 * on the Dock and taskbar (see `PRODUCT_MARK_SRC`).
 */
export function ProductLogoWatermark({ className = "" }: { className?: string }) {
    const { t } = useTranslation();

    return (
        <div
            role="img"
            aria-label={t("workspace.shell.logoAlt")}
            className={`w-64 h-64 mx-auto bg-fg opacity-5 ${className}`}
            style={{
                maskImage: LOGO_MASK,
                WebkitMaskImage: LOGO_MASK,
                maskSize: "contain",
                WebkitMaskSize: "contain",
                maskRepeat: "no-repeat",
                WebkitMaskRepeat: "no-repeat",
                maskPosition: "center",
                WebkitMaskPosition: "center",
            }}
        />
    );
}
