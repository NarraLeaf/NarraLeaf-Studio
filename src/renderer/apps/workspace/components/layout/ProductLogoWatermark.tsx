import { useProductIconIsDefault, useProductIconSrc } from "@/lib/appearance/useProductIcon";
import { useTranslation } from "@/lib/i18n";

const LOGO_MASK = "url(/img/narraleaf-studio/logo-icon-white.png)";

/**
 * The faint mark behind an idle editor canvas, shared by the empty group and the blank tab.
 *
 * Drawn two ways, because the shipped mark and a chosen one are different kinds of picture. The
 * shipped art is a flat white silhouette, invisible against the light theme's surface, so it is
 * painted as a mask over `bg-fg` and takes the theme's foreground colour - the same way the
 * wordmark beside it follows `text-fg`. Any other mark is a full-colour icon, which that mask
 * would flatten into a blob, so it is drawn as the picture it is.
 */
export function ProductLogoWatermark({ className = "" }: { className?: string }) {
    const { t } = useTranslation();
    const isDefault = useProductIconIsDefault();
    const src = useProductIconSrc();

    if (!isDefault) {
        return (
            <img
                src={src}
                alt={t("workspace.shell.logoAlt")}
                className={`w-64 h-64 mx-auto object-contain opacity-10 ${className}`}
            />
        );
    }

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
