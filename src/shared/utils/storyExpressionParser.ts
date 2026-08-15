import type { StoryVariableRef } from "@shared/types/story";
import {
    APP_TAG_EXPR_KEYWORD,
    appTagExpr,
    collectAppTagComparisonNames,
    formatStoryLiteral,
    isAppTagExpr,
    isStoryExprFunction,
    isStoryVisitedCall,
    storyVisitedRefToken,
    type StoryExpr,
    type StoryExprBinaryOp,
    type StoryExpression,
    type StoryExprFunction,
    type StoryVisitedCall,
    type StoryVisitedRef,
} from "@shared/types/story/expression";

/**
 * Parser for the story expression language: text → {@link StoryExpression}.
 *
 * A Pratt (precedence-climbing) parser, because the grammar's whole point is that `a + b * c` and
 * `x > 1 ? "a" : y > 1 ? "b" : "c"` read the way an author expects without parentheses. Precedence
 * lives in one table ({@link BINARY_PRECEDENCE}) rather than in a ladder of mutually recursive
 * functions, so adding an operator is a one-line change and the table itself is the documentation.
 *
 * Context is injected, never imported - same split the command layer already makes between its
 * parser and its resolution pass. Here the injection is {@link StoryExpressionScope}: the parser
 * knows the *shape* of a variable reference but not which variables exist, so the caller supplies
 * the lookup. That is what lets the identical parser serve the command line (real project state),
 * the migration path (a document being loaded) and the tests (a fixture map).
 *
 * The parser never throws. Anything it cannot make sense of becomes an `invalid` node carrying the
 * offending source, plus an issue with a span - so a half-typed expression still produces a tree the
 * editor can render and underline, and a committed-then-broken expression survives a round trip.
 */

export type StoryExpressionSpan = { start: number; end: number };

export type StoryExpressionIssue =
    | { code: "unexpectedToken"; span: StoryExpressionSpan; text: string }
    | { code: "unexpectedEnd"; span: StoryExpressionSpan }
    | { code: "unterminatedString"; span: StoryExpressionSpan }
    | { code: "unbalancedParen"; span: StoryExpressionSpan }
    | { code: "unknownVariable"; span: StoryExpressionSpan; name: string }
    | { code: "unknownFunction"; span: StoryExpressionSpan; name: string }
    | { code: "badArity"; span: StoryExpressionSpan; fn: StoryExprFunction; expected: string; received: number }
    /** `saved.gold` where the `saved` scope has no `gold`. Distinct from `unknownVariable` so the message can name the scope. */
    | { code: "unknownQualifiedVariable"; span: StoryExpressionSpan; scope: string; name: string }
    | { code: "unknownScopePrefix"; span: StoryExpressionSpan; prefix: string }
    /** `visited(序章)` where no scene is called that, or `picked(…)` where no option is. */
    | { code: "unknownVisitedTarget"; span: StoryExpressionSpan; call: StoryVisitedCall; name: string }
    /** `bonus()` where no `mode:"value"` story blueprint is called that. */
    | { code: "unknownBlueprint"; span: StoryExpressionSpan; name: string }
    /** `bonus(1)` - a blueprint call is always zero-argument (see the `invoke` node). */
    | { code: "blueprintTakesNoArguments"; span: StoryExpressionSpan; name: string }
    /**
     * Two scenes / options / blueprints answer to one name.
     *
     * Reported rather than resolved, and this is not fussiness: choice options are addressed by the
     * text the player reads, and "Yes" appears in a dozen scenes of any real project. Binding to
     * whichever happened to sort first would produce a condition that tests a different option than
     * the author was looking at, with nothing on screen to say so. The command line already answers
     * a duplicate asset name the same way ("rename one"), for the same reason.
     */
    | { code: "ambiguousReference"; span: StoryExpressionSpan; name: string }
    /**
     * A blueprint is named after a built-in function, so `min()` cannot mean the blueprint.
     *
     * The tree still comes out as the BUILT-IN - documents that already call `min()` keep meaning
     * what they meant - but the line will not commit until the collision is gone, because silently
     * picking one of two things an author can reasonably expect is the failure this whole language
     * avoids elsewhere. The escape without a rename is the quoted call, `'min'()`.
     */
    | { code: "blueprintShadowsFunction"; span: StoryExpressionSpan; name: string }
    /**
     * `AppTag == "Demo"` where the project has no variant called `Demo`.
     *
     * Advisory - see {@link isAdvisoryStoryExpressionIssue}. The comparison is well-formed and folds
     * to a constant `false` when the package is produced, so nothing about it is broken; what it
     * means is that the content behind it ships in no variant at all, which is worth saying and is
     * never worth refusing. A variant deleted on purpose would otherwise lock every row that named
     * it.
     */
    | { code: "unknownAppTagName"; span: StoryExpressionSpan; name: string };

