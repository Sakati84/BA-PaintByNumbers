#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
import math
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


SOURCE_LABELS = {
    "img-1394": "See und Baumlinie",
    "img-1681": "Pferd auf Wiese",
    "img-1704": "Specht im Gruen",
    "img-1998": "Gelbe Blume",
}


@dataclass
class CaseResult:
    source_id: str
    label: str
    original_path: Path | None
    ai_path: Path
    clean_path: Path
    classic_path: Path
    metrics: dict[str, Any]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fresh region-first Paint-by-Numbers pipeline lab prototype."
    )
    parser.add_argument(
        "--source-run",
        default="prompt-lab/runs/2026-07-07T12-27-30-697Z_2026-07-07-test-images-current-expert-paint-map",
        help="Prompt Lab run that contains img-*/<source-case>/output.jpg.",
    )
    parser.add_argument("--source-case", default="expert-current-paint-map")
    parser.add_argument("--out-root", default="pipeline-lab/runs")
    parser.add_argument("--run-name", default="fresh-region-first-24c")
    parser.add_argument("--colors", type=int, default=24)
    parser.add_argument("--max-edge", type=int, default=1400)
    parser.add_argument("--seed", type=int, default=7707)
    parser.add_argument("--mean-shift-sp", type=int, default=11)
    parser.add_argument("--mean-shift-sr", type=int, default=24)
    parser.add_argument("--token-colors", type=int, default=64)
    parser.add_argument("--sample-pixels", type=int, default=180_000)
    parser.add_argument("--palette-weight-power", type=float, default=0.78)
    parser.add_argument("--majority-filter-runs", type=int, default=2)
    parser.add_argument("--min-region-ratio", type=float, default=0.00018)
    parser.add_argument("--min-region-pixels", type=int, default=160)
    parser.add_argument("--tiny-merge-passes", type=int, default=12)
    parser.add_argument("--post-majority-filter-runs", type=int, default=1)
    parser.add_argument("--speckle-region-pixels", type=int, default=48)
    parser.add_argument("--final-speckle-passes", type=int, default=8)
    parser.add_argument("--final-majority-filter-runs", type=int, default=1)
    parser.add_argument("--detail-protect-min-pixels", type=int, default=80)
    parser.add_argument("--detail-protect-lab-distance", type=float, default=26.0)
    parser.add_argument("--boundary-width", type=int, default=2)
    parser.add_argument("--boundary-smoothing", type=float, default=0.9)
    return parser.parse_args()


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%f")[:-3] + "Z"


def read_rgb(path: Path) -> Image.Image:
    with Image.open(path) as image:
        return ImageOps.exif_transpose(image).convert("RGB")


def save_rgb(path: Path, rgb: np.ndarray) -> None:
    Image.fromarray(np.asarray(np.clip(rgb, 0, 255), dtype=np.uint8), "RGB").save(path)


def limit_image(image: Image.Image, max_edge: int) -> Image.Image:
    width, height = image.size
    edge = max(width, height)
    if edge <= max_edge:
        return image.copy()
    scale = max_edge / edge
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return image.resize(size, Image.Resampling.LANCZOS)


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)


def nearest_center_labels(data: np.ndarray, centers: np.ndarray, chunk_size: int = 262_144) -> np.ndarray:
    labels = np.empty((data.shape[0],), dtype=np.int32)
    centers = centers.astype(np.float32)
    for start in range(0, data.shape[0], chunk_size):
        chunk = data[start : start + chunk_size].astype(np.float32)
        diff = chunk[:, None, :] - centers[None, :, :]
        distances = np.sum(diff * diff, axis=2)
        labels[start : start + chunk_size] = np.argmin(distances, axis=1)
    return labels


def cv_kmeans_centers(data: np.ndarray, k: int, seed: int) -> np.ndarray:
    k = max(1, min(k, data.shape[0]))
    cv2.setRNGSeed(seed)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.6)
    _compactness, _labels, centers = cv2.kmeans(
        data.astype(np.float32),
        k,
        None,
        criteria,
        2,
        cv2.KMEANS_PP_CENTERS,
    )
    return centers.astype(np.float32)


