import { createPortal } from "react-dom";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type RefObject,
    type ReactNode,
} from "react";
import {
    ArrowDown,
    ArrowUp,
    ChevronDown,
    ChevronRight,
    Code2,
    Edit3,
    ListTree,
    Plus,
    Trash2,
} from "lucide-react";
import { Button, Input, TextArea } from "@/lib/components/elements";
import { Select, type SelectOption, type SelectProps } from "@/lib/components/elements/Select";
import {
    addJsonArrayItem,
    addJsonObjectField,
    coerceJsonValueToSchema,
    createJsonValueForKind,
    getJsonValueAtPath,
    getJsonValueKind,
    getJsonSchemaAtPath,
    isJsonObject,
    moveJsonArrayItem,
    normalizeJsonValue,
    removeJsonArrayItem,
    removeJsonObjectField,
    renameJsonObjectField,
    setJsonValueAtPath,
    summarizeJsonValue,
    validateJsonValueAgainstSchema,
    type JsonPath,
    type JsonValue,
    type JsonValueKind,
} from "./blueprintJsonValue";
import type { BlueprintJsonValueSchema } from "@/lib/ui-editor/blueprint-nodes/types";
import { useTranslation } from "@/lib/i18n";

type Props = {
    value: unknown;
    onChange: (next: JsonValue) => void;
    schema?: BlueprintJsonValueSchema;
};

const ICON_BUTTON =
    "nodrag !h-5 !w-5 shrink-0 !gap-0 rounded !p-1 text-fg-muted hover:bg-fill-subtle hover:text-fg";
const INPUT_CLASS = "h-6 rounded border-edge bg-[#111418] px-1.5 py-0.5 font-mono text-2xs";
const RAW_TEXTAREA_CLASS =
    "min-h-[300px] resize-none rounded border-edge bg-[#0d1014] px-2 py-1.5 font-mono text-2xs leading-relaxed";
const JSON_EDITOR_SCOPE_ATTRIBUTE = "data-blueprint-json-editor-scope";
const JSON_EDITOR_PANEL_Z_INDEX = 10000;
const JSON_EDITOR_MENU_Z_INDEX = JSON_EDITOR_PANEL_Z_INDEX + 1;

const JsonEditorScopeContext = createContext<string | null>(null);

function stopFlowNodePointerBubble(e: { stopPropagation: () => void }) {
    e.stopPropagation();
}

function pathKey(path: JsonPath): string {
    return path.length === 0 ? "$" : path.map(segment => String(segment)).join(".");
}

function toElement(target: EventTarget | null): Element | null {
    if (target instanceof Element) {
        return target;
    }
    if (target instanceof Node) {
        return target.parentElement;
    }
    return null;
}

function isJsonEditorTarget(
    target: EventTarget | null,
    panel: HTMLElement | null,
    trigger: HTMLElement | null,
    scopeId: string,
): boolean {
    const targetNode = target instanceof Node ? target : null;
    if (targetNode && (panel?.contains(targetNode) || trigger?.contains(targetNode))) {
        return true;
    }

    const targetElement = toElement(target);
    return Boolean(targetElement?.closest(`[${JSON_EDITOR_SCOPE_ATTRIBUTE}="${scopeId}"]`));
}

function JsonEditorSelect(props: SelectProps) {
    const scopeId = useContext(JsonEditorScopeContext);
    const scopedMenuAttributes = scopeId
        ? { [JSON_EDITOR_SCOPE_ATTRIBUTE]: scopeId }
        : undefined;

    return (
        <Select
            {...props}
            menuZIndex={props.menuZIndex ?? JSON_EDITOR_MENU_Z_INDEX}
            menuDataAttributes={{
                ...props.menuDataAttributes,
                ...scopedMenuAttributes,
            }}
        />
    );
}

function NumberValueInput({ value, onChange }: { value: number; onChange: (next: number) => void }) {
    const [draft, setDraft] = useState(String(value));

    useEffect(() => {
        setDraft(String(value));
    }, [value]);

    const invalid = draft.trim().length === 0 || !Number.isFinite(Number(draft));
    return (
        <Input
            className={`${INPUT_CLASS} min-w-[5rem] flex-1 ${invalid ? "border-red-400/70 text-red-100" : ""}`}
            type="number"
            value={draft}
            size="sm"
            onMouseDown={stopFlowNodePointerBubble}
            onPointerDown={stopFlowNodePointerBubble}
            onChange={e => {
                const next = e.target.value;
                setDraft(next);
                const n = Number(next);
                if (Number.isFinite(n)) {
                    onChange(n);
                }
            }}
        />
    );
}