/**
 * Whether an issue describes what the expression MEANS rather than whether it can be read.
 *
 * Every other code here says the tree is unusable, and the command line refuses to commit a line
 * carrying one. An advisory issue carries a perfectly good tree, so a surface that gates on issues
 * must gate on the non-advisory ones and display the rest.
 */
export function isAdvisoryStoryExpressionIssue(issue: StoryExpressionIssue): boolean {
    return issue.code === "unknownAppTagName";
}

export type StoryExpressionParse = {
    expression: StoryExpression;
    issues: StoryExpressionIssue[];
};

/**
 * How an identifier becomes a variable.
 *
 * A bare `gold` walks the scope chain scene → saved → persistent and stops at the first hit; the
 * narrowest scope wins because that is the one an author is most likely to have just declared. When
 * a name is shadowed, `scene.gold` / `saved.gold` / `persis.gold` names the scope outright - which
 * is why no command in this system needs a `scope=` modifier.
 */
export type StoryExpressionScope = {
    /** Resolve a bare name through the scope chain, or null when nothing declares it. */
    lookup: (name: string) => StoryVariableRef | null;
    /** Resolve a name inside one named scope, or null. */
    lookupIn: (scope: "scene" | "saved" | "persistent", name: string) => StoryVariableRef | null;
    /**
     * The name inside `visited(…)` → a scene id, inside `picked(…)` → a choice-option block id.
     *
     * One entry point for both spellings, because they resolve against two tables of the same shape
     * and splitting them would duplicate the ambiguity rule. Injected like every other lookup here:
     * the parser knows the shape of the reference, never the project.
     */
    lookupVisited: (call: StoryVisitedCall, name: string) => StoryExpressionNameResolution;
    /** A `mode:"value"` Story Action Blueprint's name → its id. */
    lookupBlueprint: (name: string) => StoryExpressionNameResolution;
    /**
     * Whether the project has a build variant of this name - what `AppTag == "Demo"` is checked
     * against.
     *
     * Optional, and an omitted predicate means "this caller cannot enumerate the variants", not
     * "there are none". That is the opposite convention to `lookupVisited` above, and deliberately
     * so: an unresolvable scene name changes what the tree IS (there is no id to store), while an
     * unknown variant name changes nothing at all - the comparison is a string against a string
     * either way, and it folds to `false` when the package is produced. So a caller with no list
     * stays silent rather than reporting a name it has no standing to judge, which is what lets the
     * document migration and the fold parse without one.
     */
    hasAppTagName?: (name: string) => boolean;
};

/**
 * What a name-keyed lookup can answer.
 *
 * Three outcomes, not two: unlike a variable (whose scope chain makes shadowing decidable), scenes,
 * options and blueprints live in one flat namespace with nothing to break a tie - so "more than one"
 * is a distinct answer the parser must be able to report rather than silently resolve.
 */
export type StoryExpressionNameResolution = { id: string } | "ambiguous" | null;

export const EMPTY_STORY_EXPRESSION_SCOPE: StoryExpressionScope = {
    lookup: () => null,
    lookupIn: () => null,
    lookupVisited: () => null,
    lookupBlueprint: () => null,
};

/** The scope prefixes an author may write. `persis` matches the command name; `persistent` is spelled out for readability. */
const SCOPE_PREFIXES: Readonly<Record<string, "scene" | "saved" | "persistent">> = {
    scene: "scene",
    local: "scene",
    saved: "saved",
    var: "saved",
    persis: "persistent",
    persistent: "persistent",
    global: "persistent",
};

/** Binding power per binary operator. Higher binds tighter; all are left-associative. */
const BINARY_PRECEDENCE: Readonly<Record<StoryExprBinaryOp, number>> = {
    "||": 1,
    "&&": 2,
    "==": 3, "!=": 3,
    "<": 4, "<=": 4, ">": 4, ">=": 4,
    "+": 5, "-": 5,
    "*": 6, "/": 6, "%": 6,
};

