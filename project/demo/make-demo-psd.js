/**
 * Build the PSD used to demo the layered-sprite import.
 *
 * Everything except the base sprite is painted here, so the only art this needs is one finished
 * character PNG — point it at any transparent-background sprite and it produces a sheet that
 * exercises the whole import path: a top-level group that becomes an axis, two clipped adjustment
 * layers, a shadow sitting above the group, a blend mode Studio cannot reproduce, and a hidden
 * work-in-progress layer.
 *
 *   node project/demo/make-demo-psd.js <base-sprite.png> [out.psd]
 *   node project/demo/make-demo-psd.js --project <project-dir> --asset <name.png> [out.psd]
 *
 * The second form pulls the sprite straight out of a NarraLeaf project's asset library, so a demo
 * can be built from art that is already in the project rather than from a file someone has to go
 * and find on disk.
 *
 * The base sprite must be an 8-bit non-interlaced PNG with an alpha channel — which is what a
 * character sprite is. Nothing here writes into the repository.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { writePsdBuffer, initializeCanvas } = require("ag-psd");

// ag-psd builds ImageData through this factory even when it never touches a canvas; the canvas half
// is left throwing on purpose, because reaching it would mean something is wrong rather than slow.
initializeCanvas(
  () => {
    throw new Error("this script does not use a canvas");
  },
  (width, height) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: "srgb"
  })
);

// ---------------------------------------------------------------- PNG (8-bit, non-interlaced)

const paeth = (a, b, c) => {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

function decodePng(buf) {
  let off = 8,
    idat = [],
    width = 0,
    height = 0,
    colorType = 0,
    bitDepth = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(
      `unsupported PNG (depth ${bitDepth}, colour type ${colorType}) — needs 8-bit RGB or RGBA`
    );
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8ClampedArray(width * height * 4);
  let prev = Buffer.alloc(stride),
    pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = Buffer.from(raw.slice(pos, pos + stride));
    pos += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 255;
      else if (filter === 2) line[i] = (line[i] + b) & 255;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) line[i] = (line[i] + paeth(a, b, c)) & 255;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels,
        d = (y * width + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return { width, height, data: out };
}

// ---------------------------------------------------------------- painting

const layer = (width, height) => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4)
});

/** Alpha-blend one colour onto a pixel. Everything below paints through this. */
function paint(img, x, y, [r, g, b], alpha) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  const a = Math.min(1, alpha);
  const was = img.data[i + 3] / 255;
  const now = a + was * (1 - a);
  img.data[i] = (r * a + img.data[i] * was * (1 - a)) / (now || 1);
  img.data[i + 1] = (g * a + img.data[i + 1] * was * (1 - a)) / (now || 1);
  img.data[i + 2] = (b * a + img.data[i + 2] * was * (1 - a)) / (now || 1);
  img.data[i + 3] = now * 255;
}

/** A soft round blob, falling off smoothly so it reads as airbrush rather than as a circle. */
function blob(img, cx, cy, radius, colour, peak) {
  for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
    for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
      const d = Math.hypot(x - cx, y - cy) / radius;
      if (d >= 1) continue;
      const falloff = (1 - d) * (1 - d);
      paint(img, x, y, colour, peak * falloff);
    }
  }
}

/** A rounded stroke, used for the anger mark. */
function stroke(img, x1, y1, x2, y2, thickness, colour, alpha) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1)) * 2;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    blob(img, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, thickness, colour, alpha);
  }
}

function verticalWash(img, colour, topAlpha, bottomAlpha) {
  for (let y = 0; y < img.height; y++) {
    const a = topAlpha + (bottomAlpha - topAlpha) * (y / Math.max(1, img.height - 1));
    for (let x = 0; x < img.width; x++) paint(img, x, y, colour, a);
  }
}

// ---------------------------------------------------------------- the sheet

/**
 * Find an image asset's file inside a project.
 *
 * Content is sharded by the asset's *id*, not by a hash of the bytes, so the metadata index is the
 * only way in.
 */
function readProjectAsset(projectDir, assetName) {
  const indexPath = path.join(projectDir, "assets", "assets.metadata.image.json");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const assets = Object.values(index.assets ?? index);
  const asset = assets.find((entry) => entry.name === assetName);
  if (!asset) {
    throw new Error(
      `no image asset named "${assetName}" in ${projectDir}\n  available: ${assets.map((a) => a.name).join(", ")}`
    );
  }
  const id = asset.id.replace(/-/g, "");
  return fs.readFileSync(
    path.join(projectDir, "assets", "content", id.slice(0, 2), id.slice(2, 4), id.slice(4))
  );
}

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1];
};
const projectDir = flag("--project");
const assetName = flag("--asset");
const positional = args.filter(
  (value, index) => !value.startsWith("--") && !(args[index - 1] ?? "").startsWith("--")
);

let sourceBytes;
if (projectDir) {
  if (!assetName) {
    console.error("--project needs --asset <name.png>");
    process.exit(1);
  }
  sourceBytes = readProjectAsset(projectDir, assetName);
} else if (positional[0]) {
  sourceBytes = fs.readFileSync(positional[0]);
} else {
  console.error(
    [
      "usage:",
      "  node project/demo/make-demo-psd.js <base-sprite.png> [out.psd]",
      "  node project/demo/make-demo-psd.js --project <project-dir> --asset <name.png> [out.psd]"
    ].join("\n")
  );
  process.exit(1);
}
const outArg = projectDir ? positional[0] : positional[1];
const base = decodePng(sourceBytes);
const W = base.width,
  H = base.height;