function JsonObjectKeyInput({
    objectValue,
    objectPath,
    fieldKey,
    commitAtPath,
}: {
    objectValue: Record<string, JsonValue>;
    objectPath: JsonPath;
    fieldKey: string;
    commitAtPath: (path: JsonPath, next: JsonValue) => void;
}) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(fieldKey);

    useEffect(() => {
        setDraft(fieldKey);
    }, [fieldKey]);

    const trimmed = draft.trim();
    const invalid =
        trimmed.length === 0 ||
        (trimmed !== fieldKey && Object.prototype.hasOwnProperty.call(objectValue, trimmed));

    return (
        <Input
            className={`${INPUT_CLASS} min-w-[5.5rem] max-w-[8rem] ${
                invalid ? "border-red-400/70 text-red-100" : ""
            }`}
            type="text"
            value={draft}
            title={invalid ? t("blueprint.json.fieldNameInvalid") : t("blueprint.json.fieldName")}
            size="sm"
            onMouseDown={stopFlowNodePointerBubble}
            onPointerDown={stopFlowNodePointerBubble}
            onChange={e => {
                const nextDraft = e.target.value;
                setDraft(nextDraft);
                const result = renameJsonObjectField(objectValue, fieldKey, nextDraft);
                if (result.committed) {
                    commitAtPath(objectPath, result.value);
                }
            }}
        />
    );
}

function PrimitiveValueEditor({
    value,
    onChange,
}: {
    value: JsonValue;
    onChange: (next: JsonValue) => void;
}) {
    const { t } = useTranslation();
    if (typeof value === "string") {
        return (
            <Input
                className={`${INPUT_CLASS} min-w-[7rem] flex-1`}
                type="text"
                value={value}
                size="sm"
                onMouseDown={stopFlowNodePointerBubble}
                onPointerDown={stopFlowNodePointerBubble}
                onChange={e => onChange(e.target.value)}
            />
        );
    }
    if (typeof value === "number") {
        return <NumberValueInput value={value} onChange={onChange} />;
    }
    if (typeof value === "boolean") {
        return (
            <JsonEditorSelect
                options={[
                    { value: "true", label: t("blueprint.json.true") },
                    { value: "false", label: t("blueprint.json.false") },
                ]}
                value={value ? "true" : "false"}
                size="sm"
                onChange={next => onChange(String(next) === "true")}
                portalMenu
                menuPlacement="below"
                className="min-w-[6rem]"
            />
        );
    }
    if (value === null) {
        return <span className="px-1 text-2xs italic text-fg-subtle">null</span>;
    }
    return null;
}