/** Arity per whitelisted function. `[min, max]`; `max: Infinity` for variadic. */
const FUNCTION_ARITY: Readonly<Record<StoryExprFunction, { min: number; max: number; label: string }>> = {
    min: { min: 1, max: Infinity, label: "1+" },
    max: { min: 1, max: Infinity, label: "1+" },
    abs: { min: 1, max: 1, label: "1" },
    round: { min: 1, max: 1, label: "1" },
    floor: { min: 1, max: 1, label: "1" },
    ceil: { min: 1, max: 1, label: "1" },
    clamp: { min: 3, max: 3, label: "3" },
    random: { min: 0, max: 0, label: "0" },
    randomInt: { min: 2, max: 2, label: "2" },
    len: { min: 1, max: 1, label: "1" },
    // Collections. Arity is checked here and NOT in the evaluator, which is why `evaluateCall` may
    // read `args[1]` without a guard - the tree cannot exist with the wrong count.
    list: { min: 0, max: Infinity, label: "0+" },
    dict: { min: 0, max: 0, label: "0" },
    get: { min: 2, max: 3, label: "2-3" },
    keys: { min: 1, max: 1, label: "1" },
    push: { min: 2, max: 2, label: "2" },
    removeAt: { min: 2, max: 2, label: "2" },
    setKey: { min: 3, max: 3, label: "3" },
    removeKey: { min: 2, max: 2, label: "2" },
    hasKey: { min: 2, max: 2, label: "2" },
    indexOf: { min: 2, max: 2, label: "2" },
    contains: { min: 2, max: 2, label: "2" },
    join: { min: 2, max: 2, label: "2" },
    slice: { min: 2, max: 3, label: "2-3" },
    concat: { min: 2, max: 2, label: "2" },
    // Strings.
    upper: { min: 1, max: 1, label: "1" },
    lower: { min: 1, max: 1, label: "1" },
    trim: { min: 1, max: 1, label: "1" },
    replace: { min: 3, max: 3, label: "3" },
    split: { min: 2, max: 2, label: "2" },
    pad: { min: 2, max: 3, label: "2-3" },
    str: { min: 1, max: 1, label: "1" },
    num: { min: 1, max: 1, label: "1" },
    // Never consulted: `AppTag` is intercepted as a keyword in `parseIdentifier`, so no call ever
    // reaches the whitelist under this name. The entry exists because the table is keyed by the
    // whole `StoryExprFunction` union, which is the mechanism that made adding the constant safe.
    appTag: { min: 0, max: 0, label: "0" },
};

// ── Tokenizer ─────────────────────────────────────────────────────────────────────────────────────

type TokenType = "number" | "string" | "identifier" | "operator" | "punct";

type Token = {
    type: TokenType;
    /** For strings and quoted identifiers, the decoded value; otherwise the source text. */
    text: string;
    span: StoryExpressionSpan;
    /**
     * A string token whose closing quote never arrived. Carried on the token rather than handled at
     * the tokenizer's issue level so the *tree* also comes out invalid - the compiler's only test for
     * "may I evaluate this" is `isStoryExpressionEvaluable`, so an issue that left behind a
     * perfectly-good literal would let `"unterminated` compile as if the author had closed the quote.
     */
    unterminated?: boolean;
    /**
     * A single-quoted identifier: `'Complex Var Name'` is one name, taken verbatim to the scope's
     * `lookup` - never a keyword, a function call or a `scope.name` split, because the whole point of
     * quoting is to address a declared name literally.
     */
    quoted?: boolean;
};

/** Multi-character operators first - otherwise `>=` tokenizes as `>` then `=`. */
const OPERATORS = ["==", "!=", "<=", ">=", "&&", "||", "+", "-", "*", "/", "%", "<", ">", "!"] as const;

function isIdentifierStart(char: string): boolean {
    // Non-ASCII letters are identifier characters: an author writing Chinese variable names should not
    // have to romanize them to reference one. The exclusion list below is what actually matters.
    return /[A-Za-z_$]/.test(char) || char.charCodeAt(0) > 0x7f;
}

function isIdentifierPart(char: string): boolean {
    return isIdentifierStart(char) || /[0-9]/.test(char);
}

function tokenize(source: string, issues: StoryExpressionIssue[]): Token[] {
    const tokens: Token[] = [];
    let index = 0;

    while (index < source.length) {
        const char = source[index];

        if (/\s/.test(char)) {
            index += 1;
            continue;
        }

        // Double quotes are string literals; single quotes are entity references (a quoted
        // identifier) - the same split the command tokenizer makes. Only strings have escapes.
        if (char === "\"") {
            const start = index;
            index += 1;
            let value = "";
            let terminated = false;
            while (index < source.length) {
                const current = source[index];
                if (current === "\\" && index + 1 < source.length) {
                    value += source[index + 1];
                    index += 2;
                    continue;
                }
                if (current === "\"") {
                    index += 1;
                    terminated = true;
                    break;
                }
                value += current;
                index += 1;
            }
            if (!terminated) {
                issues.push({ code: "unterminatedString", span: { start, end: source.length } });
            }
            tokens.push({ type: "string", text: value, span: { start, end: index }, ...(terminated ? {} : { unterminated: true }) });
            continue;
        }

        if (char === "'") {
            const start = index;
            index += 1;
            let name = "";
            let terminated = false;
            while (index < source.length) {
                if (source[index] === "'") {
                    index += 1;
                    terminated = true;
                    break;
                }
                name += source[index];
                index += 1;
            }
            if (!terminated) {
                issues.push({ code: "unterminatedString", span: { start, end: source.length } });
            }
            tokens.push({ type: "identifier", text: name, span: { start, end: index }, quoted: true, ...(terminated ? {} : { unterminated: true }) });
            continue;
        }

        if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(source[index + 1] ?? ""))) {
            const start = index;
            while (index < source.length && /[0-9.]/.test(source[index])) {
                index += 1;
            }
            tokens.push({ type: "number", text: source.slice(start, index), span: { start, end: index } });
            continue;
        }

        if (isIdentifierStart(char)) {
            const start = index;
            // A dotted name is one token: `saved.gold` is a qualified reference, not a member access -
            // the language has no member access, so the dot can mean exactly one thing.
            while (index < source.length && (isIdentifierPart(source[index]) || source[index] === ".")) {
                index += 1;
            }
            tokens.push({ type: "identifier", text: source.slice(start, index), span: { start, end: index } });
            continue;
        }

        const operator = OPERATORS.find(candidate => source.startsWith(candidate, index));
        if (operator) {
            tokens.push({ type: "operator", text: operator, span: { start: index, end: index + operator.length } });
            index += operator.length;
            continue;
        }

        if (char === "(" || char === ")" || char === "," || char === "?" || char === ":"
            || char === "[" || char === "]") {
            tokens.push({ type: "punct", text: char, span: { start: index, end: index + 1 } });
            index += 1;
            continue;
        }

        issues.push({ code: "unexpectedToken", span: { start: index, end: index + 1 }, text: char });
        index += 1;
    }

    return tokens;
}