def connected_components_for_labels(label_map: np.ndarray, label_count: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    height, width = label_map.shape
    component_map = np.full((height, width), -1, dtype=np.int32)
    component_labels: list[int] = []
    component_areas: list[int] = []

    for label in range(label_count):
        mask = (label_map == label).astype(np.uint8)
        if int(mask.sum()) == 0:
            continue
        count, components, stats, _centroids = cv2.connectedComponentsWithStats(mask, 4)
        for component_index in range(1, count):
            area = int(stats[component_index, cv2.CC_STAT_AREA])
            if area <= 0:
                continue
            component_id = len(component_labels)
            component_map[components == component_index] = component_id
            component_labels.append(label)
            component_areas.append(area)

    if int((component_map < 0).sum()) != 0:
        raise RuntimeError("component coverage failed")

    return (
        component_map,
        np.asarray(component_labels, dtype=np.int32),
        np.asarray(component_areas, dtype=np.int32),
    )


def component_mean_rgb(rgb: np.ndarray, component_map: np.ndarray, component_count: int) -> np.ndarray:
    flat_components = component_map.reshape(-1)
    flat_rgb = rgb.reshape(-1, 3).astype(np.float64)
    sums = [
        np.bincount(flat_components, weights=flat_rgb[:, channel], minlength=component_count)
        for channel in range(3)
    ]
    counts = np.bincount(flat_components, minlength=component_count).astype(np.float64)
    counts = np.maximum(counts, 1.0)
    return np.stack(sums, axis=1) / counts[:, None]


def weighted_kmeans(
    rgb: np.ndarray,
    weights: np.ndarray,
    k: int,
    seed: int,
    iterations: int = 45,
) -> tuple[np.ndarray, np.ndarray]:
    rgb_u8 = np.clip(rgb, 0, 255).astype(np.uint8).reshape(1, -1, 3)
    lab = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    k = max(1, min(k, lab.shape[0]))
    rng = np.random.default_rng(seed)
    weights = np.maximum(weights.astype(np.float64), 1e-6)

    centers = np.empty((k, 3), dtype=np.float32)
    first_index = int(rng.choice(lab.shape[0], p=weights / weights.sum()))
    centers[0] = lab[first_index]
    closest = np.sum((lab - centers[0]) ** 2, axis=1).astype(np.float64)
    for center_index in range(1, k):
        probs = weights * np.maximum(closest, 1e-6)
        probs = probs / probs.sum()
        chosen = int(rng.choice(lab.shape[0], p=probs))
        centers[center_index] = lab[chosen]
        closest = np.minimum(closest, np.sum((lab - centers[center_index]) ** 2, axis=1))

    labels = np.zeros((lab.shape[0],), dtype=np.int32)
    for _ in range(iterations):
        next_labels = nearest_center_labels(lab, centers)
        if np.array_equal(next_labels, labels):
            labels = next_labels
            break
        labels = next_labels
        for center_index in range(k):
            mask = labels == center_index
            if not np.any(mask):
                replacement = int(rng.choice(lab.shape[0], p=weights / weights.sum()))
                centers[center_index] = lab[replacement]
                continue
            centers[center_index] = np.average(lab[mask], axis=0, weights=weights[mask])

    palette_rgb = np.zeros((k, 3), dtype=np.float64)
    for color_index in range(k):
        mask = labels == color_index
        if np.any(mask):
            palette_rgb[color_index] = np.average(rgb[mask], axis=0, weights=weights[mask])
        else:
            palette_rgb[color_index] = rgb[int(np.argmax(weights))]
    return labels, palette_rgb


def majority_filter_labels(label_map: np.ndarray, label_count: int, runs: int) -> np.ndarray:
    if runs <= 0:
        return label_map
    labels = label_map.astype(np.uint8)
    kernel = np.ones((3, 3), dtype=np.uint8)
    for _run_index in range(runs):
        votes = []
        for label in range(label_count):
            mask = (labels == label).astype(np.uint8)
            vote = cv2.filter2D(mask, cv2.CV_16U, kernel, borderType=cv2.BORDER_REPLICATE)
            vote[labels == label] += 1
            votes.append(vote)
        labels = np.argmax(np.stack(votes, axis=0), axis=0).astype(np.uint8)
    return labels.astype(np.int32)


def adjacency_counts(component_map: np.ndarray) -> dict[int, dict[int, int]]:
    right_a = component_map[:, :-1].reshape(-1)
    right_b = component_map[:, 1:].reshape(-1)
    down_a = component_map[:-1, :].reshape(-1)
    down_b = component_map[1:, :].reshape(-1)
    a = np.concatenate([right_a, down_a])
    b = np.concatenate([right_b, down_b])
    mask = a != b
    if not np.any(mask):
        return {}
    pairs = np.stack([a[mask], b[mask]], axis=1)
    pairs.sort(axis=1)
    unique_pairs, counts = np.unique(pairs, axis=0, return_counts=True)
    adjacency: dict[int, dict[int, int]] = {}
    for (left, right), count in zip(unique_pairs, counts, strict=True):
        left_int = int(left)
        right_int = int(right)
        count_int = int(count)
        adjacency.setdefault(left_int, {})[right_int] = count_int
        adjacency.setdefault(right_int, {})[left_int] = count_int
    return adjacency


def merge_tiny_palette_components(
    label_map: np.ndarray,
    palette_rgb: np.ndarray,
    min_area: int,
    max_passes: int = 18,
    force_merge_below: int = 24,
    protect_min_area: int = 36,
    protect_lab_distance: float = 18.0,
) -> tuple[np.ndarray, int, int, int, int]:
    labels = label_map.copy()
    palette_lab = rgb_to_lab(np.clip(palette_rgb, 0, 255).astype(np.uint8).reshape(1, -1, 3)).reshape(-1, 3)
    total_merges = 0
    final_components = 0
    final_small_components = 0
    protected_components = 0

    for _pass_index in range(max_passes):
        component_map, component_labels, component_areas = connected_components_for_labels(labels, palette_rgb.shape[0])
        final_components = int(component_labels.shape[0])
        small_components = np.where(component_areas < min_area)[0]
        if small_components.size == 0:
            break
        adjacency = adjacency_counts(component_map)
        changed = 0
        for component_id in small_components[np.argsort(component_areas[small_components])]:
            source_label = int(component_labels[component_id])
            component_mask = component_map == int(component_id)
            if not np.all(labels[component_mask] == source_label):
                continue
            neighbors = adjacency.get(int(component_id), {})
            if not neighbors:
                continue
            best_label = source_label
            best_score = math.inf
            nearest_neighbor_distance = math.inf
            for neighbor_id, border_count in neighbors.items():
                target_label = int(component_labels[neighbor_id])
                if target_label == source_label:
                    continue
                delta = palette_lab[source_label] - palette_lab[target_label]
                color_distance = float(np.sqrt(np.sum(delta * delta)))
                nearest_neighbor_distance = min(nearest_neighbor_distance, color_distance)
                border_bonus = min(8.0, math.log1p(border_count) * 1.4)
                target_area_bonus = min(12.0, math.log1p(int(component_areas[neighbor_id])) * 0.8)
                score = color_distance - border_bonus - target_area_bonus
                if score < best_score:
                    best_score = score
                    best_label = target_label
            if (
                int(component_areas[component_id]) >= protect_min_area
                and nearest_neighbor_distance >= protect_lab_distance
            ):
                continue
            if best_label != source_label:
                labels[component_mask] = best_label
                changed += 1
        total_merges += changed
        if changed == 0:
            break

    component_map, component_labels, component_areas = connected_components_for_labels(labels, palette_rgb.shape[0])
    final_components = int(component_map.max()) + 1
    adjacency = adjacency_counts(component_map)
    for component_id in np.where(component_areas < min_area)[0]:
        source_label = int(component_labels[component_id])
        nearest_neighbor_distance = math.inf
        for neighbor_id in adjacency.get(int(component_id), {}):
            target_label = int(component_labels[neighbor_id])
            if target_label == source_label:
                continue
            delta = palette_lab[source_label] - palette_lab[target_label]
            nearest_neighbor_distance = min(nearest_neighbor_distance, float(np.sqrt(np.sum(delta * delta))))
        if (
            int(component_areas[component_id]) >= protect_min_area
            and nearest_neighbor_distance >= protect_lab_distance
        ):
            protected_components += 1
        elif int(component_areas[component_id]) < force_merge_below:
            final_small_components += 1
        else:
            final_small_components += 1
    return labels, total_merges, final_components, final_small_components, protected_components


def recompute_palette(rgb: np.ndarray, label_map: np.ndarray, colors: int) -> np.ndarray:
    flat_labels = label_map.reshape(-1)
    flat_rgb = rgb.reshape(-1, 3).astype(np.float64)
    counts = np.bincount(flat_labels, minlength=colors).astype(np.float64)
    palette = np.zeros((colors, 3), dtype=np.float64)
    for channel in range(3):
        sums = np.bincount(flat_labels, weights=flat_rgb[:, channel], minlength=colors)
        mask = counts > 0
        palette[mask, channel] = sums[mask] / counts[mask]
    return palette


def render_classic(
    clean_rgb: np.ndarray,
    region_map: np.ndarray,
    boundary_width: int,
    boundary_smoothing: float,
) -> np.ndarray:
    boundary = np.zeros(region_map.shape, dtype=np.uint8)
    boundary[:, 1:] |= region_map[:, 1:] != region_map[:, :-1]
    boundary[:, :-1] |= region_map[:, 1:] != region_map[:, :-1]
    boundary[1:, :] |= region_map[1:, :] != region_map[:-1, :]
    boundary[:-1, :] |= region_map[1:, :] != region_map[:-1, :]

    kernel_size = max(1, boundary_width * 2 - 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    if boundary_width > 1:
        boundary = cv2.dilate(boundary, kernel, iterations=1)
    if boundary_smoothing > 0:
        boundary = cv2.morphologyEx(boundary, cv2.MORPH_CLOSE, kernel)
        alpha = cv2.GaussianBlur(
            boundary.astype(np.float32),
            (0, 0),
            sigmaX=boundary_smoothing,
            sigmaY=boundary_smoothing,
        )
        alpha = np.clip(alpha, 0.0, 1.0)[..., None]
    else:
        alpha = boundary.astype(np.float32)[..., None]

    return np.clip(clean_rgb.astype(np.float32) * (1.0 - alpha), 0, 255).astype(np.uint8)


def process_case(case_dir: Path, args: argparse.Namespace, out_dir: Path) -> CaseResult:
    source_id = case_dir.name
    ai_path = case_dir / args.source_case / "output.jpg"
    original_candidates = sorted(case_dir.glob("input.original.*"))
    original_path = original_candidates[0] if original_candidates else None
    if not ai_path.exists():
        raise FileNotFoundError(ai_path)

    start = time.perf_counter()
    ai_image = limit_image(read_rgb(ai_path), args.max_edge)
    ai_rgb = np.asarray(ai_image, dtype=np.uint8)
    height, width = ai_rgb.shape[:2]
    pixel_count = height * width
    min_region_area = max(args.min_region_pixels, int(round(pixel_count * args.min_region_ratio)))

    bgr = cv2.cvtColor(ai_rgb, cv2.COLOR_RGB2BGR)
    smoothed_bgr = cv2.pyrMeanShiftFiltering(
        bgr,
        sp=args.mean_shift_sp,
        sr=args.mean_shift_sr,
        maxLevel=1,
    )
    smoothed_rgb = cv2.cvtColor(cv2.medianBlur(smoothed_bgr, 3), cv2.COLOR_BGR2RGB)

    lab_pixels = rgb_to_lab(smoothed_rgb).reshape(-1, 3)
    rng = np.random.default_rng(args.seed)
    sample_size = min(args.sample_pixels, lab_pixels.shape[0])
    sample_indices = rng.choice(lab_pixels.shape[0], size=sample_size, replace=False)
    token_centers = cv_kmeans_centers(lab_pixels[sample_indices], args.token_colors, args.seed)
    token_labels = nearest_center_labels(lab_pixels, token_centers).reshape(height, width)
    component_map, _component_tokens, component_areas = connected_components_for_labels(
        token_labels,
        token_centers.shape[0],
    )

    component_count = int(component_areas.shape[0])
    mean_rgb = component_mean_rgb(smoothed_rgb, component_map, component_count)
    region_weights = np.maximum(component_areas.astype(np.float64), 1.0) ** args.palette_weight_power
    component_palette_labels, palette_rgb = weighted_kmeans(
        mean_rgb,
        region_weights,
        args.colors,
        args.seed,
    )
    palette_label_map = component_palette_labels[component_map]
    palette_label_map = majority_filter_labels(
        palette_label_map,
        args.colors,
        args.majority_filter_runs,
    )
    (
        palette_label_map,
        tiny_merges,
        final_region_count,
        small_regions_remaining,
        protected_small_regions,
    ) = merge_tiny_palette_components(
        palette_label_map,
        palette_rgb,
        min_region_area,
        args.tiny_merge_passes,
        args.speckle_region_pixels,
        args.detail_protect_min_pixels,
        args.detail_protect_lab_distance,
    )
    palette_label_map = majority_filter_labels(
        palette_label_map,
        args.colors,
        args.post_majority_filter_runs,
    )
    (
        palette_label_map,
        post_tiny_merges,
        final_region_count,
        post_small_regions_remaining,
        post_protected_small_regions,
    ) = merge_tiny_palette_components(
        palette_label_map,
        palette_rgb,
        min_region_area,
        max(4, args.tiny_merge_passes // 2),
        args.speckle_region_pixels,
        args.detail_protect_min_pixels,
        args.detail_protect_lab_distance,
    )
    (
        palette_label_map,
        forced_speckle_merges,
        final_region_count,
        final_speckles_remaining,
        _final_protected_speckles,
    ) = merge_tiny_palette_components(
        palette_label_map,
        palette_rgb,
        args.speckle_region_pixels,
        args.final_speckle_passes,
        args.speckle_region_pixels,
        1_000_000_000,
        math.inf,
    )
    palette_label_map = majority_filter_labels(
        palette_label_map,
        args.colors,
        args.final_majority_filter_runs,
    )
    palette_rgb = recompute_palette(smoothed_rgb, palette_label_map, args.colors)
    clean_rgb = np.clip(palette_rgb[palette_label_map], 0, 255).astype(np.uint8)
    final_region_map, _final_labels, final_areas = connected_components_for_labels(
        palette_label_map,
        args.colors,
    )
    classic_rgb = render_classic(
        clean_rgb,
        final_region_map,
        args.boundary_width,
        args.boundary_smoothing,
    )

    case_out = out_dir / source_id
    case_out.mkdir(parents=True, exist_ok=True)
    clean_path = case_out / "clean-color.png"
    classic_path = case_out / "classic.png"
    save_rgb(clean_path, clean_rgb)
    save_rgb(classic_path, classic_rgb)

    metrics = {
        "width": width,
        "height": height,
        "targetColors": args.colors,
        "usedColors": int(np.unique(palette_label_map).shape[0]),
        "tokenColors": int(token_centers.shape[0]),
        "majorityFilterRuns": args.majority_filter_runs,
        "initialComponents": component_count,
        "finalRegions": final_region_count,
        "minRegionArea": min_region_area,
        "speckleRegionPixels": args.speckle_region_pixels,
        "finalSpecklePasses": args.final_speckle_passes,
        "finalMajorityFilterRuns": args.final_majority_filter_runs,
        "detailProtectMinPixels": args.detail_protect_min_pixels,
        "detailProtectLabDistance": args.detail_protect_lab_distance,
        "tinyRegionMerges": tiny_merges,
        "smallRegionsRemainingAfterFirstMerge": small_regions_remaining,
        "protectedSmallRegionsAfterFirstMerge": protected_small_regions,
        "postTinyRegionMerges": post_tiny_merges,
        "smallRegionsRemaining": post_small_regions_remaining,
        "protectedSmallRegions": post_protected_small_regions,
        "forcedSpeckleMerges": forced_speckle_merges,
        "finalSpecklesRemaining": final_speckles_remaining,
        "smallestFinalRegion": int(final_areas.min()) if final_areas.size else 0,
        "medianFinalRegion": float(np.median(final_areas)) if final_areas.size else 0.0,
        "boundaryRender": "smoothed-boundary-layer",
        "boundarySmoothing": args.boundary_smoothing,
        "runtimeMs": round((time.perf_counter() - start) * 1000),
    }

    return CaseResult(
        source_id=source_id,
        label=SOURCE_LABELS.get(source_id, source_id),
        original_path=original_path,
        ai_path=ai_path,
        clean_path=clean_path,
        classic_path=classic_path,
        metrics=metrics,
    )


def relative_path(from_dir: Path, path: Path | None) -> str | None:
    if path is None:
        return None
    path = path.resolve()
    try:
        return path.relative_to(from_dir.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def thumb(image_path: Path, width: int = 360) -> Image.Image:
    image = read_rgb(image_path)
    height = max(1, round(image.height * width / image.width))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def add_label(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str) -> None:
    font = ImageFont.load_default()
    x, y = xy
    draw.rectangle((x - 4, y - 2, x + 8 + len(text) * 7, y + 15), fill=(255, 255, 255))
    draw.text((x, y), text, fill=(0, 0, 0), font=font)


def build_overview(out_dir: Path, results: list[CaseResult]) -> Path:
    columns = [
        ("Original", lambda result: result.original_path),
        ("KI Input", lambda result: result.ai_path),
        ("Fresh Clean", lambda result: result.clean_path),
        ("Fresh Classic", lambda result: result.classic_path),
    ]
    cell_width = 360
    gap = 18
    row_gap = 30
    rows: list[Image.Image] = []

    for result in results:
        thumbs: list[Image.Image] = []
        for _label, get_path in columns:
            path = get_path(result)
            thumbs.append(thumb(path, cell_width) if path else Image.new("RGB", (cell_width, 240), "white"))
        row_height = max(image.height for image in thumbs) + 42
        row = Image.new("RGB", (cell_width * len(columns) + gap * (len(columns) - 1), row_height), "white")
        draw = ImageDraw.Draw(row)
        draw.text((0, 0), f"{result.source_id} · {result.label}", fill=(0, 0, 0), font=ImageFont.load_default())
        x = 0
        for (label, _), image in zip(columns, thumbs, strict=True):
            row.paste(image, (x, 24))
            add_label(draw, (x + 8, 30), label)
            x += cell_width + gap
        rows.append(row)

    total_height = sum(row.height for row in rows) + row_gap * (len(rows) - 1)
    overview = Image.new("RGB", (rows[0].width, total_height), "white")
    y = 0
    for row in rows:
        overview.paste(row, (0, y))
        y += row.height + row_gap

    overview_path = out_dir / "overview-classic.png"
    overview.save(overview_path, quality=95)
    return overview_path


def build_html(out_dir: Path, results: list[CaseResult], overview_path: Path, args: argparse.Namespace) -> None:
    rows = []
    for result in results:
        original_href = relative_path(out_dir, result.original_path)
        ai_href = relative_path(out_dir, result.ai_path)
        clean_href = relative_path(out_dir, result.clean_path)
        classic_href = relative_path(out_dir, result.classic_path)
        metric_html = "".join(
            f"<tr><th>{html.escape(str(key))}</th><td>{html.escape(str(value))}</td></tr>"
            for key, value in result.metrics.items()
        )
        rows.append(
            f"""
            <section class="case">
              <h2>{html.escape(result.source_id)} · {html.escape(result.label)}</h2>
              <div class="grid">
                <figure><img src="{html.escape(original_href or '')}"><figcaption>Original</figcaption></figure>
                <figure><img src="{html.escape(ai_href or '')}"><figcaption>KI Input</figcaption></figure>
                <figure><img src="{html.escape(clean_href or '')}"><figcaption>Fresh Clean</figcaption></figure>
                <figure><img src="{html.escape(classic_href or '')}"><figcaption>Fresh Classic</figcaption></figure>
              </div>
              <table>{metric_html}</table>
            </section>
            """
        )

    params = {
        "colors": args.colors,
        "maxEdge": args.max_edge,
        "meanShiftSp": args.mean_shift_sp,
        "meanShiftSr": args.mean_shift_sr,
        "tokenColors": args.token_colors,
        "paletteWeightPower": args.palette_weight_power,
        "majorityFilterRuns": args.majority_filter_runs,
        "minRegionRatio": args.min_region_ratio,
        "minRegionPixels": args.min_region_pixels,
        "tinyMergePasses": args.tiny_merge_passes,
        "postMajorityFilterRuns": args.post_majority_filter_runs,
        "speckleRegionPixels": args.speckle_region_pixels,
        "finalSpecklePasses": args.final_speckle_passes,
        "finalMajorityFilterRuns": args.final_majority_filter_runs,
        "detailProtectMinPixels": args.detail_protect_min_pixels,
        "detailProtectLabDistance": args.detail_protect_lab_distance,
        "boundaryWidth": args.boundary_width,
        "boundarySmoothing": args.boundary_smoothing,
        "seed": args.seed,
    }
    html_text = f"""<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>Fresh Region-First Pipeline</title>
  <style>
    body {{ margin: 32px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #151515; background: #f7f7f4; }}
    h1 {{ margin-bottom: 8px; }}
    .summary {{ max-width: 980px; line-height: 1.45; }}
    .params {{ white-space: pre-wrap; background: #fff; border: 1px solid #ddd; padding: 14px; }}
    .overview {{ max-width: 100%; border: 1px solid #ccc; background: white; }}
    .case {{ margin-top: 34px; }}
    .grid {{ display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }}
    figure {{ margin: 0; background: white; border: 1px solid #d9d9d2; padding: 8px; }}
    img {{ max-width: 100%; display: block; }}
    figcaption {{ margin-top: 7px; font-size: 13px; color: #333; }}
    table {{ margin-top: 12px; border-collapse: collapse; background: white; }}
    th, td {{ border: 1px solid #ddd; padding: 5px 8px; font-size: 13px; text-align: left; }}
    @media (max-width: 900px) {{ .grid {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }} }}
  </style>
</head>
<body>
  <h1>Fresh Region-First Pipeline · 24 Farben</h1>
  <p class="summary">Experimenteller Lab-Prototyp: kantenbewusste Mean-Shift-Glaettung, uebersegmentierte Farb-Regionen, gewichtete 24-Farb-Palette auf Regionsebene und konservatives Merge nur fuer sehr kleine Restregionen.</p>
  <h2>Uebersicht</h2>
  <p><a href="{html.escape(relative_path(out_dir, overview_path) or '')}">overview-classic.png</a></p>
  <img class="overview" src="{html.escape(relative_path(out_dir, overview_path) or '')}">
  <h2>Parameter</h2>
  <pre class="params">{html.escape(json.dumps(params, indent=2, ensure_ascii=False))}</pre>
  {''.join(rows)}
</body>
</html>
"""
    (out_dir / "index.html").write_text(html_text, encoding="utf-8")


def write_manifest(out_dir: Path, results: list[CaseResult], args: argparse.Namespace) -> None:
    manifest = {
        "id": out_dir.name,
        "kind": "fresh-region-first-pipeline",
        "createdAt": utc_stamp(),
        "sourceRun": args.source_run,
        "sourceCase": args.source_case,
        "params": {
            "colors": args.colors,
            "maxEdge": args.max_edge,
            "seed": args.seed,
            "meanShiftSp": args.mean_shift_sp,
            "meanShiftSr": args.mean_shift_sr,
            "tokenColors": args.token_colors,
            "samplePixels": args.sample_pixels,
            "paletteWeightPower": args.palette_weight_power,
            "majorityFilterRuns": args.majority_filter_runs,
            "minRegionRatio": args.min_region_ratio,
            "minRegionPixels": args.min_region_pixels,
            "tinyMergePasses": args.tiny_merge_passes,
            "postMajorityFilterRuns": args.post_majority_filter_runs,
            "speckleRegionPixels": args.speckle_region_pixels,
            "finalSpecklePasses": args.final_speckle_passes,
            "finalMajorityFilterRuns": args.final_majority_filter_runs,
            "detailProtectMinPixels": args.detail_protect_min_pixels,
            "detailProtectLabDistance": args.detail_protect_lab_distance,
            "boundaryWidth": args.boundary_width,
            "boundarySmoothing": args.boundary_smoothing,
        },
        "results": [
            {
                "sourceId": result.source_id,
                "label": result.label,
                "originalPath": relative_path(out_dir, result.original_path),
                "aiPath": relative_path(out_dir, result.ai_path),
                "cleanPath": relative_path(out_dir, result.clean_path),
                "classicPath": relative_path(out_dir, result.classic_path),
                "metrics": result.metrics,
            }
            for result in results
        ],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    args = parse_args()
    source_run = Path(args.source_run)
    if not source_run.exists():
        raise FileNotFoundError(source_run)

    out_dir = Path(args.out_root) / f"{utc_stamp()}_{args.run_name}"
    out_dir.mkdir(parents=True, exist_ok=True)

    case_dirs = [path for path in sorted(source_run.glob("img-*")) if (path / args.source_case / "output.jpg").exists()]
    if not case_dirs:
        raise RuntimeError(f"No cases found in {source_run} for {args.source_case}")

    results = []
    for case_dir in case_dirs:
        print(f"processing {case_dir.name}")
        results.append(process_case(case_dir, args, out_dir))

    overview_path = build_overview(out_dir, results)
    write_manifest(out_dir, results, args)
    build_html(out_dir, results, overview_path, args)
    print(out_dir)


if __name__ == "__main__":
    main()
