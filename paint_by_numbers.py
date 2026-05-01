from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import sys
from dataclasses import dataclass, replace
from enum import Enum
from pathlib import Path
from typing import Any

np: Any = None
cv2: Any = None
Image: Any = None
ImageDraw: Any = None
ImageFont: Any = None
ImageOps: Any = None
MiniBatchKMeans: Any = None

OUTLINE_RGB = (32, 32, 32)
NUMBER_DARK_RGB = (18, 18, 18)
NUMBER_LIGHT_RGB = (245, 245, 245)
TEMPLATE_BG_RGB = (255, 255, 255)
LIGHT_PAINT_RGB = (238, 232, 218)

DEFAULT_COLOR_COUNT = 48
DEFAULT_SMOOTH_D = 9
DEFAULT_SMOOTH_SIGMA_COLOR = 50.0
DEFAULT_SMOOTH_SIGMA_SPACE = 50.0
KMEANS_BATCH_SIZE = 4096
KMEANS_RANDOM_STATE = 0
AUTO_COLOR_SAMPLE_SIZE = 12_000
AUTO_COLOR_ANALYSIS_MAX_SIDE = 480
AUTO_COLOR_COVERAGE_TARGET = 0.97
AUTO_COLOR_MIN_CLUSTER_SHARE = 0.005
AUTO_COLOR_MERGE_DISTANCE = 11.0
HARD_EDGE_PROTECTION_LAB_DISTANCE = 26.0
TINY_HARD_EDGE_MERGE_MAX_AREA = 8
SMALL_REGION_MAX_PASSES = 3
THIN_REGION_MAX_AREA_MULTIPLIER = 2
THIN_REGION_MAX_AVERAGE_THICKNESS = 5.5
NARROW_STRIP_CLEANUP_RUNS = 4
PRE_REGION_STRIP_CLEANUP_RUNS = 8
THIN_PROTRUSION_KERNEL_RADIUS = 1
THIN_PROTRUSION_MAX_FILL_STEPS = 12


class NumberRenderMode(str, Enum):
    NUMBERS = "numbers"
    COLOR_CIRCLES = "color-circles"
    CIRCLES_ONLY = "circles-only"
    BRIGHT_COLOR_CIRCLES = "bright-color-circles"
    COLORED_EDGES = "colored-edges"


@dataclass(frozen=True)
class PaletteColor:
    index: int
    number: int
    rgb: tuple[int, int, int]
    pixel_count: int

    @property
    def hex(self) -> str:
        return "#{:02X}{:02X}{:02X}".format(*self.rgb)


@dataclass(frozen=True)
class Region:
    region_id: int
    color_index: int
    area: int
    bbox: tuple[int, int, int, int]


@dataclass(frozen=True)
class LabelPlacement:
    region_id: int
    x: int
    y: int
    radius: float


@dataclass(frozen=True)
class PipelineSettings:
    image: Path
    out_dir: Path
    max_colors: int
    color_count: int
    auto_color_count: bool
    min_label_area: int
    resize_max: int
    debug: bool
    number_mode: NumberRenderMode
    write_colored_edges: bool
    smooth_d: int
    smooth_sigma_color: float
    smooth_sigma_space: float
    effective_min_label_area: int = 0
    effective_merge_area: int = 0
    detected_color_count: int = 0
    color_count_used: int = 0


@dataclass(frozen=True)
class SegmentationResult:
    settings: PipelineSettings
    source: Path
    size: tuple[int, int]
    rgb: Any
    smooth_rgb: Any
    quantized_rgb: Any
    strip_cleanup_rgb: Any
    protrusion_pruned_rgb: Any
    cleanup_rgb: Any
    label_map: Any
    region_map: Any
    regions: dict[int, Region]
    palette: list[PaletteColor]
    raw_palette_rgb: Any
    auto_color_debug: dict[str, Any] | None
    boundary_outline: Any


def require_dependencies() -> None:
    global np, cv2, Image, ImageDraw, ImageFont, ImageOps, MiniBatchKMeans

    if np is not None:
        return

    missing: list[str] = []
    try:
        import numpy as _np
    except ModuleNotFoundError:
        missing.append("numpy")
    try:
        import cv2 as _cv2
    except ModuleNotFoundError:
        missing.append("opencv-python-headless")
    try:
        from PIL import Image as _Image
        from PIL import ImageDraw as _ImageDraw
        from PIL import ImageFont as _ImageFont
        from PIL import ImageOps as _ImageOps
    except ModuleNotFoundError:
        missing.append("pillow")
    try:
        from sklearn.cluster import MiniBatchKMeans as _MiniBatchKMeans
    except ModuleNotFoundError:
        missing.append("scikit-learn")

    if missing:
        raise RuntimeError(
            "Missing dependencies: "
            + ", ".join(sorted(set(missing)))
            + ". Install them with `poetry install` before running the pipeline."
        )

    np = _np
    cv2 = _cv2
    Image = _Image
    ImageDraw = _ImageDraw
    ImageFont = _ImageFont
    ImageOps = _ImageOps
    MiniBatchKMeans = _MiniBatchKMeans


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="paint-by-numbers",
        description="Turn a flat-color AI/cartoon image into a paint-by-number template.",
    )
    parser.add_argument("image", type=Path, help="Input image path")
    parser.add_argument("--out-dir", type=Path, default=Path("output"), help="Output directory. It is cleared before each run.")

    parser.add_argument(
        "--color-count",
        type=int,
        default=DEFAULT_COLOR_COUNT,
        help="Fixed paint color count / K for MiniBatchKMeans. Default: 48.",
    )
    parser.add_argument(
        "--auto-color-count",
        action="store_true",
        help="Estimate the number of main paint colors from a sampled Lab palette analysis.",
    )
    parser.add_argument(
        "--max-colors",
        type=int,
        default=DEFAULT_COLOR_COUNT,
        help="Upper cap used only with --auto-color-count.",
    )

    parser.add_argument(
        "--min-label-area",
        type=int,
        default=260,
        help="Minimum connected region area that receives a number/marker.",
    )
    parser.add_argument(
        "--resize-max",
        type=int,
        default=1200,
        help="Resize the longest side to this many pixels before processing. Use 0 to keep original size.",
    )
    parser.add_argument(
        "--smooth-d",
        type=int,
        default=DEFAULT_SMOOTH_D,
        help="Bilateral filter diameter. Use 0 to disable smoothing.",
    )
    parser.add_argument(
        "--smooth-sigma-color",
        type=float,
        default=DEFAULT_SMOOTH_SIGMA_COLOR,
        help="Bilateral filter sigmaColor.",
    )
    parser.add_argument(
        "--smooth-sigma-space",
        type=float,
        default=DEFAULT_SMOOTH_SIGMA_SPACE,
        help="Bilateral filter sigmaSpace.",
    )
    parser.add_argument(
        "--number-mode",
        choices=[mode.value for mode in NumberRenderMode],
        default=NumberRenderMode.NUMBERS.value,
        help="Recorded preferred template mode. All standard template variants are written.",
    )
    parser.add_argument(
        "--write-colored-edges",
        action="store_true",
        help="Also write template_colored_edges.png. This is intentionally opt-in because it is expensive with many regions.",
    )
    parser.add_argument("--debug", action="store_true", help="Write extra intermediate masks/images")
    return parser.parse_args(argv)


def settings_from_args(args: argparse.Namespace) -> PipelineSettings:
    if args.max_colors < 1:
        raise ValueError("--max-colors must be at least 1")
    if args.color_count < 1:
        raise ValueError("--color-count must be at least 1")
    if args.min_label_area < 1:
        raise ValueError("--min-label-area must be at least 1")
    if args.resize_max < 0:
        raise ValueError("--resize-max must be zero or positive")
    if args.smooth_d < 0:
        raise ValueError("--smooth-d must be zero or positive")
    if args.smooth_d not in (0, 1) and args.smooth_d % 2 == 0:
        raise ValueError("--smooth-d must be odd, or 0 to disable smoothing")

    return PipelineSettings(
        image=args.image,
        out_dir=args.out_dir,
        max_colors=int(args.max_colors),
        color_count=int(args.color_count),
        auto_color_count=bool(args.auto_color_count),
        min_label_area=int(args.min_label_area),
        resize_max=int(args.resize_max),
        debug=bool(args.debug),
        number_mode=NumberRenderMode(args.number_mode),
        write_colored_edges=bool(args.write_colored_edges),
        smooth_d=int(args.smooth_d),
        smooth_sigma_color=float(args.smooth_sigma_color),
        smooth_sigma_space=float(args.smooth_sigma_space),
    )


