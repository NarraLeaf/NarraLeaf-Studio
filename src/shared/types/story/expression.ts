import type { StoryBlockId, StoryLiteralValue, StorySceneId, StoryVariableRef } from "./document";

/**
 * The story expression language: the small, total, side-effect-free value language the command line
 * writes and the compiler evaluates.
 *
 * Why an AST rather than a stored string. Three consumers want "a computed value" - a `setVariable`
 * right-hand side, an `if` condition, an inline `{…}` run in dialogue - and all three previously had
 * to reach for a blueprint to add one to a number. A stored string would have to be re-parsed by
 * every consumer (including the compiler, which must not be able to fail on data that already
 * committed), so the *parse* happens once, at authoring time, and the document stores the tree.
 *
 * Why no `eval`. Every node here is interpreted by a plain tree walk (`evaluateStoryExpression`).
 * Nothing in this language can name a host object, so there is no sandbox to escape - which is what
 * makes it shippable where `compileProjectBlueprintScripts` is deliberately inert - and where the
 * `code` block, which offered a source editor and ran nothing, was deleted outright in schema v13.
 * The function set is a closed whitelist for exactly that reason; adding to it is a language
 * change, not a config change.
 *
 * `source` travels with the tree. The author sees their own text when they re-open the row, and an
 * expression that stops resolving (a variable was deleted) can still be displayed and repaired
 * rather than silently becoming `0`. This is the same bargain the `invalid` block kind strikes.
 */

export type StoryExprBinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||";

export type StoryExprUnaryOp = "-" | "!";

/**
 * The callable whitelist. Deliberately closed: nothing here can name a host object, so the set is
 * the entire surface an authored expression can reach, and every addition is a language change
 * rather than a config change.
 *
 * Closed, but no longer tiny. The original set answered "a flag or a counter"; the collection and
 * string groups below answer the thing a `json` variable was already able to *store* and had no way
 * to *read* - an inventory, the set of CGs seen, a per-chapter flag bag. Without them the language
 * could declare a `json` variable and then force every use of it into a blueprint, which is the
 * failure the expression language exists to remove.
 *
 * All of them are total (see `evaluateCall`), pure (the collection mutators return new values), and
 * deterministic - `random`/`randomInt` remain the only two exceptions to the last, and the lint rule
 * in `rules/variables.ts` exists precisely to police where those two may sit.
 */
export const STORY_EXPR_FUNCTIONS = [
  "min",
  "max",
  "abs",
  "round",
  "floor",
  "ceil",
  "clamp",
  "random",
  "randomInt",
  "len",
  // Collections. `list`/`dict` are the constructors (there is no `{…}` literal - see below); the
  // rest read or *rewrite* one, always returning a new value.
  "list",
  "dict",
  "get",
  "keys",
  "push",
  "removeAt",
  "setKey",
  "removeKey",
  "hasKey",
  "indexOf",
  "contains",
  "join",
  "slice",
  "concat",
  // Strings. `str`/`num` are the explicit conversions - the coercions the operators apply
  // implicitly, made nameable so an author can force one rather than discover it.
  "upper",
  "lower",
  "trim",
  "replace",
  "split",
  "pad",
  "str",
  "num",
  /**
   * The build variant this package is being produced as, as a string. The odd one out: it is a
   * compile-time CONSTANT, written `AppTag` with no parentheses (see {@link APP_TAG_EXPR_KEYWORD}),
   * and it sits in this list only because a zero-argument call is the smallest shape the tree
   * already has that can carry it.
   *
   * A new `StoryExpr` kind would have been the honest spelling and is exactly what must not be
   * added: every switch over `kind` that a stale build has not seen returns `undefined` for an
   * unknown one, which reads as "false" rather than as "broken" (see the v14/v15 notes in
   * `document.ts`). A new `fn`, by contrast, is a member of a closed union that three
   * `Record<StoryExprFunction, …>` tables index - so the compiler enumerates every site that has to
   * learn about it, and `isStoryExpressionEvaluable`, the evaluator and the inference stay total
   * with no edit at all.
   */
  "appTag"
] as const;

export type StoryExprFunction = (typeof STORY_EXPR_FUNCTIONS)[number];

/**
 * What a `visited(…)` / `picked(…)` node points at: a scene the player entered, or a choice option
 * the player chose. Both are Studio ids, never names - see the `visited` node below.
 *
 * The two arms are what the record itself holds (`scenes` / `options` in `storyVisited.ts`), so the
 * ref IS the address into it and no second mapping can drift out of step with the bookkeeping.
 */
export type StoryVisitedRef =
  | { kind: "scene"; sceneId: StorySceneId }
  | { kind: "option"; blockId: StoryBlockId };