function JsonTreeRow({
    root,
    path,
    schema,
    label,
    depth,
    expanded,
    setExpanded,
    commitRoot,
    objectKeyEditor,
    onRemove,
    arrayActions,
}: {
    root: JsonValue;
    path: JsonPath;
    schema?: BlueprintJsonValueSchema;
    label: ReactNode;
    depth: number;
    expanded: Set<string>;
    setExpanded: (next: Set<string>) => void;
    commitRoot: (next: JsonValue) => void;
    objectKeyEditor?: ReactNode;
    onRemove?: () => void;
    arrayActions?: ReactNode;
}) {
    const { t } = useTranslation();
    const kindOptions = useMemo<SelectOption[]>(
        () => [
            { value: "object", label: t("blueprint.json.object") },
            { value: "array", label: t("blueprint.json.array") },
            { value: "string", label: t("blueprint.json.string") },
            { value: "number", label: t("blueprint.json.number") },
            { value: "boolean", label: t("blueprint.json.boolean") },
            { value: "null", label: t("blueprint.json.null") },
        ],
        [t],
    );
    const value = getJsonValueAtPath(root, path) ?? null;
    const kind = getJsonValueKind(value);
    const expandable = kind === "object" || kind === "array";
    const schemaAtPath = getJsonSchemaAtPath(schema, path);
    const lockedKind = schemaAtPath?.kind;
    const key = pathKey(path);
    const isExpanded = expanded.has(key);
    const canAddChild =
        expandable &&
        (!schemaAtPath ||
            schemaAtPath.kind === "array" ||
            (schemaAtPath.kind === "object" && schemaAtPath.allowExtraFields === true));
    const objectFieldSchemas =
        schemaAtPath?.kind === "object" && schemaAtPath.fields ? schemaAtPath.fields : undefined;
    const objectFieldSchemaByKey = useMemo(() => {
        const out = new Map<string, NonNullable<BlueprintJsonValueSchema["fields"]>[number]>();
        for (const field of objectFieldSchemas ?? []) {
            out.set(field.key, field);
        }
        return out;
    }, [objectFieldSchemas]);
    const objectFieldKeys = useMemo(() => {
        if (!isJsonObject(value)) {
            return [];
        }
        if (!objectFieldSchemas || objectFieldSchemas.length === 0) {
            return Object.keys(value);
        }
        const ordered = objectFieldSchemas.map(field => field.key);
        if (schemaAtPath?.allowExtraFields === true) {
            const known = new Set(ordered);
            return [...ordered, ...Object.keys(value).filter(fieldKey => !known.has(fieldKey))];
        }
        return ordered;
    }, [objectFieldSchemas, schemaAtPath?.allowExtraFields, value]);

    const commitAtPath = useCallback(
        (targetPath: JsonPath, next: JsonValue) => {
            commitRoot(setJsonValueAtPath(root, targetPath, next));
        },
        [commitRoot, root],
    );

    const toggleExpanded = () => {
        const next = new Set(expanded);
        if (next.has(key)) {
            next.delete(key);
        } else {
            next.add(key);
        }
        setExpanded(next);
    };

    const changeKind = (nextKind: JsonValueKind) => {
        const nextValue = createJsonValueForKind(nextKind);
        commitAtPath(path, nextValue);
        if (nextKind === "object" || nextKind === "array") {
            setExpanded(new Set([...expanded, key]));
        }
    };

    const addChild = () => {
        if (kind === "object") {
            commitAtPath(path, addJsonObjectField(value).value);
        } else if (kind === "array") {
            commitAtPath(path, addJsonArrayItem(value));
        }
        setExpanded(new Set([...expanded, key]));
    };

    return (
        <div>
            <div
                className="flex min-h-[28px] min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-fill-subtle"
                style={{ paddingLeft: 4 + depth * 12 }}
            >
                {expandable ? (
                    <Button
                        type="button"
                        title={isExpanded ? t("common.collapse") : t("common.expand")}
                        aria-label={isExpanded ? t("common.collapse") : t("common.expand")}
                        variant="ghost"
                        size="sm"
                        className={ICON_BUTTON}
                        onMouseDown={stopFlowNodePointerBubble}
                        onPointerDown={stopFlowNodePointerBubble}
                        onClick={e => {
                            e.stopPropagation();
                            toggleExpanded();
                        }}
                    >
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </Button>
                ) : (
                    <span className="h-5 w-5 shrink-0" aria-hidden />
                )}
                <div className="flex min-w-0 flex-1 items-center gap-1">
                    {objectKeyEditor ?? (
                        <span className="min-w-[4.5rem] truncate text-2xs text-fg-muted" title={String(label)}>
                            {label}
                        </span>
                    )}
                    {lockedKind ? (
                        <span
                            className="w-[6.25rem] shrink-0 rounded border border-edge bg-[#0d1014] px-1.5 py-1 text-2xs capitalize tracking-wide text-fg-subtle"
                            title={t("blueprint.json.schemaFieldType")}
                        >
                            {lockedKind}
                        </span>
                    ) : (
                        <JsonEditorSelect
                            options={kindOptions}
                            value={kind}
                            size="sm"
                            onChange={next => changeKind(String(next) as JsonValueKind)}
                            portalMenu
                            menuPlacement="below"
                            className="w-[6.25rem] shrink-0"
                        />
                    )}
                    {expandable ? (
                        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-fg-subtle">
                            {summarizeJsonValue(value)}
                        </span>
                    ) : (
                        <PrimitiveValueEditor value={value} onChange={next => commitAtPath(path, next)} />
                    )}
                </div>
                {arrayActions}
                {canAddChild ? (
                    <Button
                        type="button"
                        title={t("blueprint.json.addItem")}
                        aria-label={t("blueprint.json.addItem")}
                        variant="ghost"
                        size="sm"
                        className={ICON_BUTTON}
                        onMouseDown={stopFlowNodePointerBubble}
                        onPointerDown={stopFlowNodePointerBubble}
                        onClick={e => {
                            e.stopPropagation();
                            addChild();
                        }}
                    >
                        <Plus className="h-3.5 w-3.5" />
                    </Button>
                ) : null}
                {onRemove ? (
                    <Button
                        type="button"
                        title={t("common.remove")}
                        aria-label={t("common.remove")}
                        variant="ghost"
                        size="sm"
                        className={`${ICON_BUTTON} hover:text-red-200`}
                        onMouseDown={stopFlowNodePointerBubble}
                        onPointerDown={stopFlowNodePointerBubble}
                        onClick={e => {
                            e.stopPropagation();
                            onRemove();
                        }}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                ) : null}
            </div>
            {isExpanded && isJsonObject(value)
                ? objectFieldKeys.map((fieldKey, index) => {
                      const childPath = [...path, fieldKey];
                      const fieldSchema = objectFieldSchemaByKey.get(fieldKey);
                      return (
                          <JsonTreeRow
                              key={`${pathKey(path)}:${index}`}
                              root={root}
                              path={childPath}
                              schema={schema}
                              label={fieldSchema?.label ?? fieldKey}
                              depth={depth + 1}
                              expanded={expanded}
                              setExpanded={setExpanded}
                              commitRoot={commitRoot}
                              objectKeyEditor={
                                  fieldSchema ? undefined : (
                                      <JsonObjectKeyInput
                                          objectValue={value}
                                          objectPath={path}
                                          fieldKey={fieldKey}
                                          commitAtPath={commitAtPath}
                                      />
                                  )
                              }
                              onRemove={
                                  fieldSchema?.required
                                      ? undefined
                                      : () => commitAtPath(path, removeJsonObjectField(value, fieldKey))
                              }
                          />
                      );
                  })
                : null}
            {isExpanded && Array.isArray(value)
                ? value.map((_, index) => {
                      const childPath = [...path, index];
                      return (
                          <JsonTreeRow
                              key={`${pathKey(path)}:${index}`}
                              root={root}
                              path={childPath}
                              schema={schema}
                              label={index}
                              depth={depth + 1}
                              expanded={expanded}
                              setExpanded={setExpanded}
                              commitRoot={commitRoot}
                              onRemove={() => commitAtPath(path, removeJsonArrayItem(value, index))}
                              arrayActions={
                                  <div className="flex shrink-0 items-center gap-0.5">
                                      <Button
                                          type="button"
                                          title={t("common.moveUp")}
                                          aria-label={t("common.moveUp")}
                                          variant="ghost"
                                          size="sm"
                                          disabled={index === 0}
                                          className={ICON_BUTTON}
                                          onMouseDown={stopFlowNodePointerBubble}
                                          onPointerDown={stopFlowNodePointerBubble}
                                          onClick={e => {
                                              e.stopPropagation();
                                              commitAtPath(path, moveJsonArrayItem(value, index, index - 1));
                                          }}
                                      >
                                          <ArrowUp className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                          type="button"
                                          title={t("common.moveDown")}
                                          aria-label={t("common.moveDown")}
                                          variant="ghost"
                                          size="sm"
                                          disabled={index >= value.length - 1}
                                          className={ICON_BUTTON}
                                          onMouseDown={stopFlowNodePointerBubble}
                                          onPointerDown={stopFlowNodePointerBubble}
                                          onClick={e => {
                                              e.stopPropagation();
                                              commitAtPath(path, moveJsonArrayItem(value, index, index + 1));
                                          }}
                                      >
                                          <ArrowDown className="h-3.5 w-3.5" />
                                      </Button>
                                  </div>
                              }
                          />
                      );
                  })
                : null}
        </div>
    );
}

