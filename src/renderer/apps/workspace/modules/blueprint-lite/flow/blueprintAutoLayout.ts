/**
 * "Format graph": lay a blueprint out the way it is meant to be read.
 *
 * A blueprint has two kinds of wire and they ask for different things. An execution wire is the
 * order things happen in, so a chain of them reads best as one straight line, left to right. A data
 * wire carries a value into one pin of one card, so it reads best short, arriving from just before
 * and below that pin. A layout that sees cards as points joined by edges - which is what this module
 * was before it knew about pins - can give neither: it does not know which pin a wire leaves,
 * whether that is the execution pin or the third data input, or in which order a card's inputs come,
 * so it crossed wires that never had to cross. Everything here starts from the pins instead.
 *
 * The layout, in the order it is built:
 *
 *  1. **Rows.** A depth-first walk along the execution wires, each card's outputs taken top to
 *     bottom. The first output a card continues through stays on the card's row; every later one -
 *     an If's False, a Switch's later cases, a dialog's second button - starts a row of its own,
 *     below everything the first one led to, beginning just right of the card it leaves. So a branch
 *     reads top to bottom as true then false, the way every node editor draws one, and its wire runs
 *     down a clear corridor beside the true side and turns right. Every card in a row is placed so
 *     its execution pin sits on the row's line, which is what makes the row's wires straight.
 *  2. **Feeders.** A card that only computes a value (it has no execution pins) belongs to the input
 *     it feeds and is drawn just before and below that input. A card's feeders are stacked in the
 *     order of the card's own input pins, so no two wires into one card cross; a feeder's own feeders
 *     extend leftwards from it the same way, the first of them level with the pin it feeds, so a
 *     chain of data cards is one straight lane. A value that feeds several inputs - only a literal,
 *     an Element and a few others may - is drawn as a feeder of the first of them and wired forwards
 *     to the rest.
 *  3. **Across.** Every execution card is as far left as its constraints allow: after the card
 *     before it in its row with room between them for its feeders, after every card it takes a wire
 *     from, and - where its row branched just before it - far enough right to leave the branch's wire
 *     its corridor.
 *  4. **Down.** Rows are dropped into place one at a time, each as high as it can go without
 *     touching anything placed before it, the execution wire of the row above included. How far a
 *     branch's wire drops does not matter; that it crosses nothing and runs under no card does.
 *  5. **Choices.** Two things the rules above leave open are settled by trying them. A branch can
 *     also sit directly under the card it leaves, with the rest of that card's row pushed right past
 *     it - but only where that strictly lowers what there is to untangle, counted on the curves the
 *     canvas actually draws: crossings and wires hidden under a card. As good is not good enough;
 *     the true-then-false reading wins every tie. And a value shared by several inputs can be drawn
 *     beside any of them; there, between arrangements that untangle equally well, the shorter wiring
 *     is kept. A feeder that a wire from elsewhere runs through is lowered below that wire, which
 *     turns a hidden wire into a visible crossing.
 *  6. **Pieces, notes and frames.** Disconnected pieces are laid out one by one and stacked down the
 *     page in the order the author had them. A note (a comment card) goes above the piece it was
 *     written over. A frame (a comment in frame mode) holds the same cards afterwards as before:
 *     cards that do not share a frame are kept the frame's padding further apart, so the frame can be
 *     re-fitted around its members without taking anything else in.
 *
 * Cycles are expected - a loop body wiring back into its own head - and the wire that closes one is
 * left out of the placement. It still draws, backwards; nothing else does.
 *
 * A vertical layout is the same layout with the page turned: transpose the cards, run all of the
 * above, transpose the answer back. There is one layout here, and only one of them can have a bug.
 *
 * Deliberately no dependency, and pure: cards, pins and wires in, positions out. The canvas hands
 * it the cards as they measured, the blueprint command line hands it cards sized from their
 * definitions, and both get the same layout.
 *
 * Comments in English per project convention.
 */

import { BLUEPRINT_GROUP_FRAME_PADDING, refitBlueprintGroupFrames } from "./blueprintGroupFrame";

/** An input sits on a card's left edge, an output on its right. */
export type BlueprintLayoutPinSide = "in" | "out";

/** Execution pins order what happens; data pins carry values. */
export type BlueprintLayoutPinKind = "exec" | "data";

export type BlueprintLayoutPin = {
    id: string;
    side: BlueprintLayoutPinSide;
    kind: BlueprintLayoutPinKind;
    /** Distance from the card's top edge to the pin's centre. */
    offset: number;
};

/** A card as the layout sees it: identity, where it is now, how big it is and where its pins are. */
export type BlueprintLayoutCard = {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    pins: readonly BlueprintLayoutPin[];
};

/** One wire, from an output pin to an input pin. */
export type BlueprintLayoutWire = {
    from: string;
    fromPin: string;
    to: string;
    toPin: string;
};

/** A comment card: a note, or - with `frame` - a frame drawn around other cards. */
export type BlueprintLayoutComment = {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    frame: boolean;
    /**
     * The cards and frames a frame holds, when the caller has already decided - the canvas asks the
     * same containment test it uses for dragging groups. Left out, a member is whatever the frame
     * fully contains as given.
     */
    members?: readonly string[];
};

export type BlueprintLayoutGraph = {
    cards: readonly BlueprintLayoutCard[];
    wires: readonly BlueprintLayoutWire[];
    comments?: readonly BlueprintLayoutComment[];
};

export type BlueprintLayoutRect = { x: number; y: number; width: number; height: number };

export type BlueprintLayoutResult = {
    /** The new top-left corner of every card and every note. */
    positions: Record<string, { x: number; y: number }>;
    /** Every frame that holds anything, re-fitted around where its members landed. */
    frames: Record<string, BlueprintLayoutRect>;
};

/**
 * Which way the rows run: `horizontal` left to right, the way pins are drawn and the way a blueprint
 * is normally read; `vertical` down the page, for an author who would rather scroll a long chain.
 */
export type BlueprintLayoutDirection = "horizontal" | "vertical";

export type BlueprintLayoutOptions = {
    direction?: BlueprintLayoutDirection;
    /** Room between two execution cards with nothing between them. */
    execGap?: number;
    /** Room between a data card and the card it feeds. */
    dataGap?: number;
    /** Room between two things stacked one above the other inside a piece. */
    rowGap?: number;
    /** Room between two disconnected pieces. */
    islandGap?: number;
    /** How far below a row's execution wire anything else may start. */
    clearance?: number;
};

type Settings = Required<Omit<BlueprintLayoutOptions, "direction">> & {
    /** The room a frame keeps around its members - the one "Fit to contents" leaves, so they agree. */
    framePadding: typeof BLUEPRINT_GROUP_FRAME_PADDING;
};

const DEFAULTS: Settings = {
    execGap: 90,
    dataGap: 60,
    rowGap: 40,
    islandGap: 90,
    clearance: 30,
    framePadding: BLUEPRINT_GROUP_FRAME_PADDING,
};

/** Half a unit of slack, so a card resting exactly on a frame's edge counts as inside it. */
const CONTAINMENT_EPSILON = 0.5;

/** How often the branch choices are revisited before the layout settles for what it has. */
const MAX_CHOICE_ROUNDS = 3;

/**
 * What a unit of wire costs against a crossing (1000): enough to choose between arrangements that
 * untangle equally well, never enough to buy a crossing back.
 */
const LENGTH_WEIGHT = 0.1;

/** How often feeder trees are lowered out from under wires before the placement is taken as it is. */
const MAX_REPAIR_PASSES = 3;