/** The id one visited ref addresses, whichever arm it is - the key into the record's array. */
export function storyVisitedRefId(ref: StoryVisitedRef): string {
  return ref.kind === "scene" ? ref.sceneId : ref.blockId;
}

/** The word an author writes for this ref. The two arms are two spellings of one node kind. */
export function storyVisitedRefToken(ref: StoryVisitedRef): "visited" | "picked" {
  return ref.kind === "scene" ? "visited" : "picked";
}

/**
 * The two callee names that are neither variables nor whitelisted functions.
 *
 * They are recognised in the parser's call position only, so a project may still declare a variable
 * called `visited` and read it as `visited + 1`. Reserving the bare word would have been a breaking
 * change to documents that already exist, for no gain.
 */
export const STORY_VISITED_CALLS = ["visited", "picked"] as const;

export type StoryVisitedCall = (typeof STORY_VISITED_CALLS)[number];

export function isStoryVisitedCall(name: string): name is StoryVisitedCall {
  return (STORY_VISITED_CALLS as readonly string[]).includes(name);
}

/**
 * The bare word an author writes for the build variant: `AppTag == "Demo"`.
 *
 * Matched case-insensitively, the same convention `true` / `false` / `null` follow, and reserved -
 * a project may not read a variable of this name by its bare spelling. The quoted form `'AppTag'`
 * still addresses that variable, because quoting means "this exact declared name, verbatim"
 * everywhere else in the language too.
 */
export const APP_TAG_EXPR_KEYWORD = "AppTag";

/** The tree `AppTag` parses to. See the `appTag` entry in {@link STORY_EXPR_FUNCTIONS}. */
export function appTagExpr(): StoryExpr {
  return { kind: "call", fn: "appTag", args: [] };
}

export function isAppTagExpr(expr: StoryExpr): boolean {
  return expr.kind === "call" && expr.fn === "appTag";
}

export type StoryExpr =
  | { kind: "literal"; value: StoryLiteralValue }
  /** A resolved variable read. Resolution binds the author's identifier to a ref; the tree never stores a name. */
  | {
      kind: "var";
      target: StoryVariableRef;
      /** Author-facing name, for display and repair only - never used to resolve. */ name: string;
    }
  | { kind: "unary"; op: StoryExprUnaryOp; operand: StoryExpr }
  | { kind: "binary"; op: StoryExprBinaryOp; left: StoryExpr; right: StoryExpr }
  | { kind: "ternary"; test: StoryExpr; consequent: StoryExpr; alternate: StoryExpr }
  | { kind: "call"; fn: StoryExprFunction; args: StoryExpr[] }
  /** `[1, 2, 3]` - the list literal. The dictionary literal is deliberately absent; see below. */
  | { kind: "array"; items: StoryExpr[] }
  /**
   * `inv[0]`, `flags["ch1"]` - the one way into a collection. Chains (`a[0][1]`) nest these.
   *
   * There is deliberately no `.` member access. `saved.gold` / `scene.hp` / `persis.x` is already
   * *scope-prefix* syntax (see `SCOPE_PREFIXES` in `storyExpressionParser.ts`), and the tokenizer
   * reads a dotted name as a single token for exactly that reason - so `obj.key` cannot mean
   * member access without first making `saved.gold` ambiguous between "the saved-scope gold" and
   * "the `gold` key of a variable named `saved`". `obj["key"]` says the same thing with no such
   * collision, and takes a computed key besides.
   *
   * There is likewise no `{…}` object literal. Dialogue's inline interpolation IS `{gold}`, so a
   * brace in author-facing text is already spoken for; an expression that opened with `{` would be
   * read as an interpolation by the text layer before this parser ever saw it. The empty
   * dictionary is `dict()` and keys go in through `setKey`.
   */
  | { kind: "index"; target: StoryExpr; index: StoryExpr }
  /**
   * `visited(序章)` / `picked(那句拒绝)` - a read of the visited record (see
   * `runtime/game/storyVisited.ts`), which until now only blueprints could reach.
   *
   * A node kind rather than a function taking a string, for the reason every other reference in
   * this system is a ref: `visited("序章")` would silently stop matching the moment the author
   * renamed the scene, and the failure would read as "the player never went there" rather than as
   * a broken line. So resolution happens ONCE, at authoring time, against an injected table, and
   * the tree stores the id - exactly what `var`, `StoryVariableRef` and `StoryLayerRef` do.
   *
   * `name` is the author's own spelling, carried for display and repair only. Nothing resolves
   * through it; a renamed scene keeps matching and merely displays its old name until the row is
   * re-opened, which is the same bargain `var` strikes.
   */
  | {
      kind: "visited";
      target: StoryVisitedRef;
      /** Author-facing name, for display and repair only - never used to resolve. */ name: string;
    }
  /**
   * `bonus()` - call a `mode: "value"` Story Action Blueprint and use its `Return Value`.
   *
   * Zero arguments, by construction rather than by omission: this closes the one asymmetry left in
   * the language. An inline interpolation and a condition could each already name a blueprint
   * (`StoryInterpolationRef` / `StoryConditionRef` both have a `blueprint` arm); an *assignment*
   * could not, so `/set x bonus() * 2` had no spelling at all. Everything it needs already ships -
   * the authoring-time sync gate (`BlueprintNodeRegistry` refuses latent/impure nodes on a value
   * graph), `Return Value`, the synchronous evaluator, and the editor route - so this is a new
   * spelling for machinery in production, not new machinery.
   *
   * Parameters, scene scoping and import semantics are deliberately absent; those belong to the
   * separate `/import` milestone and would each need a storage and a lifetime of their own.
   *
   * Built-ins win the name (see the parser): `min()` is `min`, never a blueprint called "min".
   */
  | {
      kind: "invoke";
      blueprintId: string;
      /** Author-facing name, for display and repair only - never used to resolve. */ name: string;
    }
  /**
   * A subtree that did not parse or did not resolve. Kept so a committed expression is never
   * silently rewritten into something the author did not type; the compiler faults on it rather
   * than evaluating around it.
   */
  | { kind: "invalid"; source: string };

