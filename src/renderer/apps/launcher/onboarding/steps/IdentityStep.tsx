import { Input, InputGroup } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { APP_DISPLAY_NAME } from "@shared/constants/app";
import { useOnboardingPreferences } from "../onboardingPreferences";

/**
 * Who the work is by, in the two senses Studio records separately.
 *
 * **The name and the address sign revisions** (`versionControl.authorName` / `authorEmail`). The
 * setting has existed since version control did and nothing on the way in ever asked, so every
 * install records the tool as the author of every revision - uninformative alone, and on a shared
 * history it means nobody can tell who wrote what, which is most of what a shared history is for.
 * The workspace still offers the question later, at the moment a name is about to be used; answering
 * it here simply means it has already been answered.
 *
 * **The organisation is the author line a new project starts with** (`project.defaultAuthor`). A
 * different question with a different answer: the person at the keyboard signs the change, and the
 * studio or publisher owns the work. It only ever fills a blank field in the project wizard, so it
 * is an offer rather than an override.
 *
 * Nothing here is prefilled from the operating system account. Studio does not publish somebody's
 * login name on their behalf; the only two honest options are to ask or to record the tool.
 */
export function IdentityStep() {
    const { t } = useTranslation();
    const {
        authorName, setAuthorName,
        authorEmail, setAuthorEmail,
        defaultAuthor, setDefaultAuthor,
    } = useOnboardingPreferences();

    return (
        <div className="space-y-3">
            <InputGroup label={t("settings.items.versionControlAuthor.label")}>
                <Input
                    fullWidth
                    value={authorName}
                    onChange={event => setAuthorName(event.target.value)}
                    autoFocus
                />
            </InputGroup>

            <InputGroup label={t("settings.items.versionControlAuthorEmail.label")}>
                <Input
                    fullWidth
                    type="email"
                    value={authorEmail}
                    onChange={event => setAuthorEmail(event.target.value)}
                />
            </InputGroup>

            {/* What an empty pair records, said where the pair is - not as a warning, because
                leaving it empty is a legitimate answer. */}
            <p className="text-xs text-fg-subtle">
                {t("onboarding.identity.unsigned", { name: APP_DISPLAY_NAME })}
            </p>

            <InputGroup label={t("settings.items.projectDefaultAuthor.label")}>
                <Input
                    fullWidth
                    value={defaultAuthor}
                    onChange={event => setDefaultAuthor(event.target.value)}
                    placeholder={t("project.details.authorPlaceholder")}
                />
            </InputGroup>
        </div>
    );
}
