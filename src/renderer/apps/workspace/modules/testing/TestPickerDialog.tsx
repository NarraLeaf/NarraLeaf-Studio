import { useMemo, useState } from "react";
import { Badge, Button, Select, Switch } from "@/lib/components/elements";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { cn } from "@/lib/utils/cn";
import { translate, useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { ConsoleService } from "@/lib/workspace/services/core/ConsoleService";
import { TEST_CONSOLE_CHANNEL } from "@/lib/testing/TestRunService";
import { EMPTY_TEST_PARAMETER_MEMORY, type TestParameterMemory } from "@/lib/testing/parameterCache";
import { resolveTestParameterValues, type ResolvedTestParameter } from "@/lib/testing/parameters";
import type { Workspace } from "@/lib/workspace/workspace";
import type {
    RegisteredTest,
    TestAvailability,
    TestId,
    TestParameterValue,
    TestParameterValues,
} from "@/lib/testing/types";
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
 *    Parameters follow it rather than getting a rule of their own: the section is drawn for whatever
 *    is selected and never hidden on a condition, and its controls are live exactly when Start is -
 *    so what the author may fill in and what they may run are one answer, not two.
 *
 * The parameters of the selected test sit between the list and the footer rather than inside the
 * selected row. The list is a `listbox` of `option`s, which is the wrong place to put a dropdown and
 * a switch; and a block that expanded a row into a panel is exactly the shape this file exists to
 * avoid.
 */
export function TestPickerContent({
    tests,
    getAvailability,
    listParameters,
    rememberedParameters,
    onStart,
    onCancel,
}: {
    tests: RegisteredTest[];
    getAvailability: (id: TestId) => TestAvailability;
    /**
     * What the selected test asks the author for. Absent means nothing does, and the picker draws
     * exactly what it drew before parameters existed.
     */
    listParameters?: (id: TestId) => ResolvedTestParameter[];
    /** The values these tests were last run with, read from the project cache before this opened. */
    rememberedParameters?: TestParameterMemory;
    onStart: (testId: TestId, parameters: TestParameterValues) => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation();
    const [selected, setSelected] = useState<TestId | null>(null);
    /** Only what the author changed by hand. Everything else is resolved from the declarations. */
    const [edited, setEdited] = useState<Record<TestId, TestParameterValues>>({});

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

    // Asked once per selection, not per keystroke: `options` is a call into a definition, and the
    // list it returns is what the row below is drawn from and what a remembered value is checked
    // against, so both have to be reading the same answer.
    const parameters = useMemo(
        () => (selected !== null && listParameters ? listParameters(selected) : []),
        [selected, listParameters],
    );
    const values = useMemo(() => {
        if (selected === null) {
            return {};
        }
        // The author's own edits sit on top of what was remembered, and the resolver has the last
        // word on both - so a value whose option has since disappeared falls back to the default
        // rather than leaving the control pointing at nothing.
        const remembered = (rememberedParameters ?? EMPTY_TEST_PARAMETER_MEMORY)[selected];
        return resolveTestParameterValues(parameters, { ...remembered, ...edited[selected] });
    }, [selected, parameters, rememberedParameters, edited]);

    const setValue = (parameterId: string, value: TestParameterValue) => {
        if (selected === null) {
            return;
        }
        setEdited(previous => ({
            ...previous,
            [selected]: { ...previous[selected], [parameterId]: value },
        }));
    };

    const canStart = selected !== null && availability.get(selected)?.available === true;
    /**
     * Start one test with what it would be shown.
     *
     * Resolved for the id being started rather than read off the selection, because a double-click
     * starts a row in the same gesture that selects it - and the answer must not depend on whether
     * React had re-rendered in between.
     */
    const startTest = (testId: TestId) => {
        if (availability.get(testId)?.available !== true) {
            return;
        }
        const resolved = testId === selected ? parameters : listParameters?.(testId) ?? [];
        onStart(testId, resolveTestParameterValues(resolved, {
            ...(rememberedParameters ?? EMPTY_TEST_PARAMETER_MEMORY)[testId],
            ...edited[testId],
        }));
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
                                    onActivate={() => startTest(test.definition.id)}
                                />
                            ))}
                        </div>
                    ))
                )}
            </div>

            {parameters.length > 0 ? (
                <div
                    role="group"
                    aria-label={t("test.picker.parameters")}
                    className="grid gap-1.5 border-t border-edge px-6 py-3"
                >
                    {parameters.map(parameter => (
                        <TestParameterRow
                            key={parameter.definition.id}
                            parameter={parameter}
                            value={values[parameter.definition.id]}
                            // Live exactly when Start is. An unavailable row declines the click that
                            // would select it, so this is what keeps the two from drifting rather
                            // than a state the author reaches by a different route.
                            disabled={!canStart}
                            onChange={value => setValue(parameter.definition.id, value)}
                        />
                    ))}
                </div>
            ) : null}

            <div className="flex items-center justify-end gap-2 border-t border-edge bg-surface-overlay px-6 py-3">
                <Button variant="secondary" aria-label={t("common.cancel")} onClick={onCancel}>
                    {t("common.cancel")}
                </Button>
                <Button
                    variant="primary"
                    aria-label={t("test.picker.start")}
                    disabled={!canStart}
                    onClick={() => selected !== null && startTest(selected)}
                >
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
 * One value the selected test is told before it starts: its name on the left, its control on the
 * right.
 *
 * A row, not a field stack, and one `size` across the lot - the picker is a dense list and a
 * parameter must not cost more vertical space than the test it belongs to. `FieldLabel` is drawn as
 * a `div`: `Select` and `Switch` are both buttons under the hood with no id to point a `<label>` at,
 * so the name reaches assistive tech as the control's own accessible name instead.
 */