/** A stored expression: the tree that compiles, plus the text the author typed. */
export type StoryExpression = {
  source: string;
  ast: StoryExpr;
};

/** Static type of an expression, where knowable. `unknown` where a `json` variable or a mixed branch defeats inference. */
export type StoryExprType = "boolean" | "number" | "string" | "unknown";

export function isStoryExprFunction(name: string): name is StoryExprFunction {
  return (STORY_EXPR_FUNCTIONS as readonly string[]).includes(name);
}

/** Whether the tree contains no `invalid` node - i.e. whether the compiler may evaluate it. */
export function isStoryExpressionEvaluable(expr: StoryExpr): boolean {
  switch (expr.kind) {
    case "invalid":
      return false;
    case "literal":
    case "var":
    // Both resolved at parse time or they would not be here: an unknown scene / option /
    // blueprint name lands as `invalid`, so the presence of the node IS the proof it bound.
    case "visited":
    case "invoke":
      return true;
    case "unary":
      return isStoryExpressionEvaluable(expr.operand);
    case "binary":
      return isStoryExpressionEvaluable(expr.left) && isStoryExpressionEvaluable(expr.right);
    case "ternary":
      return (
        isStoryExpressionEvaluable(expr.test) &&
        isStoryExpressionEvaluable(expr.consequent) &&
        isStoryExpressionEvaluable(expr.alternate)
      );
    case "call":
      return expr.args.every(isStoryExpressionEvaluable);
    case "array":
      return expr.items.every(isStoryExpressionEvaluable);
    case "index":
      // Both halves: `inv[i]` is broken by a bad `i` just as surely as by a bad `inv`.
      return isStoryExpressionEvaluable(expr.target) && isStoryExpressionEvaluable(expr.index);
  }
}

/**
 * The sub-expressions of one node, in evaluation order.
 *
 * One place that states the shape of the tree, so a walk that only needs to *visit* every node does
 * not have to spell out a switch of its own - and so a node kind added later meets one exhaustive
 * switch rather than five near-identical ones that each silently stop descending.
 */
export function storyExprChildren(expr: StoryExpr): StoryExpr[] {
  switch (expr.kind) {
    case "literal":
    case "var":
    case "visited":
    case "invoke":
    case "invalid":
      return [];
    case "unary":
      return [expr.operand];
    case "binary":
      return [expr.left, expr.right];
    case "ternary":
      return [expr.test, expr.consequent, expr.alternate];
    case "call":
      return expr.args;
    case "array":
      return expr.items;
    case "index":
      return [expr.target, expr.index];
  }
}

/** Whether `AppTag` appears anywhere in the tree. */
export function storyExpressionMentionsAppTag(expr: StoryExpr): boolean {
  return isAppTagExpr(expr) || storyExprChildren(expr).some(storyExpressionMentionsAppTag);
}

/**
 * Every variant name the tree compares `AppTag` against, deduped, in encounter order.
 *
 * Only `AppTag == "…"` and `AppTag != "…"` count, and only against a string literal: those are the
 * two spellings whose meaning is decided entirely by the variant list, so they are the two a surface
 * can check a name against. `AppTag == someVariable` names nothing to check.
 */
