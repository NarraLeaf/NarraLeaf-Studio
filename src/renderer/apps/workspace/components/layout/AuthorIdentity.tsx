import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { Input } from "@/lib/components/elements/Input";
import type { VersionSurface } from "../../hooks/useVersionSurface";

/**
 * One id, because the row is drawn in more than one place and a `<label for>` needs one that
 * matches.
 *
 * Never two at once - the commit form is absent while the server dialog is open, and the Team panel
 * closes when either takes the screen - so a constant is safe here in a way it would not be for a
 * repeated row.
 */
const AUTHOR_INPUT_ID = "vcs-author-name";

/**
 * Who to sign versions as.
 *
 * **The setting has always existed and nothing ever asked**, so every project in every install
 * records `NarraLeaf Studio` as the author of every version. Alone that is merely uninformative;
 * with a server configured it means a shared history in which nobody can tell who wrote what, which
 * is most of what a shared history is for.
 *
 * Asked at the moment the name is about to be used rather than in the first-run wizard, and not
 * filled in from the OS account: Studio does not publish somebody's login name on their behalf
 * (`UNCONFIGURED_IDENTITY` explains why), so the only two honest options are to ask or to keep
 * recording the tool.
 *
 * **Absent wherever something else is about to answer it.** `VcsManager.resolveIdentity` prefers
 * the account of the session stored for a project's remote origin over anything in settings, so a
 * name typed under a server that has one is a name nothing records. Which server that is differs by
 * caller - the one this project uses, or the one it is about to be pointed at - so the test is on
 * the caller and never here.
 *
 * `always` is what separates the two readings of this row. Without it the row is a prompt: it is
 * there while nobody has said, and it goes the moment somebody does. With it the row is a field
 * that states the name it holds, which is what a panel whose subject IS the identity has to show
 * even after the question has been answered.
 */
export function AuthorIdentity({ surface, always = false }: { surface: VersionSurface; always?: boolean }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(always ? surface.authorName ?? "" : "");
    const [saving, setSaving] = useState(false);

    if (surface.authorName !== null && !always) {
        return null;
    }

    const submit = () => {
        const name = draft.trim();
        // Nothing to store, and the offer stays: an empty name is what is already recorded, so
        // "saving" it would only make the row disappear without changing anything.
        if (!name || saving || name === surface.authorName) {
            return;
        }
        setSaving(true);
        void surface.setAuthorName(name).finally(() => setSaving(false));
    };

    return (
        <div data-vcs-seam="author-identity" className="mb-2">
            <label className="block text-2xs tracking-wide text-fg-subtle" htmlFor={AUTHOR_INPUT_ID}>
                {t("workspace.shell.versionControl.authorLabel")}
            </label>
            <div className="mt-1 flex items-center gap-1.5">
                {/* The field is wrapped because `Input` puts its own relative box around the
                    element, so a `flex-1` passed through `className` lands on the input inside that
                    box and stretches nothing. The row then drew a 170px field in a 500px dialog. */}
                <div className="min-w-0 flex-1">
                    <Input
                        id={AUTHOR_INPUT_ID}
                        size="sm"
                        fullWidth
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                submit();
                            }
                        }}
                        disabled={saving}
                        placeholder={t("workspace.shell.versionControl.authorPlaceholder")}
                        className="text-2xs"
                    />
                </div>
                {/* A button rather than saving on blur: this writes a Studio-wide setting, and a
                    field that stored itself when the author clicked elsewhere would do it while
                    they were still deciding. */}
                <button
                    type="button"
                    onClick={submit}
                    disabled={saving || draft.trim() === "" || draft.trim() === surface.authorName}
                    data-tip={t("workspace.shell.versionControl.authorSave")}
                    aria-label={t("workspace.shell.versionControl.authorSave")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-edge text-fg-muted transition-colors cursor-default hover:bg-fill hover:text-fg disabled:opacity-50"
                >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </button>
            </div>
        </div>
    );
}
