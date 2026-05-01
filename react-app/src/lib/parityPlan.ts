export interface ParityStagePlan {
  id: string;
  name: string;
  pythonReference: string;
  browserOutput: string;
  pythonValidationOutput: string;
  validationMethod: string;
}

export const TEST_IMAGES = [
  "example.png",
  "dog.jpg",
  "house.png",
  "tree.png",
  "malbild.png",
] as const;

export const PARITY_PLAN: ParityStagePlan[] = [
  {
    id: "stage-1-normalize",
    name: "Load image, flatten alpha, resize",
    pythonReference: "paint_by_numbers.py -> load_image()",
    browserOutput: "Normalization base canvas",
    pythonValidationOutput: "output/step_normalized.png",
    validationMethod:
      "Use the same source image in Python with --debug. Dimensions must match exactly. Compare the browser preview to output/step_normalized.png before moving on.",
  },
  {
    id: "stage-2-smooth",
    name: "Bilateral smoothing",
    pythonReference: "paint_by_numbers.py -> smooth_image()",
    browserOutput: "Smoothed intermediate canvas",
    pythonValidationOutput: "output/step_smooth.png",
    validationMethod:
      "Match smoothing parameters first, then compare the full stage output image against output/step_smooth.png.",
  },
  {
    id: "stage-3-quantize",
    name: "Lab conversion + k-means quantization",
    pythonReference: "paint_by_numbers.py -> cleanup_to_plain_colors()",
    browserOutput: "Raw quantized raster",
    pythonValidationOutput: "output/step_quantized.png",
    validationMethod:
      "Compare the raw quantized raster against output/step_quantized.png before any strip cleanup or label compaction is ported. Note that the browser currently uses OpenCV k-means while Python still uses sklearn MiniBatchKMeans.",
  },
  {
    id: "stage-4-strip-cleanup",
    name: "Narrow strip cleanup + label compaction",
    pythonReference: "paint_by_numbers.py -> cleanup_narrow_pixel_strips() + compact_labels_by_palette()",
    browserOutput: "Strip-cleaned raster",
    pythonValidationOutput: "output/step_strip_cleanup.png",
    validationMethod:
      "Compare the strip-cleaned raster against output/step_strip_cleanup.png before protrusion pruning or region merging are ported. Label ordering must stay consistent with Python after compaction.",
  },
  {
    id: "stage-5-protrusion-pruning",
    name: "Thin protrusion pruning",
    pythonReference: "paint_by_numbers.py -> prune_thin_protrusions()",
    browserOutput: "Protrusion-pruned raster",
    pythonValidationOutput: "output/step_protrusion_prune.png",
    validationMethod:
      "Validate that only the intended thin tendrils are removed and refill behavior matches Python on the same image before region merging is ported.",
  },
  {
    id: "stage-6-region-merge",
    name: "Connected regions + small region merging",
    pythonReference: "paint_by_numbers.py -> connected_regions() + merge_small_regions()",
    browserOutput: "Merged cleanup raster",
    pythonValidationOutput: "output/cleanup.png and output/paintability_report.json",
    validationMethod:
      "Check merged region counts, smallest region sizes, and cleanup raster equality against Python.",
  },
  {
    id: "stage-7-placement",
    name: "Label placement",
    pythonReference: "paint_by_numbers.py -> region_label_point_for_bbox()",
    browserOutput: "Placement overlay preview",
    pythonValidationOutput: "output/template_bright_color_circles.png",
    validationMethod:
      "Confirm circle anchor positions and radii region by region against Python before adding the final bright background render.",
  },
  {
    id: "stage-8-render",
    name: "Bright color circles rendering",
    pythonReference: "paint_by_numbers.py -> compose_template(...BRIGHT_COLOR_CIRCLES)",
    browserOutput: "Current stage preview",
    pythonValidationOutput: "output/template_bright_color_circles.png",
    validationMethod:
      "Only after all previous stages match should the final PNG be compared against Python template_bright_color_circles.png.",
  },
];