export function collectAppTagComparisonNames(expr: StoryExpr): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const visit = (node: StoryExpr): void => {
    if (node.kind === "binary" && (node.op === "==" || node.op === "!=")) {
      const name =
        appTagComparedName(node.left, node.right) ?? appTagComparedName(node.right, node.left);
      if (name !== null && !seen.has(name)) {
        seen.add(name);
        found.push(name);
      }
    }
    storyExprChildren(node).forEach(visit);
  };

  visit(expr);
  return found;
}

/** The string `other` holds, when `tag` is the AppTag constant and `other` is a string literal. */
function appTagComparedName(tag: StoryExpr, other: StoryExpr): string | null {
  if (!isAppTagExpr(tag) || other.kind !== "literal" || typeof other.value !== "string") {
    return null;
  }
  return other.value;
}

/** Every variable the tree reads, in encounter order, deduped by ref identity. */
export function collectStoryExpressionVariables(expr: StoryExpr): StoryVariableRef[] {
  const found: StoryVariableRef[] = [];
  const seen = new Set<string>();

  const visit = (node: StoryExpr): void => {
    switch (node.kind) {
      case "var": {
        const key = storyVariableRefKey(node.target);
        if (!seen.has(key)) {
          seen.add(key);
          found.push(node.target);
        }
        return;
      }
      case "unary":
        visit(node.operand);
        return;
      case "binary":
        visit(node.left);
        visit(node.right);
        return;
      case "ternary":
        visit(node.test);
        visit(node.consequent);
        visit(node.alternate);
        return;
      case "call":
        node.args.forEach(visit);
        return;
      case "array":
        node.items.forEach(visit);
        return;
      case "index":
        // The index is an expression too, so `inv[slot]` reads BOTH variables - missing the
        // second is what would leave the compiler's `buildExpressionReader` without a slot
        // for it and evaluate the subscript as `undefined` at runtime.
        visit(node.target);
        visit(node.index);
        return;
      case "literal":
      case "invalid":
      // Neither reads a variable: a visited node reads the visited record and an invoke node
      // reads whatever its graph reads, and the graph's own reads are resolved by the
      // blueprint compiler, not by this tree's reader.
      case "visited":
      case "invoke":
        return;
    }
  };

  visit(expr);
  return found;
}

/**
 * Every blueprint the tree calls, in encounter order, deduped by id.
 *
 * The `invoke` counterpart to {@link collectStoryExpressionVariables}, and it exists for the same
 * reason: the compiler resolves each callee UP FRONT so a missing blueprint document (or a deleted
 * blueprint) refuses the whole expression at build time, rather than evaluating to a plausible
 * `null` in the middle of a scene.
 */
export function collectStoryExpressionInvocations(
  expr: StoryExpr
): { blueprintId: string; name: string }[] {
  const found: { blueprintId: string; name: string }[] = [];
  const seen = new Set<string>();

  const visit = (node: StoryExpr): void => {
    switch (node.kind) {
      case "invoke":
        if (!seen.has(node.blueprintId)) {
          seen.add(node.blueprintId);
          found.push({ blueprintId: node.blueprintId, name: node.name });
        }
        return;
      case "unary":
        visit(node.operand);
        return;
      case "binary":
        visit(node.left);
        visit(node.right);
        return;
      case "ternary":
        visit(node.test);
        visit(node.consequent);
        visit(node.alternate);
        return;
      case "call":
        node.args.forEach(visit);
        return;
      case "array":
        node.items.forEach(visit);
        return;
      case "index":
        visit(node.target);
        visit(node.index);
        return;
      case "literal":
      case "var":
      case "visited":
      case "invalid":
        return;
    }
  };

  visit(expr);
  return found;
}

/** A stable string identity for a variable ref, for deduping and map keys. */
export function storyVariableRefKey(ref: StoryVariableRef): string {
  // v9 (M-VAR): all three scopes address by `variableId`, so the key is uniform. The persistent key
  // string is unchanged from v8 (`persistent:<value>`) because a persistent variable's `variableId`
  // equals its old `storageKey`, keeping scene-snapshot value maps and dedup sets stable across the bump.
  return `${ref.scope}:${ref.variableId}`;
}

/** A literal-only expression, the shape `/set gold 100` produces and every legacy value migrates to. */
export function literalExpression(value: StoryLiteralValue, source?: string): StoryExpression {
  return { source: source ?? formatStoryLiteral(value), ast: { kind: "literal", value } };
}

/** Render a literal the way the author would have typed it, so a migrated value round-trips visibly. */
export function formatStoryLiteral(value: StoryLiteralValue): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}
