#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import math
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_RUN = REPO_ROOT / "prompt-lab/runs/2026-06-30T19-40-19-250Z_nano-banana-2-lite-easy-medium-expert"
OUT_ROOT = REPO_ROOT / "pipeline-lab/method-comparisons"
TARGET_COLORS = 12
MAX_EDGE = 1024


@dataclass(frozen=True)
class SourceImage:
    source_id: str
    input_id: str
    case_id: str
    image_path: Path


def timestamp_for_path() -> str:
    return time.strftime("%Y-%m-%dT%H-%M-%S", time.localtime())


def load_sources() -> list[SourceImage]:
    manifest = json.loads((SOURCE_RUN / "manifest.json").read_text())
    sources: list[SourceImage] = []
    for result in manifest["results"]:
        if result.get("status") != "ok" or result.get("caseId") != "easy-v5":
            continue
        output_path = Path(result["outputPath"])
        if not output_path.is_absolute():
            output_path = SOURCE_RUN / output_path
        sources.append(
            SourceImage(
                source_id=f"{result['inputId']}__{result['caseId']}",
                input_id=result["inputId"],
                case_id=result["caseId"],
                image_path=output_path,
            )
        )
    return sources


def load_prepared_rgb(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGBA")
        scale = min(MAX_EDGE / im.width, MAX_EDGE / im.height, 1.0)
        if scale < 1.0:
            im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.Resampling.LANCZOS)
        background = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(background, im).convert("RGB")
        return np.asarray(im, dtype=np.uint8)


def rgb_to_lab_float(rgb: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)


