import { useProductIconSrc } from "@/lib/appearance/useProductIcon";
import { FieldLabel } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { APP_DISPLAY_NAME } from "@shared/constants/app";
import { ImportSettingsAction } from "../ImportSettingsAction";

export interface IntroStepProps {
    /** Leave setup, marker and all - what an import does once it lands. */
    onImported: () => void;
}

/**
 * The cover, before the first question.
 *
 * **It answers "what is about to happen".** Every screen after this one is a question, and the run
 * opened on the first of them - which is a fine way to start a form and a poor way to start a
 * product. A cover costs one press and buys the two sentences that make the presses that follow
 * make sense: how many questions there are, and that none of them is permanent.
 *
 * **It is where importing belongs.** The import used to sit in the footer of every screen, beside
 * the way onward, because it is one of the ways onward - but that put "I already have all of this"
 * next to question four, where it reads as a way to answer that one question. The author who has a
 * settings file knows it on the way in, so it is offered on the way in, once.
 *
 * Full width: no rail, no sample beside it. There is nothing here a preview could show, and a cover
 * that keeps the two-pane frame of the questions is a question with its controls missing.
 */
export function IntroStep({ onImported }: IntroStepProps) {
    const { t } = useTranslation();
    const iconSrc = useProductIconSrc();

    return (
        <div className="flex h-full min-h-0 flex-col justify-center px-2">
            <img src={iconSrc} alt="" className="h-12 w-12" />
            {/* The greeting above the name rather than around it: "Welcome to X", "欢迎使用 X" and
                "X へようこそ" do not agree about which side the name goes on, and a heading split
                into two spans agrees with whichever language wrote the split. */}
            <p className="mt-6 text-sm text-fg-muted">{t("onboarding.intro.greeting")}</p>
            <h1 className="mt-1 text-4xl font-semibold text-primary">{APP_DISPLAY_NAME}</h1>
            <p className="mt-4 max-w-md text-sm text-fg-muted">{t("onboarding.intro.expectation")}</p>

            {/* Framed as a question is framed on every screen after this one: the label says who
                the row is for, the row is the answer. Held to the width of the line above it so
                the cover reads as one column rather than a paragraph with a bar under it. */}
            <div className="mt-10 max-w-md">
                <FieldLabel as="div">{t("onboarding.intro.haveSettings")}</FieldLabel>
                <ImportSettingsAction onImported={onImported} />
            </div>
        </div>
    );
}