// ── Parser ────────────────────────────────────────────────────────────────────────────────────────

class ExpressionParser {
    private position = 0;

    constructor(
        private readonly source: string,
        private readonly tokens: Token[],
        private readonly scope: StoryExpressionScope,
        private readonly issues: StoryExpressionIssue[],
    ) {}

    parse(): StoryExpr {
        if (this.tokens.length === 0) {
            this.issues.push({ code: "unexpectedEnd", span: { start: 0, end: this.source.length } });
            return { kind: "invalid", source: this.source };
        }
        const expr = this.parseExpression(0);
        const leftover = this.peek();
        if (leftover) {
            this.issues.push({ code: "unexpectedToken", span: leftover.span, text: leftover.text });
            // Everything after the leftover is unreachable to the tree; fault the whole expression
            // rather than silently evaluating a prefix of what the author wrote.
            return { kind: "invalid", source: this.source };
        }
        return expr;
    }

    /** Precedence climbing over binary operators, with `?:` layered on at the loosest binding. */
    private parseExpression(minPrecedence: number): StoryExpr {
        let left = this.parseUnary();

        for (;;) {
            const token = this.peek();
            if (!token || token.type !== "operator") {
                break;
            }
            const op = token.text as StoryExprBinaryOp;
            const precedence = BINARY_PRECEDENCE[op];
            if (precedence === undefined || precedence < minPrecedence) {
                break;
            }
            this.advance();
            // Left-associative: the right operand binds one level tighter, so `a - b - c` groups as
            // `(a - b) - c` rather than `a - (b - c)`.
            const right = this.parseExpression(precedence + 1);
            left = { kind: "binary", op, left, right };
        }

        // `?:` is right-associative and binds looser than every binary operator, so a chain of them
        // (`a ? x : b ? y : z`) nests to the right without parentheses - the whole reason to have it.
        if (minPrecedence === 0 && this.peekPunct("?")) {
            this.advance();
            const consequent = this.parseExpression(0);
            if (!this.peekPunct(":")) {
                const token = this.peek();
                this.issues.push(
                    token
                        ? { code: "unexpectedToken", span: token.span, text: token.text }
                        : { code: "unexpectedEnd", span: { start: this.source.length, end: this.source.length } },
                );
                return { kind: "invalid", source: this.source };
            }
            this.advance();
            const alternate = this.parseExpression(0);
            return { kind: "ternary", test: left, consequent, alternate };
        }

        return left;
    }

    private parseUnary(): StoryExpr {
        const token = this.peek();
        if (token?.type === "operator" && (token.text === "-" || token.text === "!")) {
            this.advance();
            // Unary binds tighter than every binary operator, so `-a * b` is `(-a) * b`.
            const operand = this.parseUnary();
            return { kind: "unary", op: token.text, operand };
        }
        return this.parsePostfix(this.parsePrimary());
    }

    /**
     * `[…]` subscripts, applied left to right after a primary.
     *
     * A loop rather than recursion into `parsePrimary`, because subscripting is left-associative and
     * unbounded: `a[0][1]` is `(a[0])[1]`, and the same loop makes `get(inv, 0)["name"]` and
     * `[1, 2][i]` work without any of those being special cases. It sits above `parsePrimary` and
     * below `parseUnary` so `-a[0]` negates the element, not the array.
     */
    private parsePostfix(base: StoryExpr): StoryExpr {
        let target = base;
        for (;;) {
            const open = this.peek();
            if (!open || open.type !== "punct" || open.text !== "[") {
                break;
            }
            this.advance();
            const index = this.parseExpression(0);
            if (!this.peekPunct("]")) {
                // Same issue code as `(`: the message ("a bracket is never closed") already covers
                // both, and a separate code would buy a second catalogue entry saying the same thing.
                this.issues.push({ code: "unbalancedParen", span: open.span });
                return { kind: "invalid", source: this.source };
            }
            this.advance();
            target = { kind: "index", target, index };
        }
        return target;
    }

