// NarraLeaf Studio Export - Figma plugin main thread.
//
// Walks the chosen frames and writes the file NarraLeaf Studio's interface editor imports
// (`src/renderer/lib/ui-editor/figma-import/figmaExportFormat.ts` describes it). The plugin stays
// close to Figma's own vocabulary and decides one thing only: which layers have no widget to become
// and so are drawn into a picture here, while Figma can still draw them. Every other mapping is done
// by Studio, so it can improve without the plugin being reinstalled.
//
// Written without optional chaining or nullish coalescing so it runs in every plugin sandbox.

var FORMAT = "narraleaf.figma-export";
var VERSION = 1;

/** Node types drawn into a picture: no widget draws an arbitrary path. */
var RASTER_TYPES = {
  VECTOR: true,
  STAR: true,
  POLYGON: true,
  REGULAR_POLYGON: true,
  LINE: true,
  BOOLEAN_OPERATION: true,
  ARROW: true,
};

/** Node types that hold children and become containers. */
var FRAME_TYPES = {
  FRAME: true,
  COMPONENT: true,
  COMPONENT_SET: true,
  INSTANCE: true,
  SECTION: true,
};

/** The scale pictures are drawn at, so they stay sharp when Studio scales a page up. */
var RASTER_SCALE = 2;

figma.showUI(__html__, { width: 360, height: 420, themeColors: true });

function candidateFrames() {
  var selected = figma.currentPage.selection.filter(function (node) {
    return FRAME_TYPES[node.type] || node.type === "GROUP";
  });
  if (selected.length > 0) {
    return selected;
  }
  return figma.currentPage.children.filter(function (node) {
    return FRAME_TYPES[node.type] && node.visible;
  });
}

function describeFrames() {
  var frames = candidateFrames();
  figma.ui.postMessage({
    type: "frames",
    fromSelection: figma.currentPage.selection.length > 0,
    frames: frames.map(function (node) {
      return { id: node.id, name: node.name, width: Math.round(node.width), height: Math.round(node.height) };
    }),
  });
}

figma.on("selectionchange", describeFrames);
figma.on("currentpagechange", describeFrames);

figma.ui.onmessage = function (message) {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "ready") {
    describeFrames();
  } else if (message.type === "export") {
    runExport(message.ids || []).catch(function (error) {
      figma.ui.postMessage({ type: "error", message: String(error && error.message ? error.message : error) });
    });
  } else if (message.type === "close") {
    figma.closePlugin();
  }
};

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
    frames: frames,
    images: state.images,
    skippedHidden: state.skippedHidden,
  };
  figma.ui.postMessage({
    type: "result",
    json: JSON.stringify(file),
    fileName: frames.length === 1 ? frames[0].name : figma.currentPage.name,
  });
}

function isMixed(value) {
  return value === figma.mixed;
}

function hasMaskChild(node) {
  if (!("children" in node)) {
    return false;
  }
  return node.children.some(function (child) {
    return child.visible && child.isMask;
  });
}