def settings_with_derived_values(settings: PipelineSettings, total_pixels: int, detected_color_count: int) -> PipelineSettings:
    effective_min_label_area = max(int(settings.min_label_area), int(round(total_pixels * 0.00025)))
    effective_merge_area = int(effective_min_label_area)
    color_count_used = int(detected_color_count)
    return replace(
        settings,
        effective_min_label_area=int(effective_min_label_area),
        effective_merge_area=int(effective_merge_area),
        detected_color_count=int(detected_color_count),
        color_count_used=int(color_count_used),
    )


def sanitize_stem(path: Path) -> str:
    stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", path.stem).strip("._")
    return stem or "paint_by_numbers"


def prepare_output_dir(out_dir: Path, source: Path) -> Path:
    resolved_out_dir = out_dir.resolve()
    resolved_source = source.resolve()
    cwd = Path.cwd().resolve()

    if resolved_out_dir == cwd:
        raise ValueError("--out-dir cannot be the current working directory because it is cleared before each run")
    if resolved_out_dir == resolved_out_dir.parent:
        raise ValueError("--out-dir cannot be a filesystem root")
    if resolved_source.parent == resolved_out_dir or resolved_source.is_relative_to(resolved_out_dir):
        raise ValueError("--out-dir cannot contain the input image because it is cleared before each run")

    out_dir.mkdir(parents=True, exist_ok=True)
    for child in out_dir.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
    return out_dir


def load_image(path: Path, resize_max: int) -> tuple[Any, float]:
    if not path.exists():
        raise FileNotFoundError(f"Input image does not exist: {path}")

    img = Image.open(path)
    img = ImageOps.exif_transpose(img)

    if "A" in img.getbands():
        rgba = img.convert("RGBA")
        white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        white.alpha_composite(rgba)
        img = white.convert("RGB")
    else:
        img = img.convert("RGB")

    scale = 1.0
    width, height = img.size
    longest = max(width, height)
    if resize_max > 0 and longest > resize_max:
        scale = resize_max / float(longest)
        img = img.resize((round(width * scale), round(height * scale)), Image.Resampling.LANCZOS)

    return np.asarray(img, dtype=np.uint8), scale


# -----------------------------------------------------------------------------
# Cleanup stage: clean_img.py approach, but memory-safe and fixed-K by default.
# -----------------------------------------------------------------------------


def cleanup_to_plain_colors(rgb: Any, settings: PipelineSettings) -> tuple[Any, Any, Any, Any, int, dict[str, Any] | None]:
    """Return (smooth_rgb, quantized_rgb, cleanup_rgb, label_map, detected_color_count, auto_color_debug).

    Pipeline:
      1. edge-preserving bilateral smoothing
      2. Lab-space MiniBatchKMeans quantization
    """
    smooth = smooth_image(rgb, settings)
    lab = cv2.cvtColor(smooth, cv2.COLOR_RGB2LAB).astype(np.float32)
    height, width = lab.shape[:2]
    pixels = lab.reshape(-1, 3)

    auto_color_debug: dict[str, Any] | None = None
    if settings.auto_color_count:
        requested_k, auto_color_debug = detect_main_colors(smooth, settings.max_colors)
    else:
        requested_k = settings.color_count

    k = max(1, min(int(requested_k), int(len(pixels))))

    kmeans = MiniBatchKMeans(
        n_clusters=k,
        random_state=KMEANS_RANDOM_STATE,
        batch_size=KMEANS_BATCH_SIZE,
        n_init="auto",
    )
    kmeans.fit(pixels)

    centers_lab = kmeans.cluster_centers_.astype(np.float32)
    centers_lab_u8 = np.clip(np.round(centers_lab), 0, 255).astype(np.uint8)
    palette_rgb = cv2.cvtColor(centers_lab_u8.reshape(1, k, 3), cv2.COLOR_LAB2RGB).reshape(k, 3).astype(np.uint8)

    label_map = kmeans.labels_.reshape(height, width).astype(np.int32)
    quantized_rgb = palette_rgb[np.clip(label_map, 0, max(0, len(palette_rgb) - 1))].reshape(height, width, 3).astype(np.uint8)
    label_map, _ = cleanup_narrow_pixel_strips(label_map, palette_rgb=palette_rgb, runs=PRE_REGION_STRIP_CLEANUP_RUNS)
    label_map, palette_rgb = compact_labels_by_palette(label_map, palette_rgb)
    cleanup_rgb = palette_rgb[np.clip(label_map, 0, max(0, len(palette_rgb) - 1))].reshape(height, width, 3).astype(np.uint8)

    return smooth.astype(np.uint8), quantized_rgb, cleanup_rgb, label_map.astype(np.int32), int(len(palette_rgb)), auto_color_debug


def smooth_image(rgb: Any, settings: PipelineSettings) -> Any:
    if settings.smooth_d <= 1:
        return rgb.copy()
    return cv2.bilateralFilter(
        rgb,
        d=int(settings.smooth_d),
        sigmaColor=float(settings.smooth_sigma_color),
        sigmaSpace=float(settings.smooth_sigma_space),
    )


def compact_labels_by_palette(label_map: Any, palette_rgb: Any) -> tuple[Any, Any]:
    present_labels, counts = np.unique(label_map[label_map >= 0], return_counts=True)
    if len(present_labels) == 0:
        return np.zeros_like(label_map, dtype=np.int32), np.array([[255, 255, 255]], dtype=np.uint8)

    entries: list[tuple[int, int, tuple[int, int, int]]] = []
    for label, count in zip(present_labels, counts, strict=True):
        label_int = int(label)
        rgb = tuple(int(channel) for channel in palette_rgb[label_int])
        entries.append((label_int, int(count), rgb))

    # Numbering is stable and useful: largest areas first, then hue order.
    entries.sort(key=lambda item: (-item[1], color_sort_key(item[2])))
    remap = {old_label: new_label for new_label, (old_label, _, _) in enumerate(entries)}

    max_label = int(label_map.max()) if label_map.size > 0 else 0
    lut = np.full(max_label + 1, -1, dtype=np.int32)
    for old_label, new_label in remap.items():
        lut[old_label] = new_label
    compact = np.full(label_map.shape, -1, dtype=np.int32)
    valid = label_map >= 0
    compact[valid] = lut[label_map[valid]]

    compact_palette = np.array([rgb for _, _, rgb in entries], dtype=np.uint8)
    return compact, compact_palette


