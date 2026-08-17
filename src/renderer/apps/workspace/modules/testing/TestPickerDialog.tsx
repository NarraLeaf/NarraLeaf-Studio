import { useMemo, useState } from "react";
import { Badge, Button } from "@/lib/components/elements";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { cn } from "@/lib/utils/cn";
import { translate, useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { ConsoleService } from "@/lib/workspace/services/core/ConsoleService";
import { TEST_CONSOLE_CHANNEL } from "@/lib/testing/TestRunService";
import type { Workspace } from "@/lib/workspace/workspace";
import type { RegisteredTest, TestAvailability, TestId } from "@/lib/testing/types";
import { getTestRunService } from "./testRunService";
import {
    TEST_CATEGORY_LABEL_KEYS,
    TEST_PRESENTATION_LABEL_KEYS,
    groupTestsByCategory,
    resolveTestText,
} from "./testModel";

const CONSOLE_PANEL_ID = "narraleaf-studio:console";

/**
 * The test picker.
 *
 * A dense registry list, not a stack of cards - the same call `ProjectLintingSection` made for the
 * twenty-six lint rules, and for the same reason: this list grows with every plugin that ships a
 * test, and a bordered filled box per row becomes a wall of boxes long before it becomes readable.
 * A category heading plus a plain row is all the structure there is.
 *
 * Two things are load-bearing:
 *
 *  - **The dialog's job ends at Start** (ruling R8). It closes, the console shows the live lines,
 *    and the report tab opens when the run settles. The Build dialog hands off the same way; a
 *    dialog that stayed open to narrate a run would be a third place the run lives.
 *  - **An unavailable row stays listed.** It greys out and says why - "another run is in progress",
 *    "not while the workspace is frozen" - because a test that vanishes reads as a test that was
 *    never installed. `getAvailability` is the whole authority on this; the picker applies no gate
 *    of its own, so what the author is refused and what the host would refuse cannot drift apart.
 */
export function TestPickerContent({
    tests,
    getAvailability,
    onStart,
    onCancel,
}: {
    tests: RegisteredTest[];
    getAvailability: (id: TestId) => TestAvailability;
    onStart: (testId: TestId) => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation();
    const [selected, setSelected] = useState<TestId | null>(null);

    const groups = useMemo(() => groupTestsByCategory(tests), [tests]);
    // Evaluated once per open, which is what `checkAvailability` is documented to be cheap enough
    // for. Nothing can change underneath a modal: the only thing that starts a run is this dialog.
    const availability = useMemo(() => {
        const map = new Map<TestId, TestAvailability>();
        for (const test of tests) {
            map.set(test.definition.id, getAvailability(test.definition.id));
        }
        return map;
    }, [tests, getAvailability]);

    const canStart = selected !== null && availability.get(selected)?.available === true;
    const start = () => {
        if (selected !== null && canStart) {
            onStart(selected);
        }
    };

    return (
        // Negative margins undo DialogContainer's content padding so the list and the footer meet
        // the dialog edges. The footer is drawn here rather than passed as `buttons` because
        // dialogs.show snapshots those at open time and could never follow the selection.
        <div className="-mx-6 -my-4 flex flex-col text-sm">
            <div
                role="listbox"
                aria-label={t("test.picker.title")}
                className="grid max-h-96 min-w-0 content-start overflow-y-auto px-3 py-2"
            >
                {groups.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-fg-subtle">{t("test.picker.empty")}</p>
                ) : (
                    groups.map((group, index) => (
                        <div
                            key={group.category}
                            role="group"
                            aria-label={t(TEST_CATEGORY_LABEL_KEYS[group.category])}
                            className="grid min-w-0"
                        >
                            <FieldLabel as="div" className={cn("mb-0.5 px-1", index === 0 ? "mt-1" : "mt-3")}>
                                {t(TEST_CATEGORY_LABEL_KEYS[group.category])}
                            </FieldLabel>
                            {group.tests.map(test => (
                                <TestRow
                                    key={test.definition.id}
                                    test={test}
                                    availability={availability.get(test.definition.id) ?? { available: true }}
                                    selected={selected === test.definition.id}
                                    onSelect={() => setSelected(test.definition.id)}
                                    onActivate={() => onStart(test.definition.id)}
                                />
                            ))}
                        </div>
                    ))
                )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-edge bg-surface-overlay px-6 py-3">
                <Button variant="secondary" aria-label={t("common.cancel")} onClick={onCancel}>
                    {t("common.cancel")}
                </Button>
                <Button variant="primary" aria-label={t("test.picker.start")} disabled={!canStart} onClick={start}>
                    {t("test.picker.start")}
                </Button>
            </div>
        </div>
    );
}

/**
 * One row: what the test is called, whether it opens a window, whose it is, and one line about it.
 *
 * The description is a second line rather than a hint popover for two reasons. It is the test's own
 * content and there is room for it - and the row is a `<button>`, while `HintPopover`'s trigger is
 * also a `<button>`, so a popover here would be nested interactive content that no keyboard could
 * reach inside a disabled row anyway. When a row runs out of width the plugin id is what gives, and
 * both lines truncate.
 */
function TestRow({
    test,
    availability,
    selected,
    onSelect,
    onActivate,
}: {
    test: RegisteredTest;
    availability: TestAvailability;
    selected: boolean;
    onSelect: () => void;
    onActivate: () => void;
}) {
    const { t } = useTranslation();
    const { definition, ownerPluginId } = test;
    const title = resolveTestText(definition.title, t);
    const description = resolveTestText(definition.description, t);
    const available = availability.available;
    // The reason replaces the description: on a row that cannot be run, why it cannot is the only
    // thing the author is deciding on.
    const secondary = available ? description : resolveTestText(availability.reason, t);

    return (
        <button
            type="button"
            role="option"
            aria-selected={selected}
            aria-disabled={!available || undefined}
            aria-label={title}
            disabled={!available}
            onClick={onSelect}
            onDoubleClick={() => {
                if (available) {
                    onActivate();
                }
            }}
            className={cn(
                // `cursor-default` is not decoration: Tailwind's preflight gives every <button> a
                // pointer cursor, and Studio is arrow-everywhere (the shared `Button` sets it too).
                // Without it this row is the one hand cursor in the window.
                "grid min-w-0 cursor-default gap-0.5 rounded-md px-2 py-1.5 text-left",
                "transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
                !available
                    ? "cursor-not-allowed text-fg-subtle"
                    : selected
                      ? "bg-primary/15 text-fg"
                      : "text-fg-muted hover:bg-fill",
            )}
        >
            <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate text-sm">{title}</span>
                <Badge
                    className="shrink-0"
                    tone={definition.presentation === "windowed" ? "warning" : "neutral"}
                >
                    {t(TEST_PRESENTATION_LABEL_KEYS[definition.presentation])}
                </Badge>
                {ownerPluginId ? (
                    // A plugin's test has to read as a plugin's test - the owner is assigned by the
                    // host from the registering plugin's identity, never read off the definition.
                    <span className="min-w-0 shrink truncate font-mono text-2xs text-fg-subtle">
                        {ownerPluginId}
                    </span>
                ) : null}
            </span>
            {secondary ? <span className="min-w-0 truncate text-2xs text-fg-subtle">{secondary}</span> : null}
        </button>
    );
}

/**
 * Open the picker. Starting closes it, reveals the console (where the run's live lines land) and
 * hands the run to the service - the report tab is opened later by whoever is watching the run.
 */
export function openTestDialog(workspace: Workspace): void {
    const context = workspace.getContext();
    const uiService = context.services.get<UIService>(Services.UI);
    const consoleService = context.services.get<ConsoleService>(Services.Console);
    const testRun = getTestRunService(context);

    const dialogId = uiService.dialogs.show({
        title: translate("test.picker.title"),
        width: 560,
        closable: true,
        // What starting one of these does - the window, the console, the report that opens
        // afterwards - happens after the dialog is gone, so no control here can state it.
        helpTopic: "tests",
        content: (
            <TestPickerContent
                tests={testRun.listTests()}
                getAvailability={id => testRun.getAvailability(id)}
                onCancel={() => uiService.dialogs.close(dialogId)}
                onStart={testId => {
                    uiService.dialogs.close(dialogId);
                    uiService.panels.show(CONSOLE_PANEL_ID);
                    // Showing the panel is not enough: it restores whichever tab was last active,
                    // so without this the author lands on an empty `build` tab while the run they
                    // just started writes to `test` one tab over.
                    consoleService?.requestFocus(TEST_CONSOLE_CHANNEL);
                    void testRun.start(testId);
                }}
            />
        ),
    });
}