function usePortalPanelStyle(open: boolean, triggerRef: RefObject<HTMLElement | null>) {
    const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });

    useLayoutEffect(() => {
        if (!open) {
            return undefined;
        }
        const update = () => {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (!rect) {
                return;
            }
            const width = Math.min(520, Math.max(360, window.innerWidth - 24));
            const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
            const top = Math.min(rect.bottom + 8, window.innerHeight - 420);
            setStyle({
                position: "fixed",
                left,
                top: Math.max(12, top),
                width,
                zIndex: JSON_EDITOR_PANEL_Z_INDEX,
            });
        };
        update();
        window.addEventListener("resize", update);
        window.addEventListener("scroll", update, true);
        return () => {
            window.removeEventListener("resize", update);
            window.removeEventListener("scroll", update, true);
        };
    }, [open, triggerRef]);

    return style;
}

function formatRawJson(value: JsonValue): string {
    return JSON.stringify(value, null, 2);
}

function parseRawJsonDraft(
    draft: string,
    schema?: BlueprintJsonValueSchema,
): { ok: true; value: JsonValue } | { ok: false; message: string } {
    const trimmed = draft.trim();
    if (!trimmed) {
        const value = coerceJsonValueToSchema(null, schema);
        const validation = validateJsonValueAgainstSchema(value, schema);
        return validation.ok ? { ok: true, value } : { ok: false, message: validation.message };
    }
    try {
        const parsed = normalizeJsonValue(JSON.parse(trimmed) as unknown);
        const validation = validateJsonValueAgainstSchema(parsed, schema);
        if (!validation.ok) {
            return validation;
        }
        return { ok: true, value: coerceJsonValueToSchema(parsed, schema) };
    } catch (error) {
        return {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
        };
    }
}