    private parsePrimary(): StoryExpr {
        const token = this.peek();
        if (!token) {
            this.issues.push({ code: "unexpectedEnd", span: { start: this.source.length, end: this.source.length } });
            return { kind: "invalid", source: this.source };
        }

        if (token.type === "number") {
            this.advance();
            const value = Number(token.text);
            if (!Number.isFinite(value)) {
                this.issues.push({ code: "unexpectedToken", span: token.span, text: token.text });
                return { kind: "invalid", source: token.text };
            }
            return { kind: "literal", value };
        }

        if (token.type === "string") {
            this.advance();
            return token.unterminated
                ? { kind: "invalid", source: this.source.slice(token.span.start, token.span.end) }
                : { kind: "literal", value: token.text };
        }

        if (token.type === "punct" && token.text === "(") {
            this.advance();
            const inner = this.parseExpression(0);
            if (!this.peekPunct(")")) {
                this.issues.push({ code: "unbalancedParen", span: token.span });
                return { kind: "invalid", source: this.source };
            }
            this.advance();
            return inner;
        }

        if (token.type === "punct" && token.text === "[") {
            return this.parseArrayLiteral(token);
        }

        if (token.type === "identifier") {
            return this.parseIdentifier(token);
        }

        this.advance();
        this.issues.push({ code: "unexpectedToken", span: token.span, text: token.text });
        return { kind: "invalid", source: token.text };
    }

    private parseIdentifier(token: Token): StoryExpr {
        this.advance();
        const name = token.text;

        // A quoted identifier addresses one declared name verbatim: no keyword reading, no call, no
        // scope-prefix split - `'saved.gold'` looks up a variable literally named "saved.gold". It
        // resolves through the same scope chain a bare name does, to the same `var` node.
        if (token.quoted) {
            if (token.unterminated) {
                return { kind: "invalid", source: this.source.slice(token.span.start, token.span.end) };
            }
            // A quoted CALLEE is the escape from both of the call position's name problems: a
            // blueprint whose name has a space (the default "Story Value" does) has no bare
            // spelling at all, and one that collides with a built-in has no other way to be named.
            // Quoting already means "this exact declared name, verbatim", so it skips the whitelist
            // by the same rule that makes `'saved.gold'` a variable rather than a scope split.
            if (this.peekPunct("(")) {
                return this.parseCall(token);
            }
            const target = this.scope.lookup(name);
            if (!target) {
                this.issues.push({ code: "unknownVariable", span: token.span, name });
                return { kind: "invalid", source: name };
            }
            return { kind: "var", target, name };
        }

        // Keywords first: `true`/`false`/`null` are identifiers to the tokenizer and literals here.
        const lowered = name.toLowerCase();
        if (lowered === "true" || lowered === "false") {
            return { kind: "literal", value: lowered === "true" };
        }
        if (lowered === "null") {
            return { kind: "literal", value: null };
        }
        // `AppTag` is a keyword for the same reason those three are: it names a value the language
        // decides, not one the project declares. Reserving the bare word is what makes the fold
        // sound - if a variable could win this name, the same source would mean the build variant in
        // one project and a save file's number in another. `'AppTag'` reaches such a variable, and
        // `validateSceneDeclaration` refuses new ones.
        if (lowered === APP_TAG_EXPR_KEYWORD.toLowerCase()) {
            return appTagExpr();
        }

        if (this.peekPunct("(")) {
            return this.parseCall(token);
        }

        const dot = name.indexOf(".");
        if (dot > 0) {
            const prefix = name.slice(0, dot).toLowerCase();
            const bare = name.slice(dot + 1);
            const scope = SCOPE_PREFIXES[prefix];
            if (!scope) {
                this.issues.push({ code: "unknownScopePrefix", span: token.span, prefix });
                return { kind: "invalid", source: name };
            }
            const target = this.scope.lookupIn(scope, bare);
            if (!target) {
                this.issues.push({ code: "unknownQualifiedVariable", span: token.span, scope: prefix, name: bare });
                return { kind: "invalid", source: name };
            }
            return { kind: "var", target, name: bare };
        }

        const target = this.scope.lookup(name);
        if (!target) {
            this.issues.push({ code: "unknownVariable", span: token.span, name });
            return { kind: "invalid", source: name };
        }
        return { kind: "var", target, name };
    }