function visiblePaints(paints) {
  if (!paints || isMixed(paints)) {
    return [];
  }
  return paints.filter(function (paint) {
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
    var fullArc = !arc || (arc.innerRadius === 0 && Math.abs(arc.endingAngle - arc.startingAngle - Math.PI * 2) < 1e-3);
    if (!fullArc || Math.abs(node.width - node.height) > 0.5) {
      return "ellipse";
    }
  }
  if (node.type === "RECTANGLE" || node.type === "ELLIPSE") {
    var fills = visiblePaints(node.fills);
    if (fills.length > 1) {
      return "fills";
    }
    var unsupported = fills.some(function (paint) {
      return (paint.blendMode && paint.blendMode !== "NORMAL") || paint.type === "VIDEO" || paint.type === "PATTERN";
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
  if (bytes.length > 3 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length > 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes.length > 11 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return "application/octet-stream";
}

async function imageRefFor(hash, name, state) {
  if (!hash) {
    return null;
  }
  if (state.imageByHash[hash]) {
    return state.imageByHash[hash];
  }
  var image = figma.getImageByHash(hash);
  if (!image) {
    return null;
  }
  var bytes = await image.getBytesAsync();
  var key = "i-" + hash;
  state.images[key] = { mime: sniffMime(bytes), data: figma.base64Encode(bytes), name: name };
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
      out.push({ type: "SOLID", color: { r: paint.color.r, g: paint.color.g, b: paint.color.b, a: 1 }, opacity: opacity });
    } else if (
      paint.type === "GRADIENT_LINEAR" ||
      paint.type === "GRADIENT_RADIAL" ||
      paint.type === "GRADIENT_ANGULAR" ||
      paint.type === "GRADIENT_DIAMOND"
    ) {
      out.push({
        type: paint.type,
        gradientTransform: paint.gradientTransform,
        gradientStops: paint.gradientStops.map(function (stop) {
          return { position: stop.position, color: { r: stop.color.r, g: stop.color.g, b: stop.color.b, a: stop.color.a } };
        }),
        opacity: opacity,
      });
    } else if (paint.type === "IMAGE") {
      out.push({
        type: "IMAGE",
        imageRef: await imageRefFor(paint.imageHash, name, state),
        scaleMode: paint.scaleMode,
        opacity: opacity,
      });
    }
  }
  return out;
}

function exportEffects(node) {
  if (!("effects" in node) || isMixed(node.effects)) {
    return [];
  }
  return node.effects
    .filter(function (effect) {
      return effect.visible !== false;
    })
    .map(function (effect) {
      if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
        return {
          type: effect.type,
          color: { r: effect.color.r, g: effect.color.g, b: effect.color.b, a: effect.color.a },
          offset: { x: effect.offset.x, y: effect.offset.y },
          radius: effect.radius,
          spread: typeof effect.spread === "number" ? effect.spread : 0,
        };
      }
      return { type: effect.type, radius: effect.radius };
    })
    .filter(function (effect) {
      return (
        effect.type === "DROP_SHADOW" ||
        effect.type === "INNER_SHADOW" ||
        effect.type === "LAYER_BLUR" ||
        effect.type === "BACKGROUND_BLUR"
      );
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
  if (!("layoutMode" in node) || (node.layoutMode !== "HORIZONTAL" && node.layoutMode !== "VERTICAL")) {
    return null;
  }
  var wrap = node.layoutWrap === "WRAP";
  var out = {
    direction: node.layoutMode,
    gap: node.itemSpacing,
    padding: { top: node.paddingTop, right: node.paddingRight, bottom: node.paddingBottom, left: node.paddingLeft },
    primaryAlign: node.primaryAxisAlignItems,
    counterAlign: node.counterAxisAlignItems,
    wrap: wrap,
  };
  if (wrap && typeof node.counterAxisSpacing === "number") {
    out.counterGap = node.counterAxisSpacing;
  }
  return out;
}

async function textStyleOf(node, state) {
  var length = node.characters.length;
  var at = function (getter, plain) {
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
      mixed: fontName.mixed || fontSize.mixed || fontWeight.mixed || lineHeight.mixed || letterSpacing.mixed || fills.mixed,
    },
    fills: await exportPaints(fills.value || [], node.name, state),
  };
}

async function rasterize(node, reason, state) {
  var bounds = node.absoluteRenderBounds;
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }
  var bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: RASTER_SCALE } });
  var key = "r-" + node.id;
  state.images[key] = { mime: "image/png", data: figma.base64Encode(bytes), name: node.name };
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
    absolute: node.layoutPositioning === "ABSOLUTE" || undefined,
    raster: { imageRef: key, reason: reason },
  };
}

var STATE_PROPERTY = /state|status|interaction|状态|狀態|状態/i;

/**
 * For an instance of a component set: the variant property that reads as the button state, and the
 * other variants that differ from this one in that property alone. Studio decides which values are
 * states (`Default`, `Hover`, `Pressed` ...); this only picks the property - one named like a state,
 * or else the only property that has such siblings.
 */
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
  keys.forEach(function (key) {
    siblingsBy[key] = set.children.filter(function (child) {
      var props = child.variantProperties;
      if (!props || child.type !== "COMPONENT" || props[key] === own[key]) return false;
      return keys.every(function (other) {
        return other === key || props[other] === own[other];
      });
    });
  });
  var withSiblings = keys.filter(function (key) {
    return siblingsBy[key].length > 0;
  });
  var named = withSiblings.filter(function (key) {
    return STATE_PROPERTY.test(key);
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
  return variants.length > 0 ? { value: own[key], variants: variants } : null;
}

async function walk(node, state, isRoot) {
  if (!node.visible) {
    state.skippedHidden += 1;
    return null;
  }
  if (node.isMask) {
    // Drawn by its parent, which is rasterized whole.
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
    kind: kind,
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
    clipsContent: "clipsContent" in node ? node.clipsContent : false,
  };
  var weights = strokeWeightsOf(node);
  if (weights) out.strokeWeights = weights;
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