/** Points each wire is sampled at when wires are counted against each other. */
const WIRE_SAMPLES = 24;

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Arrange a graph: each card's and each note's new top-left corner, and each frame's new rectangle.
 *
 * Anchored at the top-left of what the graph already occupied, so formatting moves the cards
 * without moving the graph out from under the viewport.
 */
export function layoutBlueprintGraph(
    graph: BlueprintLayoutGraph,
    options: BlueprintLayoutOptions = {},
): BlueprintLayoutResult {
    if (options.direction === "vertical") {
        // Turn the page, lay the graph out the only way this file knows how, and turn it back.
        const turned = layoutBlueprintGraph(transposeGraph(graph), { ...options, direction: "horizontal" });
        const positions: BlueprintLayoutResult["positions"] = {};
        for (const [id, point] of Object.entries(turned.positions)) {
            positions[id] = { x: point.y, y: point.x };
        }
        const frames: BlueprintLayoutResult["frames"] = {};
        for (const [id, rect] of Object.entries(turned.frames)) {
            frames[id] = { x: rect.y, y: rect.x, width: rect.height, height: rect.width };
        }
        return { positions, frames };
    }

    const settings: Settings = { ...DEFAULTS, ...definedOnly(options) };
    const comments = graph.comments ?? [];
    if (graph.cards.length === 0) {
        return { positions: {}, frames: {} };
    }

    const frameComments = comments.filter(comment => comment.frame);
    const notes = comments.filter(comment => !comment.frame).sort(readingOrder);
    const membership = frameMembership(graph.cards, frameComments);
    const cards = prepareCards(graph.cards, membership.framesOfCard);
    const wires = prepareWires(graph.wires, cards);
    const islands = findIslands(cards, wires, membership.cardsOfFrame);
    const notesByIsland = assignNotes(notes, islands, cards);

    const originX = Math.min(...graph.cards.map(card => card.x), ...comments.map(comment => comment.x));
    const originY = Math.min(...graph.cards.map(card => card.y), ...comments.map(comment => comment.y));

    const positions: BlueprintLayoutResult["positions"] = {};
    let cursorY = originY;
    islands.forEach((island, index) => {
        for (const note of notesByIsland[index] ?? []) {
            positions[note.id] = { x: Math.round(originX), y: Math.round(cursorY) };
            cursorY += note.height + settings.rowGap;
        }
        const local = layoutIsland(island, cards, wires, settings);
        for (const [id, point] of local.positions) {
            positions[id] = { x: Math.round(originX + point.x), y: Math.round(cursorY + point.y) };
        }
        cursorY += local.height + settings.islandGap;
    });
    // A note that sat over nothing keeps its place.
    for (const note of notesByIsland[islands.length] ?? []) {
        positions[note.id] = { x: note.x, y: note.y };
    }

    return { positions, frames: refitFrames(frameComments, membership, positions, graph.cards) };
}

// ---------------------------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------------------------

export type BlueprintLayoutMeasure = {
    /** Places where two wires' drawn curves cross. */
    crossings: number;
    /** Wires whose input end lies left of their output end. */
    backwards: number;
    /** Wires drawn through a card that is neither of their ends, counted per card. */
    throughCards: number;
    /** Pairs of cards that overlap. */
    overlaps: number;
};

/**
 * What a reader of a laid-out graph has to untangle, counted on the wires as the canvas draws them:
 * a cubic curve that leaves its output horizontally and enters its input horizontally. Two wires that
 * leave the same output, or enter the same input, are one stroke at that end and are not compared.
 */
export function measureBlueprintLayout(
    graph: BlueprintLayoutGraph,
    positions: Readonly<Record<string, { x: number; y: number }>>,
): BlueprintLayoutMeasure {
    const rects = new Map<string, Rect>();
    for (const card of graph.cards) {
        const point = positions[card.id] ?? card;
        rects.set(card.id, { x: point.x, y: point.y, w: card.width, h: card.height });
    }
    const cards = prepareCards(graph.cards, new Map());
    const wires = prepareWires(graph.wires, cards);
    return countDefects(wires, rects);
}

// ---------------------------------------------------------------------------------------------
// Preparation
// ---------------------------------------------------------------------------------------------

type Rect = { x: number; y: number; w: number; h: number };

type Pin = { id: string; side: BlueprintLayoutPinSide; kind: BlueprintLayoutPinKind; offset: number };

type Card = {
    id: string;
    w: number;
    h: number;
    /** Where the author had it. */
    original: Rect;
    /** Its place in reading order, which every decision that has to be stable falls back on. */
    rank: number;
    /** Top to bottom. */
    pins: Pin[];
    /** Whether it takes part in execution at all. A card that does not is a data card. */
    exec: boolean;
    /** Where on the card its row's line passes: its execution input, else its first execution output. */
    line: number;
    /** Every frame holding it, nested ones included. */
    frames: readonly string[];
};

type Wire = {
    from: string;
    fromPin: string;
    fromOffset: number;
    to: string;
    toPin: string;
    toOffset: number;
    kind: BlueprintLayoutPinKind;
};

