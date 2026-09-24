import type { WidgetLogicApi } from "./widgetLogic";

/**
 * Widget types a plugin contributes, as the shared capability lookups see them.
 *
 * The questions every seam asks of a widget type - which events it raises and which heads start on
 * them (`widgetLogic.ts`), whether it may hold children and which of them are parts it built for
 * itself (`document.ts`) - are answered from tables
 * written in `shared`, because the workspace, the Dev Mode window and a built game all have to ask
 * them and only `shared` is in all three. A plugin's widget is not in those tables and cannot be:
 * it is registered at run time, and in a different registry in each realm. Before this module every
 * one of those seams answered "no" for a plugin widget - it could hold no children, its declared
 * events started nothing, not even in its own blueprint - while the plugin API invited it to
 * declare both.
 *
 * So the tables stay what they are, the built-in answer, and this is where the realm that holds the
 * plugin registrations plugs in behind them: the workspace from its widget module registry, the Dev
 * Mode window and a built game from the runtime plugin loader. **A source is a view of a registry
 * that already exists, never a copy** - what it answers is whatever is registered at the moment of
 * asking, so a plugin switched off stops being answered for in the same instant it stops being
 * drawn.
 *
 * A source only ever answers for a type the built-in tables do not know: every caller asks the
 * built-in table first, so a plugin cannot redefine what `nl.container` accepts or raises.
 */

export type ContributedWidgetDeclaration = {
    /** The widget type, which starts with its plugin's id. */
    readonly type: string;
    /** The plugin that registered it; decides which of its own node types it may name as heads. */
    readonly ownerPluginId: string;
    /**
     * The events it raises and the heads they start, already through
     * `sanitizeContributedWidgetLogicApi` - the registration sites run it before storing.
     */
    readonly logicApi?: WidgetLogicApi;
    /** Whether an author may put other elements inside it. */
    readonly acceptsChildren?: boolean;
    /**
     * The parts it builds for itself and holds nothing else, by slot name - the Slider and Switch
     * answer rather than the Container one. Already through `sanitizeContributedWidgetPartSlots`,
     * so a declaration that has slots never also says `acceptsChildren`.
     */
    readonly partSlots?: readonly string[];
};

export type ContributedWidgetSource = {
    get(type: string): ContributedWidgetDeclaration | undefined;
    list(): Iterable<ContributedWidgetDeclaration>;
};

const sources: ContributedWidgetSource[] = [];

/** Head types some contributed widget names, rebuilt on the first ask after any change. */
let contributedHeadTypes: ReadonlySet<string> | null = null;

/**
 * Put a realm's plugin registrations behind the shared lookups. Returns the removal.
 *
 * The source has to call {@link notifyContributedWidgetsChanged} when what it holds changes; the
 * lookups themselves read through on every call, but the head-type index below is cached, because
 * "is this node an event head" is asked of every node on the data-pin path.
 */
export function registerContributedWidgetSource(source: ContributedWidgetSource): () => void {
    sources.push(source);
    notifyContributedWidgetsChanged();
    return () => {
        const index = sources.indexOf(source);
        if (index >= 0) {
            sources.splice(index, 1);
            notifyContributedWidgetsChanged();
        }
    };
}

/** Called by a source after a registration was added or removed. */
export function notifyContributedWidgetsChanged(): void {
    contributedHeadTypes = null;
}

/** The plugin declaration for a widget type, or undefined when no loaded plugin contributes it. */
export function getContributedWidget(type: string | undefined | null): ContributedWidgetDeclaration | undefined {
    if (!type) {
        return undefined;
    }
    for (const source of sources) {
        const declared = source.get(type);
        if (declared) {
            return declared;
        }
    }
    return undefined;
}

/** Every widget type a loaded plugin contributes, first source first. */
export function listContributedWidgets(): ContributedWidgetDeclaration[] {
    const seen = new Set<string>();
    const out: ContributedWidgetDeclaration[] = [];
    for (const source of sources) {
        for (const declared of source.list()) {
            if (!seen.has(declared.type)) {
                seen.add(declared.type);
                out.push(declared);
            }
        }
    }
    return out;
}

/**
 * The `extra` key a plugin widget's part carries its slot name under.
 *
 * One key for every plugin widget rather than one per type, as the built-in part owners each have
 * (`sliderSlot`, `switchSlot`): an element has one parent, so it can only ever be a part of one
 * widget, and a plugin author writing `createDefaultChildElements` has one name to learn instead of
 * one to invent and then declare as well.
 */
export const CONTRIBUTED_WIDGET_PART_SLOT_KEY = "partSlot";

/**
 * The part slots a contributed widget declares, or an empty list when it declares none (or no loaded
 * plugin contributes the type).
 */
export function getContributedWidgetPartSlots(type: string | undefined | null): readonly string[] {
    return getContributedWidget(type)?.partSlots ?? [];
}

export type ContributedPartSlotsProblem = { message: string };

/**
 * The part slots a plugin widget is held to, from the ones it declared.
 *
 * Slot names are kept when they are non-empty strings, once each. A widget that declares slots and
 * `acceptsChildren` as well is answered as a widget with parts: the two describe opposite parents -
 * one takes whatever an author puts in it, the other only what it built - and the one with parts is
 * the narrower claim, so honouring it is the answer that cannot seal an author's element inside
 * something they were told would hold it. What was set aside is returned beside the result so the
 * registration site can say so to the plugin's author.
 */
export function sanitizeContributedWidgetPartSlots(
    partSlots: unknown,
    acceptsChildren: boolean,
): { partSlots: readonly string[]; acceptsChildren: boolean; problems: ContributedPartSlotsProblem[] } {
    const problems: ContributedPartSlotsProblem[] = [];
    const slots: string[] = [];
    if (partSlots !== undefined && !Array.isArray(partSlots)) {
        problems.push({ message: "partSlots is not a list of slot names, so the widget has no parts" });
    }
    for (const slot of Array.isArray(partSlots) ? partSlots : []) {
        if (typeof slot !== "string" || slot.trim().length === 0) {
            problems.push({ message: `part slot ${JSON.stringify(slot)} is not a slot name` });
            continue;
        }
        if (!slots.includes(slot)) {
            slots.push(slot);
        }
    }
    if (slots.length > 0 && acceptsChildren) {
        problems.push({
            message: "declares both partSlots and acceptsChildren; a widget with parts holds only its parts, "
                + "so acceptsChildren is ignored",
        });
    }
    return { partSlots: slots, acceptsChildren: slots.length > 0 ? false : acceptsChildren, problems };
}

/**
 * Whether a contributed widget type names `headType` as a head for one of its events.
 *
 * The same derivation the built-in heads get their widget scope from (`widgetTypesForHead` in the
 * event head catalogue reads the built-in logic table the same way), done when asked instead of at
 * catalogue load, because a plugin's widget arrives after the catalogue is built.
 */
export function contributedWidgetNamesHead(widgetType: string | undefined | null, headType: string): boolean {
    const events = getContributedWidget(widgetType)?.logicApi?.events ?? [];
    return events.some(eventDef => eventDef.headNodeTypes?.includes(headType) === true);
}

/** Whether any loaded plugin widget names `headType` as the head of one of its events. */
export function isContributedWidgetEventHeadType(headType: string): boolean {
    if (!contributedHeadTypes) {
        const types = new Set<string>();
        for (const declared of listContributedWidgets()) {
            for (const eventDef of declared.logicApi?.events ?? []) {
                for (const head of eventDef.headNodeTypes ?? []) {
                    types.add(head);
                }
            }
        }
        contributedHeadTypes = types;
    }
    return contributedHeadTypes.has(headType);
}
