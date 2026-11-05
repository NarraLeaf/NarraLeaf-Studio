# Head detector

The model Studio frames a dialog avatar with when an author (or an agent) asks for it: the
"Auto-frame" button beside a character's portrait framing, the Characters panel's "Auto-frame all
dialog avatars", and the `character_avatars_autoframe` agent tool. The avatar bake that runs on its
own never loads it - that one keeps the silhouette heuristic in `src/renderer/lib/utils/headCrop.ts`.

- Source: [deepghs/anime_head_detection](https://huggingface.co/deepghs/anime_head_detection),
  folder `head_detect_v2.0_n_yv11` (YOLO11 nano, one class `head`), MIT - see `LICENSE`.
- Input `images` float32 `[1, 3, 640, 640]`: RGB in 0-1, the picture letterboxed onto grey 114 and
  composited onto white where it is transparent. Output `output0` `[1, 5, 8400]`: centre x, centre y,
  width, height in input pixels, then the head score. The model card's threshold is 0.365.
- Shipped dynamically quantized to uint8 weights (onnxruntime `quantize_dynamic`,
  `weight_type=QUInt8`): 10.0 MB -> 2.8 MB. Over a 43-sprite comparison the quantized boxes overlap
  the float ones at IoU 0.95 or better (median 0.988), with no head found or lost that the float
  model did not, and the same speed. The signed-weight variant does not load in onnxruntime-web's
  WebAssembly build (no `ConvInteger` kernel for it).
- Runs in the workspace window on onnxruntime-web's WebAssembly backend, single-threaded; the
  runtime files are served next to it at `app://windows/ml/` (see the main process's `mlAssets.ts`).
  About 0.25 s per picture on an Apple M1.

sha256 of `model.onnx`: `a9e9e4bc791889c0a05de4eea87146cba8d4b77bde136d5428baa2f07540d9e8`