def detect_main_colors(rgb: Any, max_colors_hint: int = DEFAULT_COLOR_COUNT) -> tuple[int, dict[str, Any]]:
    analysis_rgb = resized_analysis_rgb(rgb, AUTO_COLOR_ANALYSIS_MAX_SIDE)
    lab = cv2.cvtColor(analysis_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    pixels = lab.reshape(-1, 3)
    if len(pixels) == 0:
        return 1, {
            "analysis_size": {"width": 0, "height": 0},
            "analysis_pixels": 0,
            "sample_size": 0,
            "exploratory_k": 1,
            "candidate_clusters_before_merge": 0,
            "candidate_clusters_after_merge": 0,
            "min_cluster_pixels": 0,
            "coverage_target": float(AUTO_COLOR_COVERAGE_TARGET),
            "selected_cluster_count": 1,
            "selected_coverage_percent": 0.0,
            "selected_clusters": [],
        }

    sample = sample_lab_pixels(pixels, AUTO_COLOR_SAMPLE_SIZE)
    exploratory_k = max(2, min(int(max_colors_hint) * 2, 64, len(sample)))
    if exploratory_k <= 2:
        detected_count = max(1, min(int(max_colors_hint), int(len(sample))))
        return detected_count, {
            "analysis_size": {"width": int(analysis_rgb.shape[1]), "height": int(analysis_rgb.shape[0])},
            "analysis_pixels": int(len(pixels)),
            "sample_size": int(len(sample)),
            "exploratory_k": int(exploratory_k),
            "candidate_clusters_before_merge": int(exploratory_k),
            "candidate_clusters_after_merge": int(detected_count),
            "min_cluster_pixels": 1,
            "coverage_target": float(AUTO_COLOR_COVERAGE_TARGET),
            "selected_cluster_count": int(detected_count),
            "selected_coverage_percent": 100.0,
            "selected_clusters": [],
        }

    kmeans = MiniBatchKMeans(
        n_clusters=exploratory_k,
        random_state=KMEANS_RANDOM_STATE,
        batch_size=min(KMEANS_BATCH_SIZE, len(sample)),
        n_init="auto",
    )
    labels = kmeans.fit_predict(sample)
    counts = np.bincount(labels, minlength=exploratory_k)

    clusters = [
        {
            "lab": kmeans.cluster_centers_[cluster_index].astype(np.float32).copy(),
            "count": int(count),
            "first_seen": cluster_index,
        }
        for cluster_index, count in enumerate(counts)
        if int(count) > 0
    ]
    if not clusters:
        return 1, {
            "analysis_size": {"width": int(analysis_rgb.shape[1]), "height": int(analysis_rgb.shape[0])},
            "analysis_pixels": int(len(pixels)),
            "sample_size": int(len(sample)),
            "exploratory_k": int(exploratory_k),
            "candidate_clusters_before_merge": 0,
            "candidate_clusters_after_merge": 0,
            "min_cluster_pixels": 0,
            "coverage_target": float(AUTO_COLOR_COVERAGE_TARGET),
            "selected_cluster_count": 1,
            "selected_coverage_percent": 0.0,
            "selected_clusters": [],
        }

    clusters_before_merge = len(clusters)
    clusters.sort(key=lambda item: (-int(item["count"]), int(item["first_seen"])))
    clusters = merge_close_lab_palette_clusters(clusters, merge_distance=AUTO_COLOR_MERGE_DISTANCE)

    min_cluster_pixels = max(8, int(round(len(sample) * AUTO_COLOR_MIN_CLUSTER_SHARE)))
    selected: list[dict[str, Any]] = []
    covered_pixels = 0

    for cluster in clusters:
        count = int(cluster["count"])
        if count < min_cluster_pixels and covered_pixels >= int(round(len(sample) * AUTO_COLOR_COVERAGE_TARGET)):
            break
        if count < min_cluster_pixels and selected:
            continue
        selected.append(cluster)
        covered_pixels += count
        if len(selected) >= int(max_colors_hint):
            break
        if covered_pixels >= int(round(len(sample) * AUTO_COLOR_COVERAGE_TARGET)):
            break

    detected_count = max(1, min(int(max_colors_hint), len(selected) or 1))
    coverage_percent = 100.0 * float(covered_pixels) / max(1, float(len(sample)))
    selected_clusters = [serialize_auto_color_cluster(cluster, len(sample)) for cluster in selected]
    debug_info = {
        "analysis_size": {"width": int(analysis_rgb.shape[1]), "height": int(analysis_rgb.shape[0])},
        "analysis_pixels": int(len(pixels)),
        "sample_size": int(len(sample)),
        "exploratory_k": int(exploratory_k),
        "candidate_clusters_before_merge": int(clusters_before_merge),
        "candidate_clusters_after_merge": int(len(clusters)),
        "min_cluster_pixels": int(min_cluster_pixels),
        "coverage_target": float(AUTO_COLOR_COVERAGE_TARGET),
        "selected_cluster_count": int(detected_count),
        "selected_coverage_percent": round(coverage_percent, 3),
        "selected_clusters": selected_clusters,
    }
    return detected_count, debug_info


def resized_analysis_rgb(rgb: Any, max_side: int) -> Any:
    height, width = rgb.shape[:2]
    longest = max(height, width)
    if longest <= max_side:
        return rgb

    scale = max_side / float(longest)
    new_width = max(1, int(round(width * scale)))
    new_height = max(1, int(round(height * scale)))
    return cv2.resize(rgb, (new_width, new_height), interpolation=cv2.INTER_AREA)


def sample_lab_pixels(pixels: Any, max_samples: int) -> Any:
    if len(pixels) <= max_samples:
        return pixels

    rng = np.random.default_rng(KMEANS_RANDOM_STATE)
    indices = rng.choice(len(pixels), size=max_samples, replace=False)
    return pixels[np.sort(indices)]


def serialize_auto_color_cluster(cluster: dict[str, Any], sample_size: int) -> dict[str, Any]:
    lab_u8 = np.clip(np.round(cluster["lab"]), 0, 255).astype(np.uint8)
    rgb = cv2.cvtColor(lab_u8.reshape(1, 1, 3), cv2.COLOR_LAB2RGB).reshape(3)
    rgb_tuple = tuple(int(channel) for channel in rgb)
    count = int(cluster["count"])
    return {
        "sample_pixels": count,
        "sample_percent": round(100.0 * count / max(1, sample_size), 3),
        "rgb": list(rgb_tuple),
        "hex": "#{:02X}{:02X}{:02X}".format(*rgb_tuple),
    }


def largest_connected_bin_component(inverse_map: Any, bin_indices: list[int]) -> int:
    if not bin_indices:
        return 0

    mask = np.isin(inverse_map, np.array(bin_indices, dtype=inverse_map.dtype))
    if not np.any(mask):
        return 0

    component_count, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if component_count <= 1:
        return 0
    return int(stats[1:, cv2.CC_STAT_AREA].max())


def merge_close_lab_palette_clusters(clusters: list[dict[str, Any]], merge_distance: float = 12.0) -> list[dict[str, Any]]:
    pending = [
        {
            "lab": item["lab"].astype(np.float32).copy(),
            "count": int(item["count"]),
            "first_seen": int(item.get("first_seen", 0)),
        }
        for item in clusters
    ]

    while len(pending) > 1:
        best_pair: tuple[int, int] | None = None
        best_distance = float("inf")

        for i in range(len(pending)):
            for j in range(i + 1, len(pending)):
                distance = float(np.linalg.norm(pending[i]["lab"] - pending[j]["lab"]))
                if distance < best_distance:
                    best_distance = distance
                    best_pair = (i, j)

        if best_pair is None or best_distance > merge_distance:
            break

        i, j = best_pair
        keep, drop = (i, j) if int(pending[i]["count"]) >= int(pending[j]["count"]) else (j, i)
        keep_item = pending[keep]
        drop_item = pending[drop]
        total = int(keep_item["count"]) + int(drop_item["count"])
        keep_item["lab"] = (
            keep_item["lab"] * int(keep_item["count"]) + drop_item["lab"] * int(drop_item["count"])
        ) / max(1, total)
        keep_item["count"] = total
        keep_item["first_seen"] = min(int(keep_item["first_seen"]), int(drop_item["first_seen"]))
        pending.pop(drop)

    pending.sort(key=lambda item: (-int(item["count"]), int(item["first_seen"])))
    return pending


def prune_thin_protrusions(label_map: Any, kernel_radius: int = THIN_PROTRUSION_KERNEL_RADIUS) -> Any:
    """Sever thin protrusions from color regions using morphological opening.

    A region may have enough total area to survive merging but contain 1-2px
    wide tendrils along color edges that are not paintable.  Morphological
    opening removes these thin parts, and their pixels are reassigned to the
    nearest valid neighbor via iterative 4-connected dilation.
    """
    pruned = label_map.copy().astype(np.int32)
    radius = max(1, int(kernel_radius))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))

    for color_index in np.unique(label_map):
        if int(color_index) < 0:
            continue
        mask = (label_map == color_index).astype(np.uint8)
        opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        if np.any(opened):
            removed = mask.astype(bool) & ~opened.astype(bool)
            pruned[removed] = -1

    # Fill removed pixels from nearest valid neighbor (iterative dilation).
    for _ in range(THIN_PROTRUSION_MAX_FILL_STEPS):
        unknown = pruned < 0
        if not np.any(unknown):
            break
        changed = False
        for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            neighbor = np.full_like(pruned, -1)
            if dy == -1:
                neighbor[1:, :] = pruned[:-1, :]
            elif dy == 1:
                neighbor[:-1, :] = pruned[1:, :]
            elif dx == -1:
                neighbor[:, 1:] = pruned[:, :-1]
            else:
                neighbor[:, :-1] = pruned[:, 1:]
            fill = unknown & (neighbor >= 0)
            if np.any(fill):
                pruned[fill] = neighbor[fill]
                unknown &= ~fill
                changed = True
        if not changed:
            break

    return pruned


# -----------------------------------------------------------------------------
# Region construction.
# -----------------------------------------------------------------------------


def merge_small_regions(label_map: Any, palette_rgb: Any, min_region_area: int) -> tuple[Any, Any]:
    if min_region_area <= 1:
        return compact_labels_by_palette(label_map, palette_rgb)

    merged = label_map.copy().astype(np.int32)

    for _ in range(SMALL_REGION_MAX_PASSES):
        changed = False
        region_map, regions = connected_regions(merged)
        adjacency = build_region_adjacency(region_map)
        candidate_ids = collect_merge_candidate_region_ids(regions, min_region_area)
        if candidate_ids:
            merge_targets = plan_region_merges(candidate_ids, regions, adjacency, palette_rgb)
            if merge_targets:
                merged = apply_region_merges(merged, region_map, regions, merge_targets)
                changed = True

        merged, strip_changed = cleanup_narrow_pixel_strips(merged, palette_rgb=palette_rgb)
        changed = changed or strip_changed

        if not changed:
            break

    return compact_labels_by_palette(merged, palette_rgb)