function JsonEditorPortal({
    root,
    schema,
    triggerRef,
    onChange,
    onClose,
}: {
    root: JsonValue;
    schema?: BlueprintJsonValueSchema;
    triggerRef: RefObject<HTMLElement | null>;
    onChange: (next: JsonValue) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["$"]));
    const [mode, setMode] = useState<"tree" | "raw">("tree");
    const [rawDraft, setRawDraft] = useState(() => formatRawJson(root));
    const [rawError, setRawError] = useState<string | null>(null);
    const reactId = useId();
    const scopeId = useMemo(
        () => `json-editor-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
        [reactId],
    );
    const style = usePortalPanelStyle(true, triggerRef);

    useEffect(() => {
        if (mode === "tree") {
            setRawDraft(formatRawJson(root));
            setRawError(null);
        }
    }, [mode, root]);

    const commitRawDraft = useCallback((): boolean => {
        if (mode !== "raw") {
            return true;
        }
        const parsed = parseRawJsonDraft(rawDraft, schema);
        if (!parsed.ok) {
            setRawError(parsed.message);
            return false;
        }
        setRawError(null);
        onChange(parsed.value);
        return true;
    }, [mode, onChange, rawDraft, schema]);

    const closeFromExternalInteraction = useCallback(() => {
        if (!commitRawDraft()) {
            return;
        }
        onClose();
    }, [commitRawDraft, onClose]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                closeFromExternalInteraction();
            }
        };
        const onPointerDown = (event: PointerEvent) => {
            if (!isJsonEditorTarget(event.target, panelRef.current, triggerRef.current, scopeId)) {
                closeFromExternalInteraction();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("pointerdown", onPointerDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("pointerdown", onPointerDown);
        };
    }, [closeFromExternalInteraction, scopeId, triggerRef]);

    const toggleMode = () => {
        if (mode === "raw") {
            if (!commitRawDraft()) {
                return;
            }
            setMode("tree");
            return;
        }
        setRawDraft(formatRawJson(root));
        setRawError(null);
        setMode("raw");
    };

    return createPortal(
        <div
            ref={panelRef}
            data-blueprint-json-editor-scope={scopeId}
            className="rounded-md border border-edge bg-[#111418] p-2 text-xs text-fg shadow-2xl"
            style={style}
            onMouseDownCapture={stopFlowNodePointerBubble}
            onPointerDownCapture={stopFlowNodePointerBubble}
            onWheelCapture={stopFlowNodePointerBubble}
        >
            <JsonEditorScopeContext.Provider value={scopeId}>
                <div className="mb-2 flex min-w-0 items-center gap-2 border-b border-edge pb-2">
                    <div className="min-w-0 flex-1">
                        <div className="text-2xs tracking-wide text-fg-subtle">{t("blueprint.json.label")}</div>
                        <div className="truncate font-mono text-2xs text-fg-muted">
                            {summarizeJsonValue(root)}
                        </div>
                    </div>
                    <Button
                        type="button"
                        title={mode === "raw" ? t("blueprint.json.treeEditor") : t("blueprint.json.rawJson")}
                        aria-label={mode === "raw" ? t("blueprint.json.treeEditor") : t("blueprint.json.rawJson")}
                        variant="ghost"
                        size="sm"
                        className={`${ICON_BUTTON} text-cyan-200 hover:text-cyan-100`}
                        onMouseDown={stopFlowNodePointerBubble}
                        onPointerDown={stopFlowNodePointerBubble}
                        onClick={e => {
                            e.stopPropagation();
                            toggleMode();
                        }}
                    >
                        {mode === "raw" ? <ListTree className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
                    </Button>
                </div>
                {mode === "raw" ? (
                    <div className="space-y-1.5">
                        <TextArea
                            className={`${RAW_TEXTAREA_CLASS} ${rawError ? "border-red-400/70 text-red-100" : ""}`}
                            value={rawDraft}
                            rows={12}
                            fullWidth
                            spellCheck={false}
                            onMouseDown={stopFlowNodePointerBubble}
                            onPointerDown={stopFlowNodePointerBubble}
                            onChange={event => {
                                setRawDraft(event.target.value);
                                if (rawError) {
                                    setRawError(null);
                                }
                            }}
                            onBlur={() => {
                                commitRawDraft();
                            }}
                        />
                        {rawError ? <div className="text-2xs text-red-300">{rawError}</div> : null}
                    </div>
                ) : (
                    <div className="max-h-[360px] overflow-auto pr-1">
                        <JsonTreeRow
                            root={root}
                            path={[]}
                            schema={schema}
                            label={t("blueprint.json.root")}
                            depth={0}
                            expanded={expanded}
                            setExpanded={setExpanded}
                            commitRoot={next => onChange(coerceJsonValueToSchema(next, schema))}
                        />
                    </div>
                )}
            </JsonEditorScopeContext.Provider>
        </div>,
        document.body,
    );
}

export function BlueprintJsonValueControl({ value, onChange, schema }: Props) {
    const { t } = useTranslation();
    const root = useMemo(() => coerceJsonValueToSchema(value, schema), [schema, value]);
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLDivElement | null>(null);
    const kind = getJsonValueKind(root);

    return (
        <div
            ref={triggerRef}
            className="flex min-w-0 items-center gap-1"
            onMouseDownCapture={stopFlowNodePointerBubble}
            onPointerDownCapture={stopFlowNodePointerBubble}
        >
            <div className="min-w-0 flex-1 rounded border border-edge bg-[#111418] px-1.5 py-1">
                <div className="text-2xs capitalize tracking-wide text-fg-subtle">{kind}</div>
                <div className="truncate font-mono text-2xs text-fg-muted" title={summarizeJsonValue(root)}>
                    {summarizeJsonValue(root)}
                </div>
            </div>
            <Button
                type="button"
                title={t("blueprint.json.edit")}
                aria-label={t("blueprint.json.edit")}
                variant="ghost"
                size="sm"
                className="nodrag !h-8 !w-8 shrink-0 !gap-0 rounded border border-edge !p-1.5 text-fg-muted hover:bg-fill-subtle"
                onMouseDown={stopFlowNodePointerBubble}
                onPointerDown={stopFlowNodePointerBubble}
                onClick={e => {
                    e.stopPropagation();
                    setOpen(v => !v);
                }}
            >
                <Edit3 className="h-3.5 w-3.5" />
            </Button>
            {open ? (
                <JsonEditorPortal
                    root={root}
                    schema={schema}
                    triggerRef={triggerRef}
                    onChange={next => onChange(coerceJsonValueToSchema(next, schema))}
                    onClose={() => setOpen(false)}
                />
            ) : null}
        </div>
    );
}