def lab_float_to_rgb(lab: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(np.clip(np.rint(lab), 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)


def weighted_kmeans(points: np.ndarray, weights: np.ndarray, k: int, exponent: float = 1.0, iterations: int = 32) -> np.ndarray:
    if len(points) <= k:
        return points.astype(np.float32)

    points_f = points.astype(np.float32)
    weights_f = np.maximum(weights.astype(np.float32), 1.0) ** exponent
    centers = np.empty((k, points_f.shape[1]), dtype=np.float32)

    first = int(np.argmax(weights_f))
    centers[0] = points_f[first]
    min_dist2 = np.sum((points_f - centers[0]) ** 2, axis=1)

    for center_index in range(1, k):
        score = min_dist2 * weights_f
        next_index = int(np.argmax(score))
        centers[center_index] = points_f[next_index]
        dist2 = np.sum((points_f - centers[center_index]) ** 2, axis=1)
        min_dist2 = np.minimum(min_dist2, dist2)

    labels = np.zeros(len(points_f), dtype=np.int32)
    for _ in range(iterations):
        dist2 = np.sum((points_f[:, None, :] - centers[None, :, :]) ** 2, axis=2)
        next_labels = np.argmin(dist2, axis=1).astype(np.int32)
        if np.array_equal(labels, next_labels):
            break
        labels = next_labels
        for center_index in range(k):
            mask = labels == center_index
            if not np.any(mask):
                farthest = int(np.argmax(np.min(dist2, axis=1) * weights_f))
                centers[center_index] = points_f[farthest]
                continue
            cluster_weights = weights_f[mask]
            centers[center_index] = np.average(points_f[mask], axis=0, weights=cluster_weights)

    return centers


def assign_to_centers(points: np.ndarray, centers: np.ndarray) -> np.ndarray:
    dist2 = np.sum((points[:, None, :] - centers[None, :, :]) ** 2, axis=2)
    return np.argmin(dist2, axis=1).astype(np.int32)


def compact_palette(labels: np.ndarray, centers_lab: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    flat = labels.reshape(-1)
    used, inverse = np.unique(flat, return_inverse=True)
    counts = np.bincount(inverse)
    order = np.argsort(-counts)
    remap = np.empty(len(used), dtype=np.int32)
    remap[order] = np.arange(len(used), dtype=np.int32)
    compact_labels = remap[inverse].reshape(labels.shape)
    compact_centers = centers_lab[used[order]]
    return compact_labels, compact_centers


def merge_redundant_neutrals(labels: np.ndarray, centers_lab: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if len(centers_lab) < 2:
        return labels, centers_lab

    centers = centers_lab.copy()
    parent = np.arange(len(centers), dtype=np.int32)

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = int(parent[index])
        return index

    def union(a: int, b: int) -> None:
        root_a = find(a)
        root_b = find(b)
        if root_a != root_b:
            parent[root_b] = root_a

    for i in range(len(centers)):
        for j in range(i + 1, len(centers)):
            ai = centers[i]
            aj = centers[j]
            chroma_i = math.hypot(float(ai[1] - 128.0), float(ai[2] - 128.0))
            chroma_j = math.hypot(float(aj[1] - 128.0), float(aj[2] - 128.0))
            dist = float(np.linalg.norm(ai - aj))
            both_neutral = chroma_i <= 12.0 and chroma_j <= 12.0 and dist <= 9.0
            both_light_low_chroma = ai[0] >= 82.0 and aj[0] >= 82.0 and chroma_i <= 18.0 and chroma_j <= 18.0 and dist <= 7.0
            if both_neutral or both_light_low_chroma:
                union(i, j)

    roots = np.array([find(i) for i in range(len(centers))], dtype=np.int32)
    unique_roots, inverse = np.unique(roots, return_inverse=True)
    counts = np.bincount(labels.reshape(-1), minlength=len(centers)).astype(np.float32)
    merged_centers = []
    for root in unique_roots:
        members = np.where(roots == root)[0]
        member_weights = counts[members]
        if np.sum(member_weights) <= 0:
            merged_centers.append(np.mean(centers[members], axis=0))
        else:
            merged_centers.append(np.average(centers[members], axis=0, weights=member_weights))
    merged_centers_arr = np.asarray(merged_centers, dtype=np.float32)
    merged_labels = inverse[labels]
    return compact_palette(merged_labels, merged_centers_arr)


def quantize_weighted_lab(rgb: np.ndarray, k: int = TARGET_COLORS, exponent: float = 1.35) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    flat_rgb = rgb.reshape(-1, 3)
    unique_rgb, inverse, counts = np.unique(flat_rgb, axis=0, return_inverse=True, return_counts=True)
    unique_lab = rgb_to_lab_float(unique_rgb.reshape(1, -1, 3)).reshape(-1, 3)
    centers_lab = weighted_kmeans(unique_lab, counts, k, exponent=exponent)
    unique_labels = assign_to_centers(unique_lab, centers_lab)
    labels = unique_labels[inverse].reshape(rgb.shape[:2])
    labels, centers_lab = compact_palette(labels, centers_lab)
    labels, centers_lab = merge_redundant_neutrals(labels, centers_lab)
    out_rgb = lab_float_to_rgb(centers_lab[labels].reshape(rgb.shape))
    return out_rgb, labels, centers_lab


def quantize_plain_cv_lab(rgb: np.ndarray, k: int = TARGET_COLORS) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    lab = rgb_to_lab_float(rgb)
    samples = lab.reshape(-1, 3).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.25)
    cv2.setRNGSeed(42)
    _, labels_flat, centers = cv2.kmeans(samples, k, None, criteria, 2, cv2.KMEANS_PP_CENTERS)
    labels = labels_flat.reshape(rgb.shape[:2]).astype(np.int32)
    labels, centers = compact_palette(labels, centers.astype(np.float32))
    out_rgb = lab_float_to_rgb(centers[labels].reshape(rgb.shape))
    return out_rgb, labels, centers


def quantize_spatial_labxy(rgb: np.ndarray, k: int = TARGET_COLORS, spatial_weight: float = 18.0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    h, w = rgb.shape[:2]
    lab = rgb_to_lab_float(rgb)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xy = np.stack((xx / max(w - 1, 1), yy / max(h - 1, 1)), axis=2) * spatial_weight
    features = np.concatenate((lab, xy), axis=2).reshape(-1, 5).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.2)
    cv2.setRNGSeed(42)
    _, labels_flat, centers = cv2.kmeans(features, k, None, criteria, 2, cv2.KMEANS_PP_CENTERS)
    labels = labels_flat.reshape(h, w).astype(np.int32)
    labels, centers = compact_palette(labels, centers[:, :3].astype(np.float32))
    out_rgb = lab_float_to_rgb(centers[labels].reshape(rgb.shape))
    return out_rgb, labels, centers


def quantize_meanshift(rgb: np.ndarray, k: int = TARGET_COLORS, sp: int = 16, sr: int = 22) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    shifted = cv2.pyrMeanShiftFiltering(rgb, sp=sp, sr=sr, maxLevel=1)
    return quantize_weighted_lab(shifted, k=k)


def quantize_region_modes(rgb: np.ndarray, k: int = TARGET_COLORS) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    shifted = cv2.pyrMeanShiftFiltering(rgb, sp=16, sr=24, maxLevel=1)
    interim_rgb, interim_labels, _ = quantize_weighted_lab(shifted, k=32, exponent=1.1)
    lab = rgb_to_lab_float(shifted)
    h, w = rgb.shape[:2]
    region_labels = np.full((h, w), -1, dtype=np.int32)
    region_means: list[np.ndarray] = []
    region_counts: list[int] = []
    next_region = 0

    for color_label in np.unique(interim_labels):
        mask = (interim_labels == color_label).astype(np.uint8)
        count, components = cv2.connectedComponents(mask, connectivity=8)
        for component_id in range(1, count):
            component_mask = components == component_id
            area = int(np.sum(component_mask))
            if area == 0:
                continue
            region_labels[component_mask] = next_region
            region_means.append(np.mean(lab[component_mask], axis=0))
            region_counts.append(area)
            next_region += 1

    region_means_arr = np.asarray(region_means, dtype=np.float32)
    region_counts_arr = np.asarray(region_counts, dtype=np.float32)
    centers_lab = weighted_kmeans(region_means_arr, region_counts_arr, k, exponent=1.25, iterations=40)
    region_palette_labels = assign_to_centers(region_means_arr, centers_lab)
    labels = region_palette_labels[region_labels]
    labels, centers_lab = compact_palette(labels, centers_lab)
    labels, centers_lab = merge_redundant_neutrals(labels, centers_lab)
    out_rgb = lab_float_to_rgb(centers_lab[labels].reshape(rgb.shape))
    return out_rgb, labels, centers_lab


METHODS: dict[str, Callable[[np.ndarray], tuple[np.ndarray, np.ndarray, np.ndarray]]] = {
    "plain-lab-kmeans": quantize_plain_cv_lab,
    "weighted-lab-kmeans": quantize_weighted_lab,
    "meanshift-weighted-kmeans": quantize_meanshift,
    "spatial-labxy-kmeans": quantize_spatial_labxy,
    "region-modes-then-kmeans": quantize_region_modes,
}


def connected_component_stats(labels: np.ndarray) -> dict[str, float]:
    total_components = 0
    small_components = 0
    tiny_components = 0
    largest_by_label = []
    for label in np.unique(labels):
        mask = (labels == label).astype(np.uint8)
        count, components, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        areas = stats[1:, cv2.CC_STAT_AREA] if count > 1 else np.asarray([], dtype=np.int32)
        total_components += len(areas)
        small_components += int(np.sum(areas < 64))
        tiny_components += int(np.sum(areas < 16))
        if len(areas) > 0:
            largest_by_label.append(float(np.max(areas)) / float(np.sum(areas)))
    return {
        "components": float(total_components),
        "small_components_lt64": float(small_components),
        "tiny_components_lt16": float(tiny_components),
        "mean_largest_component_share_per_color": float(np.mean(largest_by_label)) if largest_by_label else 0.0,
    }


def source_variance_by_output_region(source_rgb: np.ndarray, labels: np.ndarray) -> dict[str, float]:
    source_lab = rgb_to_lab_float(source_rgb)
    variances = []
    weighted_variances = []
    for label in np.unique(labels):
        mask = labels == label
        pixels = source_lab[mask]
        if len(pixels) < 2:
            continue
        variance = float(np.mean(np.var(pixels, axis=0)))
        variances.append(variance)
        weighted_variances.append(variance * len(pixels))
    return {
        "mean_source_lab_variance_per_color": float(np.mean(variances)) if variances else 0.0,
        "pixel_weighted_source_lab_variance": float(np.sum(weighted_variances) / labels.size) if weighted_variances else 0.0,
    }


def crop_boxes(source_id: str, shape: tuple[int, int, int]) -> dict[str, tuple[int, int, int, int]]:
    h, w = shape[:2]
    if source_id == "img-1998__easy-v5":
        return {
            "flower_left_petal": (150, 185, 330, 415),
            "flower_center": (270, 360, 500, 570),
        }
    if source_id == "img-1681__easy-v5":
        return {
            "horse_hoof": (520, 420, 610, 535),
        }
    return {
        "center": (w // 4, h // 4, (w * 3) // 4, (h * 3) // 4),
    }


def crop_palette_metrics(out_rgb: np.ndarray, boxes: dict[str, tuple[int, int, int, int]]) -> dict[str, float]:
    metrics: dict[str, float] = {}
    for name, box in boxes.items():
        x0, y0, x1, y1 = box
        x0 = max(0, min(out_rgb.shape[1], x0))
        x1 = max(0, min(out_rgb.shape[1], x1))
        y0 = max(0, min(out_rgb.shape[0], y0))
        y1 = max(0, min(out_rgb.shape[0], y1))
        crop = out_rgb[y0:y1, x0:x1]
        if crop.size == 0:
            continue
        colors, counts = np.unique(crop.reshape(-1, 3), axis=0, return_counts=True)
        order = np.argsort(-counts)
        shares = counts[order] / np.sum(counts)
        metrics[f"{name}_colors"] = float(len(colors))
        metrics[f"{name}_dominant_share"] = float(shares[0]) if len(shares) else 0.0
        metrics[f"{name}_top3_share"] = float(np.sum(shares[:3])) if len(shares) else 0.0
    return metrics


def palette_summary(out_rgb: np.ndarray) -> list[dict[str, object]]:
    colors, counts = np.unique(out_rgb.reshape(-1, 3), axis=0, return_counts=True)
    order = np.argsort(-counts)
    total = float(np.sum(counts))
    return [
        {
            "rgb": [int(v) for v in colors[index]],
            "pixels": int(counts[index]),
            "share": float(counts[index] / total),
        }
        for index in order[:16]
    ]


def write_overview(run_dir: Path, rows: list[dict[str, object]]) -> Path:
    thumbs: list[tuple[str, Path, str]] = []
    for row in rows:
        thumbs.append((str(row["sourceId"]), Path(str(row["outputPath"])), str(row["method"])))

    thumb_w, thumb_h = 220, 165
    label_h = 42
    pad = 12
    sources = sorted({str(row["sourceId"]) for row in rows})
    methods = list(METHODS.keys())
    width = pad + 220 + pad + len(methods) * (thumb_w + pad)
    height = pad + 62 + pad + len(sources) * (thumb_h + label_h + pad)
    canvas = Image.new("RGB", (width, height), (247, 248, 250))
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 13)
        font_bold = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 13)
    except Exception:
        font = font_bold = ImageFont.load_default()

    draw.text((pad, pad), "Source", font=font_bold, fill=(31, 41, 51))
    x = pad + 220 + pad
    for method in methods:
        draw.text((x, pad), method, font=font_bold, fill=(31, 41, 51))
        x += thumb_w + pad

    by_key = {(str(row["sourceId"]), str(row["method"])): row for row in rows}
    y = pad + 62 + pad
    for source in sources:
        draw.text((pad, y + 8), source, font=font_bold, fill=(31, 41, 51))
        x = pad + 220 + pad
        for method in methods:
            row = by_key[(source, method)]
            image = Image.open(Path(str(row["outputPath"]))).convert("RGB")
            image.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            draw.rectangle((x, y, x + thumb_w, y + thumb_h + label_h), fill=(255, 255, 255), outline=(217, 226, 236))
            canvas.paste(image, (x + (thumb_w - image.width) // 2, y + (thumb_h - image.height) // 2))
            draw.text(
                (x + 6, y + thumb_h + 6),
                f"c{int(row['paletteColors'])} s{int(row['small_components_lt64'])}",
                font=font,
                fill=(82, 96, 109),
            )
            x += thumb_w + pad
        y += thumb_h + label_h + pad

    output_path = run_dir / "overview.png"
    canvas.save(output_path)
    return output_path


def main() -> None:
    run_dir = OUT_ROOT / f"{timestamp_for_path()}_flattening-methods-12c"
    run_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, object]] = []
    manifest = {
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "targetColors": TARGET_COLORS,
        "maxEdge": MAX_EDGE,
        "sourceRun": str(SOURCE_RUN),
        "methods": list(METHODS.keys()),
        "results": [],
    }

    for source in load_sources():
        source_dir = run_dir / source.source_id
        source_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source.image_path, source_dir / f"ai-source{source.image_path.suffix.lower()}")
        rgb = load_prepared_rgb(source.image_path)
        Image.fromarray(rgb).save(source_dir / "input.prepared.png")

        for method_name, method in METHODS.items():
            started = time.time()
            out_rgb, labels, centers_lab = method(rgb)
            elapsed_ms = round((time.time() - started) * 1000)
            method_dir = source_dir / method_name
            method_dir.mkdir(parents=True, exist_ok=True)
            output_path = method_dir / "cleaned.png"
            Image.fromarray(out_rgb).save(output_path)

            metrics = {
                "sourceId": source.source_id,
                "method": method_name,
                "outputPath": str(output_path),
                "durationMs": elapsed_ms,
                "paletteColors": int(len(np.unique(out_rgb.reshape(-1, 3), axis=0))),
                "targetColors": TARGET_COLORS,
                **connected_component_stats(labels),
                **source_variance_by_output_region(rgb, labels),
                **crop_palette_metrics(out_rgb, crop_boxes(source.source_id, rgb.shape)),
            }
            palette = palette_summary(out_rgb)
            (method_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
            (method_dir / "palette.json").write_text(json.dumps(palette, indent=2))
            rows.append(metrics)
            manifest["results"].append({**metrics, "palette": palette})
            print(f"ok {source.source_id} / {method_name}: colors={metrics['paletteColors']} small={metrics['small_components_lt64']} {elapsed_ms}ms")

    if rows:
        csv_path = run_dir / "metrics.csv"
        fieldnames = sorted({key for row in rows for key in row.keys()})
        with csv_path.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
    overview_path = write_overview(run_dir, rows)
    manifest["overviewPath"] = str(overview_path)
    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Method comparison written to {run_dir}")


if __name__ == "__main__":
    main()
