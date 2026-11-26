/**
 * Taking back one step over a list of records, as operations, while somebody else may be editing
 * the same list.
 *
 * Outside a team project a configuration panel undoes by putting the whole document back as it was
 * before the step - the cheapest thing that is exactly right when nobody else writes it. A step
 * recorded while a team project was offline and taken after it reconnected cannot do that: the
 * document now also holds whatever other authors did since, and writing the old snapshot over it
 * would delete their work - on this machine alone, behind the server's back.
 *
 * So the step is read as what it changed - the records that differ between its two snapshots - and
 * only those are put back, as the operations the panel would have sent:
 *
 *  - **Only while each of those records still reads as the step left it.** If somebody changed one
 *    since, putting the old one back would overwrite them without anybody being told; the plan says
 *    so and nothing is sent.
 *  - **Everything else stays as the document holds it now**, other authors' records included.
 *  - **Order:** a record that comes back goes in front of the next record of the target list that is
 *    still there; a record the step only moved is moved back where the list has a verb for it.
 */

export type RecordRestorePlan<T> =
    | { conflict: true }
    | {
          conflict: false;
          deletes: string[];
          creates: { record: T; beforeId: string | null }[];
          updates: T[];
          moves: { id: string; beforeId: string | null }[];
      };

/**
 * What takes `current` from the step's `from` side to its `to` side, touching only what the step
 * touched - or `conflict` when one of those records has changed since.
 */
export function planRecordRestore<T extends { id: string }>(
    from: readonly T[],
    to: readonly T[],
    current: readonly T[],
): RecordRestorePlan<T> {
    const fromById = new Map(from.map(record => [record.id, record]));
    const toById = new Map(to.map(record => [record.id, record]));
    const currentById = new Map(current.map(record => [record.id, record]));
    const touched = new Set<string>();
    for (const id of new Set([...fromById.keys(), ...toById.keys()])) {
        if (!sameRecord(fromById.get(id), toById.get(id))) {
            touched.add(id);
        }
    }
    for (const id of touched) {
        if (!sameRecord(currentById.get(id), fromById.get(id))) {
            return { conflict: true };
        }
    }

    const deletes = [...touched].filter(id => !toById.has(id));
    const updates = [...touched].filter(id => toById.has(id) && currentById.has(id)).map(id => toById.get(id)!);
    // Back to front, so a record's next sibling is already in place when it is put back.
    const present = new Set([...currentById.keys()].filter(id => !deletes.includes(id)));
    const creates: { record: T; beforeId: string | null }[] = [];
    for (let index = to.length - 1; index >= 0; index -= 1) {
        const record = to[index];
        if (!touched.has(record.id) || currentById.has(record.id)) {
            continue;
        }
        creates.unshift({ record, beforeId: nextPresent(to, index, present) });
        present.add(record.id);
    }
    // A record the step moved and did not otherwise change. Read off the records both sides hold
    // unchanged, in the order each side lists them: an insertion or a deletion next to a record is
    // not a move of it.
    const moves: { id: string; beforeId: string | null }[] = [];
    const steady = (list: readonly T[]) => list.map(record => record.id)
        .filter(id => !touched.has(id) && fromById.has(id) && toById.has(id) && currentById.has(id));
    const fromSteady = steady(from);
    const toSteady = steady(to);
    const fromNext = new Map(fromSteady.map((id, index) => [id, fromSteady[index + 1] ?? null]));
    toSteady.forEach((id, index) => {
        if (fromNext.get(id) !== (toSteady[index + 1] ?? null)) {
            moves.push({ id, beforeId: nextPresent(to, to.findIndex(record => record.id === id), present) });
        }
    });
    return { conflict: false, deletes, creates, updates, moves };
}

/** Whether the plan changes nothing at all. */
export function isEmptyRecordRestore<T>(plan: RecordRestorePlan<T>): boolean {
    return !plan.conflict
        && plan.deletes.length === 0
        && plan.creates.length === 0
        && plan.updates.length === 0
        && plan.moves.length === 0;
}

function nextPresent<T extends { id: string }>(list: readonly T[], index: number, present: ReadonlySet<string>): string | null {
    for (let next = index + 1; next < list.length; next += 1) {
        if (present.has(list[next].id)) {
            return list[next].id;
        }
    }
    return null;
}

/** Two records, or two absences, holding the same thing - whatever their key order. */
export function sameRecord(a: unknown, b: unknown): boolean {
    return canonical(a ?? null) === canonical(b ?? null);
}

function canonical(value: unknown): string {
    return JSON.stringify(sortKeys(value)) ?? "null";
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }
    if (value === null || typeof value !== "object") {
        return value;
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        const entry = (value as Record<string, unknown>)[key];
        if (entry !== undefined) {
            out[key] = sortKeys(entry);
        }
    }
    return out;
}