    /**
     * `[]`, `[1, 2, 3]`, `[[1, 2], [3]]`. Same comma loop as an argument list, so a nested literal
     * falls out of `parseExpression` recursing rather than needing its own case.
     *
     * No trailing comma. It would have to mean "one more item, unwritten" or "nothing", and a
     * language whose whole promise is that an expression cannot fail should not be guessing.
     */
    private parseArrayLiteral(token: Token): StoryExpr {
        this.advance(); // consume "["
        const items: StoryExpr[] = [];
        if (!this.peekPunct("]")) {
            for (;;) {
                items.push(this.parseExpression(0));
                if (this.peekPunct(",")) {
                    this.advance();
                    continue;
                }
                break;
            }
        }
        if (!this.peekPunct("]")) {
            this.issues.push({ code: "unbalancedParen", span: token.span });
            return { kind: "invalid", source: this.source };
        }
        this.advance();
        return { kind: "array", items };
    }

    private parseCall(token: Token): StoryExpr {
        const name = token.text;
        // `visited` / `picked` take an ENTITY, not an expression, so they are intercepted before the
        // argument loop below ever runs. Letting `序章` reach `parseExpression` would resolve it as a
        // variable and report "no variable named 序章" - a message about the wrong namespace
        // entirely, for a line that is not wrong.
        if (!token.quoted && isStoryVisitedCall(name)) {
            return this.parseVisitedCall(token, name);
        }
        this.advance(); // consume "("
        const args: StoryExpr[] = [];
        if (!this.peekPunct(")")) {
            for (;;) {
                args.push(this.parseExpression(0));
                if (this.peekPunct(",")) {
                    this.advance();
                    continue;
                }
                break;
            }
        }
        if (!this.peekPunct(")")) {
            this.issues.push({ code: "unbalancedParen", span: token.span });
            return { kind: "invalid", source: this.source };
        }
        this.advance();

        // The whitelist wins the name. A blueprint may not redefine `min`, both because the closed
        // function set is what makes this language auditable and because a project-scoped rename
        // must never change what an existing expression computes.
        if (isStoryExprFunction(name) && !token.quoted) {
            // Say so when a blueprint is standing behind the built-in, rather than resolving one and
            // leaving the author to wonder why their graph never runs.
            if (this.scope.lookupBlueprint(name) !== null) {
                this.issues.push({ code: "blueprintShadowsFunction", span: token.span, name });
            }
            const arity = FUNCTION_ARITY[name];
            if (args.length < arity.min || args.length > arity.max) {
                this.issues.push({ code: "badArity", span: token.span, fn: name, expected: arity.label, received: args.length });
                return { kind: "invalid", source: this.source.slice(token.span.start) };
            }
            return { kind: "call", fn: name, args };
        }

        // Not a built-in: a story blueprint, if one answers to the name.
        const blueprint = this.scope.lookupBlueprint(name);
        if (blueprint === "ambiguous") {
            this.issues.push({ code: "ambiguousReference", span: token.span, name });
            return { kind: "invalid", source: name };
        }
        if (blueprint) {
            if (args.length > 0) {
                // Its own code rather than `badArity`, whose `fn` is typed to the whitelist: a
                // blueprint is not a function with a wrong count, it is a callee that takes nothing
                // at all, and the message has to say which of the two the author is looking at.
                this.issues.push({ code: "blueprintTakesNoArguments", span: token.span, name });
                return { kind: "invalid", source: this.source.slice(token.span.start) };
            }
            return { kind: "invoke", blueprintId: blueprint.id, name };
        }

        // A quoted callee that matched nothing is a missing BLUEPRINT, not a missing function: the
        // quotes said "a declared name", and the whitelist has no quoted spelling to have missed.
        this.issues.push(
            token.quoted
                ? { code: "unknownBlueprint", span: token.span, name }
                : { code: "unknownFunction", span: token.span, name },
        );
        return { kind: "invalid", source: name };
    }

    /**
     * `visited(序章)` / `picked('那 句 拒绝')` - one entity name, resolved to an id.
     *
     * The argument is a single identifier token, bare or single-quoted, and nothing else. Not an
     * expression: there is no computed form of "which scene", because the id has to be pinned at
     * authoring time for the reference to survive a rename at all.
     */
    private parseVisitedCall(token: Token, call: StoryVisitedCall): StoryExpr {
        this.advance(); // consume "("
        const argument = this.peek();
        if (!argument) {
            this.issues.push({ code: "unexpectedEnd", span: { start: this.source.length, end: this.source.length } });
            return { kind: "invalid", source: this.source.slice(token.span.start) };
        }
        if (argument.type !== "identifier" || argument.unterminated) {
            this.issues.push({ code: "unexpectedToken", span: argument.span, text: argument.text });
            return { kind: "invalid", source: this.source.slice(token.span.start) };
        }
        this.advance();
        if (!this.peekPunct(")")) {
            this.issues.push({ code: "unbalancedParen", span: token.span });
            return { kind: "invalid", source: this.source.slice(token.span.start) };
        }
        this.advance();

        const name = argument.text;
        const resolved = this.scope.lookupVisited(call, name);
        if (resolved === "ambiguous") {
            this.issues.push({ code: "ambiguousReference", span: argument.span, name });
            return { kind: "invalid", source: this.source.slice(token.span.start, this.tokens[this.position - 1].span.end) };
        }
        if (!resolved) {
            this.issues.push({ code: "unknownVisitedTarget", span: argument.span, call, name });
            return { kind: "invalid", source: this.source.slice(token.span.start, this.tokens[this.position - 1].span.end) };
        }
        const target: StoryVisitedRef = call === "visited"
            ? { kind: "scene", sceneId: resolved.id }
            : { kind: "option", blockId: resolved.id };
        return { kind: "visited", target, name };
    }