function TestParameterRow({
    parameter,
    value,
    disabled,
    onChange,
}: {
    parameter: ResolvedTestParameter;
    value: TestParameterValue | undefined;
    disabled: boolean;
    onChange: (value: TestParameterValue) => void;
}) {
    const { t } = useTranslation();
    const label = resolveTestText(parameter.definition.label, t);
    const description = resolveTestText(parameter.definition.description, t);

    return (
        <div className="flex min-w-0 items-center gap-3">
            <span className="grid min-w-0 flex-1">
                <FieldLabel as="div" className="mb-0 truncate text-xs text-fg-muted">
                    {label}
                </FieldLabel>
                {description ? (
                    <span className="min-w-0 truncate text-2xs text-fg-subtle">{description}</span>
                ) : null}
            </span>
            {parameter.kind === "select" ? (
                <Select
                    size="sm"
                    className="w-52 shrink-0"
                    fullWidth
                    // Opens upward on purpose. The row sits just above the dialog's footer, and the
                    // dialog clips its own overflow - a menu that measured its way downwards would
                    // be measuring against room this box does not have.
                    menuPlacement="above"
                    ariaLabel={label}
                    disabled={disabled}
                    value={typeof value === "string" ? value : undefined}
                    options={parameter.options.map(option => ({
                        value: option.value,
                        label: resolveTestText(option.label, t),
                    }))}
                    onChange={next => onChange(String(next))}
                />
            ) : (
                <Switch
                    size="sm"
                    className="shrink-0"
                    aria-label={label}
                    disabled={disabled}
                    checked={value === true}
                    onCheckedChange={onChange}
                />
            )}
        </div>
    );
}

/**
 * Open the picker. Starting closes it, reveals the console (where the run's live lines land) and
 * hands the run to the service - the report tab is opened later by whoever is watching the run.
 */
export function openTestDialog(workspace: Workspace): void {
    void showTestPicker(workspace);
}

/**
 * The remembered values are read *before* the dialog opens, not from inside it.
 *
 * One small file off the project cache, and reading it first is what lets `TestPickerContent` stay
 * a pure function of its props: no effect, no loading state, and no dropdown that draws a default
 * and then visibly jumps to what the author picked last time. A read that fails answers "nothing
 * remembered" (see `TestRunService.readRememberedParameters`), so the picker always opens.
 */
async function showTestPicker(workspace: Workspace): Promise<void> {
    const context = workspace.getContext();
    const uiService = context.services.get<UIService>(Services.UI);
    const consoleService = context.services.get<ConsoleService>(Services.Console);
    const testRun = getTestRunService(context);
    const rememberedParameters = await testRun.readRememberedParameters();

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
                listParameters={id => testRun.listParameters(id)}
                rememberedParameters={rememberedParameters}
                onCancel={() => uiService.dialogs.close(dialogId)}
                onStart={(testId, parameters) => {
                    uiService.dialogs.close(dialogId);
                    uiService.panels.show(CONSOLE_PANEL_ID);
                    // Showing the panel is not enough: it restores whichever tab was last active,
                    // so without this the author lands on an empty `build` tab while the run they
                    // just started writes to `test` one tab over.
                    consoleService?.requestFocus(TEST_CONSOLE_CHANNEL);
                    void testRun.start(testId, parameters);
                    // Remembered on Start, so the next open comes back to what was actually run -
                    // not to whatever the author last clicked through and then cancelled.
                    void testRun.rememberParameters(testId, parameters);
                }}
            />
        ),
    });
}
