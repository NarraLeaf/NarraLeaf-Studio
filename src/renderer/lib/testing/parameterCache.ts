import type { TestId, TestParameterValue, TestParameterValues } from "./types";

/**
 * What the author last ran each test with - the parse and serialize halves of
 * `editor/cache/test-parameters.json`.
 *
 * **This is a cache by the only criterion there is** (`docs/caches.md`): deleting the file costs
 * the author one pick from a dropdown and loses no work. Nothing in the project points at it, no
 * build reads it, and every run states its own parameters on its own record - so the file is a
 * convenience about the *last* run and never evidence about any run. That is what puts it under
 * `editor/cache/`, which `@shared/vcs/workingSet` excludes: never committed, never in a change
 * list, and therefore one copy per machine, which is also what it should be. Two authors sharing a
 * project each keep their own last ending rather than overwriting each other's.
 *
 * Everything here is defensive on purpose. The file is derived, so anything unreadable in it is
 * *nothing*, never an error to show: a truncated write, a hand-edit, a file from a Studio that
 * spelled the values differently all resolve to "no remembered values" and the picker opens on
 * defaults. There is no repair path and no diagnostic, because there is nothing to save.
 */

/** `testId -> { parameterId: value }`. Ids are opaque here; validating them is the declaration's job. */
export type TestParameterMemory = Readonly<Record<TestId, TestParameterValues>>;

export const EMPTY_TEST_PARAMETER_MEMORY: TestParameterMemory = {};

function isParameterValue(value: unknown): value is TestParameterValue {
    return typeof value === "string" || typeof value === "boolean";
}

/**
 * Read whatever came off disk as a memory, keeping only what is shaped like one.
 *
 * Filtered per value rather than rejected whole: one test's entry going bad is no reason to forget
 * the other five, and a value of an unexpected type is dropped rather than passed on - what a
 * remembered value means is decided against the live declaration by `resolveTestParameterValues`,
 * and this only guarantees it is a value at all.
 */
export function parseTestParameterMemory(raw: unknown): TestParameterMemory {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return EMPTY_TEST_PARAMETER_MEMORY;
    }
    const memory: Record<TestId, Record<string, TestParameterValue>> = {};
    for (const [testId, entry] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
            continue;
        }
        const values: Record<string, TestParameterValue> = {};
        for (const [parameterId, value] of Object.entries(entry as Record<string, unknown>)) {
            if (isParameterValue(value)) {
                values[parameterId] = value;
            }
        }
        if (Object.keys(values).length > 0) {
            memory[testId] = values;
        }
    }
    return memory;
}

/**
 * The memory with one test's values replaced.
 *
 * A test that resolved to no values at all (a `select` with an empty list, so the run could not
 * have started) drops its entry instead of writing an empty object, so the file does not accumulate
 * a row per test the author merely looked at.
 */
export function rememberTestParameters(
    memory: TestParameterMemory,
    testId: TestId,
    values: TestParameterValues,
): TestParameterMemory {
    const next: Record<TestId, TestParameterValues> = { ...memory };
    if (Object.keys(values).length === 0) {
        delete next[testId];
    } else {
        next[testId] = { ...values };
    }
    return next;
}

/**
 * Indented: the file is a handful of short lines, and the only reason anyone ever opens it is to
 * see why a dropdown came back pointing where it did.
 */
export function serializeTestParameterMemory(memory: TestParameterMemory): string {
    return JSON.stringify(memory, null, 2);
}
