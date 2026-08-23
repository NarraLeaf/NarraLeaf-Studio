import { FieldLabel } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { ImportSettingsAction } from "../ImportSettingsAction";

export interface WelcomeStepProps {
    /** Leave setup, marker and all - what an import does once it lands. */
    onImported: () => void;
}

/**
 * The screen setup opens on, and the one place importing is offered.
 *
 * **It is a screen like the others, not a cover.** Same heading, same line under it, same rail
 * entry, same sample beside it - the sample showing the dashboard, which is the surface the
 * screens without one of their own show. A splash with the product name across it would be the one
 * screen in the flow that is looked at rather than read, and setup is six questions long: what the
 * first screen owes the reader is what the rest of them are, not a title card.
 *
 * **Importing belongs here** rather than in the footer of every screen. An import answers every
 * question at once, so beside question four it reads as a way to answer question four. Whoever has
 * a settings file knows it on the way in, so it is offered on the way in, once.
 */
export function WelcomeStep({ onImported }: WelcomeStepProps) {
    const { t } = useTranslation();

    return (
        <div>
            {/* The label says who the row is for - most first runs are not - and the row is the
                answer, drawn the way every other answer in this flow is drawn. */}
            <FieldLabel as="div">{t("onboarding.welcome.haveSettings")}</FieldLabel>
            <ImportSettingsAction onImported={onImported} />
        </div>
    );
}
