import type { StoryVariableRef } from "@shared/types/story";
import {
    isStoryExprFunction,
    type StoryExpr,
    type StoryExprBinaryOp,
    type StoryExpression,
    type StoryExprFunction,
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
    | { code: "unknownScopePrefix"; span: StoryExpressionSpan; prefix: string };

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
};

export const EMPTY_STORY_EXPRESSION_SCOPE: StoryExpressionScope = {
    lookup: () => null,
    lookupIn: () => null,
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

        if (char === "(" || char === ")" || char === "," || char === "?" || char === ":") {
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
        return this.parsePrimary();
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

    private parseCall(token: Token): StoryExpr {
        const name = token.text;
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

        if (!isStoryExprFunction(name)) {
            this.issues.push({ code: "unknownFunction", span: token.span, name });
            return { kind: "invalid", source: name };
        }
        const arity = FUNCTION_ARITY[name];
        if (args.length < arity.min || args.length > arity.max) {
            this.issues.push({ code: "badArity", span: token.span, fn: name, expected: arity.label, received: args.length });
            return { kind: "invalid", source: this.source.slice(token.span.start) };
        }
        return { kind: "call", fn: name, args };
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
    const keyword = lowered === "true" || lowered === "false" || lowered === "null";
    // A dot never passes isIdentifierPart, so a dotted name (which would re-parse as a scope prefix)
    // is quoted by the same test.
    const bare = name.length > 0 && !keyword && isIdentifierStart(name[0]) && [...name].every(isIdentifierPart);
    return bare ? name : `'${name}'`;
}

/** Build a scope from a flat list of declared variables - the shape both the command line and tests have. */
export function createStoryExpressionScope(
    entries: readonly { name: string; ref: StoryVariableRef }[],
): StoryExpressionScope {
    const normalize = (name: string): string => name.trim().toLowerCase();
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
    };
}