    private peek(): Token | undefined {
        return this.tokens[this.position];
    }

    private peekPunct(text: string): boolean {
        const token = this.peek();
        return token?.type === "punct" && token.text === text;
    }

    private advance(): void {
        this.position += 1;
    }
}

/**
 * Parse an expression. Never throws: an unparseable source yields an `invalid` tree plus issues, so
 * the caller decides whether that blocks a commit (it does, on the command line) or is merely
 * displayed (it is, when re-opening a row whose variable was since deleted).
 */
export function parseStoryExpression(source: string, scope: StoryExpressionScope): StoryExpressionParse {
    const issues: StoryExpressionIssue[] = [];
    const trimmed = source.trim();
    if (trimmed === "") {
        return {
            expression: { source, ast: { kind: "invalid", source } },
            issues: [{ code: "unexpectedEnd", span: { start: 0, end: 0 } }],
        };
    }
    const tokens = tokenize(source, issues);
    const ast = new ExpressionParser(source, tokens, scope, issues).parse();
    // After the tree exists, not during: `AppTag == "Demo"` is only a comparison once both operands
    // and the operator have been read, and this is the one check here that is about a pair of nodes
    // rather than about a token. The span is the whole source - the name's own offsets are gone by
    // now, and an advisory that underlines the line reads the same as one that underlines the word.
    if (scope.hasAppTagName) {
        for (const name of collectAppTagComparisonNames(ast)) {
            if (!scope.hasAppTagName(name)) {
                issues.push({ code: "unknownAppTagName", span: { start: 0, end: source.length }, name });
            }
        }
    }
    return { expression: { source, ast }, issues };
}

/**
 * Print a variable name the way the lexer reads one reference back: bare when it lexes as a single
 * identifier and parses as a plain name, single-quoted otherwise. The inverse of the quoted-identifier
 * token - what generated sources (compound-assignment desugaring, auto-built steps) must use so a
 * name with a space, a dot or a keyword's spelling survives the round trip.
 */
export function formatStoryExpressionName(name: string): string {
    const lowered = name.toLowerCase();
    // `AppTag` sits with the three literal keywords: a variable that happens to carry the name would
    // re-lex as the build-variant constant if it were printed bare, so the printer quotes it - which
    // is the spelling that still reaches the variable.
    const keyword = lowered === "true" || lowered === "false" || lowered === "null"
        || lowered === APP_TAG_EXPR_KEYWORD.toLowerCase();
    // A dot never passes isIdentifierPart, so a dotted name (which would re-parse as a scope prefix)
    // is quoted by the same test.
    const bare = name.length > 0 && !keyword && isIdentifierStart(name[0]) && [...name].every(isIdentifierPart);
    return bare ? name : `'${name}'`;
}

/** One name-addressable project entity, as the scope builder consumes it. */
export type StoryExpressionNamedEntry = { id: string; name: string };

/**
 * The tables `visited(…)`, `picked(…)` and a blueprint call resolve against.
 *
 * All optional, and an omitted table is NOT the same as an empty one only in intent: both report the
 * name as unknown. That is deliberate - a surface that cannot enumerate scenes must not let a
 * `visited(…)` commit against nothing, and the parser has no way to tell "no scenes" from "I did not
 * look". Every surface that offers the syntax passes the tables; see `buildStoryCommandContext`.
 */
export type StoryExpressionEntities = {
    scenes?: readonly StoryExpressionNamedEntry[];
    /** Choice options, addressed by the text the player reads. Document-wide: `picked` asks about another scene's choice. */
    options?: readonly StoryExpressionNamedEntry[];
    /** `mode: "value"` Story Action Blueprints - the only ones an expression may call. */
    blueprints?: readonly StoryExpressionNamedEntry[];
    /**
     * The project's build variants, release included - what `AppTag == "Demo"` is checked against.
     *
     * Names only; there is no id to bind, because the comparison IS a string comparison at play time
     * and renaming a variant renames what the story must say. Omitting the list is silence rather
     * than "no variants" - see `hasAppTagName` on the scope.
     */
    appTags?: readonly StoryExpressionNamedEntry[];
};