def collect_merge_candidate_region_ids(
    regions: dict[int, Region],
    min_region_area: int,
) -> list[int]:
    candidate_ids: list[int] = []
    thin_region_area_limit = int(min_region_area * THIN_REGION_MAX_AREA_MULTIPLIER)

    for region in regions.values():
        if region.area < min_region_area:
            candidate_ids.append(region.region_id)
            continue

        if region.area <= thin_region_area_limit and region_average_thickness(region) <= THIN_REGION_MAX_AVERAGE_THICKNESS:
            candidate_ids.append(region.region_id)

    return candidate_ids


def cleanup_narrow_pixel_strips(label_map: Any, palette_rgb: Any | None = None, runs: int = NARROW_STRIP_CLEANUP_RUNS) -> tuple[Any, bool]:
    if label_map.shape[0] < 3 or label_map.shape[1] < 3:
        return label_map.astype(np.int32), False

    cleaned = label_map.copy().astype(np.int32)
    changed_any = False
    palette_lab = None
    if palette_rgb is not None and len(palette_rgb) > 0:
        palette_lab = cv2.cvtColor(palette_rgb.reshape(1, len(palette_rgb), 3), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)

    for _ in range(max(1, int(runs))):
        counts = label_pixel_counts(cleaned)
        center = cleaned[1:-1, 1:-1]
        left = cleaned[1:-1, :-2]
        right = cleaned[1:-1, 2:]
        up = cleaned[:-2, 1:-1]
        down = cleaned[2:, 1:-1]
        up_left = cleaned[:-2, :-2]
        up_right = cleaned[:-2, 2:]
        down_left = cleaned[2:, :-2]
        down_right = cleaned[2:, 2:]

        valid_center = center >= 0
        horizontal = valid_center & (left >= 0) & (left == right) & (left != center)
        vertical = valid_center & (up >= 0) & (up == down) & (up != center)
        diagonal_a = valid_center & (up_left >= 0) & (up_left == down_right) & (up_left != center)
        diagonal_b = valid_center & (up_right >= 0) & (up_right == down_left) & (up_right != center)
        cross_left = valid_center & (left >= 0) & (left == up) & (left == down) & (left != center)
        cross_right = valid_center & (right >= 0) & (right == up) & (right == down) & (right != center)
        cross_up = valid_center & (up >= 0) & (up == left) & (up == right) & (up != center)
        cross_down = valid_center & (down >= 0) & (down == left) & (down == right) & (down != center)
        candidate = horizontal | vertical | diagonal_a | diagonal_b | cross_left | cross_right | cross_up | cross_down
        if not np.any(candidate):
            break

        replacement = center.copy()
        replacement_strength = np.zeros(center.shape, dtype=np.int64)

        def promote(mask: Any, target: Any) -> None:
            if not np.any(mask):
                return
            target_labels = target[mask].astype(np.int64)
            update = np.ones(len(target_labels), dtype=bool)
            if palette_lab is not None:
                center_labels = center[mask].astype(np.int64)
                color_distance = np.linalg.norm(palette_lab[target_labels] - palette_lab[center_labels], axis=1)
                update &= color_distance <= HARD_EDGE_PROTECTION_LAB_DISTANCE
                if not np.any(update):
                    return
            target_strength = counts[target_labels]
            current_strength = replacement_strength[mask]
            update &= target_strength > current_strength
            if not np.any(update):
                return
            replacement_values = replacement[mask]
            replacement_values[update] = target_labels[update].astype(np.int32)
            replacement[mask] = replacement_values
            replacement_values_strength = replacement_strength[mask]
            replacement_values_strength[update] = target_strength[update]
            replacement_strength[mask] = replacement_values_strength

        promote(horizontal, left)
        promote(vertical, up)
        promote(diagonal_a, up_left)
        promote(diagonal_b, up_right)
        promote(cross_left, left)
        promote(cross_right, right)
        promote(cross_up, up)
        promote(cross_down, down)

        changed_mask = replacement != center
        if not np.any(changed_mask):
            break

        cleaned[1:-1, 1:-1][changed_mask] = replacement[changed_mask]
        changed_any = True

    return cleaned, changed_any


def label_pixel_counts(label_map: Any) -> Any:
    valid = label_map[label_map >= 0]
    if len(valid) == 0:
        return np.zeros(0, dtype=np.int64)
    return np.bincount(valid.astype(np.int64), minlength=int(valid.max()) + 1)


def region_average_thickness(region: Region) -> float:
    x1, y1, x2, y2 = region.bbox
    width = max(1, int(x2 - x1))
    height = max(1, int(y2 - y1))
    longest_side = max(width, height)
    return float(region.area) / float(longest_side)


