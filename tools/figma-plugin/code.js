// Generated from src/main.js and Studio's design reading - do not edit by hand.
// Regenerate: node node_modules/vitest/vitest.mjs run src/renderer/lib/ui-editor/figma-import/figmaPlugin.test.ts -u
(() => {
  // src/renderer/lib/ui-editor/figma-import/gameUiRoles.ts
  var GAME_UI_SLOTS = ["dialog", "choice", "onStage", "notification"];
  var SLOT_WORDS = {
    dialog: [
      "dialog",
      "dialogue",
      "dialogbox",
      "dialoguebox",
      "textbox",
      "textwindow",
      "messagebox",
      "messagewindow",
      "say",
      "对话框",
      "对白框",
      "对话",
      "文本框",
      "台词框",
      "会话框",
      "對話框",
      "ダイアログ",
      "メッセージウィンドウ",
      "テキストボックス",
      "テキストウィンドウ",
      "会話ウィンドウ"
    ],
    choice: [
      "choice",
      "choices",
      "choicemenu",
      "menuchoice",
      "选项",
      "选择",
      "选择肢",
      "選項",
      "選択肢"
    ],
    onStage: [
      "quickmenu",
      "quick",
      "systemmenu",
      "systembuttons",
      "hud",
      "快捷菜单",
      "快速菜单",
      "快捷按钮",
      "系统菜单",
      "系统按钮",
      "クイックメニュー",
      "システムメニュー",
      "システムボタン"
    ],
    notification: [
      "notification",
      "notifications",
      "notify",
      "toast",
      "toasts",
      "通知",
      "提示",
      "お知らせ"
    ]
  };
  var DIALOG_PART_WORDS = {
    sentence: ["sentence", "line", "text", "body", "dialogue", "dialog", "台词", "对白", "正文", "文本", "内容", "セリフ", "台詞", "本文", "テキスト"],
    name: ["name", "nametag", "speaker", "名字", "名称", "姓名", "说话人", "角色名", "名前", "話者", "ネーム"],
    avatar: ["avatar", "face", "portrait", "headshot", "头像", "立绘头像", "アバター", "顔", "フェイス"]
  };
  var QUICK_MENU_ACTIONS = ["auto", "skip", "log", "save", "load", "config", "hide"];
  var QUICK_MENU_WORDS = {
    auto: ["auto", "autoplay", "autoforward", "自动", "自动播放", "オート"],
    skip: ["skip", "fastforward", "ff", "跳过", "快进", "スキップ"],
    log: ["log", "backlog", "history", "日志", "历史", "回想", "记录", "履歴", "ログ", "バックログ"],
    save: ["save", "qsave", "quicksave", "存档", "保存", "セーブ"],
    load: ["load", "qload", "quickload", "读档", "读取", "载入", "加载", "ロード"],
    config: ["config", "settings", "setting", "options", "option", "preferences", "prefs", "设置", "设定", "系统", "コンフィグ", "設定", "オプション"],
    hide: ["hide", "hidebox", "隐藏", "关闭对话框", "非表示", "消す"]
  };
  var SEPARATORS = /[\s_\-.@/\\()（）[\]【】=,，、:：]+/;
  var CJK = /[぀-ヿ㐀-鿿]/;
  function matches(name, words, cjkSuffix) {
    const lower = name.toLowerCase();
    const tokens = lower.split(SEPARATORS).filter(Boolean);
    const joined = tokens.join("");
    if (words.some((word) => tokens.includes(word) || joined === word)) {
      return true;
    }
    const trimmed = name.trim();
    return cjkSuffix && words.some((word) => CJK.test(word) && trimmed.endsWith(word));
  }
  function firstMatch(name, table, order, cjkSuffix = true) {
    if (!name) {
      return null;
    }
    for (const key of order) {
      if (matches(name, table[key], cjkSuffix)) {
        return key;
      }
    }
    return null;
  }
  function gameUiSlotOfName(name) {
    return firstMatch(name, SLOT_WORDS, GAME_UI_SLOTS, false);
  }
  function dialogPartOfName(name) {
    return firstMatch(name, DIALOG_PART_WORDS, ["name", "avatar", "sentence"]);
  }
  function quickMenuActionOfName(name) {
    return firstMatch(name, QUICK_MENU_WORDS, QUICK_MENU_ACTIONS);
  }
  var DESIGN_ROLES = [...GAME_UI_SLOTS, "sentence", "name", "avatar", ...QUICK_MENU_ACTIONS];
  function isDesignRole(value) {
    return typeof value === "string" && DESIGN_ROLES.includes(value);
  }
  function nameOf(node) {
    return typeof node.name === "string" ? node.name.trim() : "";
  }
  function hasOwnName(node) {
    var _a;
    if (node.kind !== "text") return true;
    const words = typeof ((_a = node.text) == null ? void 0 : _a.characters) === "string" ? node.text.characters.trim() : "";
    return nameOf(node) !== words;
  }
  function gameUiSlotOf(node) {
    if (isDesignRole(node.role)) {
      return GAME_UI_SLOTS.includes(node.role) ? node.role : null;
    }
    return gameUiSlotOfName(nameOf(node));
  }
  function dialogPartOf(node) {
    if (isDesignRole(node.role)) {
      return node.role === "sentence" || node.role === "name" || node.role === "avatar" ? node.role : null;
    }
    return hasOwnName(node) ? dialogPartOfName(nameOf(node)) : null;
  }
  function quickMenuActionOf(node) {
    if (isDesignRole(node.role)) {
      return QUICK_MENU_ACTIONS.includes(node.role) ? node.role : null;
    }
    return quickMenuActionOfName(nameOf(node));
  }
  function isMarked(node) {
    return isDesignRole(node.role);
  }

  // src/renderer/lib/ui-editor/figma-import/buttonStates.ts
  var BUTTON_STATES = ["default", "hover", "pressed", "disabled", "selected"];
  var WORDS = {
    default: ["normal", "default", "idle", "up", "rest", "base", "普通", "默认", "常态", "正常", "通常", "ノーマル", "デフォルト"],
    hover: ["hover", "hovered", "over", "mouseover", "highlight", "highlighted", "悬停", "悬浮", "高亮", "经过", "ホバー", "オーバー"],
    pressed: ["pressed", "press", "down", "active", "click", "clicked", "按下", "点击", "押下", "プレス"],
    disabled: ["disabled", "disable", "inactive", "禁用", "不可用", "置灰", "無効", "无效"],
    selected: ["selected", "on", "checked", "toggled", "lit", "选中", "已选", "开启", "オン", "選択中"]
  };
  var SEPARATORS2 = /[\s_\-.@/\\()（）[\]【】=,，、:：]+/;
  var CJK2 = /[぀-ヿ㐀-鿿]/;
  function tokensOf(name) {
    return name.toLowerCase().split(SEPARATORS2).filter(Boolean);
  }
  function buttonStateOfName(name) {
    const tokens = tokensOf(name);
    for (const state of BUTTON_STATES) {
      if (WORDS[state].some((word) => tokens.includes(word))) {
        return state;
      }
    }
    const trimmed = name.trim();
    for (const state of BUTTON_STATES) {
      if (WORDS[state].some((word) => CJK2.test(word) && trimmed.endsWith(word) && trimmed.length > word.length)) {
        return state;
      }
    }
    return null;
  }

  // src/renderer/lib/ui-editor/figma-import/figmaGeometry.ts
  var IDENTITY_MATRIX = [[1, 0, 0], [0, 1, 0]];
  function applyMatrix(m, x, y) {
    return { x: m[0][0] * x + m[0][1] * y + m[0][2], y: m[1][0] * x + m[1][1] * y + m[1][2] };
  }
  function invertMatrix(m) {
    const [[a, c, tx], [b, d, ty]] = m;
    const det = a * d - b * c;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
      return IDENTITY_MATRIX;
    }
    const ia = d / det;
    const ib = -b / det;
    const ic = -c / det;
    const id = a / det;
    return [
      [ia, ic, -(ia * tx + ic * ty)],
      [ib, id, -(ib * tx + id * ty)]
    ];
  }
  function matrixRotationDeg(m) {
    return Math.atan2(m[1][0], m[0][0]) * 180 / Math.PI;
  }
  function normalizeDegrees(deg) {
    let out = deg % 360;
    if (out > 180) out -= 360;
    if (out <= -180) out += 360;
    return Math.abs(out) < 1e-6 ? 0 : out;
  }
  function placeInParent(node, parentTransform) {
    const centre = applyMatrix(node.transform, node.width / 2, node.height / 2);
    const local = applyMatrix(invertMatrix(parentTransform), centre.x, centre.y);
    return {
      x: local.x - node.width / 2,
      y: local.y - node.height / 2,
      width: node.width,
      height: node.height,
      rotation: normalizeDegrees(matrixRotationDeg(node.transform) - matrixRotationDeg(parentTransform))
    };
  }

  // src/renderer/lib/ui-editor/figma-import/gameUiReading.ts
  var MAX_NAME_LENGTH = 80;
  var childrenOf = (node) => Array.isArray(node.children) ? node.children : [];
  function layerName(raw) {
    const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
    return text.length > MAX_NAME_LENGTH ? text.slice(0, MAX_NAME_LENGTH) : text;
  }
  function num(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
  function matrixOf(raw) {
    if (Array.isArray(raw) && raw.length === 2 && raw.every((row) => Array.isArray(row) && row.length === 3 && row.every((value) => typeof value === "number" && Number.isFinite(value)))) {
      return raw;
    }
    return IDENTITY_MATRIX;
  }
  function absoluteBox(node) {
    return placeInParent({ transform: matrixOf(node.transform), width: num(node.width, 0), height: num(node.height, 0) }, IDENTITY_MATRIX);
  }
  var areaOf = (node) => num(node.width, 0) * num(node.height, 0);
  function walkLayers(nodes, parent, visit) {
    for (const node of nodes) {
      visit(node, parent);
      walkLayers(childrenOf(node), node, visit);
    }
  }
  function isStateLook(node) {
    return node.kind === "raster" || node.kind === "shape" || node.kind === "ellipse" || (node.kind === "frame" || node.kind === "group") && childrenOf(node).length === 0;
  }
  function readButton(node) {
    var _a;
    if (node.variantValue && Array.isArray(node.variants) && node.variants.length > 0) {
      const own = buttonStateOfName(node.variantValue);
      if (!own) {
        return null;
      }
      const states2 = { [own]: node };
      for (const variant of node.variants) {
        const state = buttonStateOfName(variant.value);
        if (state && !states2[state]) {
          states2[state] = variant.node;
        }
      }
      if (!states2.default || Object.keys(states2).length < 2) {
        return null;
      }
      const looks = Object.values(states2);
      if (looks.some((look) => childrenOf(look).some((child) => child.kind !== "text") || childrenOf(look).length > 1)) {
        return "mixed";
      }
      const labels = {};
      for (const [state, look] of Object.entries(states2)) {
        const text = childrenOf(look)[0];
        if (text) labels[state] = text;
      }
      return { states: states2, label: (_a = childrenOf(node)[0]) != null ? _a : null, labels };
    }
    if (node.kind !== "group" && node.kind !== "frame") {
      return null;
    }
    const states = {};
    let label = null;
    let others = 0;
    for (const child of childrenOf(node)) {
      const state = buttonStateOfName(child.name);
      if (state && !states[state] && isStateLook(child)) {
        states[state] = child;
      } else if (child.kind === "text" && !label) {
        label = child;
      } else {
        others += 1;
      }
    }
    if (!states.default || Object.keys(states).length < 2) {
      return null;
    }
    return others > 0 ? "mixed" : { states, label, labels: {} };
  }
  function insideButtons(nodes) {
    const inside = /* @__PURE__ */ new Set();
    const visit = (node, swallowed) => {
      if (swallowed) inside.add(node);
      const button = swallowed ? null : readButton(node);
      const swallows = swallowed || button !== null && button !== "mixed";
      childrenOf(node).forEach((child) => visit(child, swallows));
    };
    nodes.forEach((node) => visit(node, false));
    return inside;
  }
  function gameUiPartsOf(frame) {
    const own = gameUiSlotOf(frame);
    const named = (node, except) => childrenOf(node).flatMap((child) => {
      if (child.kind === "text") return [];
      const slot = gameUiSlotOf(child);
      return slot && slot !== except ? [{ slot, node: child, whole: false }] : [];
    });
    if (own) {
      return [{ slot: own, node: frame, whole: true }, ...named(frame, own)];
    }
    return named(frame, null).flatMap((part) => [part, ...named(part.node, part.slot)]);
  }
  function partLayers(part, parts) {
    const nested = new Set(parts.map((entry) => entry.node));
    return childrenOf(part.node).filter((child) => !nested.has(child));
  }
  function readDialog(children, usable) {
    var _a, _b;
    const texts = [];
    const parents = /* @__PURE__ */ new Map();
    let avatar = null;
    walkLayers(children, null, (node, parent) => {
      parents.set(node, parent);
      if (!usable(node)) return;
      if (node.kind === "text") {
        texts.push(node);
      } else if (!avatar && dialogPartOf(node) === "avatar") {
        avatar = node;
      }
    });
    const largest = (list) => list.reduce((best, node) => !best || areaOf(node) > areaOf(best) ? node : best, null);
    let sentence = largest(texts.filter((node) => dialogPartOf(node) === "sentence"));
    let sentenceGuessed = false;
    if (!sentence) {
      sentence = largest(texts.filter((node) => dialogPartOf(node) !== "name"));
      sentenceGuessed = sentence !== null;
    }
    let name = (_a = texts.find((node) => node !== sentence && dialogPartOf(node) === "name")) != null ? _a : null;
    let nameGuessed = false;
    if (!name && sentence) {
      const line = absoluteBox(sentence);
      const bottom = (node) => {
        const box = absoluteBox(node);
        return box.y + box.height;
      };
      const above = texts.filter((node) => node !== sentence && bottom(node) <= line.y + 4 && areaOf(node) < areaOf(sentence));
      name = above.reduce((best, node) => !best || bottom(node) > bottom(best) ? node : best, null);
      nameGuessed = name !== null;
    }
    return { sentence, sentenceGuessed, name, nameGuessed, plate: name ? (_b = parents.get(name)) != null ? _b : null : null, avatar };
  }
  function canBeAvatar(node) {
    return node.kind === "raster" || node.kind === "shape" || node.kind === "ellipse" || (node.kind === "frame" || node.kind === "group") && childrenOf(node).length === 0;
  }
  function listOptionsOf(children, top) {
    const hasText = (node) => node.kind === "text" || childrenOf(node).some(hasText);
    return children.filter((child) => child.kind === "text" || (child.kind === "group" || child.kind === "frame") && hasText(child)).sort((a, b) => top(a) - top(b));
  }
  function readQuickMenu(children, usable) {
    const out = [];
    const visit = (node) => {
      const action = quickMenuActionOf(node);
      if (action && usable(node)) {
        out.push({ action, node });
      } else {
        childrenOf(node).forEach(visit);
      }
    };
    children.forEach(visit);
    return out;
  }

  // src/renderer/lib/ui-editor/figma-import/gameUiChecklist.ts
  var layerOf = (node) => ({ id: String(node.id), name: layerName(node.name) });
  var statusOf = (node, guessed) => guessed ? "guessed" : isMarked(node) ? "marked" : "named";
  function checkFrame(frame) {
    const parts = gameUiPartsOf(frame);
    const taken = new Set(parts.map((part) => part.node));
    const leftOut = parts.length > 0 && !parts[0].whole ? childrenOf(frame).filter((child) => !taken.has(child)).map(layerOf) : [];
    const seen = /* @__PURE__ */ new Set();
    return {
      frame: layerOf(frame),
      leftOut,
      parts: parts.map((part) => {
        const duplicate = seen.has(part.slot);
        seen.add(part.slot);
        const layers = partLayers(part, parts);
        return {
          slot: part.slot,
          layer: layerOf(part.node),
          marked: isMarked(part.node),
          duplicate,
          entries: duplicate ? [] : entriesOf(part.slot, part.whole, part.node, layers)
        };
      })
    };
  }
  function entriesOf(slot, whole, node, layers) {
    if (!whole && node.kind !== "group" && node.kind !== "frame") {
      return [];
    }
    const swallowed = insideButtons(layers);
    const usable = (layer) => !swallowed.has(layer);
    const mixed = [];
    const findMixed = (list) => list.forEach((layer) => {
      if (swallowed.has(layer)) return;
      if (readButton(layer) === "mixed") mixed.push({ kind: "mixedButton", status: "missing", layer: layerOf(layer) });
      findMixed(childrenOf(layer));
    });
    findMixed(layers);
    if (slot === "dialog") {
      const reading = readDialog(layers, usable);
      const entries = [
        {
          kind: "sentence",
          status: reading.sentence ? statusOf(reading.sentence, reading.sentenceGuessed) : "missing",
          layer: reading.sentence ? layerOf(reading.sentence) : null
        },
        {
          kind: "name",
          status: reading.name ? statusOf(reading.name, reading.nameGuessed) : "missing",
          layer: reading.name ? layerOf(reading.name) : null
        },
        {
          kind: "avatar",
          status: !reading.avatar ? "missing" : canBeAvatar(reading.avatar) ? statusOf(reading.avatar, false) : "unusable",
          layer: reading.avatar ? layerOf(reading.avatar) : null
        }
      ];
      return [...entries, ...mixed];
    }
    if (slot === "choice" || slot === "notification") {
      const options = listOptionsOf(layers, (layer) => absoluteBox(layer).y);
      return [{ kind: "rows", status: options.length > 0 ? "named" : "missing", count: options.length, layer: options[0] ? layerOf(options[0]) : null }];
    }
    const buttons = readQuickMenu(layers, usable);
    if (buttons.length === 0) {
      return [{ kind: "noButtons", status: "missing" }, ...mixed];
    }
    return [
      ...buttons.map(({ action, node: button }) => {
        const shape = readButton(button);
        const entry = { kind: "button", status: isMarked(button) ? "marked" : "named", action, layer: layerOf(button) };
        if (action === "auto" || action === "skip") {
          entry.lit = shape !== null && shape !== "mixed" && Boolean(shape.states.selected);
        }
        return entry;
      }),
      ...mixed
    ];
  }

  // tools/figma-plugin/src/main.js
  var FORMAT = "narraleaf.figma-export";
  var VERSION = 1;
  var RASTER_TYPES = {
    VECTOR: true,
    STAR: true,
    POLYGON: true,
    REGULAR_POLYGON: true,
    LINE: true,
    BOOLEAN_OPERATION: true,
    ARROW: true
  };
  var FRAME_TYPES = {
    FRAME: true,
    COMPONENT: true,
    COMPONENT_SET: true,
    INSTANCE: true,
    SECTION: true
  };
  var RASTER_SCALE = 2;
  var MARK_NS = "narraleaf";
  var SLOT_ROLES = ["dialog", "choice", "onStage", "notification"];
  var PART_ROLES = ["sentence", "name", "avatar"];
  var BUTTON_ROLES = ["auto", "skip", "log", "save", "load", "config", "hide"];
  var SINGLE_ROLES = SLOT_ROLES.concat(PART_ROLES);
  var ROLE_WORDS = {
    zh: {
      dialog: "对话框",
      choice: "选项",
      onStage: "快捷菜单",
      notification: "通知",
      sentence: "台词",
      name: "名字",
      avatar: "头像"
    },
    en: {
      dialog: "Dialogue box",
      choice: "Choices",
      onStage: "Quick menu",
      notification: "Notifications",
      sentence: "Line",
      name: "Name",
      avatar: "Avatar"
    }
  };
  var BUTTON_WORDS = { auto: "Auto", skip: "Skip", log: "Log", save: "Save", load: "Load", config: "Config", hide: "Hide" };
  var NOTICES = {
    zh: {
      noSelection: "请先在画布上选中图层",
      marked: "已标为{role}：{layers}",
      cleared: "已清除 {layers}的标注",
      needText: "{layers}不是文本，台词和名字只能标在文本上",
      notText: "{layers}是文本，不能标为{role}",
      slotDeep: "它不在画框的第一层，Studio 不会把它当作游戏界面",
      outsideDialog: "它不在对话框里，导入时不会接线",
      outsideQuickMenu: "它不在快捷菜单里，导入时不会接线"
    },
    en: {
      noSelection: "Select layers on the canvas first",
      marked: "Marked {layers} as {role}",
      cleared: "Cleared the mark on {layers}",
      needText: "Skipped {layers}: the line and the name can only be text",
      notText: "Skipped {layers}: text cannot be marked as {role}",
      slotDeep: "It is not at the top of a frame, so Studio will not read it as Game UI",
      outsideDialog: "It is outside the dialogue box, so it will not be wired",
      outsideQuickMenu: "It is outside the quick menu, so it will not be wired"
    }
  };
  var language = "en";
  function format(text, params) {
    return text.replace(/\{(\w+)\}/g, function(_, key) {
      return params[key] === void 0 ? "" : String(params[key]);
    });
  }
  function layersWord(n) {
    if (language === "zh") return n + " 个图层";
    return n === 1 ? "1 layer" : n + " layers";
  }
  function roleWord(role) {
    return BUTTON_WORDS[role] || ROLE_WORDS[language][role] || role;
  }
  function markOf(node) {
    var role = node.getSharedPluginData(MARK_NS, "role");
    return DESIGN_ROLES.indexOf(role) >= 0 ? role : "";
  }
  function nameReadsAs(role, name) {
    if (SLOT_ROLES.indexOf(role) >= 0) return gameUiSlotOfName(name) === role;
    if (PART_ROLES.indexOf(role) >= 0) return dialogPartOfName(name) === role;
    return quickMenuActionOfName(name) === role;
  }
  function slotOfLayer(node) {
    var role = markOf(node);
    if (role) return SLOT_ROLES.indexOf(role) >= 0 ? role : null;
    return node.type === "TEXT" ? null : gameUiSlotOfName(node.name);
  }
  var DEFAULT_NAME = /^(Frame|Group|Rectangle|Ellipse|Vector|Image|Component|Instance|Section|Polygon|Star|Line|Arrow|Union|Subtract|Intersect|Exclude|Boolean|Text)( \d+)?$/i;
  function isFigmaName(node) {
    if (DEFAULT_NAME.test(node.name.trim())) return true;
    return node.type === "TEXT" && node.name.trim() === node.characters.trim();
  }
  function topFrameOf(node) {
    var current = node;
    while (current.parent && current.parent.type !== "PAGE" && current.parent.type !== "SECTION") {
      current = current.parent;
    }
    return current;
  }
  function hasAncestorSlot(node, slot) {
    var top = topFrameOf(node);
    var current = node;
    while (current) {
      if (slotOfLayer(current) === slot) return true;
      if (current === top) return false;
      current = current.parent;
    }
    return false;
  }
  function slotPlaceIsRead(node) {
    var top = topFrameOf(node);
    if (node === top || node.parent === top) return true;
    return Boolean(node.parent && node.parent.parent === top && slotOfLayer(node.parent));
  }
  function setMark(node, role) {
    node.setSharedPluginData(MARK_NS, "role", role);
    node.setRelaunchData({ check: roleWord(role) });
    var current = node.name;
    var figmaNamed = isFigmaName(node);
    if (!figmaNamed && nameReadsAs(role, current)) return;
    var renamed = figmaNamed ? roleWord(role) : roleWord(role) + " · " + stripMarkPrefix(current);
    if (renamed === current) return;
    if (!node.getSharedPluginData(MARK_NS, "name")) {
      node.setSharedPluginData(MARK_NS, "name", current);
    }
    if (node.type === "TEXT") node.autoRename = false;
    node.name = renamed;
    node.setSharedPluginData(MARK_NS, "renamed", renamed);
  }
  function clearMark(node) {
    var original = node.getSharedPluginData(MARK_NS, "name");
    var renamed = node.getSharedPluginData(MARK_NS, "renamed");
    if (original && renamed && node.name === renamed) {
      node.name = original;
    }
    node.setSharedPluginData(MARK_NS, "role", "");
    node.setSharedPluginData(MARK_NS, "name", "");
    node.setSharedPluginData(MARK_NS, "renamed", "");
    node.setRelaunchData({});
  }
  function stripMarkPrefix(name) {
    var words = [];
    ["zh", "en"].forEach(function(lang) {
      Object.keys(ROLE_WORDS[lang]).forEach(function(key) {
        words.push(ROLE_WORDS[lang][key]);
      });
    });
    Object.keys(BUTTON_WORDS).forEach(function(key) {
      words.push(BUTTON_WORDS[key]);
    });
    for (var i = 0; i < words.length; i += 1) {
      if (name.indexOf(words[i] + " · ") === 0) return name.slice(words[i].length + 3);
    }
    return name;
  }
  function markSelection(role) {
    var notices = NOTICES[language];
    var nodes = figma.currentPage.selection.slice();
    if (nodes.length === 0) return notices.noSelection;
    if (role === "clear") {
      nodes.forEach(clearMark);
      return format(notices.cleared, { layers: layersWord(nodes.length) });
    }
    var wantsText = role === "sentence" || role === "name";
    var refused = 0;
    var marked = [];
    nodes.forEach(function(node2) {
      var isText = node2.type === "TEXT";
      if (wantsText !== isText && !(BUTTON_ROLES.indexOf(role) >= 0)) {
        refused += 1;
        return;
      }
      if (SINGLE_ROLES.indexOf(role) >= 0) {
        var top = topFrameOf(node2);
        var others = [top].concat("findAll" in top ? top.findAll(function(other) {
          return markOf(other) === role;
        }) : []);
        others.forEach(function(other) {
          if (other !== node2 && markOf(other) === role) clearMark(other);
        });
      }
      setMark(node2, role);
      marked.push(node2);
    });
    var parts = [];
    if (marked.length > 0) parts.push(format(notices.marked, { layers: layersWord(marked.length), role: roleWord(role) }));
    if (refused > 0) parts.push(format(wantsText ? notices.needText : notices.notText, { layers: layersWord(refused), role: roleWord(role) }));
    if (marked.length === 1) {
      var node = marked[0];
      if (SLOT_ROLES.indexOf(role) >= 0 && !slotPlaceIsRead(node)) parts.push(notices.slotDeep);
      if (PART_ROLES.indexOf(role) >= 0 && !hasAncestorSlot(node, "dialog")) parts.push(notices.outsideDialog);
      if (BUTTON_ROLES.indexOf(role) >= 0 && !hasAncestorSlot(node, "onStage")) parts.push(notices.outsideQuickMenu);
    }
    return parts.join(language === "zh" ? "；" : ". ");
  }
  function selectionSummary() {
    var nodes = figma.currentPage.selection;
    var roles = nodes.map(markOf);
    var role = roles.length === 0 ? "" : roles.every(function(value) {
      return value === roles[0];
    }) ? roles[0] : "mixed";
    return { count: nodes.length, role };
  }
  function candidateFrames() {
    var seen = {};
    var selected = [];
    figma.currentPage.selection.forEach(function(node) {
      var top = topFrameOf(node);
      if ((FRAME_TYPES[top.type] || top.type === "GROUP") && !seen[top.id]) {
        seen[top.id] = true;
        selected.push(top);
      }
    });
    if (selected.length > 0) {
      return selected;
    }
    return figma.currentPage.children.filter(function(node) {
      return FRAME_TYPES[node.type] && node.visible;
    });
  }
  var describing = 0;
  var lastFrameKey = "";
  async function describeFrames(force) {
    var token = describing += 1;
    var frames = candidateFrames();
    var key = frames.map(function(node2) {
      return node2.id;
    }).join(",");
    if (!force && key === lastFrameKey) {
      figma.ui.postMessage({ type: "selection", selection: selectionSummary() });
      return;
    }
    lastFrameKey = key;
    var out = [];
    for (var i = 0; i < frames.length; i += 1) {
      var node = frames[i];
      var checklist = null;
      try {
        var exported = await walk(node, { dry: true, images: {}, imageByHash: {}, skippedHidden: 0 }, true);
        checklist = exported ? checkFrame(exported) : null;
      } catch (error) {
        checklist = null;
      }
      if (token !== describing) return;
      out.push({ id: node.id, name: node.name, width: Math.round(node.width), height: Math.round(node.height), checklist });
    }
    figma.ui.postMessage({
      type: "frames",
      fromSelection: figma.currentPage.selection.length > 0,
      frames: out,
      selection: selectionSummary()
    });
  }
  var describeTimer = null;
  function scheduleDescribe(force) {
    if (describeTimer) clearTimeout(describeTimer);
    describeTimer = setTimeout(function() {
      describeTimer = null;
      describeFrames(force);
    }, 120);
  }
  async function selectLayer(id) {
    var node = await figma.getNodeByIdAsync(id);
    if (!node || node.type === "PAGE" || node.type === "DOCUMENT") return;
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
  }
  function openPanel() {
    figma.showUI(__html__, { width: 380, height: 600, themeColors: true });
    figma.on("selectionchange", function() {
      scheduleDescribe(false);
    });
    figma.on("currentpagechange", function() {
      scheduleDescribe(true);
    });
    figma.ui.onmessage = function(message) {
      if (!message || typeof message !== "object") {
        return;
      }
      if (message.type === "ready") {
        language = message.language === "zh" ? "zh" : "en";
        figma.clientStorage.setAsync("language", language).catch(function() {
        });
        describeFrames(true);
      } else if (message.type === "mark") {
        figma.notify(markSelection(String(message.role)));
        describeFrames(true);
      } else if (message.type === "select") {
        selectLayer(String(message.id));
      } else if (message.type === "export") {
        runExport(message.ids || []).catch(function(error) {
          figma.ui.postMessage({ type: "error", message: String(error && error.message ? error.message : error) });
        });
      } else if (message.type === "close") {
        figma.closePlugin();
      }
    };
  }
  async function runMarkCommand(role) {
    try {
      var stored = await figma.clientStorage.getAsync("language");
      language = stored === "zh" ? "zh" : "en";
    } catch (error) {
      language = "en";
    }
    figma.closePlugin(markSelection(role));
  }
  var command = figma.command || "open";
  if (command.indexOf("mark:") === 0) {
    runMarkCommand(command.slice(5));
  } else {
    openPanel();
  }
  async function runExport(ids) {
    var state = { images: {}, imageByHash: {}, skippedHidden: 0, done: 0 };
    var frames = [];
    for (var i = 0; i < ids.length; i += 1) {
      var node = await figma.getNodeByIdAsync(ids[i]);
      if (!node) {
        continue;
      }
      figma.ui.postMessage({ type: "progress", name: node.name, index: i + 1, total: ids.length });
      var exported = await walk(node, state, true);
      if (exported) {
        frames.push(exported);
      }
    }
    var file = {
      format: FORMAT,
      version: VERSION,
      source: { fileName: figma.root.name, pageName: figma.currentPage.name },
      frames,
      images: state.images,
      skippedHidden: state.skippedHidden
    };
    figma.ui.postMessage({
      type: "result",
      json: JSON.stringify(file),
      fileName: frames.length === 1 ? frames[0].name : figma.currentPage.name
    });
  }
  function isMixed(value) {
    return value === figma.mixed;
  }
  function hasMaskChild(node) {
    if (!("children" in node)) {
      return false;
    }
    return node.children.some(function(child) {
      return child.visible && child.isMask;
    });
  }
  function visiblePaints(paints) {
    if (!paints || isMixed(paints)) {
      return [];
    }
    return paints.filter(function(paint) {
      return paint.visible !== false;
    });
  }
  function rasterReason(node, isRoot) {
    if (isRoot) {
      return null;
    }
    if (/\[raster\]/i.test(node.name)) {
      return "named";
    }
    if (RASTER_TYPES[node.type]) {
      return "vector";
    }
    if (hasMaskChild(node)) {
      return "mask";
    }
    if (node.type === "ELLIPSE") {
      var arc = node.arcData;
      var fullArc = !arc || arc.innerRadius === 0 && Math.abs(arc.endingAngle - arc.startingAngle - Math.PI * 2) < 1e-3;
      if (!fullArc || Math.abs(node.width - node.height) > 0.5) {
        return "ellipse";
      }
    }
    if (node.type === "RECTANGLE" || node.type === "ELLIPSE") {
      var fills = visiblePaints(node.fills);
      if (fills.length > 1) {
        return "fills";
      }
      var unsupported = fills.some(function(paint) {
        return paint.blendMode && paint.blendMode !== "NORMAL" || paint.type === "VIDEO" || paint.type === "PATTERN";
      });
      if (unsupported) {
        return "paint";
      }
      if (node.blendMode && node.blendMode !== "NORMAL" && node.blendMode !== "PASS_THROUGH") {
        return "blend";
      }
    }
    return null;
  }
  function sniffMime(bytes) {
    if (bytes.length > 3 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "image/png";
    if (bytes.length > 2 && bytes[0] === 255 && bytes[1] === 216) return "image/jpeg";
    if (bytes.length > 3 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return "image/gif";
    if (bytes.length > 11 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return "image/webp";
    return "application/octet-stream";
  }
  async function imageRefFor(hash, name, state) {
    if (!hash) {
      return null;
    }
    if (state.imageByHash[hash]) {
      return state.imageByHash[hash];
    }
    if (state.dry) {
      return "i-" + hash;
    }
    var image = figma.getImageByHash(hash);
    if (!image) {
      return null;
    }
    var bytes = await image.getBytesAsync();
    var key = "i-" + hash;
    state.images[key] = { mime: sniffMime(bytes), data: figma.base64Encode(bytes), name };
    state.imageByHash[hash] = key;
    return key;
  }
  async function exportPaints(paints, name, state) {
    var out = [];
    var list = visiblePaints(paints);
    for (var i = 0; i < list.length; i += 1) {
      var paint = list[i];
      var opacity = typeof paint.opacity === "number" ? paint.opacity : 1;
      if (paint.type === "SOLID") {
        out.push({ type: "SOLID", color: { r: paint.color.r, g: paint.color.g, b: paint.color.b, a: 1 }, opacity });
      } else if (paint.type === "GRADIENT_LINEAR" || paint.type === "GRADIENT_RADIAL" || paint.type === "GRADIENT_ANGULAR" || paint.type === "GRADIENT_DIAMOND") {
        out.push({
          type: paint.type,
          gradientTransform: paint.gradientTransform,
          gradientStops: paint.gradientStops.map(function(stop) {
            return { position: stop.position, color: { r: stop.color.r, g: stop.color.g, b: stop.color.b, a: stop.color.a } };
          }),
          opacity
        });
      } else if (paint.type === "IMAGE") {
        out.push({
          type: "IMAGE",
          imageRef: await imageRefFor(paint.imageHash, name, state),
          scaleMode: paint.scaleMode,
          opacity
        });
      }
    }
    return out;
  }
  function exportEffects(node) {
    if (!("effects" in node) || isMixed(node.effects)) {
      return [];
    }
    return node.effects.filter(function(effect) {
      return effect.visible !== false;
    }).map(function(effect) {
      if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
        return {
          type: effect.type,
          color: { r: effect.color.r, g: effect.color.g, b: effect.color.b, a: effect.color.a },
          offset: { x: effect.offset.x, y: effect.offset.y },
          radius: effect.radius,
          spread: typeof effect.spread === "number" ? effect.spread : 0
        };
      }
      return { type: effect.type, radius: effect.radius };
    }).filter(function(effect) {
      return effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW" || effect.type === "LAYER_BLUR" || effect.type === "BACKGROUND_BLUR";
    });
  }
  function radiiOf(node) {
    if (node.type === "ELLIPSE") {
      var r = Math.min(node.width, node.height) / 2;
      return [r, r, r, r];
    }
    if (!("cornerRadius" in node)) {
      return [0, 0, 0, 0];
    }
    if (!isMixed(node.cornerRadius)) {
      return [node.cornerRadius, node.cornerRadius, node.cornerRadius, node.cornerRadius];
    }
    return [node.topLeftRadius || 0, node.topRightRadius || 0, node.bottomRightRadius || 0, node.bottomLeftRadius || 0];
  }
  function strokeWeightsOf(node) {
    if (!("strokeTopWeight" in node) || !isMixed(node.strokeWeight)) {
      return null;
    }
    return { top: node.strokeTopWeight, right: node.strokeRightWeight, bottom: node.strokeBottomWeight, left: node.strokeLeftWeight };
  }
  function autoLayoutOf(node) {
    if (!("layoutMode" in node) || node.layoutMode !== "HORIZONTAL" && node.layoutMode !== "VERTICAL") {
      return null;
    }
    var wrap = node.layoutWrap === "WRAP";
    var out = {
      direction: node.layoutMode,
      gap: node.itemSpacing,
      padding: { top: node.paddingTop, right: node.paddingRight, bottom: node.paddingBottom, left: node.paddingLeft },
      primaryAlign: node.primaryAxisAlignItems,
      counterAlign: node.counterAxisAlignItems,
      wrap
    };
    if (wrap && typeof node.counterAxisSpacing === "number") {
      out.counterGap = node.counterAxisSpacing;
    }
    return out;
  }
  async function textStyleOf(node, state) {
    var length = node.characters.length;
    var at = function(getter, plain) {
      if (!isMixed(plain)) {
        return { value: plain, mixed: false };
      }
      return { value: length > 0 ? node[getter](0, 1) : null, mixed: true };
    };
    var fontName = at("getRangeFontName", node.fontName);
    var fontSize = at("getRangeFontSize", node.fontSize);
    var fontWeight = at("getRangeFontWeight", node.fontWeight);
    var lineHeight = at("getRangeLineHeight", node.lineHeight);
    var letterSpacing = at("getRangeLetterSpacing", node.letterSpacing);
    var textCase = at("getRangeTextCase", node.textCase);
    var fills = at("getRangeFills", node.fills);
    var fontValue = fontName.value || { family: "", style: "Regular" };
    var lineValue = lineHeight.value || { unit: "AUTO" };
    var spacingValue = letterSpacing.value || { unit: "PIXELS", value: 0 };
    return {
      style: {
        characters: node.characters,
        fontFamily: fontValue.family,
        fontStyle: fontValue.style,
        fontWeight: typeof fontWeight.value === "number" ? fontWeight.value : 400,
        fontSize: typeof fontSize.value === "number" ? fontSize.value : 16,
        lineHeight: { unit: lineValue.unit, value: typeof lineValue.value === "number" ? lineValue.value : 0 },
        letterSpacing: { unit: spacingValue.unit, value: spacingValue.value },
        align: node.textAlignHorizontal,
        verticalAlign: node.textAlignVertical,
        autoResize: node.textAutoResize,
        textCase: textCase.value || "ORIGINAL",
        mixed: fontName.mixed || fontSize.mixed || fontWeight.mixed || lineHeight.mixed || letterSpacing.mixed || fills.mixed
      },
      fills: await exportPaints(fills.value || [], node.name, state)
    };
  }
  async function rasterize(node, reason, state) {
    var bounds = node.absoluteRenderBounds;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return null;
    }
    var key = "r-" + node.id;
    if (!state.dry) {
      var bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: RASTER_SCALE } });
      state.images[key] = { mime: "image/png", data: figma.base64Encode(bytes), name: node.name };
    }
    return {
      id: node.id,
      name: node.name,
      kind: "raster",
      figmaType: node.type,
      width: bounds.width,
      height: bounds.height,
      transform: [[1, 0, bounds.x], [0, 1, bounds.y]],
      opacity: 1,
      fills: [],
      strokes: [],
      strokeWeight: 0,
      strokeAlign: "CENTER",
      dashed: false,
      radii: [0, 0, 0, 0],
      effects: [],
      clipsContent: false,
      absolute: node.layoutPositioning === "ABSOLUTE" || void 0,
      role: markOf(node) || void 0,
      raster: { imageRef: key, reason }
    };
  }
  var STATE_PROPERTY = /state|status|interaction|状态|狀態|状態/i;
  async function variantsOf(node, state) {
    if (node.type !== "INSTANCE" || !node.variantProperties) {
      return null;
    }
    var main = await node.getMainComponentAsync();
    var set = main && main.parent && main.parent.type === "COMPONENT_SET" ? main.parent : null;
    if (!set) {
      return null;
    }
    var own = node.variantProperties;
    var keys = Object.keys(own);
    var siblingsBy = {};
    keys.forEach(function(key2) {
      siblingsBy[key2] = set.children.filter(function(child) {
        var props = child.variantProperties;
        if (!props || child.type !== "COMPONENT" || props[key2] === own[key2]) return false;
        return keys.every(function(other) {
          return other === key2 || props[other] === own[other];
        });
      });
    });
    var withSiblings = keys.filter(function(key2) {
      return siblingsBy[key2].length > 0;
    });
    var named = withSiblings.filter(function(key2) {
      return STATE_PROPERTY.test(key2);
    });
    var key = named.length > 0 ? named[0] : withSiblings.length === 1 ? withSiblings[0] : null;
    if (!key) {
      return null;
    }
    var variants = [];
    for (var i = 0; i < siblingsBy[key].length; i += 1) {
      var sibling = siblingsBy[key][i];
      var exported = await walk(sibling, state, true);
      if (exported) {
        variants.push({ value: sibling.variantProperties[key], node: exported });
      }
    }
    return variants.length > 0 ? { value: own[key], variants } : null;
  }
  async function walk(node, state, isRoot) {
    if (!node.visible) {
      state.skippedHidden += 1;
      return null;
    }
    if (node.isMask) {
      return null;
    }
    var reason = rasterReason(node, isRoot);
    if (reason) {
      return rasterize(node, reason, state);
    }
    var kind;
    if (node.type === "TEXT") kind = "text";
    else if (FRAME_TYPES[node.type]) kind = "frame";
    else if (node.type === "GROUP") kind = "group";
    else if (node.type === "RECTANGLE") kind = "shape";
    else if (node.type === "ELLIPSE") kind = "ellipse";
    else return null;
    var out = {
      id: node.id,
      name: node.name,
      kind,
      figmaType: node.type,
      width: node.width,
      height: node.height,
      transform: node.absoluteTransform,
      opacity: typeof node.opacity === "number" ? node.opacity : 1,
      fills: [],
      strokes: "strokes" in node ? await exportPaints(node.strokes, node.name, state) : [],
      strokeWeight: "strokeWeight" in node && !isMixed(node.strokeWeight) ? node.strokeWeight : 0,
      strokeAlign: "strokeAlign" in node ? node.strokeAlign : "CENTER",
      dashed: "dashPattern" in node && node.dashPattern.length > 0,
      radii: radiiOf(node),
      effects: exportEffects(node),
      clipsContent: "clipsContent" in node ? node.clipsContent : false
    };
    var weights = strokeWeightsOf(node);
    if (weights) out.strokeWeights = weights;
    var role = markOf(node);
    if (role) out.role = role;
    if (node.layoutPositioning === "ABSOLUTE") out.absolute = true;
    if (node.blendMode && node.blendMode !== "NORMAL" && node.blendMode !== "PASS_THROUGH") out.blendMode = node.blendMode;
    if (kind === "text") {
      var text = await textStyleOf(node, state);
      out.text = text.style;
      out.fills = text.fills;
      return out;
    }
    if ("fills" in node) {
      out.fills = await exportPaints(node.fills, node.name, state);
    }
    var auto = autoLayoutOf(node);
    if (auto) out.autoLayout = auto;
    var variants = await variantsOf(node, state);
    if (variants) {
      out.variantValue = variants.value;
      out.variants = variants.variants;
    }
    if ("children" in node) {
      var children = [];
      for (var i = 0; i < node.children.length; i += 1) {
        var child = await walk(node.children[i], state, false);
        if (child) children.push(child);
      }
      out.children = children;
    }
    return out;
  }
})();