/**
 * Print a tree back as source the lexer reads as the same tree.
 *
 * Beside the parser rather than in the one consumer that used to own it, because round-tripping is a
 * property of the pair: every reference here has to be spelled the way `parseIdentifier` /
 * `parseCall` will read it back, and a printer sitting in a UI module had already drifted (a variable
 * whose name held a space printed bare, and re-lexed as two tokens).
 *
 * Parenthesised eagerly around every binary and ternary. Re-deriving precedence to decide where
 * parens are *needed* would be a second, subtly different copy of `BINARY_PRECEDENCE`, and the output
 * is read by a machine far more often than by a person.
 */
export function formatStoryExpr(expr: StoryExpr): string {
    switch (expr.kind) {
        case "literal":
            return formatStoryLiteral(expr.value);
        case "var":
            // Through the name formatter, not raw: a variable called `my gold` printed bare re-lexes
            // as two tokens, so the round trip loses the reference it started from.
            return formatStoryExpressionName(expr.name);
        case "visited":
            // `visited(序章)` / `picked('那 句 拒绝')` - the token comes from the ref's own arm, so the
            // two spellings can never drift from the record they read.
            return `${storyVisitedRefToken(expr.target)}(${formatStoryExpressionName(expr.name)})`;
        case "invoke":
            // A quoted callee is a legal call (see `parseIdentifier`), which is what lets the default
            // "Story Value" - a name with a space in it - survive being printed and re-parsed.
            return `${formatStoryExpressionName(expr.name)}()`;
        case "unary":
            return `${expr.op}${formatStoryExpr(expr.operand)}`;
        case "binary":
            return `(${formatStoryExpr(expr.left)} ${expr.op} ${formatStoryExpr(expr.right)})`;
        case "ternary":
            return `(${formatStoryExpr(expr.test)} ? ${formatStoryExpr(expr.consequent)} : ${formatStoryExpr(expr.alternate)})`;
        case "call":
            // `AppTag` is written as a bare word and has no call spelling at all (the parser reads it
            // as a keyword), so printing `appTag()` would produce a source the lexer then chokes on.
            return isAppTagExpr(expr)
                ? APP_TAG_EXPR_KEYWORD
                : `${expr.fn}(${expr.args.map(formatStoryExpr).join(", ")})`;
        case "array":
            return `[${expr.items.map(formatStoryExpr).join(", ")}]`;
        case "index":
            // No parens around the target: every binary and ternary is already parenthesised above,
            // so whatever comes back either binds tighter than `[…]` or brought its own.
            return `${formatStoryExpr(expr.target)}[${formatStoryExpr(expr.index)}]`;
        case "invalid":
            return expr.source;
    }
}

/** Build a scope from a flat list of declared variables - the shape both the command line and tests have. */
export function createStoryExpressionScope(
    entries: readonly { name: string; ref: StoryVariableRef }[],
    entities: StoryExpressionEntities = {},
): StoryExpressionScope {
    const normalize = (name: string): string => name.trim().toLowerCase();

    // Exact, case-insensitive, and reporting rather than guessing on a tie - the same rule
    // `findByName` applies to asset names on the command line, for the same reason.
    const byName = (list: readonly StoryExpressionNamedEntry[] | undefined, name: string): StoryExpressionNameResolution => {
        const needle = normalize(name);
        const matches = (list ?? []).filter(entry => normalize(entry.name) === needle);
        if (matches.length === 0) {
            return null;
        }
        return matches.length > 1 ? "ambiguous" : { id: matches[0].id };
    };
    // Scene shadows saved shadows persistent: the narrowest declaration wins a bare name, because it
    // is the one the author most recently had reason to think about. Qualified names are the escape.
    const order: Record<StoryVariableRef["scope"], number> = { scene: 0, saved: 1, persistent: 2 };

    return {
        lookup: name => {
            const needle = normalize(name);
            const matches = entries.filter(entry => normalize(entry.name) === needle);
            if (matches.length === 0) {
                return null;
            }
            return matches.slice().sort((a, b) => order[a.ref.scope] - order[b.ref.scope])[0].ref;
        },
        lookupIn: (scope, name) => {
            const needle = normalize(name);
            return entries.find(entry => entry.ref.scope === scope && normalize(entry.name) === needle)?.ref ?? null;
        },
        lookupVisited: (call, name) => byName(call === "visited" ? entities.scenes : entities.options, name),
        lookupBlueprint: name => byName(entities.blueprints, name),
        // Exact, case included, unlike every other name table here. The comparison the author wrote
        // is a string equality the fold performs verbatim, so a check that accepted "demo" for
        // "Demo" would pass a line that then ships nowhere - which is the one thing this predicate
        // exists to catch. Absent list, absent predicate: see `hasAppTagName` on the scope type.
        ...(entities.appTags
            ? { hasAppTagName: (name: string) => entities.appTags!.some(tag => tag.name === name) }
            : {}),
    };
}