def build_region_adjacency(region_map: Any) -> dict[int, dict[int, int]]:
    adjacency: dict[int, dict[int, int]] = {}
    if region_map.size == 0:
        return adjacency

    base = int(region_map.max()) + 1
    if base <= 0:
        return adjacency

    def add_pairs(left: Any, right: Any) -> None:
        mask = (left >= 0) & (right >= 0) & (left != right)
        if not np.any(mask):
            return

        pairs = np.stack((left[mask].astype(np.int64), right[mask].astype(np.int64)), axis=1)
        ordered = np.sort(pairs, axis=1)
        packed = ordered[:, 0] * base + ordered[:, 1]
        unique, counts = np.unique(packed, return_counts=True)

        for packed_value, count in zip(unique, counts, strict=True):
            a = int(packed_value // base)
            b = int(packed_value % base)
            adjacency.setdefault(a, {})[b] = adjacency.setdefault(a, {}).get(b, 0) + int(count)
            adjacency.setdefault(b, {})[a] = adjacency.setdefault(b, {}).get(a, 0) + int(count)

    add_pairs(region_map[:, :-1], region_map[:, 1:])
    add_pairs(region_map[:-1, :], region_map[1:, :])
    return adjacency


def plan_region_merges(
    candidate_ids: list[int],
    regions: dict[int, Region],
    adjacency: dict[int, dict[int, int]],
    palette_rgb: Any,
) -> dict[int, int]:
    palette_lab = cv2.cvtColor(palette_rgb.reshape(1, len(palette_rgb), 3), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    candidate_set = set(int(region_id) for region_id in candidate_ids)
    merge_targets: dict[int, int] = {}

    for region_id in sorted(candidate_set, key=lambda item: (int(regions[item].area), int(item))):
        target_region_id = choose_region_merge_target(region_id, regions, adjacency, candidate_set, palette_lab)
        if target_region_id is not None:
            merge_targets[int(region_id)] = int(target_region_id)

    return merge_targets


def choose_region_merge_target(
    source_region_id: int,
    regions: dict[int, Region],
    adjacency: dict[int, dict[int, int]],
    candidate_set: set[int],
    palette_lab: Any,
) -> int | None:
    source_region = regions.get(int(source_region_id))
    if source_region is None:
        return None

    source_priority = region_merge_priority(source_region)
    source_lab = palette_lab[int(source_region.color_index)]
    options: list[tuple[int, int, int, int, float, int]] = []

    for neighbor_region_id, border_count in adjacency.get(int(source_region_id), {}).items():
        neighbor_region = regions.get(int(neighbor_region_id))
        if neighbor_region is None:
            continue

        is_candidate_neighbor = int(neighbor_region_id) in candidate_set
        if is_candidate_neighbor and region_merge_priority(neighbor_region) <= source_priority:
            continue

        larger_neighbor = neighbor_region.area > source_region.area
        color_distance = float(np.linalg.norm(palette_lab[int(neighbor_region.color_index)] - source_lab))
        if color_distance > HARD_EDGE_PROTECTION_LAB_DISTANCE and source_region.area > TINY_HARD_EDGE_MERGE_MAX_AREA:
            continue
        options.append(
            (
                1 if is_candidate_neighbor else 0,
                0 if larger_neighbor else 1,
                -int(border_count),
                -int(neighbor_region.area),
                color_distance,
                int(neighbor_region_id),
            )
        )

    if not options:
        return None

    return min(options)[-1]


def region_merge_priority(region: Region) -> tuple[int, int]:
    return int(region.area), int(region.region_id)


def apply_region_merges(
    label_map: Any,
    region_map: Any,
    regions: dict[int, Region],
    merge_targets: dict[int, int],
) -> Any:
    resolved_cache: dict[int, int] = {}

    def resolve_target(region_id: int) -> int:
        current = int(region_id)
        visited: list[int] = []

        while current in merge_targets:
            if current in resolved_cache:
                current = resolved_cache[current]
                break
            if current in visited:
                break
            visited.append(current)
            current = int(merge_targets[current])

        for item in visited:
            resolved_cache[item] = int(current)
        return int(current)

    region_to_label = np.full(max(regions.keys(), default=-1) + 1, -1, dtype=np.int32)
    for region in regions.values():
        region_to_label[int(region.region_id)] = int(region.color_index)

    for source_region_id in sorted(merge_targets):
        target_region_id = resolve_target(int(merge_targets[source_region_id]))
        target_region = regions.get(int(target_region_id))
        if target_region is None:
            continue

        region_to_label[int(source_region_id)] = int(target_region.color_index)

    merged = np.full(region_map.shape, -1, dtype=np.int32)
    valid = region_map >= 0
    merged[valid] = region_to_label[region_map[valid]]
    return merged


def connected_regions(label_map: Any) -> tuple[Any, dict[int, Region]]:
    region_map = np.full(label_map.shape, -1, dtype=np.int32)
    regions: dict[int, Region] = {}
    next_id = 0

    for color_index in sorted(int(idx) for idx in np.unique(label_map) if idx >= 0):
        mask = (label_map == color_index).astype(np.uint8)
        num_labels, components, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        for component_id in range(1, num_labels):
            area = int(stats[component_id, cv2.CC_STAT_AREA])
            if area <= 0:
                continue
            component_mask = components == component_id
            region_map[component_mask] = next_id
            x = int(stats[component_id, cv2.CC_STAT_LEFT])
            y = int(stats[component_id, cv2.CC_STAT_TOP])
            w = int(stats[component_id, cv2.CC_STAT_WIDTH])
            h = int(stats[component_id, cv2.CC_STAT_HEIGHT])
            regions[next_id] = Region(
                region_id=next_id,
                color_index=color_index,
                area=area,
                bbox=(x, y, x + w, y + h),
            )
            next_id += 1

    return region_map, regions


def palette_from_label_map(cleanup_rgb: Any, label_map: Any) -> list[PaletteColor]:
    labels, counts = np.unique(label_map[label_map >= 0], return_counts=True)
    if len(labels) == 0:
        return []

    # cleanup_rgb is built from palette[label_map], so all pixels with the same
    # label share one color — use the fast O(N) palette extraction.
    raw_palette = palette_rgb_from_label_map(cleanup_rgb, label_map)
    palette: list[PaletteColor] = []
    for label, count in zip(labels, counts, strict=True):
        label_int = int(label)
        rgb_value = tuple(int(c) for c in raw_palette[label_int])
        palette.append(
            PaletteColor(
                index=label_int,
                number=label_int + 1,
                rgb=normalize_paint_color(rgb_value),
                pixel_count=int(count),
            )
        )

    palette.sort(key=lambda item: item.index)
    return palette


def palette_rgb_from_label_map(cleanup_rgb: Any, label_map: Any) -> Any:
    flat_labels = label_map.ravel()
    valid = flat_labels >= 0
    if not np.any(valid):
        return np.array([[255, 255, 255]], dtype=np.uint8)

    # All pixels with the same label share one color — single vectorized scatter.
    max_label = int(flat_labels[valid].max())
    palette = np.full((max_label + 1, 3), 255, dtype=np.uint8)
    palette[flat_labels[valid]] = cleanup_rgb.reshape(-1, 3)[valid]
    return palette


def count_unique_rgb_colors(rgb: Any) -> int:
    if len(rgb.shape) != 3 or rgb.shape[2] != 3:
        return 0
    flat = rgb.reshape(-1, 3)
    if len(flat) == 0:
        return 0
    return int(len(np.unique(flat, axis=0)))


def exact_palette_from_raw_palette(raw_palette_rgb: Any, pixel_counts: list[int]) -> list[PaletteColor]:
    palette: list[PaletteColor] = []
    for index, rgb in enumerate(raw_palette_rgb):
        palette.append(
            PaletteColor(
                index=int(index),
                number=int(index + 1),
                rgb=tuple(int(channel) for channel in rgb),
                pixel_count=int(pixel_counts[index]) if index < len(pixel_counts) else 0,
            )
        )
    return palette


def boundary_mask(region_map: Any) -> Any:
    boundary = np.zeros(region_map.shape, dtype=bool)
    valid = region_map >= 0

    horizontal = valid[:, 1:] & valid[:, :-1] & (region_map[:, 1:] != region_map[:, :-1])
    boundary[:, :-1] |= horizontal

    vertical = valid[1:, :] & valid[:-1, :] & (region_map[1:, :] != region_map[:-1, :])
    boundary[:-1, :] |= vertical

    return boundary.astype(bool)


# -----------------------------------------------------------------------------
# Color helpers and fast rasterization.
# -----------------------------------------------------------------------------


def color_sort_key(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    arr = np.uint8([[rgb]])
    hsv = cv2.cvtColor(arr, cv2.COLOR_RGB2HSV)[0, 0]
    return float(hsv[0]), float(hsv[1]), float(hsv[2])


def relative_luminance(rgb: tuple[int, int, int]) -> float:
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def normalize_paint_color(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    luminance = relative_luminance(rgb)
    spread = max(rgb) - min(rgb)

    if luminance > 244.0 and spread < 24:
        return LIGHT_PAINT_RGB

    if luminance >= 42.0:
        return rgb

    scale = 42.0 / max(luminance, 1.0)
    return tuple(max(24, min(255, int(round(channel * scale)))) for channel in rgb)


def number_color_for_fill(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    return NUMBER_LIGHT_RGB if relative_luminance(rgb) < 105.0 else NUMBER_DARK_RGB


def bright_template_color(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    # Strong tint toward white while keeping hue visible.
    alpha = 0.16
    return tuple(int(round(255 * (1.0 - alpha) + channel * alpha)) for channel in rgb)


def palette_array(palette: list[PaletteColor], bright: bool = False) -> Any:
    if not palette:
        return np.array([[255, 255, 255]], dtype=np.uint8)

    colors: list[tuple[int, int, int]] = []
    for color in palette:
        colors.append(bright_template_color(color.rgb) if bright else color.rgb)
    return np.array(colors, dtype=np.uint8)


def raster_from_label_map(label_map: Any, palette: list[PaletteColor], fallback_rgb: tuple[int, int, int] = OUTLINE_RGB, bright: bool = False) -> Any:
    colors = palette_array(palette, bright=bright)
    safe_labels = np.clip(label_map, 0, len(colors) - 1)
    out = colors[safe_labels].astype(np.uint8)
    out[label_map < 0] = fallback_rgb
    return out


# -----------------------------------------------------------------------------
# Label placement and rendering.
# -----------------------------------------------------------------------------


def precompute_label_placements(
    region_map: Any,
    regions: dict[int, Region],
    min_label_area: int,
) -> dict[int, LabelPlacement]:
    placements: dict[int, LabelPlacement] = {}
    for region in regions.values():
        if region.area < min_label_area:
            continue
        x, y, radius = region_label_point_for_region(region_map, region)
        placements[region.region_id] = LabelPlacement(region.region_id, x, y, radius)
    return placements


def region_label_point_for_region(region_map: Any, region: Region) -> tuple[int, int, float]:
    return region_label_point_for_bbox(region_map, region.region_id, region.bbox)


def region_label_point_for_bbox(region_map: Any, region_id: int, bbox: tuple[int, int, int, int]) -> tuple[int, int, float]:
    x1, y1, x2, y2 = bbox
    mask = (region_map[y1:y2, x1:x2] == region_id).astype(np.uint8)
    if not np.any(mask):
        return x1, y1, 0.0

    padded = cv2.copyMakeBorder(mask, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    dist = cv2.distanceTransform(padded, cv2.DIST_L2, 5)
    _, max_value, _, max_loc = cv2.minMaxLoc(dist)
    x = min(max(x1 + int(max_loc[0]) - 1, 0), region_map.shape[1] - 1)
    y = min(max(y1 + int(max_loc[1]) - 1, 0), region_map.shape[0] - 1)
    return x, y, float(max_value)


def draw_region_numbers(
    image_rgb: Any,
    region_map: Any,
    regions: dict[int, Region],
    palette: list[PaletteColor],
    placements: dict[int, LabelPlacement],
    adaptive_color: bool = False,
    number_mode: NumberRenderMode = NumberRenderMode.NUMBERS,
) -> Any:
    out = image_rgb.copy()
    if number_mode == NumberRenderMode.COLORED_EDGES:
        return out

    height, width = region_map.shape
    longest = max(height, width)
    font = cv2.FONT_HERSHEY_SIMPLEX
    min_scale = min(0.62, max(0.42, longest / 2600.0))
    max_scale = min(0.85, max(0.62, longest / 1500.0))

    for region in sorted(regions.values(), key=lambda item: item.area, reverse=True):
        placement = placements.get(region.region_id)
        if placement is None:
            continue

        palette_color = palette[region.color_index]
        number = str(palette_color.number)
        x, y, radius = placement.x, placement.y, placement.radius
        scale = choose_font_scale(number, font, radius, region.area, min_scale, max_scale)
        scale, thickness, text_w, text_h, baseline, margin = fit_text_box_to_canvas(number, font, scale, width, height)

        if number_mode in (NumberRenderMode.CIRCLES_ONLY, NumberRenderMode.BRIGHT_COLOR_CIRCLES):
            circle_radius = min(fixed_circle_marker_radius(width, height), max(1, int(math.floor(radius * 0.75))))
            center_x, center_y, circle_radius = clamp_circle_to_canvas(x, y, circle_radius, width, height)
            cv2.circle(out, (center_x, center_y), circle_radius, palette_color.rgb, -1, cv2.LINE_AA)
            continue

        if number_mode == NumberRenderMode.COLOR_CIRCLES:
            scale, thickness, text_w, text_h, baseline, margin, circle_radius = fit_circle_label_to_region(
                number, font, scale, radius, width, height
            )
            center_x, center_y, circle_radius = clamp_circle_to_canvas(x, y, circle_radius, width, height)
            cv2.circle(out, (center_x, center_y), circle_radius, palette_color.rgb, -1, cv2.LINE_AA)
            origin_x = int(round(center_x - text_w / 2))
            origin_y = int(round(center_y + (text_h - baseline) / 2))
            text_color = number_color_for_fill(palette_color.rgb)
        else:
            origin_x = int(round(x - text_w / 2))
            origin_y = int(round(y + text_h / 2))
            text_color = number_color_for_fill(palette_color.rgb) if adaptive_color else NUMBER_DARK_RGB

        origin_x, origin_y = clamp_text_origin_to_canvas(origin_x, origin_y, text_w, text_h, baseline, width, height, margin)
        cv2.putText(out, number, (origin_x, origin_y), font, scale, text_color, thickness, cv2.LINE_AA)

    return out


def fixed_circle_marker_radius(width: int, height: int) -> int:
    longest = max(width, height)
    return max(3, min(5, int(round(longest / 300.0))))


def fit_circle_label_to_region(
    text: str,
    font: int,
    scale: float,
    region_radius: float,
    width: int,
    height: int,
) -> tuple[float, int, int, int, int, int, int]:
    min_scale = 0.22

    for _ in range(24):
        scale, thickness, text_w, text_h, baseline, margin = fit_text_box_to_canvas(text, font, scale, width, height)
        circle_radius = circle_radius_for_text(text_w, text_h, baseline, thickness)
        max_region_radius = max(1.0, region_radius * 0.82)
        if circle_radius <= max_region_radius or scale <= min_scale:
            return scale, thickness, text_w, text_h, baseline, margin, min(circle_radius, max(1, int(math.floor(max_region_radius))))
        scale *= 0.9

    scale, thickness, text_w, text_h, baseline, margin = fit_text_box_to_canvas(text, font, scale, width, height)
    max_region_radius = max(1.0, region_radius * 0.82)
    circle_radius = min(circle_radius_for_text(text_w, text_h, baseline, thickness), max(1, int(math.floor(max_region_radius))))
    return scale, thickness, text_w, text_h, baseline, margin, circle_radius


def circle_radius_for_text(text_w: int, text_h: int, baseline: int, thickness: int) -> int:
    padding = max(4, thickness + 3)
    return max(6, int(math.ceil(max(text_w, text_h + baseline) / 2.0 + padding)))


def clamp_circle_to_canvas(x: int, y: int, radius: int, width: int, height: int) -> tuple[int, int, int]:
    max_radius = max(1, (min(width, height) - 2) // 2)
    radius = min(radius, max_radius)

    min_x = radius + 1
    max_x = width - radius - 2
    min_y = radius + 1
    max_y = height - radius - 2

    safe_x = width // 2 if max_x < min_x else min(max(int(round(x)), min_x), max_x)
    safe_y = height // 2 if max_y < min_y else min(max(int(round(y)), min_y), max_y)

    return int(safe_x), int(safe_y), int(radius)


def fit_text_box_to_canvas(text: str, font: int, scale: float, width: int, height: int) -> tuple[float, int, int, int, int, int]:
    min_scale = 0.22

    for _ in range(24):
        thickness = max(1, int(round(scale * 1.8)))
        (text_w, text_h), baseline = cv2.getTextSize(text, font, scale, thickness)
        margin = max(3, thickness + 2)
        fits_width = text_w <= max(1, width - 2 * margin)
        fits_height = text_h + baseline <= max(1, height - 2 * margin)
        if fits_width and fits_height:
            return scale, thickness, int(text_w), int(text_h), int(baseline), int(margin)
        if scale <= min_scale:
            return scale, thickness, int(text_w), int(text_h), int(baseline), int(margin)
        scale *= 0.9

    thickness = max(1, int(round(scale * 1.8)))
    (text_w, text_h), baseline = cv2.getTextSize(text, font, scale, thickness)
    margin = max(3, thickness + 2)
    return scale, thickness, int(text_w), int(text_h), int(baseline), int(margin)


def clamp_text_origin_to_canvas(
    origin_x: int,
    origin_y: int,
    text_w: int,
    text_h: int,
    baseline: int,
    width: int,
    height: int,
    margin: int,
) -> tuple[int, int]:
    min_x = margin
    max_x = width - margin - text_w
    safe_x = max(0, (width - text_w) // 2) if max_x < min_x else min(max(origin_x, min_x), max_x)

    min_y = margin + text_h
    max_y = height - margin - baseline
    if max_y < min_y:
        safe_y = min(max(text_h, (height + text_h - baseline) // 2), max(0, height - baseline))
    else:
        safe_y = min(max(origin_y, min_y), max_y)

    return int(safe_x), int(safe_y)


def choose_font_scale(text: str, font: int, radius: float, area: int, min_scale: float, max_scale: float) -> float:
    absolute_min_scale = 0.28
    area_scale = math.sqrt(max(area, 1)) / 95.0
    radius_scale = max(radius * 0.075, min_scale)
    scale = min(max_scale, max(min_scale, min(area_scale, radius_scale)))

    target_width = max(8.0, radius * 1.65)
    target_height = max(8.0, radius * 1.35)
    for _ in range(20):
        (text_w, text_h), _ = cv2.getTextSize(text, font, scale, max(1, int(round(scale * 1.8))))
        if text_w <= target_width and text_h <= target_height:
            return max(absolute_min_scale, scale)
        if scale <= absolute_min_scale:
            return absolute_min_scale
        scale *= 0.88
    return max(absolute_min_scale, scale)


# -----------------------------------------------------------------------------
# Output composition.
# -----------------------------------------------------------------------------


def compose_template(
    label_map: Any,
    region_map: Any,
    regions: dict[int, Region],
    palette: list[PaletteColor],
    outlines: Any,
    placements: dict[int, LabelPlacement],
    number_mode: NumberRenderMode,
) -> Any:
    if number_mode == NumberRenderMode.COLORED_EDGES:
        return compose_colored_edges_template(label_map, region_map, regions, palette, outlines)

    if number_mode == NumberRenderMode.BRIGHT_COLOR_CIRCLES:
        template = raster_from_label_map(label_map, palette, fallback_rgb=TEMPLATE_BG_RGB, bright=True)
    else:
        template = np.full((*label_map.shape, 3), TEMPLATE_BG_RGB, dtype=np.uint8)

    template[outlines] = OUTLINE_RGB
    return draw_region_numbers(
        template,
        region_map,
        regions,
        palette,
        placements,
        adaptive_color=False,
        number_mode=number_mode,
    )


def compose_colored_edges_template(label_map: Any, region_map: Any, regions: dict[int, Region], palette: list[PaletteColor], outlines: Any) -> Any:
    # Kept for opt-in compatibility only. It is expensive with very fragmented images.
    template = np.full((*region_map.shape, 3), TEMPLATE_BG_RGB, dtype=np.uint8)
    template[outlines] = OUTLINE_RGB
    return color_region_edges(template, region_map, regions, palette, outlines)


def color_region_edges(image_rgb: Any, region_map: Any, regions: dict[int, Region], palette: list[PaletteColor], outlines: Any) -> Any:
    out = image_rgb.copy()
    height, width = region_map.shape
    rim_width = max(3, min(6, int(round(max(height, width) / 360.0))))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    outline_neighbors = cv2.dilate(outlines.astype(np.uint8), kernel, iterations=1).astype(bool)
    outline_owner = expanded_region_owner_map(region_map, rim_width + 2)
    bg = np.array(TEMPLATE_BG_RGB, dtype=np.float32)

    for region in sorted(regions.values(), key=lambda item: item.area, reverse=True):
        mask = region_map == region.region_id
        color = np.array(palette[region.color_index].rgb, dtype=np.float32)
        dist = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 3)
        inner_edge = mask & ((dist <= rim_width + 0.25) | outline_neighbors)
        if np.any(inner_edge):
            alpha = np.clip((rim_width + 1.0 - dist[inner_edge]) / max(1.0, float(rim_width)), 0.0, 1.0)
            alpha = 0.18 + alpha * 0.64
            blended = bg[None, :] * (1.0 - alpha[:, None]) + color[None, :] * alpha[:, None]
            out[inner_edge] = np.clip(np.round(blended), 0, 255).astype(np.uint8)
        outline_edge = outlines & (outline_owner == region.region_id)
        out[outline_edge] = color.astype(np.uint8)

    return out


def expanded_region_owner_map(region_map: Any, max_steps: int) -> Any:
    owner = region_map.copy()
    directions = (
        (-1, 0),
        (1, 0),
        (0, -1),
        (0, 1),
        (-1, -1),
        (-1, 1),
        (1, -1),
        (1, 1),
    )

    for _ in range(max(0, max_steps)):
        unknown = owner < 0
        if not np.any(unknown):
            break

        next_owner = owner.copy()
        filled = np.zeros(owner.shape, dtype=bool)
        for dy, dx in directions:
            shifted = shifted_region_ids(owner, dy, dx)
            candidates = unknown & ~filled & (shifted >= 0)
            if not np.any(candidates):
                continue
            next_owner[candidates] = shifted[candidates]
            filled[candidates] = True

        if not np.any(filled):
            break
        owner = next_owner

    return owner


def shifted_region_ids(region_ids: Any, dy: int, dx: int) -> Any:
    height, width = region_ids.shape
    shifted = np.full_like(region_ids, -1)

    if dy >= 0:
        src_y1, src_y2 = dy, height
        dst_y1, dst_y2 = 0, height - dy
    else:
        src_y1, src_y2 = 0, height + dy
        dst_y1, dst_y2 = -dy, height

    if dx >= 0:
        src_x1, src_x2 = dx, width
        dst_x1, dst_x2 = 0, width - dx
    else:
        src_x1, src_x2 = 0, width + dx
        dst_x1, dst_x2 = -dx, width

    if src_y1 < src_y2 and src_x1 < src_x2:
        shifted[dst_y1:dst_y2, dst_x1:dst_x2] = region_ids[src_y1:src_y2, src_x1:src_x2]

    return shifted


def compose_reference(
    label_map: Any,
    region_map: Any,
    regions: dict[int, Region],
    palette: list[PaletteColor],
    outlines: Any,
    placements: dict[int, LabelPlacement],
) -> Any:
    reference = raster_from_label_map(label_map, palette)
    reference[outlines] = OUTLINE_RGB
    return draw_region_numbers(
        reference,
        region_map,
        regions,
        palette,
        placements,
        adaptive_color=True,
        number_mode=NumberRenderMode.NUMBERS,
    )


def compose_cleaned(label_map: Any, palette: list[PaletteColor], outlines: Any) -> Any:
    cleaned = raster_from_label_map(label_map, palette)
    cleaned[outlines] = OUTLINE_RGB
    return cleaned


def compose_debug(region_map: Any, outlines: Any) -> Any:
    debug = np.full((*region_map.shape, 3), 255, dtype=np.uint8)
    valid = region_map >= 0
    ids = region_map[valid].astype(np.int64)
    if len(ids):
        colors = np.empty((int(ids.max()) + 1, 3), dtype=np.uint8)
        idx = np.arange(len(colors), dtype=np.int64)
        colors[:, 0] = ((idx * 37 + 73) % 255).astype(np.uint8)
        colors[:, 1] = ((idx * 67 + 31) % 255).astype(np.uint8)
        colors[:, 2] = ((idx * 97 + 151) % 255).astype(np.uint8)
        debug[valid] = colors[ids]
    debug[outlines] = OUTLINE_RGB
    return debug


# -----------------------------------------------------------------------------
# Save helpers and reports.
# -----------------------------------------------------------------------------


def save_rgb(path: Path, rgb: Any) -> None:
    Image.fromarray(rgb.astype(np.uint8), mode="RGB").save(path)


def save_mask(path: Path, mask: Any) -> None:
    Image.fromarray((mask.astype(np.uint8) * 255), mode="L").save(path)


def save_palette_image(path: Path, palette: list[PaletteColor]) -> None:
    row_h = 58
    margin = 24
    col_w = 360
    columns = 1 if len(palette) <= 18 else 2
    rows = int(math.ceil(len(palette) / columns))
    width = margin * 2 + col_w * columns
    height = margin * 2 + row_h * max(rows, 1)
    img = Image.new("RGB", (width, height), (252, 250, 244))
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default()

    for idx, color in enumerate(palette):
        col = idx // rows
        row = idx % rows
        x = margin + col * col_w
        y = margin + row * row_h
        swatch = (x, y + 5, x + 42, y + 47)
        draw.rectangle(swatch, fill=color.rgb, outline=(20, 20, 20), width=2)
        text = f"{color.number:>2}  {color.hex}"
        draw.text((x + 56, y + 18), text, fill=(20, 20, 20), font=font)

    img.save(path)


def save_palette_json(
    path: Path,
    source: Path,
    size: tuple[int, int],
    palette: list[PaletteColor],
    exact_palette: list[PaletteColor],
    outputs: dict[str, str],
    settings: dict[str, Any],
) -> None:
    total = sum(color.pixel_count for color in palette)
    payload = {
        "source": str(source),
        "width": size[0],
        "height": size[1],
        "settings": settings,
        "colors": [
            {
                "number": color.number,
                "hex": exact_color.hex,
                "rgb": list(exact_color.rgb),
                "paint_hex": color.hex,
                "paint_rgb": list(color.rgb),
                "pixel_count": color.pixel_count,
                "area_percent": round(100.0 * color.pixel_count / max(1, total), 3),
            }
            for color, exact_color in zip(palette, exact_palette, strict=True)
        ],
        "outputs": outputs,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def save_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def paintability_report(segmentation: SegmentationResult, placements: dict[int, LabelPlacement]) -> dict[str, Any]:
    regions = list(segmentation.regions.values())
    areas = np.array([region.area for region in regions], dtype=np.int64) if regions else np.array([], dtype=np.int64)
    min_label_area = int(segmentation.settings.effective_min_label_area)
    numbered = [region for region in regions if region.region_id in placements]
    unnumbered = [region for region in regions if region.region_id not in placements]

    if len(areas):
        smallest = int(areas.min())
        largest = int(areas.max())
        median = float(np.median(areas))
    else:
        smallest = largest = 0
        median = 0.0

    return {
        "width": int(segmentation.size[0]),
        "height": int(segmentation.size[1]),
        "colors": int(len(segmentation.palette)),
        "regions_total": int(len(regions)),
        "regions_numbered": int(len(numbered)),
        "regions_too_small_for_label": int(len(unnumbered)),
        "min_label_area": min_label_area,
        "smallest_region": smallest,
        "largest_region": largest,
        "median_region_area": round(median, 3),
        "smallest_numbered_region": int(min((region.area for region in numbered), default=0)),
        "largest_unnumbered_region": int(max((region.area for region in unnumbered), default=0)),
        "small_area_merging": True,
        "small_region_merge_area": int(segmentation.settings.effective_merge_area),
        "colored_edges_written": bool(segmentation.settings.write_colored_edges),
        "auto_color_count": bool(segmentation.settings.auto_color_count),
    }


# -----------------------------------------------------------------------------
# Pipeline.
# -----------------------------------------------------------------------------


def build_segmentation(settings: PipelineSettings) -> SegmentationResult:
    require_dependencies()

    rgb, _ = load_image(settings.image, settings.resize_max)
    height, width = rgb.shape[:2]

    smooth_rgb, quantized_rgb, cleanup_rgb, label_map, detected_color_count, auto_color_debug = cleanup_to_plain_colors(rgb, settings)
    settings = settings_with_derived_values(settings, height * width, detected_color_count)
    strip_cleanup_rgb = cleanup_rgb.copy()
    pre_prune_palette_rgb = palette_rgb_from_label_map(cleanup_rgb, label_map)
    label_map = prune_thin_protrusions(label_map)
    cleanup_rgb = pre_prune_palette_rgb[np.clip(label_map, 0, max(0, len(pre_prune_palette_rgb) - 1))].reshape(height, width, 3).astype(np.uint8)
    protrusion_pruned_rgb = cleanup_rgb.copy()
    label_map, merged_palette_rgb = merge_small_regions(label_map, palette_rgb_from_label_map(cleanup_rgb, label_map), settings.effective_merge_area)
    cleanup_rgb = merged_palette_rgb[np.clip(label_map, 0, max(0, len(merged_palette_rgb) - 1))].reshape(height, width, 3).astype(np.uint8)

    region_map, regions = connected_regions(label_map)
    palette = palette_from_label_map(cleanup_rgb, label_map)
    raw_palette_rgb = palette_rgb_from_label_map(cleanup_rgb, label_map)
    outlines = boundary_mask(region_map)

    return SegmentationResult(
        settings=settings,
        source=settings.image,
        size=(width, height),
        rgb=rgb,
        smooth_rgb=smooth_rgb,
        quantized_rgb=quantized_rgb,
        strip_cleanup_rgb=strip_cleanup_rgb,
        protrusion_pruned_rgb=protrusion_pruned_rgb,
        cleanup_rgb=cleanup_rgb,
        label_map=label_map,
        region_map=region_map,
        regions=regions,
        palette=palette,
        raw_palette_rgb=raw_palette_rgb,
        auto_color_debug=auto_color_debug,
        boundary_outline=outlines,
    )


def render_outputs(segmentation: SegmentationResult, out_dir: Path) -> dict[str, Path]:
    label_map = segmentation.label_map
    region_map = segmentation.region_map
    regions = segmentation.regions
    palette = segmentation.palette
    outlines = segmentation.boundary_outline
    min_label_area = int(segmentation.settings.effective_min_label_area)
    output_dir = out_dir

    placements = precompute_label_placements(region_map, regions, min_label_area)
    exact_palette = exact_palette_from_raw_palette(segmentation.raw_palette_rgb, [color.pixel_count for color in palette])
    exact_cleanup_unique_colors = int(count_unique_rgb_colors(segmentation.cleanup_rgb))
    exact_colors_match_detected = exact_cleanup_unique_colors == int(segmentation.settings.color_count_used)

    template_numbers = compose_template(label_map, region_map, regions, palette, outlines, placements, NumberRenderMode.NUMBERS)
    template_color_circles = compose_template(label_map, region_map, regions, palette, outlines, placements, NumberRenderMode.COLOR_CIRCLES)
    template_circles_only = compose_template(label_map, region_map, regions, palette, outlines, placements, NumberRenderMode.CIRCLES_ONLY)
    template_bright_color_circles = compose_template(label_map, region_map, regions, palette, outlines, placements, NumberRenderMode.BRIGHT_COLOR_CIRCLES)
    template_classic = compose_reference(label_map, region_map, regions, palette, outlines, placements)

    paths: dict[str, Path] = {
        "template_classic": output_dir / "template_classic.png",
        "template_numbers": output_dir / "template_numbers.png",
        "template_color_circles": output_dir / "template_color_circles.png",
        "template_circles_only": output_dir / "template_circles_only.png",
        "template_bright_color_circles": output_dir / "template_bright_color_circles.png",
        "cleanup": output_dir / "cleanup.png",
        "palette": output_dir / "palette.png",
        "palette_json": output_dir / "palette.json",
        "paintability_report": output_dir / "paintability_report.json",
    }

    if segmentation.settings.write_colored_edges:
        template_colored_edges = compose_template(label_map, region_map, regions, palette, outlines, placements, NumberRenderMode.COLORED_EDGES)
        paths["template_colored_edges"] = output_dir / "template_colored_edges.png"
        save_rgb(paths["template_colored_edges"], template_colored_edges)

    save_rgb(paths["template_classic"], template_classic)
    save_rgb(paths["template_numbers"], template_numbers)
    save_rgb(paths["template_color_circles"], template_color_circles)
    save_rgb(paths["template_circles_only"], template_circles_only)
    save_rgb(paths["template_bright_color_circles"], template_bright_color_circles)
    save_rgb(paths["cleanup"], segmentation.cleanup_rgb)
    save_palette_image(paths["palette"], palette)

    report = paintability_report(segmentation, placements)
    report["exact_main_colors_detected"] = int(segmentation.settings.color_count_used)
    report["exact_cleanup_unique_colors"] = exact_cleanup_unique_colors
    report["exact_cleanup_matches_detected_main_colors"] = bool(exact_colors_match_detected)
    paths["paintability_report"].write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    settings_payload = {
        "color_count_mode": "auto_detected_k" if segmentation.settings.auto_color_count else "manual_fixed_k",
        "color_count_used": int(segmentation.settings.color_count_used),
        "auto_detected_color_count": int(segmentation.settings.detected_color_count),
        "requested_color_count": int(segmentation.settings.color_count),
        "max_colors": int(segmentation.settings.max_colors),
        "min_label_area": int(segmentation.settings.effective_min_label_area),
        "cleanup_step": "bilateral_filter_lab_minibatch_kmeans_hard_lab_remap_small_region_merge",
        "cleanup_bilateral_d": int(segmentation.settings.smooth_d),
        "cleanup_bilateral_sigma_color": float(segmentation.settings.smooth_sigma_color),
        "cleanup_bilateral_sigma_space": float(segmentation.settings.smooth_sigma_space),
        "kmeans_batch_size": int(KMEANS_BATCH_SIZE),
        "kmeans_random_state": int(KMEANS_RANDOM_STATE),
        "segmentation_strategy": "cleaned_color_connected_components_only",
        "small_area_merging": True,
        "small_region_merge_area": int(segmentation.settings.effective_merge_area),
        "line_art_barrier_detection": False,
        "guide_detail_detection": False,
        "main_color_detection": "sampled_lab_palette_analysis" if segmentation.settings.auto_color_count else "manual_fixed_k",
        "exact_cleanup_unique_colors": exact_cleanup_unique_colors,
        "exact_cleanup_matches_detected_main_colors": bool(exact_colors_match_detected),
        "paint_palette_is_normalized": True,
        "number_mode": segmentation.settings.number_mode.value,
        "template_modes_written": [
            NumberRenderMode.NUMBERS.value,
            NumberRenderMode.COLOR_CIRCLES.value,
            NumberRenderMode.CIRCLES_ONLY.value,
            NumberRenderMode.BRIGHT_COLOR_CIRCLES.value,
        ] + ([NumberRenderMode.COLORED_EDGES.value] if segmentation.settings.write_colored_edges else []),
        "performance_notes": {
            "template_png_removed": True,
            "colored_edges_default": False,
            "region_rasterization": "palette_lookup_from_label_map",
            "label_placements_precomputed": True,
        },
    }
    save_palette_json(
        paths["palette_json"],
        segmentation.source,
        segmentation.size,
        palette,
        exact_palette,
        {name: str(path) for name, path in paths.items()},
        settings_payload,
    )

    if segmentation.settings.debug:
        debug = compose_debug(region_map, outlines)
        paths["debug"] = output_dir / "debug.png"
        paths["auto_color_debug"] = output_dir / "auto_color_debug.json"
        paths["boundary_mask"] = output_dir / "boundary_mask.png"
        paths["step_normalized"] = output_dir / "step_normalized.png"
        paths["step_smooth"] = output_dir / "step_smooth.png"
        paths["step_quantized"] = output_dir / "step_quantized.png"
        paths["step_strip_cleanup"] = output_dir / "step_strip_cleanup.png"
        paths["step_protrusion_prune"] = output_dir / "step_protrusion_prune.png"
        save_rgb(paths["debug"], debug)
        save_mask(paths["boundary_mask"], outlines)
        save_rgb(paths["step_normalized"], segmentation.rgb)
        save_rgb(paths["step_smooth"], segmentation.smooth_rgb)
        save_rgb(paths["step_quantized"], segmentation.quantized_rgb)
        save_rgb(paths["step_strip_cleanup"], segmentation.strip_cleanup_rgb)
        save_rgb(paths["step_protrusion_prune"], segmentation.protrusion_pruned_rgb)
        auto_color_debug = dict(segmentation.auto_color_debug or {})
        auto_color_debug["detected_main_color_count"] = int(segmentation.settings.color_count_used)
        auto_color_debug["final_exact_cleanup_unique_colors"] = exact_cleanup_unique_colors
        auto_color_debug["final_exact_cleanup_matches_detected_main_colors"] = bool(exact_colors_match_detected)
        save_json(paths["auto_color_debug"], auto_color_debug)

    return paths


def run_pipeline(args: argparse.Namespace) -> dict[str, Path]:
    settings = settings_from_args(args)
    prepare_output_dir(settings.out_dir, settings.image)
    segmentation = build_segmentation(settings)
    return render_outputs(segmentation, settings.out_dir)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        paths = run_pipeline(args)
    except Exception as exc:
        print(f"paint-by-numbers: error: {exc}", file=sys.stderr)
        return 1

    print("Wrote paint-by-number outputs:")
    for name, path in paths.items():
        print(f"  {name}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