function definedOnly<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Reading order: down the page, then across, then by id so equal positions never swap between runs. */
function readingOrder(a: { x: number; y: number; id: string }, b: { x: number; y: number; id: string }): number {
    if (a.y !== b.y) {
        return a.y - b.y;
    }
    if (a.x !== b.x) {
        return a.x - b.x;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function prepareCards(
    given: readonly BlueprintLayoutCard[],
    framesOfCard: ReadonlyMap<string, readonly string[]>,
): Map<string, Card> {
    const cards = new Map<string, Card>();
    [...given].sort(readingOrder).forEach((card, rank) => {
        const pins = [...card.pins].sort((a, b) => a.offset - b.offset);
        const execIn = pins.find(pin => pin.kind === "exec" && pin.side === "in");
        const execOut = pins.find(pin => pin.kind === "exec" && pin.side === "out");
        const anchor = execIn ?? execOut ?? pins.find(pin => pin.side === "out") ?? pins[0];
        cards.set(card.id, {
            id: card.id,
            w: card.width,
            h: card.height,
            original: { x: card.x, y: card.y, w: card.width, h: card.height },
            rank,
            pins,
            exec: Boolean(execIn ?? execOut),
            line: anchor?.offset ?? card.height / 2,
            frames: framesOfCard.get(card.id) ?? [],
        });
    });
    return cards;
}

/** Drop self-loops, duplicates and wires naming a card that is not being laid out. */
function prepareWires(raw: readonly BlueprintLayoutWire[], cards: ReadonlyMap<string, Card>): Wire[] {
    const seen = new Set<string>();
    const out: Wire[] = [];
    for (const wire of raw) {
        const from = cards.get(wire.from);
        const to = cards.get(wire.to);
        if (!from || !to || wire.from === wire.to) {
            continue;
        }
        const key = `${wire.from}\u0000${wire.fromPin}\u0000${wire.to}\u0000${wire.toPin}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const fromPin = from.pins.find(pin => pin.id === wire.fromPin && pin.side === "out");
        const toPin = to.pins.find(pin => pin.id === wire.toPin && pin.side === "in");
        out.push({
            from: wire.from,
            fromPin: wire.fromPin,
            fromOffset: fromPin?.offset ?? from.h / 2,
            to: wire.to,
            toPin: wire.toPin,
            toOffset: toPin?.offset ?? to.h / 2,
            kind: fromPin?.kind === "exec" || toPin?.kind === "exec" ? "exec" : "data",
        });
    }
    return out;
}

type Membership = {
    framesOfCard: Map<string, string[]>;
    cardsOfFrame: Map<string, string[]>;
    /** Frames inside each frame, so nested frames are re-fitted before the frames around them. */
    framesOfFrame: Map<string, string[]>;
};

function contains(
    frame: { x: number; y: number; width: number; height: number },
    box: { x: number; y: number; width: number; height: number },
): boolean {
    return (
        box.x >= frame.x - CONTAINMENT_EPSILON &&
        box.y >= frame.y - CONTAINMENT_EPSILON &&
        box.x + box.width <= frame.x + frame.width + CONTAINMENT_EPSILON &&
        box.y + box.height <= frame.y + frame.height + CONTAINMENT_EPSILON
    );
}

/** What each frame holds before anything moves - the membership formatting has to keep. */
function frameMembership(
    cards: readonly BlueprintLayoutCard[],
    frames: readonly BlueprintLayoutComment[],
): Membership {
    const framesOfCard = new Map<string, string[]>();
    const cardsOfFrame = new Map<string, string[]>();
    const framesOfFrame = new Map<string, string[]>();
    for (const frame of frames) {
        const given = frame.members ? new Set(frame.members) : null;
        const held = cards.filter(card => (given ? given.has(card.id) : contains(frame, card))).map(card => card.id);
        cardsOfFrame.set(frame.id, held);
        for (const id of held) {
            const list = framesOfCard.get(id) ?? [];
            list.push(frame.id);
            framesOfCard.set(id, list);
        }
        framesOfFrame.set(
            frame.id,
            frames
                .filter(other => other.id !== frame.id && (given ? given.has(other.id) : contains(frame, other)))
                .map(other => other.id),
        );
    }
    return { framesOfCard, cardsOfFrame, framesOfFrame };
}

/**
 * Islands, each in reading order, ordered by their first card - so the piece that was at the top is
 * still at the top. Cards that share a frame are one island whether or not a wire joins them, so a
 * frame is never split between two pieces.
 */
function findIslands(
    cards: ReadonlyMap<string, Card>,
    wires: readonly Wire[],
    cardsOfFrame: ReadonlyMap<string, readonly string[]>,
): string[][] {
    const parent = new Map<string, string>();
    for (const id of cards.keys()) {
        parent.set(id, id);
    }
    const find = (id: string): string => {
        let root = id;
        while (parent.get(root) !== root) {
            root = parent.get(root)!;
        }
        parent.set(id, root);
        return root;
    };
    const union = (a: string, b: string) => {
        const ra = find(a);
        const rb = find(b);
        if (ra === rb) {
            return;
        }
        if (cards.get(ra)!.rank < cards.get(rb)!.rank) {
            parent.set(rb, ra);
        } else {
            parent.set(ra, rb);
        }
    };
    for (const wire of wires) {
        union(wire.from, wire.to);
    }
    for (const members of cardsOfFrame.values()) {
        for (let i = 1; i < members.length; i += 1) {
            union(members[0]!, members[i]!);
        }
    }
    const groups = new Map<string, string[]>();
    for (const card of [...cards.values()].sort((a, b) => a.rank - b.rank)) {
        const root = find(card.id);
        const list = groups.get(root) ?? [];
        list.push(card.id);
        groups.set(root, list);
    }
    return [...groups.values()].sort((a, b) => cards.get(a[0]!)!.rank - cards.get(b[0]!)!.rank);
}

/**
 * The piece each note was written over: the nearest island below it, or failing that the nearest at
 * all. The extra last slot holds notes with no island to go with, which stay where they are.
 */
function assignNotes(
    notes: readonly BlueprintLayoutComment[],
    islands: readonly string[][],
    cards: ReadonlyMap<string, Card>,
): BlueprintLayoutComment[][] {
    const out: BlueprintLayoutComment[][] = islands.map(() => []);
    out.push([]);
    if (islands.length === 0) {
        out[0]!.push(...notes);
        return out;
    }
    const bounds = islands.map(ids => boundsOf(ids.map(id => cards.get(id)!.original)));
    for (const note of notes) {
        let best = 0;
        let bestScore = Number.POSITIVE_INFINITY;
        bounds.forEach((box, index) => {
            const dx = Math.max(0, box.x - (note.x + note.width), note.x - (box.x + box.w));
            const gapBelow = box.y - (note.y + note.height);
            // A note is written above what it describes, so an island above the note is a worse
            // match than any island below it within reason.
            const dy = gapBelow >= -note.height / 2 ? Math.max(0, gapBelow) : 2000 + (note.y - (box.y + box.h));
            const score = dx + dy;
            if (score < bestScore) {
                bestScore = score;
                best = index;
            }
        });
        out[best]!.push(note);
    }
    return out;
}

function boundsOf(rects: readonly Rect[]): Rect {
    const x0 = Math.min(...rects.map(r => r.x));
    const y0 = Math.min(...rects.map(r => r.y));
    const x1 = Math.max(...rects.map(r => r.x + r.w));
    const y1 = Math.max(...rects.map(r => r.y + r.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function transposeGraph(graph: BlueprintLayoutGraph): BlueprintLayoutGraph {
    return {
        cards: graph.cards.map(card => ({
            id: card.id,
            x: card.y,
            y: card.x,
            width: card.height,
            height: card.width,
            // Pins stay on a card's sides however the page is turned, so across the turned card they
            // keep only their order, spread over its new height.
            pins: card.pins.map(pin => ({ ...pin, offset: (pin.offset / Math.max(1, card.height)) * card.width })),
        })),
        wires: graph.wires,
        comments: graph.comments?.map(comment => ({
            ...comment,
            x: comment.y,
            y: comment.x,
            width: comment.height,
            height: comment.width,
        })),
    };
}

// ---------------------------------------------------------------------------------------------
// One island
// ---------------------------------------------------------------------------------------------

/** A row: execution cards sharing one line, or one data card nothing consumes. */
type Row = {
    cards: string[];
    /** The card this row branched from, or null for a row that starts a chain of its own. */
    from: string | null;
    /** Rows that branch off this one, wherever along it. */
    children: number[];
};

/**
 * A data card and everything it owns, laid out leftwards and kept rigid: `x` from its anchor's left
 * edge, `y` from the tree's root's top edge.
 */
type FeederTree = {
    root: string;
    /** The wire from the root into its anchor. */
    wire: Wire;
    items: { id: string; x: number; y: number }[];
    /** Extent above and below the root's top edge. */
    top: number;
    bottom: number;
    /** How far left of the anchor the tree reaches. */
    reach: number;
};

type Structure = {
    cards: ReadonlyMap<string, Card>;
    wires: readonly Wire[];
    rows: Row[];
    rowOf: Map<string, number>;
    /** Execution cards in the order the walk reached them, then data cards nothing consumes. */
    anchors: string[];
    /** The anchor each card is placed relative to: itself for an anchor, its consumer's for a feeder. */
    anchorOf: Map<string, string>;
    /** Each anchor's feeder trees, in the order of the inputs they feed. */
    trees: Map<string, FeederTree[]>;
    /** Where each card sits from its anchor's left edge. */
    relX: Map<string, number>;
    /** Room each anchor needs before it for the cards that feed it directly, gap included; 0 for none. */
    rootReach: Map<string, number>;
    /** Room each anchor's whole feeder trees take before it, gap included; 0 for none. */
    fullReach: Map<string, number>;
    /**
     * The earliest anchor of the stretch of its row, ending at this one, whose cards all sit in the
     * same frames. A feeder tree may reach left under that stretch and no further, so a frame never
     * has to grow over a card it does not hold.
     */
    runStart: Map<string, string>;
    /** Execution wires that join a card from somewhere other than the card before it in its row. */
    joins: Wire[];
    /** Cards a row branches from, in the order the walk met them. */
    branchCards: string[];
    /** The input each data card is drawn beside. */
    owner: ReadonlyMap<string, Wire>;
    /** Data wires into each card that do not come from a card it owns, top to bottom. */
    externalInputs: ReadonlyMap<string, readonly Wire[]>;
};

/**
 * Where a branch's row goes: below everything its card's first output led to (the default), or
 * directly under the card with the rest of the card's row pushed right past the branch.
 */
type Choice = "belowRow" | "underCard";

type Placement = {
    positions: Map<string, { x: number; y: number }>;
    width: number;
    height: number;
    score: number;
    /** The part of the score that counts what there is to untangle, without the wires' length. */
    defects: number;
    /** Where each feeder tree's root went, from its row's line, and where that line went. */
    treeTops: Map<string, { top: number; line: number }>;
};

function layoutIsland(
    ids: readonly string[],
    cards: ReadonlyMap<string, Card>,
    allWires: readonly Wire[],
    settings: Settings,
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
    const member = new Set(ids);
    const wires = allWires.filter(wire => member.has(wire.from) && member.has(wire.to));

    // Two kinds of decision are left open by the rules above, and both are settled by trying them:
    // whether a branch may sit directly under its card instead of below its row, and which of its
    // inputs a value that feeds several of them is drawn beside. A branch moves under its card only
    // when that strictly untangles something, and comes back as soon as it no longer does; a shared
    // value moves when the result is better at all, shorter wiring included.
    let owners = new Map<string, Wire>();
    let structure = analyseIsland(ids, cards, wires, settings, owners);
    let choices = new Map<string, Choice>(structure.branchCards.map(id => [id, "belowRow"]));
    let best = placeAndRepair(structure, choices, settings);
    const shared = sharedValues(ids, cards, wires);
    for (let round = 0; round < MAX_CHOICE_ROUNDS && best.score > 0; round += 1) {
        let improved = false;
        for (const id of structure.branchCards) {
            const trial = new Map(choices);
            const next: Choice = choices.get(id) === "underCard" ? "belowRow" : "underCard";
            trial.set(id, next);
            const candidate = placeAndRepair(structure, trial, settings);
            const better = next === "underCard" ? candidate.defects < best.defects : candidate.defects <= best.defects;
            if (better) {
                choices = trial;
                best = candidate;
                improved = true;
            }
        }
        for (const [id, consumers] of shared) {
            for (const wire of consumers) {
                if (structure.owner.get(id) === wire) {
                    continue;
                }
                const trialOwners = new Map(owners);
                trialOwners.set(id, wire);
                const trialStructure = analyseIsland(ids, cards, wires, settings, trialOwners);
                const trialChoices = new Map<string, Choice>(
                    trialStructure.branchCards.map(card => [card, choices.get(card) ?? "belowRow"]),
                );
                const candidate = placeAndRepair(trialStructure, trialChoices, settings);
                if (candidate.score < best.score) {
                    owners = trialOwners;
                    structure = trialStructure;
                    choices = trialChoices;
                    best = candidate;
                    improved = true;
                }
            }
        }
        if (!improved) {
            break;
        }
    }
    return best;
}

/**
 * Data cards whose value feeds more than one input, with the wires to each - in id order, not
 * reading order, so formatting a formatted graph tries them in the same order and settles.
 */
function sharedValues(ids: readonly string[], cards: ReadonlyMap<string, Card>, wires: readonly Wire[]): Map<string, Wire[]> {
    const out = new Map<string, Wire[]>();
    for (const id of [...ids].sort()) {
        if (cards.get(id)!.exec) {
            continue;
        }
        const consumers = wires.filter(wire => wire.from === id && wire.kind === "data");
        if (consumers.length > 1) {
            out.set(id, consumers);
        }
    }
    return out;
}

/**
 * Rows, feeders and anchors: everything about an island that does not depend on where anything goes.
 */
function analyseIsland(
    ids: readonly string[],
    cards: ReadonlyMap<string, Card>,
    wires: readonly Wire[],
    settings: Settings,
    ownerOverrides: ReadonlyMap<string, Wire>,
): Structure {
    const byRank = (a: string, b: string) => cards.get(a)!.rank - cards.get(b)!.rank;
    const execOut = new Map<string, Wire[]>();
    const execInCount = new Map<string, number>();
    const dataIn = new Map<string, Wire[]>();
    const dataOut = new Map<string, Wire[]>();
    for (const id of ids) {
        execOut.set(id, []);
        execInCount.set(id, 0);
        dataIn.set(id, []);
        dataOut.set(id, []);
    }
    for (const wire of wires) {
        if (wire.kind === "exec") {
            execOut.get(wire.from)!.push(wire);
            execInCount.set(wire.to, execInCount.get(wire.to)! + 1);
        } else {
            dataIn.get(wire.to)!.push(wire);
            dataOut.get(wire.from)!.push(wire);
        }
    }
    for (const list of execOut.values()) {
        list.sort((a, b) => a.fromOffset - b.fromOffset || byRank(a.to, b.to));
    }
    for (const list of dataIn.values()) {
        list.sort((a, b) => a.toOffset - b.toOffset || byRank(a.from, b.from));
    }

    // 1. Rows, by a depth-first walk along execution wires. Iterative, because an author's graph
    // gets long rather than wide - exactly the shape that overflows a recursive walk.
    const execIds = ids.filter(id => cards.get(id)!.exec);
    const rows: Row[] = [];
    const rowOf = new Map<string, number>();
    const order: string[] = [];
    const joins: Wire[] = [];
    const branchCards: string[] = [];
    const visited = new Set<string>();
    const onPath = new Set<string>();
    const startRow = (from: string | null, parentRow: number | null): number => {
        rows.push({ cards: [], from, children: [] });
        const index = rows.length - 1;
        if (parentRow !== null) {
            rows[parentRow]!.children.push(index);
        }
        return index;
    };
    const roots = [
        ...execIds.filter(id => execInCount.get(id) === 0),
        // A cycle with no way in is entered at the card the author put first.
        ...execIds,
    ];
    for (const root of roots) {
        if (visited.has(root)) {
            continue;
        }
        const stack: { id: string; row: number; next: number; continued: boolean }[] = [];
        const enter = (id: string, row: number) => {
            visited.add(id);
            onPath.add(id);
            rows[row]!.cards.push(id);
            rowOf.set(id, row);
            order.push(id);
            stack.push({ id, row, next: 0, continued: false });
        };
        enter(root, startRow(null, null));
        while (stack.length > 0) {
            const frame = stack[stack.length - 1]!;
            const outs = execOut.get(frame.id)!;
            if (frame.next >= outs.length) {
                onPath.delete(frame.id);
                stack.pop();
                continue;
            }
            const wire = outs[frame.next]!;
            frame.next += 1;
            if (visited.has(wire.to)) {
                // Into a card already placed: a loop closing if that card is still being walked
                // from, otherwise a second way into it. Neither decides where anything goes; a join
                // only has to arrive from the left.
                if (!onPath.has(wire.to)) {
                    joins.push(wire);
                }
                continue;
            }
            if (!frame.continued) {
                frame.continued = true;
                enter(wire.to, frame.row);
            } else {
                if (!branchCards.includes(frame.id)) {
                    branchCards.push(frame.id);
                }
                enter(wire.to, startRow(frame.id, frame.row));
            }
        }
    }

    // 2. Data cards: each belongs to the first input it feeds, in the order the walk reached the
    // execution cards those inputs lead to.
    const walkIndex = new Map(order.map((id, index) => [id, index]));
    const dataIds = ids.filter(id => !cards.get(id)!.exec).sort(byRank);
    const owner = new Map<string, Wire>();
    const keyOf = new Map<string, number>();
    const resolving = new Set<string>();
    const keyFor = (id: string): number => {
        if (cards.get(id)!.exec) {
            return walkIndex.get(id) ?? Number.MAX_SAFE_INTEGER;
        }
        const known = keyOf.get(id);
        if (known !== undefined) {
            return known;
        }
        if (resolving.has(id)) {
            return Number.MAX_SAFE_INTEGER;
        }
        resolving.add(id);
        let bestWire: Wire | null = null;
        let bestKey = Number.MAX_SAFE_INTEGER;
        for (const wire of dataOut.get(id)!) {
            const key = keyFor(wire.to);
            if (key < bestKey) {
                bestKey = key;
                bestWire = wire;
            }
        }
        const chosen = ownerOverrides.get(id);
        if (chosen) {
            const key = keyFor(chosen.to);
            if (key < Number.MAX_SAFE_INTEGER) {
                bestKey = key;
                bestWire = chosen;
            }
        }
        resolving.delete(id);
        const key = bestWire && bestKey < Number.MAX_SAFE_INTEGER
            // A shade after its consumer, so two feeders of one card keep their consumer's order.
            ? bestKey + 1e-6 * (1 + bestWire.toOffset)
            : Number.MAX_SAFE_INTEGER;
        if (bestWire && key < Number.MAX_SAFE_INTEGER) {
            owner.set(id, bestWire);
        }
        keyOf.set(id, key);
        return key;
    };
    for (const id of dataIds) {
        keyFor(id);
    }
    // A data card whose values lead to no execution card - a piece made only of data cards, or a
    // value nothing reads - hangs off the next data card along, and the last of them is an anchor.
    const dataAnchors: string[] = [];
    for (const id of dataIds) {
        if (owner.has(id)) {
            continue;
        }
        const into = dataOut.get(id)!.find(wire => !cards.get(wire.to)!.exec && wouldNotLoop(id, wire.to, owner));
        if (into) {
            owner.set(id, into);
        } else {
            dataAnchors.push(id);
        }
    }
    const ownedInputs = (id: string): Wire[] => dataIn.get(id)!.filter(wire => owner.get(wire.from) === wire);
    const foreignInputs = (id: string): Wire[] => dataIn.get(id)!.filter(wire => owner.get(wire.from) !== wire);

    // 3. Feeder trees, each laid out once relative to its anchor.
    const anchors = [...order, ...dataAnchors];
    const anchorOf = new Map<string, string>();
    const trees = new Map<string, FeederTree[]>();
    const relX = new Map<string, number>();
    const rootReach = new Map<string, number>();
    const fullReach = new Map<string, number>();
    for (const anchor of anchors) {
        anchorOf.set(anchor, anchor);
        relX.set(anchor, 0);
        const list: FeederTree[] = [];
        let rootLeft = 0;
        let fullLeft = 0;
        for (const wire of ownedInputs(anchor)) {
            const tree = layoutFeederTree(wire.from, cards, ownedInputs, foreignInputs, settings);
            const left = -settings.dataGap - cards.get(wire.from)!.w;
            const items = tree.items.map(item => ({ id: item.id, x: left + item.x, y: item.y }));
            for (const item of items) {
                anchorOf.set(item.id, anchor);
                relX.set(item.id, item.x);
            }
            const reach = -Math.min(...items.map(item => item.x));
            list.push({ root: wire.from, wire, items, top: tree.top, bottom: tree.bottom, reach });
            rootLeft = Math.min(rootLeft, left);
            fullLeft = Math.min(fullLeft, -reach);
        }
        trees.set(anchor, list);
        rootReach.set(anchor, rootLeft < 0 ? -rootLeft : 0);
        fullReach.set(anchor, fullLeft < 0 ? -fullLeft : 0);
    }

    // Data anchors get a row each, after every execution row.
    for (const id of dataAnchors) {
        rows.push({ cards: [id], from: null, children: [] });
        rowOf.set(id, rows.length - 1);
    }

    // The stretch of each row, ending at each anchor, whose cards share the same frames.
    const runStart = new Map<string, string>();
    const sameFrames = (a: string, b: string) => {
        const fa = cards.get(a)!.frames;
        const fb = cards.get(b)!.frames;
        return fa.length === fb.length && fa.every(frame => fb.includes(frame));
    };
    for (const row of rows) {
        let start = row.cards[0]!;
        for (let i = 0; i < row.cards.length; i += 1) {
            const id = row.cards[i]!;
            if (i > 0 && !sameFrames(row.cards[i - 1]!, id)) {
                start = id;
            }
            runStart.set(id, start);
        }
    }

    const externalInputs = new Map<string, Wire[]>();
    for (const id of ids) {
        externalInputs.set(id, dataIn.get(id)!.filter(wire => owner.get(wire.from) !== wire));
    }

    return {
        cards,
        wires,
        rows,
        rowOf,
        anchors,
        anchorOf,
        trees,
        relX,
        rootReach,
        fullReach,
        runStart,
        joins,
        branchCards,
        owner,
        externalInputs,
    };
}

function wouldNotLoop(id: string, target: string, owner: ReadonlyMap<string, Wire>): boolean {
    let walk: string | undefined = target;
    const seen = new Set<string>();
    while (walk !== undefined && !seen.has(walk)) {
        if (walk === id) {
            return false;
        }
        seen.add(walk);
        walk = owner.get(walk)?.to;
    }
    return true;
}

/**
 * A data card and everything it owns, laid out leftwards: the card at the origin, each owned input's
 * tree to its left in pin order, the first level with its pin and each next one below the last.
 */
function layoutFeederTree(
    root: string,
    cards: ReadonlyMap<string, Card>,
    ownedInputs: (id: string) => Wire[],
    foreignInputs: (id: string) => Wire[],
    settings: Settings,
): { items: { id: string; x: number; y: number }[]; top: number; bottom: number } {
    const card = cards.get(root)!;
    const items = [{ id: root, x: 0, y: 0 }];
    let top = 0;
    let bottom = card.h;
    let cursor = Number.NEGATIVE_INFINITY;
    const foreign = foreignInputs(root);
    for (const wire of ownedInputs(root)) {
        const tree = layoutFeederTree(wire.from, cards, ownedInputs, foreignInputs, settings);
        const levelTop = wire.toOffset - wire.fromOffset;
        // A wire from elsewhere into a lower pin has to pass this tree to get there; with the tree
        // below that pin it crosses one wire instead of running through the tree's cards.
        const later = foreign.filter(other => other.toOffset > wire.toOffset);
        const clear = later.length > 0
            ? Math.max(...later.map(other => other.toOffset)) + settings.clearance - tree.top
            : Number.NEGATIVE_INFINITY;
        const y = Math.max(levelTop, cursor - tree.top, clear);
        const x = -settings.dataGap - cards.get(wire.from)!.w;
        for (const item of tree.items) {
            items.push({ id: item.id, x: x + item.x, y: y + item.y });
        }
        top = Math.min(top, y + tree.top);
        bottom = Math.max(bottom, y + tree.bottom);
        cursor = y + tree.bottom + settings.rowGap;
    }
    return { items, top, bottom };
}

// ---------------------------------------------------------------------------------------------
// Placing an island for one set of choices
// ---------------------------------------------------------------------------------------------

/** Frame padding owed between two cards: every frame holding one of them and not the other. */
function framePadding(
    a: readonly string[],
    b: readonly string[],
    sideOfA: "right" | "bottom",
    sideOfB: "left" | "top",
    settings: Settings,
): number {
    let total = 0;
    for (const frame of a) {
        if (!b.includes(frame)) {
            total += settings.framePadding[sideOfA];
        }
    }
    for (const frame of b) {
        if (!a.includes(frame)) {
            total += settings.framePadding[sideOfB];
        }
    }
    return total;
}

type Constraint = { from: string; to: string; delta: number };

type Obstacle = Rect & { frames: readonly string[]; wire: boolean };

function place(
    structure: Structure,
    choices: ReadonlyMap<string, Choice>,
    settings: Settings,
    lowestTop: ReadonlyMap<string, number> = new Map(),
): Placement {
    const { cards, rows, anchors, anchorOf, trees, relX } = structure;
    const card = (id: string) => cards.get(id)!;
    // How far before an anchor its row has to leave room: its whole feeder trees when it opens a
    // stretch of its row, only the cards feeding it directly when the rest of the trees can reach
    // back under the cards before it.
    const gapReach = (id: string) =>
        structure.runStart.get(id) === id ? structure.fullReach.get(id)! : structure.rootReach.get(id)!;

    // --- Across: the furthest left each anchor may go.
    const constraints: Constraint[] = [];
    const gapBefore = (id: string, after: string) =>
        (gapReach(id) > 0 ? gapReach(id) + settings.dataGap : settings.execGap) +
        framePadding(card(after).frames, card(id).frames, "right", "left", settings);
    for (const row of rows) {
        for (let i = 1; i < row.cards.length; i += 1) {
            const prev = row.cards[i - 1]!;
            const id = row.cards[i]!;
            constraints.push({ from: prev, to: id, delta: card(prev).w + gapBefore(id, prev) });
            // The rest of the trees reach back no further than the stretch of the row they share
            // frames with.
            const start = structure.runStart.get(id)!;
            if (start !== id) {
                constraints.push({
                    from: start,
                    to: id,
                    delta: structure.fullReach.get(id)! - gapReach(start),
                });
            }
        }
        if (row.from !== null) {
            const first = row.cards[0]!;
            if (choices.get(row.from) === "underCard") {
                constraints.push({ from: row.from, to: first, delta: card(row.from).w + gapBefore(first, row.from) });
            } else {
                // Below the row, the card it branches from is out of the way: the branch starts a
                // wire's gap right of that card, and its first card's feeders reach back under it -
                // no further left than its left edge.
                constraints.push({
                    from: row.from,
                    to: first,
                    delta: card(row.from).w + settings.execGap +
                        framePadding(card(row.from).frames, card(first).frames, "right", "left", settings),
                });
                constraints.push({ from: row.from, to: first, delta: gapReach(first) });
            }
        }
    }
    for (const wire of structure.joins) {
        constraints.push({
            from: wire.from,
            to: wire.to,
            delta: card(wire.from).w + settings.execGap + gapReach(wire.to),
        });
    }
    // Every data wire runs forwards: its input end after its output end.
    for (const wire of structure.wires) {
        if (wire.kind !== "data") {
            continue;
        }
        const a = anchorOf.get(wire.from)!;
        const b = anchorOf.get(wire.to)!;
        if (a === b) {
            continue;
        }
        constraints.push({
            from: a,
            to: b,
            delta: relX.get(wire.from)! + card(wire.from).w + settings.dataGap - relX.get(wire.to)!,
        });
    }
    // Branches: below the row, the rest of the row leaves the branch's wire a corridor to drop
    // through - clear of its cards, and of the frames around them; directly under the card, the
    // rest of the row passes the whole branch.
    for (const branchCard of structure.branchCards) {
        const row = rows[structure.rowOf.get(branchCard)!]!;
        const next = row.cards[row.cards.indexOf(branchCard) + 1];
        if (next === undefined) {
            continue;
        }
        const branchRows = row.children.filter(index => rows[index]!.from === branchCard);
        if (choices.get(branchCard) === "underCard") {
            for (const id of anchorsUnder(rows, branchRows)) {
                constraints.push({
                    from: id,
                    to: next,
                    delta: card(id).w + settings.execGap + gapReach(next) +
                        framePadding(card(id).frames, card(next).frames, "right", "left", settings),
                });
            }
        } else {
            const first = rows[branchRows[0]!]!.cards[0]!;
            constraints.push({
                from: first,
                to: next,
                delta: gapReach(next) +
                    settings.framePadding.left *
                        card(next).frames.filter(frame => !card(branchCard).frames.includes(frame)).length,
            });
        }
    }
    const x = longestPaths(anchors, constraints);

    // --- Down: each row's feeders settle under it, then the row drops as high as it goes.
    const placed: Obstacle[] = [];
    const lineOfRow = new Map<number, number>();
    const treeTopOf = new Map<string, number>();
    const treeRowOf = new Map<string, number>();
    const positions = new Map<string, { x: number; y: number }>();
    let floor = Number.NEGATIVE_INFINITY;
    const margin = settings.rowGap / 2;
    const overlapsAcross = (a: Rect, b: Rect) => a.x < b.x + b.w + margin && b.x < a.x + a.w + margin;
    /** How far `item` has to move down to clear `other`, which is above it. */
    const clearanceBelow = (item: Rect & { frames: readonly string[] }, other: Obstacle) =>
        other.y + other.h +
        (other.wire ? settings.clearance : settings.rowGap) +
        framePadding(other.frames, item.frames, "bottom", "top", settings) -
        item.y;

    rows.forEach((row, rowIndex) => {
        // The row in its own frame of reference: its line at 0.
        const local: (Obstacle & { id: string | null })[] = [];
        for (let i = 0; i < row.cards.length; i += 1) {
            const id = row.cards[i]!;
            local.push({ id, x: x.get(id)!, y: -card(id).line, w: card(id).w, h: card(id).h, frames: card(id).frames, wire: false });
            if (i > 0) {
                const prev = row.cards[i - 1]!;
                local.push({
                    id: null,
                    x: x.get(prev)! + card(prev).w,
                    y: 0,
                    w: x.get(id)! - x.get(prev)! - card(prev).w,
                    h: 0,
                    frames: card(prev).frames.filter(frame => card(id).frames.includes(frame)),
                    wire: true,
                });
            }
        }
        for (const anchor of row.cards) {
            const isExec = card(anchor).exec;
            // The first tree starts below the row's wire; each next one below the last one's root,
            // so the wires into the anchor keep the order of its pins.
            let cursor = isExec ? settings.clearance : Number.NEGATIVE_INFINITY;
            for (const tree of trees.get(anchor)!) {
                const levelTop = tree.wire.toOffset - card(anchor).line - tree.wire.fromOffset;
                let top = Math.max(levelTop, cursor - tree.top);
                // As inside a tree: a wire from elsewhere into a lower pin passes above this tree.
                const later = structure.externalInputs.get(anchor)!.filter(wire => wire.toOffset > tree.wire.toOffset);
                if (later.length > 0) {
                    const lowest = Math.max(...later.map(wire => wire.toOffset)) - card(anchor).line;
                    top = Math.max(top, lowest + settings.clearance - tree.top);
                }
                top = Math.max(top, lowestTop.get(tree.root) ?? Number.NEGATIVE_INFINITY);
                const rects = tree.items.map(item => ({
                    x: x.get(anchor)! + item.x,
                    dy: item.y,
                    w: card(item.id).w,
                    h: card(item.id).h,
                    frames: card(item.id).frames,
                }));
                // Clear whatever of the row is already there - cards before the anchor that the
                // tree reaches back under, their trees, and the row's wire.
                for (let settled = false, guard = 0; !settled && guard < 50; guard += 1) {
                    settled = true;
                    for (const rect of rects) {
                        const at = { x: rect.x, y: top + rect.dy, w: rect.w, h: rect.h, frames: rect.frames };
                        for (const other of local) {
                            if (other.id === anchor || !overlapsAcross(at, other) || other.y >= at.y + at.h + settings.rowGap) {
                                continue;
                            }
                            const push = clearanceBelow(at, other);
                            if (push > 0) {
                                top += push;
                                settled = false;
                            }
                        }
                    }
                }
                for (const item of tree.items) {
                    local.push({
                        id: item.id,
                        x: x.get(anchor)! + item.x,
                        y: top + item.y,
                        w: card(item.id).w,
                        h: card(item.id).h,
                        frames: card(item.id).frames,
                        wire: false,
                    });
                }
                cursor = top + card(tree.root).h + settings.rowGap;
                treeTopOf.set(tree.root, top);
                treeRowOf.set(tree.root, rowIndex);
            }
        }

        // Drop the row: as high as it can go below what is already placed, and never above the
        // row it branched from.
        let line = rowIndex === 0 ? 0 : Number.NEGATIVE_INFINITY;
        if (row.from === null && rowIndex > 0) {
            // A chain of its own starts below everything, as the author's separate chains read.
            line = floor + settings.islandGap - Math.min(...local.map(item => item.y));
        } else if (row.from !== null) {
            line = lineOfRow.get(structure.rowOf.get(row.from)!)!;
        }
        for (const item of local) {
            if (item.wire) {
                continue;
            }
            for (const other of placed) {
                if (overlapsAcross(item, other)) {
                    line = Math.max(line, line + clearanceBelow({ ...item, y: line + item.y }, other));
                }
            }
        }
        if (!Number.isFinite(line)) {
            line = 0;
        }
        lineOfRow.set(rowIndex, line);
        for (const item of local) {
            const rect = { ...item, y: line + item.y };
            placed.push(rect);
            if (item.id !== null) {
                positions.set(item.id, { x: rect.x, y: rect.y });
                floor = Math.max(floor, rect.y + rect.h);
            }
        }
    });

    // --- Normalise to the island's own top-left, frame padding included.
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const pad = settings.framePadding;
    for (const [id, point] of positions) {
        const c = card(id);
        const depth = c.frames.length;
        minX = Math.min(minX, point.x - depth * pad.left);
        minY = Math.min(minY, point.y - depth * pad.top);
        maxX = Math.max(maxX, point.x + c.w + depth * pad.right);
        maxY = Math.max(maxY, point.y + c.h + depth * pad.bottom);
    }
    const shifted = new Map<string, { x: number; y: number }>();
    const rects = new Map<string, Rect>();
    for (const [id, point] of positions) {
        const next = { x: point.x - minX, y: point.y - minY };
        shifted.set(id, next);
        rects.set(id, { x: next.x, y: next.y, w: card(id).w, h: card(id).h });
    }
    const defects = scoreOf(countDefects(structure.wires, rects, { skipHidden: true }));
    const treeTops = new Map<string, { top: number; line: number }>();
    for (const [root, top] of treeTopOf) {
        treeTops.set(root, { top, line: lineOfRow.get(treeRowOf.get(root)!)! - minY });
    }
    return {
        positions: shifted,
        width: maxX - minX,
        height: maxY - minY,
        defects,
        score: defects + LENGTH_WEIGHT * wireLength(structure.wires, rects),
        treeTops,
    };
}

/**
 * What a placement costs. An overlap or a backwards wire is a broken rule rather than a matter of
 * degree; past those, a wire hidden under a card is harder to follow than two wires crossing.
 */
function scoreOf(defects: BlueprintLayoutMeasure): number {
    return defects.overlaps * 100000 + defects.backwards * 50000 + defects.throughCards * 1500 + defects.crossings * 1000;
}

/** How far the wires run, for choosing between arrangements that untangle equally well. */
function wireLength(wires: readonly Wire[], rects: ReadonlyMap<string, Rect>): number {
    let total = 0;
    for (const wire of wires) {
        const a = rects.get(wire.from);
        const b = rects.get(wire.to);
        if (!a || !b) {
            continue;
        }
        const dx = Math.abs(b.x - (a.x + a.w));
        const dy = Math.abs(b.y + wire.toOffset - (a.y + wire.fromOffset));
        total += dx + dy;
    }
    return total;
}

/**
 * Place, then move feeder trees out from under wires that run through them.
 *
 * A wire from one end of a row to the other passes every feeder hanging between its ends, and the
 * rules that place feeders cannot see it, because where it runs depends on where its far end lands.
 * So the trees it runs through are lowered below it and the island placed again - kept only while
 * that leaves less to untangle.
 */
function placeAndRepair(structure: Structure, choices: ReadonlyMap<string, Choice>, settings: Settings): Placement {
    let lowest = new Map<string, number>();
    let best = place(structure, choices, settings, lowest);
    for (let pass = 0; pass < MAX_REPAIR_PASSES && best.score > 0; pass += 1) {
        const wanted = treesUnderWires(structure, best, settings);
        const next = new Map(lowest);
        let changed = false;
        for (const [root, top] of wanted) {
            if (top > (next.get(root) ?? Number.NEGATIVE_INFINITY) + 0.5) {
                next.set(root, top);
                changed = true;
            }
        }
        if (!changed) {
            break;
        }
        const candidate = place(structure, choices, settings, next);
        if (candidate.score >= best.score) {
            break;
        }
        lowest = next;
        best = candidate;
    }
    return best;
}

/** For each feeder tree a wire runs through, the top that would put the tree below that wire. */
function treesUnderWires(structure: Structure, placement: Placement, settings: Settings): Map<string, number> {
    const { cards } = structure;
    const wanted = new Map<string, number>();
    const inset = 4;
    for (const list of structure.trees.values()) {
        for (const tree of list) {
            const place = placement.treeTops.get(tree.root);
            if (!place) {
                continue;
            }
            const members = new Set(tree.items.map(item => item.id));
            const rects = tree.items.map(item => {
                const point = placement.positions.get(item.id)!;
                return { x: point.x, y: point.y, w: cards.get(item.id)!.w, h: cards.get(item.id)!.h };
            });
            const box = boundsOf(rects);
            for (const wire of structure.wires) {
                if (members.has(wire.from) || members.has(wire.to)) {
                    continue;
                }
                const a = placement.positions.get(wire.from);
                const b = placement.positions.get(wire.to);
                if (!a || !b) {
                    continue;
                }
                const points = sampleWire(
                    { x: a.x + cards.get(wire.from)!.w, y: a.y + wire.fromOffset },
                    { x: b.x, y: b.y + wire.toOffset },
                );
                const hit = rects.some(rect =>
                    points.some(([px, py]) =>
                        px > rect.x + inset && px < rect.x + rect.w - inset && py > rect.y + inset && py < rect.y + rect.h - inset,
                    ),
                );
                if (!hit) {
                    continue;
                }
                const over = points.filter(([px]) => px >= box.x - settings.dataGap && px <= box.x + box.w);
                const deepest = Math.max(...over.map(([, py]) => py));
                const top = place.top + (deepest + settings.clearance - box.y);
                wanted.set(tree.root, Math.max(wanted.get(tree.root) ?? Number.NEGATIVE_INFINITY, top));
            }
        }
    }
    return wanted;
}

/** Every anchor in the given rows and in every row that branches off them, however deep. */
function anchorsUnder(rows: readonly Row[], start: readonly number[]): string[] {
    const out: string[] = [];
    const stack = [...start];
    while (stack.length > 0) {
        const row = rows[stack.pop()!]!;
        out.push(...row.cards);
        stack.push(...row.children);
    }
    return out;
}

/**
 * The smallest x for every anchor that meets every constraint. The constraints almost always form a
 * graph without cycles; when the author's wiring closes one, the anchor the walk reached first gives
 * way, and the wire that loses comes out backwards - which the score then counts against it.
 */
function longestPaths(anchors: readonly string[], constraints: readonly Constraint[]): Map<string, number> {
    const incoming = new Map<string, Constraint[]>();
    const outgoing = new Map<string, Constraint[]>();
    for (const id of anchors) {
        incoming.set(id, []);
        outgoing.set(id, []);
    }
    for (const constraint of constraints) {
        if (constraint.from === constraint.to || !incoming.has(constraint.to) || !incoming.has(constraint.from)) {
            continue;
        }
        incoming.get(constraint.to)!.push(constraint);
        outgoing.get(constraint.from)!.push(constraint);
    }
    const remaining = new Map(anchors.map(id => [id, incoming.get(id)!.length]));
    const x = new Map<string, number>();
    const done = new Set<string>();
    const ready = anchors.filter(id => remaining.get(id) === 0);
    const settle = (id: string) => {
        done.add(id);
        let value = 0;
        for (const constraint of incoming.get(id)!) {
            if (done.has(constraint.from)) {
                value = Math.max(value, x.get(constraint.from)! + constraint.delta);
            }
        }
        x.set(id, value);
        for (const constraint of outgoing.get(id)!) {
            const left = remaining.get(constraint.to)! - 1;
            remaining.set(constraint.to, left);
            if (left === 0 && !done.has(constraint.to)) {
                ready.push(constraint.to);
            }
        }
    };
    while (done.size < anchors.length) {
        const next = ready.shift();
        if (next !== undefined) {
            if (!done.has(next)) {
                settle(next);
            }
            continue;
        }
        // A cycle: release the anchor that comes first in the walk.
        settle(anchors.find(id => !done.has(id))!);
    }
    return x;
}

// ---------------------------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------------------------

/**
 * Frames re-fitted around wherever their members landed, nested ones first so the frame around
 * them wraps their new outline. A frame that held nothing stays as it was and is not listed.
 */
function refitFrames(
    frames: readonly BlueprintLayoutComment[],
    membership: Membership,
    positions: Readonly<Record<string, { x: number; y: number }>>,
    cards: readonly BlueprintLayoutCard[],
): Record<string, BlueprintLayoutRect> {
    const moved = new Map<string, BlueprintLayoutRect>();
    for (const card of cards) {
        const point = positions[card.id];
        if (point) {
            moved.set(card.id, { x: point.x, y: point.y, width: card.width, height: card.height });
        }
    }
    const members = new Map(
        frames.map(frame => [
            frame.id,
            [...(membership.cardsOfFrame.get(frame.id) ?? []), ...(membership.framesOfFrame.get(frame.id) ?? [])],
        ]),
    );
    return refitBlueprintGroupFrames(frames, members, moved);
}

// ---------------------------------------------------------------------------------------------
// Counting what crosses
// ---------------------------------------------------------------------------------------------

/**
 * A wire as the canvas draws it: a cubic from the output's side to the input's, leaving and
 * entering horizontally, its control points pulled half the distance across (or, going backwards,
 * a short loop out of each end).
 */
function sampleWire(start: { x: number; y: number }, end: { x: number; y: number }): [number, number][] {
    const dx = end.x - start.x;
    const pull = dx >= 0 ? dx / 2 : 6.25 * Math.sqrt(-dx);
    const c1x = start.x + pull;
    const c2x = end.x - pull;
    const points: [number, number][] = [];
    for (let i = 0; i <= WIRE_SAMPLES; i += 1) {
        const t = i / WIRE_SAMPLES;
        const u = 1 - t;
        const px = u * u * u * start.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * end.x;
        const py = u * u * u * start.y + 3 * u * u * t * start.y + 3 * u * t * t * end.y + t * t * t * end.y;
        points.push([px, py]);
    }
    return points;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0;
}

function segmentsCross(p1: [number, number], p2: [number, number], q1: [number, number], q2: [number, number]): boolean {
    if (orient(q1[0], q1[1], q2[0], q2[1], p1[0], p1[1]) === orient(q1[0], q1[1], q2[0], q2[1], p2[0], p2[1])) {
        return false;
    }
    return orient(p1[0], p1[1], p2[0], p2[1], q1[0], q1[1]) !== orient(p1[0], p1[1], p2[0], p2[1], q2[0], q2[1]);
}

function countDefects(
    wires: readonly Wire[],
    rects: ReadonlyMap<string, Rect>,
    options: { skipHidden?: boolean } = {},
): BlueprintLayoutMeasure {
    const curves: { wire: Wire; points: [number, number][]; box: Rect }[] = [];
    let backwards = 0;
    for (const wire of wires) {
        const a = rects.get(wire.from);
        const b = rects.get(wire.to);
        if (!a || !b) {
            continue;
        }
        const start = { x: a.x + a.w, y: a.y + wire.fromOffset };
        const end = { x: b.x, y: b.y + wire.toOffset };
        if (end.x < start.x - 1) {
            backwards += 1;
        }
        const points = sampleWire(start, end);
        curves.push({ wire, points, box: boundsOf(points.map(([px, py]) => ({ x: px, y: py, w: 0, h: 0 }))) });
    }

    let crossings = 0;
    for (let i = 0; i < curves.length; i += 1) {
        for (let j = i + 1; j < curves.length; j += 1) {
            const a = curves[i]!;
            const b = curves[j]!;
            if (a.wire.from === b.wire.from && a.wire.fromPin === b.wire.fromPin) {
                continue;
            }
            if (a.wire.to === b.wire.to && a.wire.toPin === b.wire.toPin) {
                continue;
            }
            if (!boxesTouch(a.box, b.box)) {
                continue;
            }
            for (let s = 0; s < a.points.length - 1; s += 1) {
                for (let t = 0; t < b.points.length - 1; t += 1) {
                    if (!segmentsCross(a.points[s]!, a.points[s + 1]!, b.points[t]!, b.points[t + 1]!)) {
                        continue;
                    }
                    // Two wires meeting under a third card are already counted as running through
                    // it, and nobody sees them cross there.
                    if (options.skipHidden && underAnotherCard(a.points[s]!, [a.wire, b.wire], rects)) {
                        continue;
                    }
                    crossings += 1;
                }
            }
        }
    }

    let throughCards = 0;
    const inset = 4;
    for (const curve of curves) {
        for (const [id, rect] of rects) {
            if (id === curve.wire.from || id === curve.wire.to || !boxesTouch(curve.box, rect)) {
                continue;
            }
            const hit = curve.points.some(
                ([px, py]) =>
                    px > rect.x + inset && px < rect.x + rect.w - inset && py > rect.y + inset && py < rect.y + rect.h - inset,
            );
            if (hit) {
                throughCards += 1;
            }
        }
    }

    let overlaps = 0;
    const all = [...rects.values()];
    for (let i = 0; i < all.length; i += 1) {
        for (let j = i + 1; j < all.length; j += 1) {
            const a = all[i]!;
            const b = all[j]!;
            const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            if (w > 0.5 && h > 0.5) {
                overlaps += 1;
            }
        }
    }
    return { crossings, backwards, throughCards, overlaps };
}

/**
 * Whether two wires cross where a card hides it: over a card neither of them is wired to, or inside
 * a card only one of them is wired to - which the other one is then running through. Either way the
 * wire running over the card is what a reader sees, and it is counted as that.
 */
function underAnotherCard(point: [number, number], wires: readonly [Wire, Wire], rects: ReadonlyMap<string, Rect>): boolean {
    const margin = 8;
    for (const [id, rect] of rects) {
        const ends = wires.filter(wire => wire.from === id || wire.to === id).length;
        if (ends === 2) {
            continue;
        }
        const grow = ends === 0 ? margin : 0;
        if (
            point[0] > rect.x - grow &&
            point[0] < rect.x + rect.w + grow &&
            point[1] > rect.y - grow &&
            point[1] < rect.y + rect.h + grow
        ) {
            return true;
        }
    }
    return false;
}

function boxesTouch(a: Rect, b: Rect): boolean {
    return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}
