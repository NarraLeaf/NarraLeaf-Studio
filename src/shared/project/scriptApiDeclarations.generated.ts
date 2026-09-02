/**
 * The host API half of a script blueprint's declarations, as text.
 *
 * GENERATED FILE - do not edit. Written from Studio's own source by
 * scripts/gen-script-api-dts.mjs; run that script after changing the script context or event
 * types, and `--check` in CI reports it as stale otherwise.
 *
 * Studio writes this into `scripts/.narraleaf/script.d.ts` when a project opens.
 */

export const SCRIPT_API_DECLARATIONS = `/**
 * Types for NarraLeaf Studio script blueprints.
 *
 * GENERATED FILE - do not edit. Written from Studio's own source by
 * scripts/gen-script-api-dts.mjs, and copied into your project by Studio.
 *
 * Import from "@narraleaf/script", always with \`import type\`:
 *
 *     import type { WidgetCtx, ScriptEvent } from "@narraleaf/script";
 *
 *     export function onMouseClick(ctx: WidgetCtx<"nl.button">, event: ScriptEvent<"mouseClick">) {
 *         ctx.host.devtools.log("info", "clicked");
 *     }
 */

declare module "@narraleaf/script" {
    type BlueprintOwnerRef = {
    	kind: "globalMain";
    } | {
    	kind: "surfaceMain";
    	surfaceId: string;
    } | {
    	kind: "widgetMain";
    	surfaceId: string;
    	elementId: string;
    } | {
    	kind: "widgetValue";
    	surfaceId: string;
    	elementId: string;
    	propPath: string;
    } | {
    	kind: "componentWidgetMain";
    	componentId: string;
    	elementId: string;
    }
    /**
     * Story Action Blueprint: an implicit project resource bound 1:1 to a single story action.
     * Self-referential - the owner key equals the blueprint id. Has no surface; its only event is
     * "On Call". Scene membership is derived at compile time, not baked into identity.
     *
     * \`mode\` distinguishes how the "On Call" graph is consumed:
     *  - "action" (default when absent): a story action block; the graph runs for its side effects
     *     and may use async ("latent") nodes.
     *  - "value": an inline text interpolation; the graph's Return Value is rendered inline and is
     *     therefore evaluated synchronously, so async nodes are disallowed while authoring.
     *  - "condition": a control-flow condition (if / else-if); the graph's Return Value is a boolean
     *     evaluated synchronously each time the branch is tested. Async nodes are disallowed and the
     *     return is type-checked to boolean while authoring.
     */
     | {
    	kind: "storyAction";
    	blueprintId: string;
    	mode?: "action" | "value" | "condition";
    };
    type LiteralValue = string | number | boolean | null | LiteralValue[] | {
    	[key: string]: LiteralValue;
    };
    type BlueprintElementRef = {
    	surfaceId: string;
    	elementId: string;
    	elementType: string;
    };
    type BlueprintVector2D = {
    	x: number;
    	y: number;
    };
    type BlueprintRect = {
    	x: number;
    	y: number;
    	width: number;
    	height: number;
    };
    type BlueprintRGBAColor = {
    	r: number;
    	g: number;
    	b: number;
    	a: number;
    };
    type BlueprintImageAsset = {
    	kind: "imageAsset";
    	assetId: string;
    };
    type BlueprintSoundHandle = {
    	kind: "soundHandle";
    	id: string;
    };
    type BlueprintDebugEvent = {
    	type: "execution.started";
    	executionId: string;
    	blueprintId: string;
    } | {
    	type: "execution.finished";
    	executionId: string;
    	blueprintId: string;
    } | {
    	type: "execution.cancelled";
    	executionId: string;
    	blueprintId?: string;
    	eventId?: string;
    	graphId?: string;
    	nodeId?: string;
    	reason?: string;
    } | {
    	type: "node.enter";
    	executionId: string;
    	nodeId: string;
    } | {
    	type: "node.exit";
    	executionId: string;
    	nodeId: string;
    } | {
    	type: "state.read";
    	scope: string;
    	key: string;
    } | {
    	type: "state.write";
    	scope: string;
    	key: string;
    } | {
    	type: "binding.evaluated";
    	bindingId: string;
    } | {
    	type: "function.call";
    	functionId: string;
    } | {
    	type: "function.return";
    	functionId: string;
    } | {
    	type: "devtools.log";
    	level: string;
    	message: string;
    } | {
    	type: "execution.error";
    	executionId: string;
    	message: string;
    	blueprintId?: string;
    	eventId?: string;
    	graphId?: string;
    	nodeId?: string;
    	/**
    	 * The UI surface whose graph failed, when the failure happened on one.
    	 *
    	 * The rest of this event names OUR ids - a blueprint, a graph, a node - none of which an
    	 * author can find their way back from. A surface id resolves against the document they
    	 * drew, which is what lets a host say "the Quick Menu" rather than "bp:8f2c1a…". Absent on
    	 * the global blueprint, which belongs to no surface.
    	 */
    	surfaceId?: string;
    };
    type BlueprintOpenExternalRequest = {
    	url: string;
    };
    type BlueprintOpenExternalOutcome = "opened" | "refused" | "failed";
    type BlueprintOpenExternalResult = {
    	outcome: BlueprintOpenExternalOutcome;
    	/** Human-readable reason, null when the page was handed over. */
    	error: string | null;
    };
    declare const BLUEPRINT_NETWORK_METHODS: readonly [
    	"GET",
    	"POST",
    	"PUT",
    	"PATCH",
    	"DELETE",
    	"HEAD"
    ];
    type BlueprintNetworkMethod = typeof BLUEPRINT_NETWORK_METHODS[number];
    type BlueprintNetworkFetchRequest = {
    	url: string;
    	method: BlueprintNetworkMethod;
    	/** Header name -> value. Null and \`{}\` both mean "send none". */
    	headers: Record<string, string> | null;
    	/** Request body, for the methods that carry one. */
    	body: string | null;
    	timeoutMs: number;
    };
    type BlueprintNetworkFetchOutcome = "success" | "httpError" | "networkError" | "timeout";
    type BlueprintNetworkFetchResult = {
    	outcome: BlueprintNetworkFetchOutcome;
    	/** HTTP status, or 0 when no response was received. */
    	status: number;
    	/** Response body text, present whenever a response arrived. */
    	body: string | null;
    	/** Human-readable failure reason, null on success. */
    	error: string | null;
    };
    type BlueprintPointerMoveOutcome = 
    /** The cursor is now at the requested point. */
    "moved"
    /** This shell cannot move the cursor: a web export, or a host with no platform support. */
     | "unsupported"
    /** The move was attempted and failed. */
     | "failed";
    type BlueprintPointerMoveResult = {
    	outcome: BlueprintPointerMoveOutcome;
    	error?: string;
    };
    declare const BLUEPRINT_POINTER_MOVE_EASINGS: readonly [
    	"linear",
    	"easeIn",
    	"easeOut",
    	"easeInOut"
    ];
    type BlueprintPointerMoveEasing = (typeof BLUEPRINT_POINTER_MOVE_EASINGS)[number];
    type BlueprintCharacterInfo = {
    	id: string;
    	/** Author-facing display name. Empty when the character is unnamed - never falls back to \`id\`, which is a UUID. */
    	name: string;
    	/**
    	 * The author's accent colour, already in pin shape. Null when the character has no colour set,
    	 * which is a different thing from "white" - see {@link blueprintCharacterColorOrDefault} for
    	 * what a non-nullable colour pin does with it.
    	 */
    	color: BlueprintRGBAColor | null;
    	/** The character's default dialog avatar, or null when it has none. */
    	avatar: BlueprintImageAsset | null;
    };
    type LocaleCode = string;
    type LocalizationLocaleEntry = {
    	code: LocaleCode;
    	/** Author-facing autonym shown to players (e.g. "日本語", never "Japanese"). */
    	displayName: string;
    	/** Optional intermediate fallback locale tried before the source locale. */
    	fallback?: LocaleCode;
    };
    type GameLocalizationBundle = {
    	sourceLocale: LocaleCode;
    	locales: LocalizationLocaleEntry[];
    	tables: Record<LocaleCode, Record<string, string>>;
    	/** Named-key source texts (key name → source-language text). */
    	keys?: Record<string, string>;
    	/**
    	 * Scene-name source texts (scene id → source-language name), for the scenes this build ships.
    	 *
    	 * The same job \`keys\` does for named keys: a translation table only holds the *target* side, so
    	 * without this a \`scene:\` reference read while the game is in the source language has nothing to
    	 * render but the id. Assembled from the story documents the bundle carries, so a scene a variant
    	 * dropped is absent here too.
    	 */
    	scenes?: Record<string, string>;
    };
    type StoryId = string;
    type StoryLiteralValue = string | number | boolean | null | StoryLiteralValue[] | {
    	[key: string]: StoryLiteralValue;
    };
    type SaveRecordTimes = {
    	/** When this slot was last written, epoch milliseconds; 0 when the record carries no stamp. */
    	savedAt: number;
    	/** When this slot was first written, epoch milliseconds; 0 when the record carries no stamp. */
    	createdAt: number;
    };
    type SaveRecordPlaytime = {
    	/** Seconds of play behind the slot; 0 when nothing was recorded. */
    	seconds: number;
    	/** False when the slot carries no reading at all. */
    	recorded: boolean;
    };
    type SaveRecordLine = {
    	/** The last sentence shown, or "" when the record carries none. */
    	line: string;
    	/** Who spoke it, or "" when the record carries no speaker (narration, or none yet). */
    	speaker: string;
    };
    type AutoSaveEntry = {
    	id: string;
    	/** Slot index within the ring. */
    	slot: number;
    	/** When this slot was last written, epoch milliseconds. */
    	timestamp: number;
    	/** When this slot was first written, epoch milliseconds. */
    	createdAt: number;
    	/** Whatever the writer attached as user metadata (null when none). */
    	metadata: unknown;
    };
    type VoiceLocaleEntry = {
    	code: LocaleCode;
    	/** Author-facing autonym shown for this voice language (e.g. "日本語"). */
    	displayName: string;
    };
    type UIInputActionSource = "pointer" | "key" | "gamepad" | "touch";
    type UIInputActionEventPayload = {
    	actionId: string;
    	source: UIInputActionSource;
    	x?: number;
    	y?: number;
    };
    declare const UI_STRUCT_FIELD_TYPES: readonly [
    	"string",
    	"number",
    	"boolean",
    	"image",
    	"color",
    	"json"
    ];
    type UIStructFieldType = (typeof UI_STRUCT_FIELD_TYPES)[number];
    type UIStructField = {
    	/**
    	 * Stable identity. Value bindings, node params and generated pins all address a field by this,
    	 * so renaming \`key\` costs nothing and reshuffling the list costs nothing.
    	 */
    	id: string;
    	/** The property name this field occupies inside an item object. */
    	key: string;
    	/**
    	 * What the author called it, shown in the item table header and in every field picker.
    	 *
    	 * Optional because \`key\` is usually already the readable name; a label is what lets a field
    	 * whose key has to stay ASCII (it travels in JSON to a plugin, a save file, a story variable)
    	 * still read as words in the editor.
    	 */
    	label?: string;
    	type: UIStructFieldType;
    };
    type UIStructId = string;
    type UIStructDef = {
    	id: UIStructId;
    	fields: UIStructField[];
    };
    type UIComponentId = string;
    type DevModeStartStoryRequest = {
    	storyId: StoryId;
    	sceneId: string;
    	/** Row-precise "play from here": enter the game pre-posed at this block and play forward. */
    	startBlockId?: string;
    	/** Scene Snapshot (变量快照) whose variable overrides seed the launch. */
    	snapshotId?: string;
    };
    type GameProgressImportOutcome = {
    	outcome: "found" | "missing" | "failed";
    	sceneId: string;
    	error: string;
    };
    type GameStorageDurability = "durable" | "evictable" | "unknown";
    type GradientKind = "linear" | "radial" | "conic";
    interface GradientStop {
    	/** 0..1 along the gradient line. */
    	offset: number;
    	/**
    	 * A stored colour string: a literal, or \`nlbrand:<id>[/<alpha>]\`. Deliberately unresolved - see
    	 * the file comment.
    	 */
    	color: string;
    }
    interface GradientFill {
    	kind: GradientKind;
    	/** Normalised to two or more, sorted by offset, offsets clamped to 0..1. */
    	stops: GradientStop[];
    	/** Linear and conic. Degrees, CSS convention: 0 points to the top, 90 to the right. */
    	angle?: number;
    	/** Radial and conic. 0..1 of the painted box. */
    	center?: {
    		x: number;
    		y: number;
    	};
    	/** Radial. 0..1 of the painted box, one radius per axis. */
    	radius?: {
    		x: number;
    		y: number;
    	};
    }
    type ImageFillMode = "cover" | "contain" | "stretch" | "crop" | "tile";
    interface ImageFillCropPlacement {
    	leftPct: number;
    	topPct: number;
    	widthPct: number;
    	heightPct: number;
    }
    interface ImageFill {
    	mode: ImageFillMode;
    	assetId?: string | null;
    	cropPlacement?: ImageFillCropPlacement;
    }
    type UIListItemScope = {
    	item: unknown;
    	index: number;
    	count: number;
    	key: string;
    	/**
    	 * Whether this is the selected row.
    	 *
    	 * On the scope because it belongs to the row rather than to any one widget in it: everything in
    	 * a selected row reads as selected, and each widget decides for itself whether it has an
    	 * appearance row that says so.
    	 */
    	selected?: boolean;
    	/**
    	 * The shape the owning list declared, carried rather than looked up.
    	 *
    	 * A field binding is resolved deep inside the element merge, which holds an element and a scope
    	 * and no document. Putting the struct on the scope keeps that read a read - the list already
    	 * resolved it once for its own columns and keys.
    	 */
    	struct?: UIStructDef | null;
    };
    type UIListScrollMetrics = {
    	offset: number;
    	maxOffset: number;
    	progress: number;
    };
    type AppearanceSystemCondition = Partial<{
    	hovered: boolean;
    	active: boolean;
    	disabled: boolean;
    	focused: boolean;
    	/** Inside the row a list has selected. */
    	selected: boolean;
    }>;
    type AppearanceRowValue = string | number | boolean | null | ImageFill | GradientFill | Record<string, unknown>;
    type AppearanceValueRow = {
    	conditions?: AppearanceSystemCondition | null;
    	value: AppearanceRowValue;
    };
    type AppearanceTransitionTweenEasing = "linear" | "easeIn" | "easeOut" | "easeInOut" | "circIn" | "circOut" | "circInOut";
    type AppearanceFieldTransition = {
    	type: "tween";
    	durationMs: number;
    	delayMs?: number;
    	easing: AppearanceTransitionTweenEasing;
    } | {
    	type: "spring";
    	delayMs?: number;
    	stiffness: number;
    	damping: number;
    	mass: number;
    };
    type ContainerAppearancePropertyKey = "backgroundColor" | "borderRadius" | "borderRadiusTL" | "borderRadiusTR" | "borderRadiusBL" | "borderRadiusBR" | "borderRadiusLinked" | "borderColor" | "borderWidth" | "borderStyle" | "backgroundImage" | "backgroundFit" | "imageFill" | "gradientFill" | "fillType" | "fillVisible" | "fillOpacity" | "strokeVisible" | "strokeOpacity" | "strokeAlign" | "strokeSide" | "borderJoin" | "cornerAdvanced" | "transformOffsetX" | "transformOffsetY" | "transformScale" | "transformRotation" | "transformOpacity" | "effectBlur" | "effectBackgroundBlur" | "effectShadow" | "effectInnerShadow" | "effectBlend" | "effectGlow" | "effectFilter";
    declare const BUTTON_CURSOR_VALUES: readonly [
    	"auto",
    	"default",
    	"pointer",
    	"text",
    	"move",
    	"grab",
    	"grabbing",
    	"crosshair",
    	"help",
    	"wait",
    	"progress",
    	"not-allowed"
    ];
    type ButtonCursorValue = (typeof BUTTON_CURSOR_VALUES)[number];
    type ButtonAppearancePropertyKey = "fontAssetId" | "fontSize" | "fontWeight" | "color" | "lineHeight" | "backgroundColor" | "fillType" | "fillOpacity" | "fillVisible" | "imageFill" | "gradientFill" | "backgroundImage" | "backgroundFit" | "borderRadius" | "borderWidth" | "borderColor" | "borderStyle" | "strokeOpacity" | "strokeSide" | "borderJoin" | "strokeAlign" | "paddingX" | "paddingY" | "clipContent" | "cursor" | "transformOffsetX" | "transformOffsetY" | "transformScale" | "transformRotation" | "transformOpacity" | "effectBlur" | "effectBackgroundBlur" | "effectShadow" | "effectTextShadow" | "effectInnerShadow" | "effectBlend" | "effectGlow" | "effectFilter";
    type TextAppearancePropertyKey = "fontAssetId" | "fontSize" | "fontWeight" | "fontStyle" | "color" | "lineHeight" | "transformOffsetX" | "transformOffsetY" | "transformScale" | "transformRotation" | "transformOpacity" | "effectBlur" | "effectTextShadow" | "effectBlend" | "effectFilter";
    type AppearancePropertyGroup = {
    	key: ContainerAppearancePropertyKey;
    	rows: AppearanceValueRow[];
    	transition?: AppearanceFieldTransition | null;
    } | {
    	key: ButtonAppearancePropertyKey;
    	rows: AppearanceValueRow[];
    	transition?: AppearanceFieldTransition | null;
    } | {
    	key: TextAppearancePropertyKey;
    	rows: AppearanceValueRow[];
    	transition?: AppearanceFieldTransition | null;
    };
    type AppearanceVariant = {
    	id: string;
    	name: string;
    	propertyGroups: AppearancePropertyGroup[];
    };
    type AppearanceModel = {
    	defaultVariantId: string;
    	variants: AppearanceVariant[];
    };
    type UISliderOrientation = "horizontal" | "vertical";
    type UISliderWidgetProps = {
    	value: number;
    	min: number;
    	max: number;
    	step: number;
    	orientation: UISliderOrientation;
    	trackElementId?: string | null;
    	handleElementId?: string | null;
    };
    type UISliderRange = {
    	min: number;
    	max: number;
    	step: number;
    };
    type UISliderRuntimeValue = UISliderRange & {
    	value: number;
    	normalizedValue: number;
    };
    type UISwitchWidgetProps = {
    	/** The author's starting state. What the player toggles lives in WidgetRuntimeStateStore. */
    	checked: boolean;
    	/** Blocks pointer and keyboard toggling. Looks are the \`disabled\` appearance signal's job. */
    	interactionDisabled: boolean;
    	trackElementId?: string | null;
    	thumbElementId?: string | null;
    };
    type UISwitchRuntimeValue = {
    	checked: boolean;
    };
    type UITextInputMode = "text" | "password" | "number";
    type UITextInputWidgetProps = {
    	value: string;
    	placeholder: string;
    	/** i18n attach-layer key for \`placeholder\`; player-facing text is never a Studio catalog key. */
    	placeholderLocalizationKey?: string | null;
    	inputMode: UITextInputMode;
    	/** 0 = unlimited. */
    	maxLength: number;
    	readOnly: boolean;
    	disabled: boolean;
    	textAlign: "left" | "center" | "right";
    };
    type UITextInputRuntimeValue = {
    	value: string;
    	/** Length in code points, so an emoji counts once - this is what \`maxLength\` is measured in. */
    	length: number;
    };
    type UIDisplayableMotionFromCurrentValue = {
    	from: "current";
    	to: number;
    };
    type UIDisplayableMotionValue = number | number[] | UIDisplayableMotionFromCurrentValue;
    type UIDisplayableMotionTarget = {
    	x?: UIDisplayableMotionValue;
    	y?: UIDisplayableMotionValue;
    	scale?: UIDisplayableMotionValue;
    	rotate?: UIDisplayableMotionValue;
    	opacity?: UIDisplayableMotionValue;
    };
    type UIDisplayableMotionTransition = {
    	type: "tween";
    	durationMs: number;
    	delayMs?: number;
    	easing?: string;
    } | {
    	type: "spring";
    	delayMs?: number;
    	stiffness: number;
    	damping: number;
    	mass: number;
    };
    type UIDisplayableMotionOverride = {
    	id: string;
    	target: UIDisplayableMotionTarget;
    	transition: UIDisplayableMotionTransition;
    	/** One-shot effects such as shake/pulse should hand control back to authored layout when finished. */
    	resetOnComplete?: boolean;
    };
    type TextWritingMode = "horizontal-tb" | "vertical-rl" | "vertical-lr";
    type TextGlyphOrientation = "mixed" | "upright" | "sideways";
    type TextWritingMode$1 = TextWritingMode;
    type TextOrientation = TextGlyphOrientation;
    type EffectShadowLayerData = {
    	offsetX: number;
    	offsetY: number;
    	blur: number;
    	spread: number;
    	color: string;
    };
    type FilterPresetId = "brightness" | "contrast" | "saturate" | "grayscale";
    type EffectShadowLayer = EffectShadowLayerData;
    type EffectShadowStored = {
    	storage: "layer";
    	layer: EffectShadowLayer;
    } | {
    	storage: "css";
    	css: string;
    };
    type EffectFilterStored = {
    	storage: "preset";
    	preset: FilterPresetId;
    	amount: number;
    } | {
    	storage: "css";
    	css: string;
    };
    type ElementEffectValues = {
    	effectBlur: number;
    	effectBackgroundBlur: number;
    	effectShadow: EffectShadowStored | null;
    	/** Text widgets: CSS text-shadow (separate from box-shadow \`effectShadow\`). */
    	effectTextShadow: EffectShadowStored | null;
    	effectInnerShadow: EffectShadowStored | null;
    	effectBlend: string;
    	effectGlow: EffectShadowStored | null;
    	effectFilter: EffectFilterStored | null;
    };
    type TextAlign = "left" | "center" | "right";
    type TextVerticalAlign = "start" | "center" | "end";
    type TextWrapMode = "word" | "character" | "nowrap";
    type TextWidgetProps = {
    	text: string;
    	/** Game-localization opt-in: registers the implicit translation unit \`ui:<elementId>.text\`. */
    	localizable?: boolean;
    	/** Named localization key reference; takes precedence over the implicit unit. */
    	localizationKey?: string;
    	fontSize: number;
    	color: string;
    	fontWeight: "normal" | "bold" | "600";
    	fontStyle: "normal" | "italic";
    	textAlign: TextAlign;
    	textVerticalAlign: TextVerticalAlign;
    	lineHeight: number;
    	/** Project font asset id when using a custom typeface in the editor; null inherits canvas default */
    	fontAssetId: string | null;
    	textWrapMode: TextWrapMode;
    	/**
    	 * Shrink the rendered text until it fits the element's box.
    	 *
    	 * The authored \`fontSize\` becomes a ceiling rather than a fixed value: the text is never set
    	 * larger than it, and never smaller than {@link TextWidgetProps.textAutoFitMinFontSize}. A line
    	 * that still does not fit at the floor is clipped, which is what every line does today.
    	 */
    	textAutoFit: boolean;
    	/** Smallest size auto fit may set, in px. */
    	textAutoFitMinFontSize: number;
    	/** Block flow. \`horizontal-tb\` leaves every other vertical setting inert. */
    	writingMode: TextWritingMode$1;
    	textOrientation: TextOrientation;
    	/**
    	 * 縦中横: sets a short Latin or digit run upright across the column instead of on its side,
    	 * the way a Japanese novel sets a two-digit number. Only read while writing vertically.
    	 */
    	tateChuYoko: boolean;
    	/** Longest run tate-chu-yoko combines, in characters. Two is the typographic convention. */
    	tateChuYokoMaxLength: number;
    	transformOffsetX: number;
    	transformOffsetY: number;
    	transformScale: number;
    	transformRotation: number;
    	transformOpacity: number;
    	/** Static baseline effects; appearance overlays may override per variant / state. */
    	effects: ElementEffectValues;
    	/** Optional variant + conditional row visuals; when absent, flat props are the sole source. */
    	appearance?: AppearanceModel | null;
    };
    type BlueprintPointerMoveOptions = {
    	durationSeconds?: number;
    	easing?: BlueprintPointerMoveEasing;
    };
    type BlueprintTextProperties = Pick<TextWidgetProps, "text" | "fontAssetId" | "fontSize" | "fontWeight" | "color" | "textAlign" | "textVerticalAlign" | "lineHeight" | "textWrapMode" | "effects">;
    type BlueprintTextPropertiesPatch = Partial<BlueprintTextProperties>;
    type BlueprintSliderProperties = UISliderRuntimeValue;
    type BlueprintSliderPropertiesPatch = Partial<Pick<UISliderWidgetProps, "value" | "min" | "max" | "step">>;
    type BlueprintSwitchProperties = UISwitchRuntimeValue;
    type BlueprintSwitchPropertiesPatch = Partial<Pick<UISwitchWidgetProps, "checked">>;
    type BlueprintTextInputProperties = UITextInputRuntimeValue;
    type BlueprintTextInputPropertiesPatch = Partial<Pick<UITextInputWidgetProps, "value">>;
    type BlueprintListProperties = {
    	items: unknown[];
    	selectedIndex: number;
    	/**
    	 * The shape the list declares, or null when it declares none.
    	 *
    	 * Carried with the items rather than fetched separately, because every node that reads a field
    	 * needs both and reading them apart is how the two drift: a graph that sorted by a field the
    	 * list no longer declares would sort by nothing and report success.
    	 */
    	struct: UIStructDef | null;
    	/**
    	 * Where the list has got to along its axis, as it last measured itself.
    	 *
    	 * A list that has not been rendered - or has been rendered somewhere with no runtime store, like
    	 * a Surface thumbnail - reports at-rest rather than nothing, so a graph asking gets the answer
    	 * for a list that cannot scroll instead of an undefined it has no way to branch on.
    	 */
    	scroll: UIListScrollMetrics;
    };
    type BlueprintDisplayableProperties = {
    	position: {
    		x: number;
    		y: number;
    	};
    	offset: {
    		x: number;
    		y: number;
    	};
    	/**
    	 * The extent the widget covers, never negative. The authored layout may hold a negative width
    	 * or height - that is how a widget dragged past its own origin is stored - and \`position\`
    	 * already reports the true top-left, so reporting the raw sign here would have described a
    	 * rectangle whose right edge sits left of its left edge.
    	 */
    	size: {
    		width: number;
    		height: number;
    	};
    	bounds: BlueprintRect;
    	rotation: number;
    	opacity: number;
    	display: boolean;
    	visible: boolean;
    };
    type BlueprintDisplayablePropertiesPatch = Partial<{
    	x: number;
    	y: number;
    	offsetX: number;
    	offsetY: number;
    	width: number;
    	height: number;
    	rotation: number;
    	opacity: number;
    	display: boolean;
    	visible: boolean;
    }>;
    type BlueprintDisplayableMotionRequest = {
    	id?: string;
    	target: UIDisplayableMotionTarget;
    	transition: UIDisplayableMotionTransition;
    	resetOnComplete?: boolean;
    	commitLayoutOnComplete?: Partial<Pick<BlueprintDisplayablePropertiesPatch, "x" | "y">>;
    };
    type BlueprintWidgetCommonProperties = {
    	visible: boolean;
    	enabled: boolean;
    	variantId: string | null;
    };
    type BlueprintButtonProperties = {
    	label: string;
    	cursor: ButtonCursorValue;
    };
    type BlueprintContainerProperties = {
    	clipContent: boolean;
    };
    type BlueprintImageProperties = {
    	asset: BlueprintImageAsset | null;
    	/** Legacy patch/read alias kept so older saved graph nodes can still run. */
    	assetId: string | null;
    	fitMode: ImageFillMode;
    	cropRect: ImageFillCropPlacement;
    	flipX: boolean;
    	flipY: boolean;
    };
    type BlueprintFrameProperties = {
    	targetSurfaceId: string | null;
    	params: Record<string, unknown>;
    };
    type BlueprintGamePreferenceKey = "autoForward" | "skip"
    /**
     * Studio's own, not the engine's: skipping stops at a line the player has not read.
     *
     * It lives in the engine's preference store all the same (see \`preferenceRuntime\`), which is
     * what lets it reach this API, the \`gamePreferenceChanged\` event and the project's preference
     * defaults through exactly the same plumbing as the twelve the engine defines.
     */
     | "skipReadText"
    /**
     * Studio's own, and transient: the skip run is going. Writing it is the equivalent of holding
     * the skip key, and the host clears it whenever the run ends - a guard stopping it, the game
     * leaving the stage, the window losing focus. Never persisted (see \`@shared/types/preference\`).
     */
     | "skipping"
    /**
     * Studio's own: the engine keeps this in \`game.config\`, not in its preference store, so the
     * host copies it across on every change (see \`preferenceRuntime\`).
     */
     | "autoForwardDelay" | "showDialog" | "gameSpeed" | "cps"
    /** Milliseconds a newly typed character takes to fade in; \`0\` types it at full strength. */
     | "textRevealDuration" | "voiceVolume" | "voiceFadeDuration" | "voiceEndMode" | "bgmVolume" | "soundVolume" | "globalVolume" | "skipDelay" | "skipInterval";
    type BlueprintGamePreferenceVoiceEndMode = "fade" | "stop" | "none";
    type BlueprintGamePreferenceValue = boolean | number | BlueprintGamePreferenceVoiceEndMode;
    type BlueprintLayerShowOptions = {
    	/** Everything below goes inert and the keys belong to this layer. */
    	modal?: boolean;
    	/** Whether Go back closes it. Default true. */
    	dismissible?: boolean;
    	/** Mutual-exclusion group; a second layer of an occupied group queues behind the first. */
    	group?: string | null;
    };
    type BlueprintHostApiRuntime = {
    	navigation: {
    		openSurface: (surfaceId: string, props?: unknown) => Promise<void>;
    		getPageProps: () => Record<string, unknown>;
    		pageBack: () => Promise<void>;
    		clearPages: () => Promise<void>;
    		clearGameOverlay: () => Promise<void>;
    		quitApplication: () => Promise<void>;
    		getFullscreen: () => Promise<boolean>;
    		setFullscreen: (fullscreen: boolean) => Promise<void>;
    		/** The sizes worth offering, ascending. Empty where the shell has no window to size. */
    		getWindowScaleOptions: () => Promise<number[]>;
    		getWindowScale: () => Promise<number>;
    		setWindowScale: (scale: number) => Promise<void>;
    		getWindowSize: () => Promise<{
    			width: number;
    			height: number;
    		}>;
    		setWindowSize: (width: number, height: number) => Promise<void>;
    		/**
    		 * Open one web address in the player's browser.
    		 *
    		 * The host does not decide: it hands the request to whatever the shell supplied, and the
    		 * shell's own process checks it against the addresses the build declared. Nothing here
    		 * consults the project's network setting, because no request is made - see
    		 * \`@shared/types/blueprint/externalLink\`.
    		 */
    		openExternal: (request: BlueprintOpenExternalRequest) => Promise<BlueprintOpenExternalResult>;
    	};
    	/** Surfaces stacked over the page lane. See the \`layers\` family in \`@shared/types/blueprint/hostApi\`. */
    	layers: {
    		/** Put a page up as a layer and return the handle that names it. */
    		show: (surfaceId: string, props?: unknown, options?: BlueprintLayerShowOptions) => Promise<string>;
    		/** Take that layer down, settling once it has finished animating out. */
    		hide: (handle: string) => Promise<void>;
    		/** Take a whole group down - what is on screen and what is queued behind it. */
    		hideGroup: (group: string) => Promise<void>;
    		/** Wait for that layer to close and read what it closed with. Null for a handle already gone. */
    		wait: (handle: string) => Promise<unknown>;
    		/** Close the layer the calling graph runs in. A no-op with a warning anywhere else. */
    		closeSelf: (result?: unknown) => Promise<void>;
    		isMounted: (handle: string) => boolean;
    	};
    	widget: {
    		setVisible: (elementId: string, visible: boolean) => Promise<void>;
    		setEnabled: (elementId: string, enabled: boolean) => Promise<void>;
    		/** \`null\` clears runtime override and restores authored default variant resolution. */
    		setVariant: (elementId: string, variantId: string | null, options?: {
    			waitForTransition?: boolean;
    		}) => Promise<void>;
    		getCommonProperties: (elementId: string) => BlueprintWidgetCommonProperties;
    		getTextProperties: (elementId: string) => BlueprintTextProperties;
    		setTextProperties: (elementId: string, patch: BlueprintTextPropertiesPatch) => Promise<void>;
    		getButtonProperties: (elementId: string) => BlueprintButtonProperties;
    		setButtonProperties: (elementId: string, patch: Partial<BlueprintButtonProperties>) => Promise<void>;
    		getContainerProperties: (elementId: string) => BlueprintContainerProperties;
    		setContainerProperties: (elementId: string, patch: Partial<BlueprintContainerProperties>) => Promise<void>;
    		getImageProperties: (elementId: string) => BlueprintImageProperties;
    		setImageProperties: (elementId: string, patch: Partial<BlueprintImageProperties>) => Promise<void>;
    		getSliderProperties: (elementId: string) => BlueprintSliderProperties;
    		setSliderProperties: (elementId: string, patch: BlueprintSliderPropertiesPatch) => Promise<void>;
    		getSwitchProperties: (elementId: string) => BlueprintSwitchProperties;
    		setSwitchProperties: (elementId: string, patch: BlueprintSwitchPropertiesPatch) => Promise<void>;
    		getTextInputProperties: (elementId: string) => BlueprintTextInputProperties;
    		setTextInputProperties: (elementId: string, patch: BlueprintTextInputPropertiesPatch) => Promise<void>;
    		getListProperties: (elementId: string) => BlueprintListProperties;
    		setListItems: (elementId: string, items: readonly unknown[]) => Promise<void>;
    		setListSelectedIndex: (elementId: string, index: number) => Promise<void>;
    		scrollListToIndex: (elementId: string, index: number) => Promise<void>;
    		scrollListToTop: (elementId: string) => Promise<void>;
    		scrollListToBottom: (elementId: string) => Promise<void>;
    		getDisplayableProperties: (elementId: string) => BlueprintDisplayableProperties;
    		/**
    		 * What the widget currently covers on screen, in the coordinates of the surface it is on,
    		 * or \`null\` when nothing is painted for it.
    		 *
    		 * Separate from {@link getDisplayableProperties} because the two answer different
    		 * questions. That one reads the document - where the author put the widget - and is the
    		 * right answer for layout arithmetic. This one measures the DOM, so it accounts for a
    		 * motion in flight, an appearance variant that shifted the widget, a text box sized to its
    		 * own words, and which row of a list an instance ended up on.
    		 */
    		getMeasuredRect: (elementId: string) => BlueprintRect | null;
    		setDisplayableProperties: (elementId: string, patch: BlueprintDisplayablePropertiesPatch) => Promise<void>;
    		animateDisplayable: (elementId: string, request: BlueprintDisplayableMotionRequest) => Promise<UIDisplayableMotionOverride>;
    		stopDisplayableAnimation: (animationId: string) => Promise<void>;
    		getFrameProperties: (elementId: string) => BlueprintFrameProperties;
    		setFrameProperties: (elementId: string, patch: Partial<BlueprintFrameProperties>) => Promise<void>;
    	};
    	state: {
    		get: (scope: string, key: string) => unknown;
    		set: (scope: string, key: string, value: unknown) => void;
    	};
    	persistence: {
    		get: (key: string) => Promise<unknown>;
    		set: (key: string, value: unknown) => Promise<void>;
    	};
    	localization: {
    		/** Localization setup of the running game, or null when the project has none. */
    		getConfig: () => GameLocalizationConfigSnapshot | null;
    		/** Effective current locale (stored player choice, else the source locale). */
    		getLocale: () => Promise<string>;
    		/** Persist the player's language choice; callers validate against getConfig(). */
    		setLocale: (code: string) => Promise<void>;
    	};
    	/**
    	 * Voice-over: which dub the player hears, and replaying a take on demand.
    	 *
    	 * Separate from \`localization\` because dub language and subtitle language are separate player
    	 * choices - a game may be read in English and heard in Japanese.
    	 */
    	voice: {
    		/** The dub languages this build ships, in project order. Empty when the game has no voice. */
    		listLocales: () => VoiceLocaleEntry[];
    		/** Effective dub language: the stored player choice when the build ships it, else the first. */
    		getLocale: () => Promise<string>;
    		/** Persist the player's dub choice. Takes effect from the next spoken line - no restart. */
    		setLocale: (code: string) => Promise<void>;
    		/**
    		 * Play one line's take in the current dub language, on that speaker's bus.
    		 *
    		 * The id is a voice unit id - the same id a backlog entry reports as \`voiceId\` - which is why
    		 * a replay button is built from this rather than from the entry's resolved URL. Resolves to
    		 * false when the line has no take in the current language.
    		 */
    		play: (unitId: string) => Promise<boolean>;
    		/**
    		 * Play one choice option's take, at most one instance of that option at a time.
    		 *
    		 * Same clip and same bus as {@link play}; what differs is the bookkeeping a menu needs. A
    		 * hover fires as often as the pointer crosses a row, so a line already speaking is left
    		 * alone rather than restarted, and it answers false. \`interruptOthers\` stops the takes of
    		 * the *other* options - the author's call, because a menu that reads each option over the
    		 * last is as deliberate a design as one that speaks a single line at a time.
    		 */
    		playChoice: (unitId: string, options?: {
    			interruptOthers?: boolean;
    		}) => Promise<boolean>;
    	};
    	frame: {
    		getParam: (key: string) => unknown;
    		emit: (eventName: string, data: unknown) => Promise<void>;
    	};
    	game: {
    		/**
    		 * Begin a story. \`options.inheritSavedGame\` carries a save's saved-scope values and visited
    		 * scenes into the new game - see the \`Inherit From\` pin - and carries nothing else.
    		 */
    		startStory: (request: DevModeStartStoryRequest, options?: {
    			inheritSavedGame?: unknown;
    		}) => Promise<void>;
    		/** The running playthrough as a serialized game, or null when none is running. */
    		captureRun: () => unknown | null;
    		/** The serialized game stored in a slot, or null when there is no such slot. */
    		readSaveGame: (id: string) => Promise<unknown | null>;
    		isInGame: () => boolean;
    		isGameOverlay: () => boolean;
    		quit: (surfaceId: string) => Promise<void>;
    		writeSave: (id: string, metadata?: unknown, screenshot?: boolean) => Promise<void>;
    		/** False when the save was not applied - the player and the author have both been told. */
    		loadSave: (id: string) => Promise<boolean>;
    		deleteSave: (id: string) => Promise<void>;
    		listSaveIds: () => Promise<string[]>;
    		getSaveMetadata: (id: string) => Promise<unknown>;
    		/** When a slot was written, or null when there is no such slot. */
    		getSaveTimes: (id: string) => Promise<SaveRecordTimes | null>;
    		/** Where a slot stopped, or null when there is no such slot. */
    		getSaveLine: (id: string) => Promise<SaveRecordLine | null>;
    		/** How long a slot was played, or null when there is no such slot. */
    		getSavePlaytime: (id: string) => Promise<SaveRecordPlaytime | null>;
    		/** The running playthrough's playtime, in seconds. */
    		getPlaytime: () => number;
    		/** Seconds ever spent in this project, across every playthrough. */
    		getTotalPlaytime: () => number;
    		getSavePreview: (id: string) => Promise<BlueprintImageAsset | null>;
    		/** Write an autosave into the reserved ring now, regardless of the timer. */
    		writeAutoSave: () => Promise<void>;
    		/** The reserved autosave ring, newest first. Never overlaps \`listSaveIds\`. */
    		listAutoSaves: () => Promise<AutoSaveEntry[]>;
    		/**
    		 * The backlog behind the play head, oldest first.
    		 *
    		 * From engine 0.26.0 this stops at the head: after the player steps back, the lines they
    		 * stepped past are no longer in here, they are in {@link getFuture}. Before anyone steps
    		 * back - which is every ordinary playthrough - the two are the whole backlog and nothing.
    		 */
    		getHistory: () => Promise<BlueprintGameHistoryEntry[]>;
    		/** The lines ahead of the play head, nearest first. Empty until the player steps back. */
    		getFuture: () => Promise<BlueprintGameHistoryEntry[]>;
    		/** Jump back to a history entry by id; omit the id to undo the last entry. */
    		restoreHistory: (id?: string) => Promise<void>;
    		/** Step the play head forward one line, back over a line the player has already read. */
    		redoHistory: () => Promise<void>;
    		canUndoHistory: () => boolean;
    		canRedoHistory: () => boolean;
    		getNametag: () => string | null;
    		/**
    		 * The speaking character's dialog avatar, or null. Already keyed on the differential the
    		 * character is currently wearing - the engine resolves it off the live portrait element.
    		 */
    		getSpeakerAvatar: () => BlueprintImageAsset | null;
    		/**
    		 * The speaking character's authored accent colour, already in pin shape. Opaque white when
    		 * nobody is speaking, the narrator is, or the character has no colour - the pin it feeds is
    		 * a non-nullable RGBAColor, so "no colour" and "the default colour" are the same answer.
    		 */
    		getSpeakerColor: () => BlueprintRGBAColor;
    		/**
    		 * Has the line on screen finished revealing, with the dialog now waiting for the player.
    		 *
    		 * False while it is still typing, and false again the moment the next line mounts, so an
    		 * indicator bound to it needs no timer of its own. False with no dialog on screen at all.
    		 */
    		isDialogWaiting: () => boolean;
    		/**
    		 * The current line's text - the whole line, not the part revealed so far. Empty string when
    		 * no line is on screen.
    		 */
    		getDialogText: () => string;
    		/**
    		 * Does the current line have no speaker. Distinct from a null nametag, which a character
    		 * with a blank name also reports. False when no line is on screen.
    		 */
    		isNarrator: () => boolean;
    		/**
    		 * Any character by id, from the table mirrored into global state - the addressable read the
    		 * speaker-scoped getters above cannot do. Null when the id is empty, or names a character
    		 * that is not (or is no longer) in the project.
    		 */
    		getCharacter: (characterId: string) => BlueprintCharacterInfo | null;
    		getNotifications: () => BlueprintGameNotification[];
    		getChoiceCount: () => number;
    		isNvlMode: () => boolean;
    		/** True while a dialog line is on screen and its message is marked read. */
    		isCurrentTextRead: () => boolean;
    		isTextRead: (textId: string) => boolean;
    		/** Wipe the persisted text-read record (all stories). */
    		clearTextRead: () => Promise<void>;
    		/**
    		 * Has the player ever ENTERED this scene, by Studio scene id.
    		 *
    		 * Not the same question as \`isTextRead\`: that record is written when a line is displayed,
    		 * this one when a scene actually starts. Saved-domain, so loading an older save rewinds it.
    		 */
    		isSceneVisited: (sceneId: string) => boolean;
    		/**
    		 * One saved variable of the running playthrough, by the id a \`savedVariableRef\` names.
    		 *
    		 * \`found\` is false with no game running, and with an id this build's story does not
    		 * declare. The two are worth telling apart from a value: \`null\` and the declared default
    		 * are both real values a variable can hold, so neither can double as "there was nothing to
    		 * read". See the capability's own note for why this is read-only.
    		 */
    		getSavedVariable: (variableId: string) => {
    			value: unknown;
    			found: boolean;
    		};
    		/**
    		 * Write one saved variable of the running playthrough.
    		 *
    		 * Throws when there is no game, when the id names nothing this build declares, and when the
    		 * value cannot go into a save file. All three are authoring errors a button would otherwise
    		 * swallow; see the capability's own note for what a write from a screen does and does not do.
    		 */
    		setSavedVariable: (variableId: string, value: unknown) => void;
    		/**
    		 * Has the player ever PICKED this choice option, by the option row's Studio block id. The
    		 * one thing the text-read record structurally cannot answer - a menu that merely appeared
    		 * marks every option of it read.
    		 */
    		isOptionPicked: (optionId: string) => boolean;
    		/**
    		 * Wipe the visited record of the running game.
    		 *
    		 * Synchronous, unlike \`clearTextRead\`: the record lives in the live \`Storable\`, not in host
    		 * persistence, so there is nothing to await. It is also scoped to the running session - with
    		 * no game up there is no record, and the call is a no-op instead of an error.
    		 */
    		clearVisited: () => void;
    		/**
    		 * Has the player ever reached this ending, by the \`ending\` row's Studio block id.
    		 *
    		 * Project persistence rather than the save file, unlike the visited record above: an endings
    		 * screen reports what this player has ever seen, so loading an older save must not re-lock
    		 * anything. Needs no running story - a title screen asks it before the first game exists.
    		 */
    		isEndingReached: (endingId: string) => boolean;
    		/**
    		 * Is this DLC installed beside the running build, by the id the author gave it.
    		 *
    		 * The whole of what a game may ask about its DLC, and deliberately not "does the player own
    		 * it". Ownership is a storefront's fact and a plugin's to answer; what decides whether the
    		 * content is here is whether its file is, which is the question this asks. A build with no
    		 * DLC beside it answers false to everything, which is what a title screen wants before the
    		 * player has bought anything.
    		 */
    		isDlcInstalled: (dlcId: string) => boolean;
    		/**
    		 * Every ending one story declares, in document order, each row already carrying whether it
    		 * was reached. Empty for an unknown or unnamed story rather than an error.
    		 *
    		 * The list comes from the story document this build ships, so it can never offer an ending
    		 * the compiler does not emit, and it is available with no game running for the same reason
    		 * the reader above is.
    		 */
    		listEndings: (storyId: string) => BlueprintStoryEnding[];
    		/**
    		 * Forget one ending. Awaited, unlike \`clearVisited\`: this writes host persistence rather
    		 * than a live \`Storable\`, and a caller that navigates away on the next beat has to know the
    		 * write landed.
    		 */
    		clearEndingState: (endingId: string) => Promise<void>;
    		/** Wipe the whole endings record. The \`Clear Text Read\` of this family. */
    		clearEndings: () => Promise<void>;
    		choose: (index: number) => Promise<void>;
    		next: () => Promise<void>;
    		skip: () => Promise<void>;
    		showDialog: () => Promise<void>;
    		hideDialog: () => Promise<void>;
    		toggleDialogDisplay: () => Promise<void>;
    		setSentenceSpeed: (cps: number) => Promise<void>;
    		getPreference: (key: BlueprintGamePreferenceKey) => BlueprintGamePreferenceValue;
    		setPreference: (key: BlueprintGamePreferenceKey, value: BlueprintGamePreferenceValue) => Promise<void>;
    	};
    	sound: {
    		play: (input: BlueprintSoundPlayInput) => Promise<BlueprintSoundHandle | null>;
    		stop: (handle: BlueprintSoundHandle | null, fadeMs?: number) => Promise<void>;
    		pause: (handle: BlueprintSoundHandle) => Promise<void>;
    		resume: (handle: BlueprintSoundHandle) => Promise<void>;
    		/** Ramp rather than jump when \`fadeMs\` is set - this is also the fade-out/duck node. */
    		setVolume: (handle: BlueprintSoundHandle, volume: number, fadeMs?: number) => Promise<void>;
    		/** Milliseconds from the start of the file, not from the clip's in point. */
    		seek: (handle: BlueprintSoundHandle, timeMs: number) => Promise<void>;
    		isPlaying: (handle: BlueprintSoundHandle) => boolean;
    		/**
    		 * The volume a **host-owned** media element (the \`nl.video\` widget's \`<video>\`) must be set
    		 * to so it obeys the same mixer everything else does.
    		 *
    		 * A DOM element the host created sits on none of the engine's gain nodes, so the whole
    		 * product has to be computed and written to \`element.volume\`: the authored volume, times
    		 * every bus in the track's chain, times the player's slider for whichever seeded bus that
    		 * chain runs through, times master. Without this a muted game keeps playing video at full
    		 * volume. Pair it with {@link subscribeMixerChanges} - a value read once goes stale the
    		 * moment the player drags a slider, bus faders included.
    		 */
    		resolveElementVolume: (input: {
    			audioTrackId?: string | null;
    			volume?: number | null;
    		}) => number;
    		/** Fires when any preference feeding \`resolveElementVolume\` changes. Returns a disposer. */
    		subscribeMixerChanges: (listener: () => void) => () => void;
    		/**
    		 * An audio **track**'s own volume, 0..1 - one strip of the player's mixer.
    		 *
    		 * The player-facing counterpart of {@link setVolume}, which addresses one playing clip by
    		 * handle. A track is a bus every clip beneath it is routed through, so setting one applies
    		 * live to everything already playing and survives the clip that provoked it. This is what
    		 * makes "turn Alice down" expressible at all: the four fixed volume preferences can only
    		 * reach the three buses the engine seeds.
    		 *
    		 * An unknown or deleted track id reads as unity and writes nowhere, so a settings page
    		 * built against a track the author later removed degrades to an inert slider.
    		 */
    		getTrackVolume: (trackId: string) => number;
    		setTrackVolume: (trackId: string, volume: number) => Promise<void>;
    	};
    	/**
    	 * HTTP, for the Fetch node.
    	 *
    	 * The host does not issue the request itself: it hands it to whatever the shell supplied, which
    	 * on desktop and in Dev Mode is the main process (\`onNetworkFetch\`). Nothing here calls
    	 * \`fetch()\` - see \`@shared/utils/blueprintNetworkFetch\` for why the renderer must not.
    	 */
    	network: {
    		fetch: (request: BlueprintNetworkFetchRequest) => Promise<BlueprintNetworkFetchResult>;
    	};
    	/**
    	 * The read side of input routing, for \`Is Action Held\` and \`Get Input Device\`.
    	 *
    	 * The only part of the input model a graph can ask about rather than be told about. Everything
    	 * else in it is a dispatch - an action fires, a head runs - and none of that can answer "while
    	 * the gesture is down" or "with which hand", because a fired event leaves nothing behind that
    	 * says whether the hand is still there or what it was.
    	 *
    	 * Structural rather than a declared family in \`@shared/types/blueprint/hostApi\`, matching how
    	 * both nodes reach for it (see \`BlueprintInputActionHostApi\`): the contract there names
    	 * capabilities a host may or may not implement, and these are answered by the window every host
    	 * already has.
    	 */
    	input: {
    		isActionHeld: (actionId: string) => boolean;
    		/**
    		 * Which device the player is using at this moment.
    		 *
    		 * One of the four values the \`On Action\` head's \`source\` pin carries, typed as a plain
    		 * string so a graph compares both against the same literals.
    		 */
    		getDevice: () => string;
    	};
    	/**
    	 * Moving the player's real cursor, for the Move Mouse family.
    	 *
    	 * The author names a point in a surface's own coordinates, which is the only frame they have
    	 * reason to think in. Turning that into a point in the window happens here, off the same
    	 * surface shell every mouse event's payload is divided by, so "the centre of this button"
    	 * measured by \`widget.getMeasuredRect\` and the point the cursor lands on are the same place.
    	 *
    	 * \`surfaceId\` is the surface the point belongs to; \`null\` means the active one. A point on a
    	 * surface that is not currently laid out has nowhere to be, and reports \`failed\` rather than
    	 * being guessed at against a different surface's scale.
    	 */
    	pointer: {
    		moveTo: (surfaceId: string | null, point: BlueprintVector2D, options?: BlueprintPointerMoveOptions) => Promise<BlueprintPointerMoveResult>;
    		/**
    		 * The same act aimed at a widget's centre, measured rather than computed from the document.
    		 *
    		 * A method of its own rather than something a caller assembles out of \`getMeasuredRect\` and
    		 * \`moveTo\`, because the two halves have to agree about which surface the widget turned out
    		 * to be painted on. A component instance renders its contents wherever it was placed, so
    		 * the answer is not always the surface the element was authored under, and a caller
    		 * stitching the halves together would have to know that to get it right.
    		 */
    		moveToElementCenter: (elementId: string, options?: BlueprintPointerMoveOptions) => Promise<BlueprintPointerMoveResult>;
    	};
    	/**
    	 * Carrying a playthrough between two editions of one title, for the Export/Import Progress
    	 * nodes.
    	 *
    	 * The host does not decide where the document is: it hands the act to whatever the shell
    	 * supplied, and the shell's own process resolves the file from the build's progress key. What
    	 * this side states is what the playthrough holds, never where it goes.
    	 *
    	 * \`import\` answers with a scene id rather than going anywhere with it. The node deliberately
    	 * does not jump - \`Start Game\` is what starts a story, and an author's graph usually has
    	 * something to do first.
    	 */
    	progress: {
    		export: () => Promise<{
    			outcome: "written" | "failed";
    			error: string;
    		}>;
    		import: () => Promise<GameProgressImportOutcome>;
    	};
    	/**
    	 * What the shell can promise about the data it writes, for the \`Check Storage Durability\` node.
    	 *
    	 * A fact about where the game is running, not about the playthrough: a packaged desktop game
    	 * keeps files nothing reclaims, a web export holds whatever grant the browser gave it. Stated,
    	 * never acted on - what a player is told about it belongs to the title.
    	 */
    	storage: {
    		durability: () => Promise<GameStorageDurability>;
    	};
    	devtools: {
    		log: (level: string, message: string) => void;
    	};
    };
    type BlueprintSoundPlayInput = {
    	assetId: string;
    	/**
    	 * Project audio track (\`ProjectAudioTrack.id\`), which **is** the engine bus this clip is routed
    	 * into, and whose own gain is applied live by the gain graph rather than folded in here. It also
    	 * supplies the loop default below. Absent resolves to the seeded SFX bus, which is what an
    	 * unqualified "play this clip" has always meant.
    	 */
    	audioTrackId?: string | null;
    	/** Author override; absent means the track's own default. */
    	loop?: boolean | null;
    	/** Author override, 0..1 as authored; absent means unity. Never pre-multiplied by a bus gain. */
    	volume?: number | null;
    	/** Fade-in in milliseconds; absent means a hard start (a fade belongs to the moment). */
    	fadeInMs?: number | null;
    };
    type GameLocalizationConfigSnapshot = Pick<GameLocalizationBundle, "sourceLocale" | "locales"> & Partial<Pick<GameLocalizationBundle, "tables" | "keys" | "scenes">>;
    type BlueprintGameNotification = {
    	id: string;
    	message: string;
    };
    type BlueprintStoryEnding = {
    	endingId: string;
    	name: string;
    	sceneId: string;
    	/** The scene the ending row sits in, so a row can be grouped or captioned without a lookup. */
    	sceneName: string;
    	isReached: boolean;
    };
    type BlueprintGameHistoryEntry = {
    	/** History token; pass to Restore From History to jump the game back to this point. */
    	id: string;
    	/** "say" for spoken lines, "menu" for a resolved choice. */
    	type: "say" | "menu";
    	/** Sentence text (say) or the menu prompt (menu); empty string when the source had none. */
    	text: string;
    	/** Speaker nametag for a say entry; null for menu entries or narration. */
    	character: string | null;
    	/** Resolved voice clip URL for a say entry; null when absent. Not addressable - see \`voiceId\`. */
    	voice: string | null;
    	/**
    	 * The voice unit id this line's take is filed under; null when the line was not voiced through
    	 * the voice module. This is the replayable handle: feed it to the Play Voice node. \`voice\` is a
    	 * URL the player already heard and nothing in the runtime accepts a URL.
    	 */
    	voiceId: string | null;
    	/** Chosen option text for a menu entry; null for say entries or an unresolved menu. */
    	selected: string | null;
    	/** True while the entry is the line currently being shown (not yet committed). */
    	isPending: boolean;
    };
    type BehaviorGraphEventControl = {
    	stopPropagation(): void;
    	isPropagationStopped(): boolean;
    };
    type UIHostAdapterElementEventOptions = {
    	listItemScope?: UIListItemScope | null;
    	instanceKey?: string;
    	componentId?: UIComponentId;
    	/** Resolved values by param id: the instance's own, falling back to the declared default. */
    	componentParams?: Record<string, string>;
    	eventControl?: BehaviorGraphEventControl;
    	allowClosedScopeExecution?: boolean;
    };
    type UIHostAdapterBlueprintRuntime = {
    	surfaceId: string;
    	/** Instance-specific scope id. Defaults to \`surfaceId\` for top-level surfaces. */
    	runtimeScopeId?: string;
    	setSurfaceState: (key: string, value: unknown) => void;
    	getSurfaceState: (key: string) => unknown;
    	emitDebug: (event: BlueprintDebugEvent) => void;
    	getSurfaceTransitionState?: () => {
    		isEntering: boolean;
    		isExiting: boolean;
    	};
    	/** Dispatch a widget private event slot (for example \`init\` or \`mouseClick\`) on the owner-local blueprint. */
    	dispatchElementBlueprintEvent: (elementId: string, eventName: string, payload?: Record<string, unknown>, options?: UIHostAdapterElementEventOptions) => Promise<void>;
    	/** Continue the current widget event from this element to its structural parent. */
    	continueElementEventBubble?: (elementId: string, eventName: string, payload?: Record<string, unknown>, options?: UIHostAdapterElementEventOptions) => Promise<boolean>;
    	/** Dispatch a surface-level event on the current surfaceMain blueprint. */
    	dispatchSurfaceBlueprintEvent?: (eventName: string, payload?: Record<string, unknown>) => Promise<void>;
    	/**
    	 * Raise one of this surface's declared input actions on its surfaceMain blueprint.
    	 *
    	 * The seam between routing and authoring: routing decides that this click, wheel or key means
    	 * "advance" on this surface (see \`runtime/input/surfaceInputActions\`), and this hands that
    	 * decision to the graph. Named rather than positional because the payload is what the action's
    	 * head node reads its pins from.
    	 *
    	 * It resolves when the action's graphs have run, which is what lets a lane walk stay sequential.
    	 */
    	dispatchSurfaceInputAction?: (payload: UIInputActionEventPayload) => Promise<void>;
    	dispatchBroadcastEvent?: (eventName: string, data: unknown, sender?: string) => Promise<void>;
    	getBroadcastListenerCount?: (eventName: string) => number;
    	/** Invoke a declared blueprint fn (Call Fn node); awaits the fn body and returns its Fn Return values. */
    	invokeBlueprintFn?: (input: {
    		fnRef: string;
    		args: Record<string, unknown>;
    		depth: number;
    		/** Surface of the calling execution; global callers omit it and only see global fns. */
    		callerSurfaceId?: string;
    		/** Component definition of the calling execution, when it is running inside one. */
    		callerComponentId?: string;
    		/** That instance's resolved params, which the fn body runs with. */
    		callerComponentParams?: Record<string, string>;
    		/** Which drawing the call came from, so the body's widget writes land on it. */
    		callerInstanceKey?: string;
    		signal?: AbortSignal;
    		callerExecutionId?: string;
    	}) => Promise<{
    		returns: Record<string, unknown>;
    	}>;
    	frame?: {
    		getParam: (key: string) => unknown;
    		emit: (eventName: string, data: unknown) => Promise<void> | void;
    	};
    	/** M3-full: Dev Mode host API (graphs + TS ctx); absent in editor preview. */
    	hostApi?: BlueprintHostApiRuntime;
    };
    type StoryVariableRuntimeAccess = {
    	/** Resolve \`variableId\` to its stored value, or the declared default when unset. */
    	get: (variableId: string) => unknown;
    	/** Resolve \`variableId\` and write \`value\` to the backing store. */
    	set: (variableId: string, value: unknown) => void;
    };
    declare const SCRIPT_WIDGET_TYPES: readonly [
    	"nl.container",
    	"nl.text",
    	"nl.image",
    	"nl.video",
    	"nl.puppet",
    	"nl.button",
    	"nl.textInput",
    	"nl.slider",
    	"nl.switch",
    	"nl.list",
    	"nl.frame",
    	"nl.dialog.sentence",
    	"nl.notification.list",
    	"nl.choice.list",
    	"nl.nvl.list",
    	"nl.nvl.texts"
    ];
    type ScriptWidgetType = (typeof SCRIPT_WIDGET_TYPES)[number];
    type ScriptListRow = Pick<UIListItemScope, "item" | "index" | "count" | "key" | "selected">;
    type ScriptSelf = {
    	kind: "project";
    } | {
    	kind: "surface";
    	surfaceId: string;
    } | {
    	kind: "element";
    	surfaceId: string;
    	elementId: string;
    	widgetType: ScriptWidgetType;
    	row: ScriptListRow | null;
    } | {
    	kind: "componentElement";
    	componentId: string;
    	elementId: string;
    	widgetType: ScriptWidgetType;
    	params: Readonly<Record<string, string>>;
    	row: ScriptListRow | null;
    };
    type ScriptBroadcast = {
    	send: (event: string, data?: unknown) => Promise<void>;
    	listenerCount: NonNullable<UIHostAdapterBlueprintRuntime["getBroadcastListenerCount"]>;
    };
    type ScriptSurfaceTransition = {
    	isEntering: () => boolean;
    	isExiting: () => boolean;
    	isTransitioning: () => boolean;
    };
    type SurfaceBound<Self extends ScriptSelf, T> = Self extends {
    	kind: "surface" | "element";
    } ? T : undefined;
    type GameScriptContext<Self extends ScriptSelf = ScriptSelf> = {
    	self: Self;
    	host: BlueprintHostApiRuntime;
    	broadcast: SurfaceBound<Self, ScriptBroadcast>;
    	surface: SurfaceBound<Self, ScriptSurfaceTransition>;
    	vars: Record<string, unknown>;
    	signal: AbortSignal;
    	stopPropagation: () => void;
    };
    type StoryScriptSelf = {
    	kind: "storyRow";
    };
    type StorySyncScriptContext = {
    	self: StoryScriptSelf;
    	scene: StoryVariableRuntimeAccess;
    	saved: StoryVariableRuntimeAccess;
    };
    type StoryScriptContext = StorySyncScriptContext & {
    	persistent: BlueprintHostApiRuntime["persistence"];
    	signal: AbortSignal;
    };
    declare const VALUE_SCRIPT_READS: {
    	readonly navigation: readonly [
    		"getPageProps"
    	];
    	readonly layers: readonly [
    		"isMounted"
    	];
    	readonly widget: readonly [
    		"getCommonProperties",
    		"getTextProperties",
    		"getButtonProperties",
    		"getContainerProperties",
    		"getImageProperties",
    		"getSliderProperties",
    		"getSwitchProperties",
    		"getTextInputProperties",
    		"getListProperties",
    		"getDisplayableProperties",
    		"getMeasuredRect",
    		"getFrameProperties"
    	];
    	readonly state: readonly [
    		"get"
    	];
    	readonly frame: readonly [
    		"getParam"
    	];
    	readonly game: readonly [
    		"isInGame",
    		"isGameOverlay",
    		"getPlaytime",
    		"getTotalPlaytime",
    		"getNametag",
    		"getSpeakerAvatar",
    		"getSpeakerColor",
    		"isDialogWaiting",
    		"getDialogText",
    		"isNarrator",
    		"getCharacter",
    		"getNotifications",
    		"getChoiceCount",
    		"isNvlMode",
    		"isCurrentTextRead",
    		"isTextRead",
    		"isSceneVisited",
    		"getSavedVariable",
    		"isOptionPicked",
    		"isEndingReached",
    		"isDlcInstalled",
    		"listEndings",
    		"canUndoHistory",
    		"canRedoHistory",
    		"getPreference"
    	];
    	readonly sound: readonly [
    		"resolveElementVolume",
    		"getTrackVolume"
    	];
    	readonly localization: readonly [
    		"getConfig"
    	];
    	readonly voice: readonly [
    		"listLocales"
    	];
    	readonly input: readonly [
    		"isActionHeld",
    		"getDevice"
    	];
    };
    type ValueScriptHost = {
    	[F in keyof typeof VALUE_SCRIPT_READS]: Pick<BlueprintHostApiRuntime[F], Extract<(typeof VALUE_SCRIPT_READS)[F][number], keyof BlueprintHostApiRuntime[F]>>;
    };
    type ValueScriptSelf = Extract<ScriptSelf, {
    	kind: "element";
    }>;
    type ValueScriptContext = {
    	self: ValueScriptSelf;
    	host: ValueScriptHost;
    	surface: ScriptSurfaceTransition;
    	vars: Record<string, unknown>;
    };
    type StoryActionHandler = (ctx: StoryScriptContext) => void | Promise<void>;
    type StoryValueHandler = (ctx: StorySyncScriptContext) => StoryLiteralValue;
    type StoryConditionHandler = (ctx: StorySyncScriptContext) => boolean;
    type ValueHandler = (ctx: ValueScriptContext) => LiteralValue;
    /**
     * How a head's output pin is typed for a script.
     *
     * The pin's \`valueType\` is the coarse graph type (\`float\`, \`json\`, ...); the two preference kinds
     * are where the host API already has a narrower name for what the pin carries.
     */
    export type ScriptPinKind = "number" | "string" | "boolean" | "unknown" | "element" | "preferenceKey" | "preferenceValue";
    type DecodePin<K> = K extends "number" ? number : K extends "string" ? string : K extends "boolean" ? boolean : K extends "element" ? BlueprintElementRef : K extends "preferenceKey" ? BlueprintGamePreferenceKey : K extends "preferenceValue" ? BlueprintGamePreferenceValue : unknown;
    /**
     * Every script event, with the shape of its \`event\` argument: field name to pin kind.
     *
     * Runtime data rather than a type alone so the test can compare each entry with the head's pins,
     * and so the runtime that builds an \`event\` from a dispatch payload has one table to read.
     */
    export declare const SCRIPT_EVENT_PAYLOADS: {
    	readonly appBoot: {};
    	readonly gameReady: {};
    	readonly windowCloseRequested: {};
    	readonly fullscreenChanged: {
    		readonly isFullscreen: "boolean";
    	};
    	readonly keyDown: {
    		readonly key: "string";
    		readonly altKey: "boolean";
    		readonly ctrlKey: "boolean";
    		readonly shiftKey: "boolean";
    		readonly metaKey: "boolean";
    	};
    	readonly keyUp: {
    		readonly key: "string";
    		readonly altKey: "boolean";
    		readonly ctrlKey: "boolean";
    		readonly shiftKey: "boolean";
    		readonly metaKey: "boolean";
    	};
    	readonly preferenceChanged: {
    		readonly key: "preferenceKey";
    		readonly value: "preferenceValue";
    		readonly previousValue: "preferenceValue";
    	};
    	readonly action: {
    		readonly x: "number";
    		readonly y: "number";
    		readonly actionId: "string";
    		readonly source: "string";
    	};
    	readonly surfaceInit: {};
    	readonly surfaceUnmount: {};
    	readonly beforeSurfaceExit: {};
    	readonly afterSurfaceEnter: {};
    	readonly init: {};
    	readonly unmount: {};
    	readonly flush: {
    		readonly element: "element";
    	};
    	readonly mouseClick: {
    		readonly x: "number";
    		readonly y: "number";
    	};
    	readonly mouseDoubleClick: {
    		readonly x: "number";
    		readonly y: "number";
    	};
    	readonly mouseEnter: {
    		readonly x: "number";
    		readonly y: "number";
    	};
    	readonly mouseLeave: {
    		readonly x: "number";
    		readonly y: "number";
    	};
    	readonly mouseMove: {
    		readonly x: "number";
    		readonly y: "number";
    	};
    	readonly mouseDown: {
    		readonly button: "number";
    		readonly x: "number";
    		readonly y: "number";
    	};
    	readonly mouseUp: {
    		readonly button: "number";
    		readonly x: "number";
    		readonly y: "number";
    	};
    	readonly mouseWheel: {
    		readonly deltaX: "number";
    		readonly deltaY: "number";
    		readonly x: "number";
    		readonly y: "number";
    	};
    	readonly rightClick: {
    		readonly x: "number";
    		readonly y: "number";
    	};
    	readonly focus: {};
    	readonly blur: {};
    	readonly broadcast: {
    		readonly event: "string";
    		readonly data: "unknown";
    		readonly sender: "string";
    	};
    	readonly elementClick: {
    		readonly button: "number";
    		readonly x: "number";
    		readonly y: "number";
    		readonly element: "element";
    	};
    	readonly elementFlush: {
    		readonly element: "element";
    	};
    	readonly itemClick: {
    		readonly index: "number";
    		readonly count: "number";
    		readonly key: "string";
    		readonly item: "unknown";
    	};
    	readonly itemHover: {
    		readonly index: "number";
    		readonly count: "number";
    		readonly key: "string";
    		readonly item: "unknown";
    	};
    	readonly itemRender: {
    		readonly index: "number";
    		readonly count: "number";
    		readonly key: "string";
    		readonly item: "unknown";
    	};
    	readonly selectionChanged: {
    		readonly previousIndex: "number";
    		readonly index: "number";
    		readonly count: "number";
    		readonly key: "string";
    		readonly item: "unknown";
    	};
    	readonly scroll: {
    		readonly offset: "number";
    		readonly maxOffset: "number";
    		readonly progress: "number";
    	};
    	readonly scrollEnd: {
    		readonly offset: "number";
    		readonly maxOffset: "number";
    		readonly progress: "number";
    	};
    	readonly listItemRefresh: {
    		readonly index: "number";
    		readonly count: "number";
    		readonly key: "string";
    		readonly item: "unknown";
    		readonly props: "unknown";
    	};
    	readonly sliderDragStart: {
    		readonly value: "number";
    	};
    	readonly sliderDragEnd: {
    		readonly value: "number";
    	};
    	readonly sliderValueChanged: {
    		readonly value: "number";
    		readonly previousValue: "number";
    	};
    	readonly switchChanged: {
    		readonly checked: "boolean";
    		readonly previousChecked: "boolean";
    	};
    	readonly switchTurnedOn: {};
    	readonly switchTurnedOff: {};
    	readonly textInputSubmit: {
    		readonly value: "string";
    	};
    	readonly textInputValueChanged: {
    		readonly value: "string";
    		readonly previousValue: "string";
    	};
    	readonly pageEvent: {
    		readonly event: "string";
    		readonly data: "unknown";
    	};
    };
    export type ScriptEventId = keyof typeof SCRIPT_EVENT_PAYLOADS;
    export type ScriptEventPayload<E extends ScriptEventId> = {
    	readonly [K in keyof (typeof SCRIPT_EVENT_PAYLOADS)[E]]: DecodePin<(typeof SCRIPT_EVENT_PAYLOADS)[E][K]>;
    };
    /** \`mouseClick\` is exported as \`onMouseClick\`; the rule, not a table. */
    export type ScriptEventExportName<E extends ScriptEventId> = \`on\${Capitalize<E>}\`;
    export declare function scriptEventExportName<E extends ScriptEventId>(eventId: E): ScriptEventExportName<E>;
    /**
     * Which script event each head node starts. The folded pairs share an entry; see the file comment.
     *
     * \`On Call\` is absent on purpose - it is not an export - and the test asserts that this is the
     * only registered head absent here.
     */
    export declare const SCRIPT_EVENT_HEADS: Readonly<Record<string, ScriptEventId>>;
    /**
     * Events a project script and a surface script may export.
     *
     * Written by hand and held to the palette: the test derives the same lists from the registry by
     * asking \`isBlueprintNodeAllowedInGraphContext\` about every head, and fails on any difference.
     * This is the half of the declarations the generator (B3) will eventually write; until then the
     * test is what stops it drifting.
     */
    export declare const SCRIPT_EVENTS_BY_ANCHOR: {
    	readonly project: readonly [
    		"appBoot",
    		"gameReady",
    		"keyDown",
    		"keyUp",
    		"preferenceChanged",
    		"fullscreenChanged",
    		"windowCloseRequested",
    		"action"
    	];
    	readonly surface: readonly [
    		"surfaceInit",
    		"surfaceUnmount",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"mouseClick",
    		"rightClick",
    		"keyDown",
    		"keyUp",
    		"preferenceChanged",
    		"fullscreenChanged",
    		"windowCloseRequested",
    		"action",
    		"broadcast",
    		"elementClick",
    		"elementFlush"
    	];
    };
    /**
     * Events a widget script may export, by widget type. Same discipline as {@link SCRIPT_EVENTS_BY_ANCHOR}.
     */
    export declare const SCRIPT_EVENTS_BY_WIDGET: {
    	readonly "nl.container": readonly [
    		"init",
    		"unmount",
    		"flush",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"keyDown",
    		"keyUp",
    		"fullscreenChanged",
    		"broadcast",
    		"elementClick",
    		"elementFlush",
    		"mouseClick",
    		"mouseDoubleClick",
    		"mouseEnter",
    		"mouseLeave",
    		"mouseMove",
    		"mouseDown",
    		"mouseUp",
    		"mouseWheel",
    		"rightClick",
    		"focus",
    		"blur",
    		"listItemRefresh"
    	];
    	readonly "nl.text": readonly [
    		"init",
    		"unmount",
    		"flush",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"keyDown",
    		"keyUp",
    		"fullscreenChanged",
    		"broadcast",
    		"elementClick",
    		"elementFlush",
    		"mouseClick",
    		"mouseDoubleClick",
    		"mouseEnter",
    		"mouseLeave",
    		"mouseMove",
    		"mouseDown",
    		"mouseUp",
    		"mouseWheel",
    		"rightClick",
    		"focus",
    		"blur",
    		"listItemRefresh"
    	];
    	readonly "nl.image": readonly [
    		"init",
    		"unmount",
    		"flush",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"keyDown",
    		"keyUp",
    		"fullscreenChanged",
    		"broadcast",
    		"elementClick",
    		"elementFlush",
    		"mouseClick",
    		"mouseDoubleClick",
    		"mouseEnter",
    		"mouseLeave",
    		"mouseMove",
    		"mouseDown",
    		"mouseUp",
    		"mouseWheel",
    		"rightClick",
    		"focus",
    		"blur",
    		"listItemRefresh"
    	];
    	readonly "nl.video": readonly [
    		"init",
    		"unmount",
    		"flush",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"keyDown",
    		"keyUp",
    		"fullscreenChanged",
    		"broadcast",
    		"elementClick",
    		"elementFlush",
    		"mouseClick",
    		"mouseDoubleClick",
    		"mouseEnter",
    		"mouseLeave",
    		"mouseMove",
    		"mouseDown",
    		"mouseUp",
    		"mouseWheel",
    		"rightClick",
    		"focus",
    		"blur"
    	];
    	readonly "nl.puppet": readonly [
    		"init",
    		"unmount",
    		"flush",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"keyDown",
    		"keyUp",
    		"fullscreenChanged",
    		"broadcast",
    		"elementClick",
    		"elementFlush",
    		"mouseClick",
    		"mouseDoubleClick",
    		"mouseEnter",
    		"mouseLeave",
    		"mouseMove",
    		"mouseDown",
    		"mouseUp",
    		"mouseWheel",
    		"rightClick",
    		"focus",
    		"blur"
    	];
    	readonly "nl.button": readonly [
    		"init",
    		"unmount",
    		"flush",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"keyDown",
    		"keyUp",
    		"fullscreenChanged",
    		"broadcast",
    		"elementClick",
    		"elementFlush",
    		"mouseClick",
    		"mouseDoubleClick",
    		"mouseEnter",
    		"mouseLeave",
    		"mouseMove",
    		"mouseDown",
    		"mouseUp",
    		"mouseWheel",
    		"rightClick",
    		"focus",
    		"blur",
    		"listItemRefresh"
    	];
    	readonly "nl.textInput": readonly [
    		"init",
    		"unmount",
    		"flush",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"keyDown",
    		"keyUp",
    		"fullscreenChanged",
    		"broadcast",
    		"elementClick",
    		"elementFlush",
    		"focus",
    		"blur",
    		"textInputSubmit",
    		"textInputValueChanged"
    	];
    	readonly "nl.slider": readonly [
    		"init",
    		"unmount",
    		"flush",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"keyDown",
    		"keyUp",
    		"fullscreenChanged",
    		"broadcast",
    		"elementClick",
    		"elementFlush",
    		"sliderDragStart",
    		"sliderDragEnd",
    		"sliderValueChanged"
    	];
    	readonly "nl.switch": readonly [
    		"init",
    		"unmount",
    		"flush",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"keyDown",
    		"keyUp",
    		"fullscreenChanged",
    		"broadcast",
    		"elementClick",
    		"elementFlush",
    		"mouseClick",
    		"mouseDoubleClick",
    		"mouseEnter",
    		"mouseLeave",
    		"mouseMove",
    		"mouseDown",
    		"mouseUp",
    		"mouseWheel",
    		"rightClick",
    		"focus",
    		"blur",
    		"switchChanged",
    		"switchTurnedOn",
    		"switchTurnedOff"
    	];
    	readonly "nl.list": readonly [
    		"init",
    		"unmount",
    		"flush",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"keyDown",
    		"keyUp",
    		"fullscreenChanged",
    		"broadcast",
    		"elementClick",
    		"elementFlush",
    		"itemClick",
    		"itemHover",
    		"itemRender",
    		"selectionChanged",
    		"scroll",
    		"scrollEnd"
    	];
    	readonly "nl.frame": readonly [
    		"init",
    		"unmount",
    		"flush",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"keyDown",
    		"keyUp",
    		"fullscreenChanged",
    		"broadcast",
    		"elementClick",
    		"elementFlush",
    		"pageEvent"
    	];
    	readonly "nl.dialog.sentence": readonly [
    		"init",
    		"unmount",
    		"flush",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"keyDown",
    		"keyUp",
    		"fullscreenChanged",
    		"broadcast",
    		"elementClick",
    		"elementFlush",
    		"mouseClick",
    		"mouseDoubleClick",
    		"mouseEnter",
    		"mouseLeave",
    		"mouseMove",
    		"mouseDown",
    		"mouseUp",
    		"mouseWheel",
    		"rightClick",
    		"focus",
    		"blur",
    		"listItemRefresh"
    	];
    	readonly "nl.notification.list": readonly [
    		"init",
    		"unmount",
    		"flush",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"keyDown",
    		"keyUp",
    		"fullscreenChanged",
    		"broadcast",
    		"elementClick",
    		"elementFlush",
    		"itemClick",
    		"itemHover",
    		"itemRender",
    		"selectionChanged",
    		"scroll",
    		"scrollEnd"
    	];
    	readonly "nl.choice.list": readonly [
    		"init",
    		"unmount",
    		"flush",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"keyDown",
    		"keyUp",
    		"fullscreenChanged",
    		"broadcast",
    		"elementClick",
    		"elementFlush",
    		"itemClick",
    		"itemHover",
    		"itemRender",
    		"selectionChanged",
    		"scroll",
    		"scrollEnd"
    	];
    	readonly "nl.nvl.list": readonly [
    		"init",
    		"unmount",
    		"flush",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"keyDown",
    		"keyUp",
    		"fullscreenChanged",
    		"broadcast",
    		"elementClick",
    		"elementFlush",
    		"itemClick",
    		"itemHover",
    		"itemRender",
    		"selectionChanged",
    		"scroll",
    		"scrollEnd"
    	];
    	readonly "nl.nvl.texts": readonly [
    		"init",
    		"unmount",
    		"flush",
    		"beforeSurfaceExit",
    		"afterSurfaceEnter",
    		"keyDown",
    		"keyUp",
    		"fullscreenChanged",
    		"broadcast",
    		"elementClick",
    		"elementFlush",
    		"mouseClick",
    		"mouseDoubleClick",
    		"mouseEnter",
    		"mouseLeave",
    		"mouseMove",
    		"mouseDown",
    		"mouseUp",
    		"mouseWheel",
    		"rightClick",
    		"focus",
    		"blur",
    		"listItemRefresh"
    	];
    };
    /**
     * Events a widget script loses inside a component definition.
     *
     * The palette keeps a definition's graph to "this widget acting on itself": the keyboard heads,
     * the broadcast pair and the two heads that name a *different* element are left out, and whether
     * a definition should reach them is a question with its own answer, not a leftover to tidy here.
     */
    export declare const COMPONENT_EXCLUDED_EVENTS: readonly [
    	"keyDown",
    	"keyUp",
    	"fullscreenChanged",
    	"broadcast",
    	"elementClick",
    	"elementFlush"
    ];
    type ComponentExcludedEvent = (typeof COMPONENT_EXCLUDED_EVENTS)[number];
    export type ScriptEventHandler<Self extends ScriptSelf, E extends ScriptEventId> = (ctx: GameScriptContext<Self>, event: ScriptEventPayload<E>) => void | Promise<void>;
    /**
     * The names an author annotates a handler with.
     *
     * A script's handlers are named exports - \`export function onMouseClick(...)\` - so each one states
     * its own types, and these are what it states them as. The module types below describe the
     * namespace those exports add up to; nothing has to be written in that shape.
     *
     * Two forms, because the two ways of writing a function want different things:
     *
     *     export function onSliderValueChanged(ctx: WidgetCtx<"nl.slider">, event: ScriptEvent<"sliderValueChanged">) {}
     *
     *     export const onSliderValueChanged: WidgetHandler<"nl.slider", "sliderValueChanged"> = (ctx, event) => {};
     *
     * The first is a declaration and annotates each parameter; the second annotates the whole function
     * once and infers both. The generated half of the declarations (B3) narrows the widget type per
     * element, so a real project's script names the element rather than its type.
     */
    export type ScriptEvent<E extends ScriptEventId> = ScriptEventPayload<E>;
    export type GlobalCtx = GameScriptContext<{
    	kind: "project";
    }>;
    /** A story row's context. The synchronous modes get {@link StorySyncCtx} instead. */
    export type StoryCtx = StoryScriptContext;
    export type StorySyncCtx = StorySyncScriptContext;
    /** A value binding's context: the host API's reads, and nothing that waits. */
    export type ValueCtx = ValueScriptContext;
    export type SurfaceCtx = GameScriptContext<SurfaceSelf>;
    export type WidgetCtx<W extends ScriptWidgetType> = GameScriptContext<ElementSelf<W>>;
    export type ComponentWidgetCtx<W extends ScriptWidgetType> = GameScriptContext<ComponentElementSelf<W>>;
    export type GlobalHandler<E extends (typeof SCRIPT_EVENTS_BY_ANCHOR)["project"][number]> = ScriptEventHandler<{
    	kind: "project";
    }, E>;
    export type SurfaceHandler<E extends (typeof SCRIPT_EVENTS_BY_ANCHOR)["surface"][number]> = ScriptEventHandler<SurfaceSelf, E>;
    export type WidgetHandler<W extends ScriptWidgetType, E extends (typeof SCRIPT_EVENTS_BY_WIDGET)[W][number]> = ScriptEventHandler<ElementSelf<W>, E>;
    export type ComponentWidgetHandler<W extends ScriptWidgetType, E extends Exclude<(typeof SCRIPT_EVENTS_BY_WIDGET)[W][number], ComponentExcludedEvent>> = ScriptEventHandler<ComponentElementSelf<W>, E>;
    /** A module's optional named exports, one per event the slot admits. */
    export type ScriptEventExports<Self extends ScriptSelf, E extends ScriptEventId> = {
    	[K in E as ScriptEventExportName<K>]?: ScriptEventHandler<Self, K>;
    };
    type SurfaceSelf = Extract<ScriptSelf, {
    	kind: "surface";
    }>;
    type ElementSelf<W extends ScriptWidgetType> = Extract<ScriptSelf, {
    	kind: "element";
    }> & {
    	widgetType: W;
    };
    type ComponentElementSelf<W extends ScriptWidgetType> = Extract<ScriptSelf, {
    	kind: "componentElement";
    }> & {
    	widgetType: W;
    };
    export type GlobalScriptModule = ScriptEventExports<{
    	kind: "project";
    }, (typeof SCRIPT_EVENTS_BY_ANCHOR)["project"][number]>;
    export type SurfaceScriptModule = ScriptEventExports<SurfaceSelf, (typeof SCRIPT_EVENTS_BY_ANCHOR)["surface"][number]>;
    export type WidgetScriptModule<W extends ScriptWidgetType> = ScriptEventExports<ElementSelf<W>, (typeof SCRIPT_EVENTS_BY_WIDGET)[W][number]>;
    export type ComponentWidgetScriptModule<W extends ScriptWidgetType> = ScriptEventExports<ComponentElementSelf<W>, Exclude<(typeof SCRIPT_EVENTS_BY_WIDGET)[W][number], ComponentExcludedEvent>>;
    export type ValueScriptModule = {
    	default: ValueHandler;
    };
    export type StoryScriptModule<Mode extends "action" | "value" | "condition" = "action"> = {
    	default: Mode extends "value" ? StoryValueHandler : Mode extends "condition" ? StoryConditionHandler : StoryActionHandler;
    };
    /**
     * The module shape a given owner's script must have.
     *
     * Keyed on the owner union so a new owner position is a compile error here (the test asserts no
     * position maps to \`never\`). \`W\` is the widget type of an element owner; the generated
     * declarations supply it from the project, and callers that do not know it get every widget's
     * union, which is the loose but honest answer.
     */
    export type ScriptModuleFor<Owner extends BlueprintOwnerRef, W extends ScriptWidgetType = ScriptWidgetType> = Owner extends {
    	kind: "globalMain";
    } ? GlobalScriptModule : Owner extends {
    	kind: "surfaceMain";
    } ? SurfaceScriptModule : Owner extends {
    	kind: "widgetMain";
    } ? WidgetScriptModule<W> : Owner extends {
    	kind: "widgetValue";
    } ? ValueScriptModule : Owner extends {
    	kind: "componentWidgetMain";
    } ? ComponentWidgetScriptModule<W> : Owner extends {
    	kind: "storyAction";
    	mode?: infer M;
    } ? StoryScriptModule<M extends "value" | "condition" ? M : "action"> : never;
}
`;