const out = outArg || path.join(process.cwd(), "layered-demo.psd");

// The face is where the mood marks go. Located as a fraction of the canvas so this still lands
// somewhere sensible on a sprite of another size.
const face = { x: W * 0.48, y: H * 0.17, w: W * 0.29, h: H * 0.12 };
const cheekY = face.y + face.h * 0.75;
const cheekL = face.x - face.w * 0.3;
const cheekR = face.x + face.w * 0.3;
const cheekR2 = Math.round(face.w * 0.26);

/** A cropped layer around the face — cropped on purpose, so the import has to restore its position. */
const moodBox = {
  left: Math.round(face.x - face.w * 0.75),
  top: Math.round(face.y - face.h * 0.9),
  right: Math.round(face.x + face.w * 0.95),
  bottom: Math.round(cheekY + face.h * 0.6)
};
const moodSize = { w: moodBox.right - moodBox.left, h: moodBox.bottom - moodBox.top };

const calm = layer(moodSize.w, moodSize.h);
blob(calm, cheekL - moodBox.left, cheekY - moodBox.top, cheekR2, [255, 138, 150], 0.3);
blob(calm, cheekR - moodBox.left, cheekY - moodBox.top, cheekR2, [255, 138, 150], 0.3);

const angry = layer(moodSize.w, moodSize.h);
blob(angry, cheekL - moodBox.left, cheekY - moodBox.top, cheekR2, [255, 96, 96], 0.34);
blob(angry, cheekR - moodBox.left, cheekY - moodBox.top, cheekR2, [255, 96, 96], 0.34);
// The anger mark: a red hash at the temple, the anime shorthand everyone reads instantly.
const vx = face.x + face.w * 0.72 - moodBox.left;
const vy = face.y - face.h * 0.35 - moodBox.top;
const arm = Math.round(face.w * 0.16);
const gap = Math.round(face.w * 0.055);
const pen = Math.max(2, Math.round(W * 0.0035));
for (const d of [-gap, gap]) {
  stroke(angry, vx - arm, vy + d, vx + arm, vy + d, pen, [214, 38, 46], 0.95);
  stroke(angry, vx + d, vy - arm, vx + d, vy + arm, pen, [214, 38, 46], 0.95);
}

// Full-canvas adjustments, clipped to the character. Without the clip these would flood the whole
// document rectangle, which is exactly what makes the clipping mask worth demonstrating.
const warm = layer(W, H);
verticalWash(warm, [255, 186, 140], 0.1, 0.26);

const rim = layer(W, H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < Math.round(W * 0.34); x++) {
    paint(rim, x, y, [96, 158, 255], 0.55 * (1 - x / (W * 0.34)));
  }
}

// The shadow sits above the mood group, so it has to survive on every mood — that is the whole
// point of merging onto a group rather than onto its topmost member.
const shadeTop = Math.round(H * 0.48);
const shade = layer(W, H - shadeTop);
verticalWash(shade, [92, 104, 150], 0.0, 0.72);

const grain = layer(Math.round(W * 0.5), Math.round(H * 0.25));
for (let y = 0; y < grain.height; y += 2) {
  for (let x = 0; x < grain.width; x += 2) paint(grain, x, y, [180, 180, 180], 0.5);
}

const scratch = layer(Math.round(W * 0.4), Math.round(H * 0.2));
stroke(scratch, 20, 20, grain.width * 0.6, grain.height * 0.4, 6, [40, 40, 40], 0.8);

const psd = {
  width: W,
  height: H,
  children: [
    {
      name: "Body",
      left: 0,
      top: 0,
      right: W,
      bottom: H,
      opacity: 1,
      blendMode: "normal",
      imageData: base
    },
    {
      name: "Warm tint",
      left: 0,
      top: 0,
      right: W,
      bottom: H,
      opacity: 1,
      blendMode: "normal",
      clipping: true,
      imageData: warm
    },
    {
      name: "Rim light",
      left: 0,
      top: 0,
      right: W,
      bottom: H,
      opacity: 1,
      blendMode: "color",
      clipping: true,
      imageData: rim
    },
    {
      name: "Mood",
      opacity: 1,
      blendMode: "pass through",
      children: [
        {
          name: "Calm",
          left: moodBox.left,
          top: moodBox.top,
          right: moodBox.right,
          bottom: moodBox.bottom,
          opacity: 1,
          blendMode: "normal",
          imageData: calm
        },
        {
          name: "Angry",
          left: moodBox.left,
          top: moodBox.top,
          right: moodBox.right,
          bottom: moodBox.bottom,
          opacity: 1,
          blendMode: "normal",
          imageData: angry
        }
      ]
    },
    {
      name: "Shade",
      left: 0,
      top: shadeTop,
      right: W,
      bottom: H,
      opacity: 1,
      blendMode: "multiply",
      imageData: shade
    },
    {
      name: "Grain",
      left: 0,
      top: 0,
      right: grain.width,
      bottom: grain.height,
      opacity: 1,
      blendMode: "dissolve",
      imageData: grain
    },
    {
      name: "Scratch (WIP)",
      left: 40,
      top: Math.round(H * 0.55),
      right: 40 + scratch.width,
      bottom: Math.round(H * 0.55) + scratch.height,
      opacity: 1,
      blendMode: "normal",
      hidden: true,
      imageData: scratch
    }
  ]
};

fs.writeFileSync(out, Buffer.from(writePsdBuffer(psd, { psb: false, generateThumbnail: false })));
console.log(`wrote ${out} — ${W}×${H}, ${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB`);
