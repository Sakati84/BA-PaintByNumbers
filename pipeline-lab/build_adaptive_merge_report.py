#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
import math
import shutil
from collections import defaultdict
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


CONFIG_ORDER = [
    "expert24-balanced-detail",
    "expert24-adaptive-unlimited",
    "expert24-adaptive-2200",
    "expert24-adaptive-2400",
    "expert24-adaptive-2600",
    "expert24-adaptive-1800",
    "expert24-max-detail",
    "drake-reference",
]

SOURCE_LABELS = {
    "1-foto-1": "Camper am Meer",
    "img-1394": "See und Baumlinie",
    "img-1681": "Pferd auf Wiese",
    "img-1704": "Specht im Gruen",
    "img-1998": "Gelbe Blume",
    "foto-1": "Drake-Referenz Foto 1",
    "foto-1-dog": "Hund im Gras",
    "foto-2-frog": "Frosch",
    "foto-3-stork": "Storch im Nest",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="append", required=True, help="Pipeline Lab run directory. Pass multiple times.")
    parser.add_argument("--drake-dir", help="Historical Drake output directory to include as external reference.")
    parser.add_argument("--out", required=True, help="Report output directory.")
    return parser.parse_args()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def report_href(report_dir: Path, target: str | Path) -> str:
    path = Path(target)
    if not path.is_absolute():
        path = path.resolve()
    try:
        return path.relative_to(report_dir).as_posix()
    except ValueError:
        return Path("..").joinpath(path.relative_to(report_dir.parent)).as_posix()


def load_rgb(path: str | Path) -> Image.Image:
    with Image.open(path) as image:
        return ImageOps.exif_transpose(image).convert("RGB")


def resize_like(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    if image.size == size:
        return image
    return image.resize(size, Image.Resampling.LANCZOS)


def image_to_np(image: Image.Image) -> np.ndarray:
    return np.asarray(image, dtype=np.uint8)


def canny_edges(rgb: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    median = float(np.median(gray))
    lower = int(max(12, 0.66 * median))
    upper = int(min(220, 1.33 * median + 24))
    return cv2.Canny(gray, lower, upper) > 0


def edge_metrics(source: np.ndarray, output: np.ndarray) -> dict[str, float]:
    source_edges = canny_edges(source)
    output_edges = canny_edges(output)
    kernel = np.ones((3, 3), np.uint8)
    source_dilated = cv2.dilate(source_edges.astype(np.uint8), kernel, iterations=1) > 0
    output_dilated = cv2.dilate(output_edges.astype(np.uint8), kernel, iterations=1) > 0
    source_count = max(1, int(source_edges.sum()))
    output_count = max(1, int(output_edges.sum()))
    recall = float((source_edges & output_dilated).sum() / source_count)
    precision = float((output_edges & source_dilated).sum() / output_count)
    f1 = 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)
    return {
        "edgeRecall": recall,
        "edgePrecision": precision,
        "edgeF1": f1,
        "sourceEdgePixels": float(source_count),
        "outputEdgePixels": float(output_count),
    }


def rgb_metrics(source: np.ndarray, output: np.ndarray) -> dict[str, float]:
    diff = source.astype(np.float32) - output.astype(np.float32)
    abs_diff = np.abs(diff)
    return {
        "maeRgb": float(abs_diff.mean()),
        "rmseRgb": float(math.sqrt(float((diff * diff).mean()))),
        "p95AbsRgb": float(np.percentile(abs_diff, 95)),
    }


def srgb_to_lab(colors: np.ndarray) -> np.ndarray:
    colors = colors.astype(np.float32) / 255.0
    colors = np.where(colors > 0.04045, ((colors + 0.055) / 1.055) ** 2.4, colors / 12.92)
    matrix = np.array(
        [
            [0.4124, 0.3576, 0.1805],
            [0.2126, 0.7152, 0.0722],
            [0.0193, 0.1192, 0.9505],
        ],
        dtype=np.float32,
    )
    xyz = colors @ matrix.T
    xyz[:, 0] /= 0.95047
    xyz[:, 2] /= 1.08883
    xyz = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack(
        [
            116 * xyz[:, 1] - 16,
            500 * (xyz[:, 0] - xyz[:, 1]),
            200 * (xyz[:, 1] - xyz[:, 2]),
        ],
        axis=1,
    )


def palette_distinctness(palette_path: str | Path | None, fallback_palette_count: int) -> dict[str, float]:
    if palette_path is None:
        return {"meanNearestLab": 0.0, "minNearestLab": 0.0}
    palette = read_json(Path(palette_path))
    colors = np.array([item["color"] for item in palette], dtype=np.float32)
    if len(colors) <= 1:
        return {"meanNearestLab": 0.0, "minNearestLab": 0.0}
    if len(colors) != fallback_palette_count:
        fallback_palette_count = len(colors)
    lab = srgb_to_lab(colors)
    distances = []
    for index in range(fallback_palette_count):
        delta = lab - lab[index]
        dists = np.sqrt((delta * delta).sum(axis=1))
        dists[index] = 1_000_000
        distances.append(float(dists.min()))
    return {
        "meanNearestLab": float(np.mean(distances)),
        "minNearestLab": float(np.min(distances)),
    }


def total_timing_ms(timings_path: str | Path | None) -> float:
    if timings_path is None:
        return 0.0
    timings = read_json(Path(timings_path))
    return float(sum(float(value) for value in timings.values()))


def variant_path(result: dict[str, Any], variant_id: str) -> str | None:
    for variant in result.get("variants", []):
        if variant.get("id") == variant_id:
            return variant.get("pngPath")
    return None


def source_label(input_id: str) -> str:
    return SOURCE_LABELS.get(input_id, input_id)


def compute_image_metrics(prepared_path: str | Path, output_path: str | Path) -> dict[str, float]:
    prepared = load_rgb(prepared_path)
    output = resize_like(load_rgb(output_path), prepared.size)
    source_np = image_to_np(prepared)
    output_np = image_to_np(output)
    metrics: dict[str, float] = {}
    metrics.update(rgb_metrics(source_np, output_np))
    metrics.update(edge_metrics(source_np, output_np))
    return metrics


def load_runs(run_dirs: list[Path]) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    configs: dict[str, dict[str, Any]] = {}

    for run_dir in run_dirs:
        manifest = read_json(run_dir / "manifest.json")
        source_by_id = {source["id"]: source for source in manifest["sources"]}
        config_by_id = {config["id"]: config for config in manifest["configs"]}
        configs.update(config_by_id)
        for result in manifest["results"]:
            if result.get("status") != "ok":
                continue
            source = source_by_id[result["sourceId"]]
            config = config_by_id[result["configId"]]
            output_path = variant_path(result, "cleanColor")
            if output_path is None:
                continue
            metrics = compute_image_metrics(result["preparedPath"], output_path)
            metrics.update(palette_distinctness(result.get("palettePath"), result["paletteCount"]))
            image_mp = (result["preparedWidth"] * result["preparedHeight"]) / 1_000_000
            metrics["facetsPerMp"] = float(result["facetCount"] / max(image_mp, 0.001))
            metrics["totalTimingMs"] = total_timing_ms(result.get("timingsPath"))
            rows.append(
                {
                    "runDir": str(run_dir),
                    "sourceId": result["sourceId"],
                    "inputId": result["inputId"],
                    "sourceCaseId": result["sourceCaseId"],
                    "sourceLabel": source_label(result["inputId"]),
                    "configId": result["configId"],
                    "configLabel": config["label"],
                    "configDescription": config.get("description"),
                    "settings": config["settings"],
                    "facetCount": result["facetCount"],
                    "paletteCount": result["paletteCount"],
                    "preparedWidth": result["preparedWidth"],
                    "preparedHeight": result["preparedHeight"],
                    "preparedPath": result["preparedPath"],
                    "aiSourcePath": source["localAiImagePath"],
                    "originalInputPath": source.get("localOriginalInputPath"),
                    "cleanColorPath": output_path,
                    "classicPath": variant_path(result, "classic"),
                    "brightPath": variant_path(result, "brightColorCircles"),
                    "metrics": metrics,
                }
            )

    return rows, configs


def load_drake_reference(drake_dir: Path) -> dict[str, Any]:
    root = drake_dir.parent
    report = read_json(drake_dir / "paintability_report.json")
    source_path = root / "source-run" / "outputs" / "foto-1.jpg"
    cleanup_path = drake_dir / "cleanup.png"
    classic_path = drake_dir / "template_classic_no_numbers.png"
    with load_rgb(cleanup_path) as output:
        width, height = output.size
    metrics = compute_image_metrics(source_path, cleanup_path)
    image_mp = (width * height) / 1_000_000
    metrics.update(
        {
            "facetsPerMp": float(report["regions_total"] / max(image_mp, 0.001)),
            "totalTimingMs": 0.0,
            "meanNearestLab": 0.0,
            "minNearestLab": 0.0,
        }
    )
    return {
        "runDir": str(drake_dir),
        "sourceId": "foto-1__expert-24",
        "inputId": "foto-1",
        "sourceCaseId": "expert-24",
        "sourceLabel": source_label("foto-1"),
        "configId": "drake-reference",
        "configLabel": "Drake reference",
        "configDescription": "Historischer Drake-Pipeline-Output fuer dieselbe Foto-1-Quelle.",
        "settings": {
            "kMeansNrOfClusters": report["colors"],
            "maximumNumberOfFacets": report["regions_total"],
            "smallRegionMergeArea": report["small_region_merge_area"],
        },
        "facetCount": report["regions_total"],
        "paletteCount": report["colors"],
        "preparedWidth": width,
        "preparedHeight": height,
        "preparedPath": str(source_path),
        "aiSourcePath": str(source_path),
        "originalInputPath": str(root / "source-run" / "inputs" / "foto-1.jpg"),
        "cleanColorPath": str(cleanup_path),
        "classicPath": str(classic_path),
        "brightPath": str(drake_dir / "template_bright_color_circles.png"),
        "metrics": metrics,
        "drakePaintability": report,
    }


def group_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, dict[str, Any]]]:
    grouped: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for row in rows:
        grouped[row["sourceId"]][row["configId"]] = row
    return grouped


def summarize(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_config: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_config[row["configId"]].append(row)
    summaries = []
    for config_id in CONFIG_ORDER:
        items = by_config.get(config_id, [])
        if not items:
            continue
        summaries.append(
            {
                "configId": config_id,
                "label": items[0]["configLabel"],
                "description": items[0]["configDescription"],
                "sourceCount": len(items),
                "avgFacets": float(np.mean([item["facetCount"] for item in items])),
                "avgPalette": float(np.mean([item["paletteCount"] for item in items])),
                "avgMaeRgb": float(np.mean([item["metrics"]["maeRgb"] for item in items])),
                "avgEdgeRecall": float(np.mean([item["metrics"]["edgeRecall"] for item in items])),
                "avgEdgeF1": float(np.mean([item["metrics"]["edgeF1"] for item in items])),
                "avgFacetsPerMp": float(np.mean([item["metrics"]["facetsPerMp"] for item in items])),
                "avgTimingMs": float(np.mean([item["metrics"]["totalTimingMs"] for item in items])),
                "settings": items[0]["settings"],
            }
        )
    return summaries


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except Exception:
            pass
    return ImageFont.load_default()


def fit_cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_w, target_h = size
    scale = max(target_w / image.width, target_h / image.height)
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
    left = max(0, (resized.width - target_w) // 2)
    top = max(0, (resized.height - target_h) // 2)
    return resized.crop((left, top, left + target_w, top + target_h))


def crop_box(center_x: int, center_y: int, crop_w: int, crop_h: int, width: int, height: int) -> tuple[int, int, int, int]:
    left = max(0, min(width - crop_w, center_x - crop_w // 2))
    top = max(0, min(height - crop_h, center_y - crop_h // 2))
    return left, top, left + crop_w, top + crop_h


def select_detail_crops(source: Image.Image, baseline: Image.Image, count: int = 2) -> list[tuple[int, int, int, int]]:
    source_np = image_to_np(source)
    baseline_np = image_to_np(resize_like(baseline, source.size))
    source_edges = canny_edges(source_np)
    baseline_edges = canny_edges(baseline_np)
    baseline_dilated = cv2.dilate(baseline_edges.astype(np.uint8), np.ones((5, 5), np.uint8), iterations=1) > 0
    lost = (source_edges & ~baseline_dilated).astype(np.float32)
    height, width = lost.shape
    crop_w = max(160, min(width, round(width * 0.34)))
    crop_h = max(150, min(height, round(height * 0.26)))
    density = cv2.boxFilter(lost, ddepth=-1, ksize=(crop_w, crop_h), normalize=False)
    boxes: list[tuple[int, int, int, int]] = []
    for _ in range(count):
        _, max_val, _, max_loc = cv2.minMaxLoc(density)
        if max_val <= 0:
            break
        box = crop_box(max_loc[0], max_loc[1], crop_w, crop_h, width, height)
        boxes.append(box)
        left, top, right, bottom = box
        density[max(0, top - crop_h):min(height, bottom + crop_h), max(0, left - crop_w):min(width, right + crop_w)] = 0
    if not boxes:
        boxes.append(crop_box(width // 2, height // 2, crop_w, crop_h, width, height))
    return boxes


def config_rows_in_order(rows_by_config: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    return [rows_by_config[config_id] for config_id in CONFIG_ORDER if config_id in rows_by_config]


def make_strip(source_id: str, rows_by_config: dict[str, dict[str, Any]], assets_dir: Path) -> str:
    source_row = next(iter(rows_by_config.values()))
    config_rows = config_rows_in_order(rows_by_config)
    columns = [("KI source", None)] + [(row["configLabel"], row) for row in config_rows]
    thumb_size = (180, 162)
    header_h = 38
    footer_h = 54
    gap = 10
    width = len(columns) * thumb_size[0] + (len(columns) - 1) * gap
    height = header_h + thumb_size[1] + footer_h
    canvas = Image.new("RGB", (width, height), (248, 250, 252))
    draw = ImageDraw.Draw(canvas)
    label_font = font(13, True)
    meta_font = font(11)
    for index, (title, row) in enumerate(columns):
        x = index * (thumb_size[0] + gap)
        draw.text((x, 8), title, fill=(25, 35, 45), font=label_font)
        if row is None:
            image = load_rgb(source_row["preparedPath"])
            meta = "KI-Quelle"
        else:
            image = load_rgb(row["cleanColorPath"])
            meta = f"{row['facetCount']} Fl. | F1 {row['metrics']['edgeF1'] * 100:.1f}%"
        canvas.paste(fit_cover(image, thumb_size), (x, header_h))
        draw.rectangle((x, header_h, x + thumb_size[0], header_h + thumb_size[1]), outline=(203, 213, 225))
        draw.text((x, header_h + thumb_size[1] + 8), meta, fill=(71, 85, 105), font=meta_font)
    out = assets_dir / f"{source_id}__strip.jpg"
    canvas.save(out, quality=92)
    return str(out)


def make_crop_montages(source_id: str, rows_by_config: dict[str, dict[str, Any]], assets_dir: Path) -> list[str]:
    baseline_id = "expert24-balanced-detail" if "expert24-balanced-detail" in rows_by_config else next(iter(rows_by_config.keys()))
    source = load_rgb(rows_by_config[baseline_id]["preparedPath"])
    baseline = load_rgb(rows_by_config[baseline_id]["cleanColorPath"])
    boxes = select_detail_crops(source, resize_like(baseline, source.size), count=2)
    config_rows = config_rows_in_order(rows_by_config)
    columns = [("KI source", None)] + [(row["configLabel"], row) for row in config_rows]
    crop_size = (190, 142)
    header_h = 32
    gap = 8
    label_font = font(12, True)
    paths: list[str] = []
    for crop_index, box in enumerate(boxes, start=1):
        width = len(columns) * crop_size[0] + (len(columns) - 1) * gap
        height = header_h + crop_size[1]
        canvas = Image.new("RGB", (width, height), (248, 250, 252))
        draw = ImageDraw.Draw(canvas)
        for index, (label, row) in enumerate(columns):
            x = index * (crop_size[0] + gap)
            draw.text((x, 7), label[:24], fill=(25, 35, 45), font=label_font)
            if row is None:
                image = source
            else:
                image = resize_like(load_rgb(row["cleanColorPath"]), source.size)
            crop = image.crop(box).resize(crop_size, Image.Resampling.LANCZOS)
            canvas.paste(crop, (x, header_h))
            draw.rectangle((x, header_h, x + crop_size[0], header_h + crop_size[1]), outline=(203, 213, 225))
        out = assets_dir / f"{source_id}__crop_{crop_index}.jpg"
        canvas.save(out, quality=92)
        paths.append(str(out))
    return paths


def fmt(value: float, digits: int = 1) -> str:
    return f"{value:.{digits}f}"


def pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def risk_label(facets_per_mp: float) -> str:
    if facets_per_mp >= 1800:
        return "hoch"
    if facets_per_mp >= 1100:
        return "mittel"
    return "niedrig"


def settings_digest(settings: dict[str, Any]) -> str:
    keys = [
        "nearIdenticalPaletteMergeLabDistance",
        "removeFacetsSmallerThanImageRatio",
        "maximumNumberOfFacets",
        "narrowPixelStripCleanupRuns",
        "nrOfTimesToHalveBorderSegments",
        "smallRegionMergeArea",
    ]
    compact = {key: settings[key] for key in keys if key in settings}
    return json.dumps(compact, separators=(",", ":"))


def source_sort_key(source_id: str) -> tuple[int, str]:
    if source_id.startswith("1-foto"):
        return (0, source_id)
    if source_id.startswith("foto-1__expert-24"):
        return (1, source_id)
    return (2, source_id)


def write_report(
  report_dir: Path,
  rows: list[dict[str, Any]],
  summaries: list[dict[str, Any]],
  grouped: dict[str, dict[str, dict[str, Any]]],
  strips: dict[str, str],
  crops: dict[str, list[str]],
  run_dirs: list[Path],
  drake_dir: Path | None,
) -> None:
    by_config = {summary["configId"]: summary for summary in summaries}
    baseline = by_config.get("expert24-balanced-detail")
    recommended = by_config.get("expert24-adaptive-2600")
    unlimited = by_config.get("expert24-adaptive-unlimited")
    strict = by_config.get("expert24-adaptive-1800")
    max_detail = by_config.get("expert24-max-detail")

    def config_summary_html(summary: dict[str, Any]) -> str:
        delta_facets = ""
        if baseline is not None and summary["configId"] != "drake-reference":
            delta = (summary["avgFacets"] / baseline["avgFacets"] - 1) * 100
            delta_facets = f"<br><span>{delta:+.0f}% vs old balanced</span>"
        return f"""
        <tr>
          <td><strong>{html.escape(summary["label"])}</strong><br><span>{html.escape(summary["configId"])}</span></td>
          <td>{fmt(summary["avgFacets"], 0)}{delta_facets}</td>
          <td>{fmt(summary["avgPalette"], 1)}</td>
          <td>{fmt(summary["avgMaeRgb"], 1)}</td>
          <td>{pct(summary["avgEdgeRecall"])}</td>
          <td>{pct(summary["avgEdgeF1"])}</td>
          <td>{fmt(summary["avgFacetsPerMp"], 0)}<br><span>{risk_label(summary["avgFacetsPerMp"])}</span></td>
          <td><code>{html.escape(settings_digest(summary["settings"]))}</code></td>
        </tr>
        """

    source_sections = []
    for source_id in sorted(grouped.keys(), key=source_sort_key):
        rows_by_config = grouped[source_id]
        source_row = next(iter(rows_by_config.values()))
        source_title = f"{source_row['sourceLabel']} ({source_row['inputId']})"
        comparison_rows = []
        reference = rows_by_config.get("expert24-balanced-detail") or next(iter(rows_by_config.values()))
        for row in config_rows_in_order(rows_by_config):
            delta = (row["facetCount"] / reference["facetCount"] - 1) * 100
            comparison_rows.append(
                f"""
                <tr>
                  <td>{html.escape(row["configLabel"])}</td>
                  <td>{row["facetCount"]} <span>({delta:+.0f}% vs ref)</span></td>
                  <td>{row["paletteCount"]}</td>
                  <td>{fmt(row["metrics"]["maeRgb"], 1)}</td>
                  <td>{pct(row["metrics"]["edgeRecall"])}</td>
                  <td>{pct(row["metrics"]["edgeF1"])}</td>
                  <td>{risk_label(row["metrics"]["facetsPerMp"])}</td>
                </tr>
                """
            )
        crop_imgs = "\n".join(
            f'<a href="{html.escape(report_href(report_dir, path))}"><img src="{html.escape(report_href(report_dir, path))}" alt="{html.escape(source_title)} crop"></a>'
            for path in crops[source_id]
        )
        source_sections.append(
            f"""
            <section class="source-section" id="{html.escape(source_id)}">
              <div class="section-head">
                <div>
                  <h2>{html.escape(source_title)}</h2>
                  <p>KI-Quelle gegen alte Balanced-Referenz, neue adaptive Varianten und - falls vorhanden - Drake. Die Detail-Crops sitzen dort, wo die Referenz gegenueber der KI-Quelle die meisten Kanten verliert.</p>
                </div>
                <a class="small-link" href="{html.escape(report_href(report_dir, source_row["aiSourcePath"]))}">KI-Bild oeffnen</a>
              </div>
              <a class="strip" href="{html.escape(report_href(report_dir, strips[source_id]))}"><img src="{html.escape(report_href(report_dir, strips[source_id]))}" alt="{html.escape(source_title)} strip"></a>
              <div class="crop-grid">{crop_imgs}</div>
              <table class="compact">
                <thead><tr><th>Run</th><th>Flaechen</th><th>Farben</th><th>MAE</th><th>Kanten-Recall</th><th>Kanten-F1</th><th>Risiko</th></tr></thead>
                <tbody>{''.join(comparison_rows)}</tbody>
              </table>
            </section>
            """
        )

    run_links = "".join(
        f'<li><a href="{html.escape(report_href(report_dir, run_dir / "index.html"))}">{html.escape(run_dir.name)}</a></li>'
        for run_dir in run_dirs
    )
    if drake_dir is not None:
        run_links += f'<li><a href="{html.escape(report_href(report_dir, drake_dir / "template_classic_no_numbers.png"))}">Drake reference output</a></li>'

    rec_facets = fmt(recommended["avgFacets"], 0) if recommended is not None else "n/a"
    rec_f1 = pct(recommended["avgEdgeF1"]) if recommended is not None else "n/a"
    unlimited_facets = fmt(unlimited["avgFacets"], 0) if unlimited is not None else "n/a"
    strict_facets = fmt(strict["avgFacets"], 0) if strict is not None else "n/a"
    max_facets = fmt(max_detail["avgFacets"], 0) if max_detail is not None else "n/a"

    html_text = f"""<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Adaptive Expert-24 Merge Vergleich</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f7f9fb;
      --surface: #ffffff;
      --ink: #17212b;
      --muted: #64748b;
      --line: #d8e1ea;
      --accent: #1d7668;
      --warn: #8a5a10;
      --radius: 8px;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }}
    header {{ background: #fff; border-bottom: 1px solid var(--line); }}
    .wrap {{ width: min(1480px, calc(100vw - 32px)); margin: 0 auto; }}
    .hero {{
      padding: 28px 0 22px;
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 28px;
      align-items: end;
    }}
    h1 {{ margin: 0 0 10px; font-size: clamp(28px, 4vw, 48px); line-height: 1.04; letter-spacing: 0; }}
    h2 {{ margin: 0; font-size: 22px; letter-spacing: 0; }}
    h3 {{ margin: 0 0 8px; font-size: 16px; letter-spacing: 0; }}
    p {{ margin: 0; color: var(--muted); }}
    .decision {{ border-left: 4px solid var(--accent); padding: 12px 0 12px 16px; background: #eefaf7; }}
    nav {{ display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 0; border-top: 1px solid var(--line); }}
    nav a, .small-link {{
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 6px 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: #24465f;
      text-decoration: none;
      font-size: 13px;
      white-space: nowrap;
    }}
    main {{ padding: 24px 0 40px; }}
    .grid {{ display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }}
    .metric {{ background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; }}
    .metric strong {{ display: block; font-size: 24px; margin-bottom: 4px; }}
    .metric span, td span {{ color: var(--muted); font-size: 12px; }}
    section {{ margin: 0 0 28px; padding-top: 4px; }}
    .panel {{ background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px; margin-bottom: 18px; }}
    .section-head {{ display: flex; justify-content: space-between; align-items: start; gap: 16px; margin-bottom: 12px; }}
    table {{ width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }}
    th, td {{ text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 13px; }}
    th {{ color: #334155; background: #f1f5f9; font-weight: 700; }}
    tr:last-child td {{ border-bottom: 0; }}
    code {{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: #334155; white-space: nowrap; }}
    .source-section {{ background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px; }}
    .strip img {{ width: 100%; display: block; border: 1px solid var(--line); border-radius: 6px; background: #fff; }}
    .crop-grid {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 12px 0; overflow-x: auto; }}
    .crop-grid img {{ width: 100%; min-width: 760px; display: block; border: 1px solid var(--line); border-radius: 6px; }}
    .notes {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }}
    .note {{ border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; background: #fff; }}
    ul {{ margin: 8px 0 0; padding-left: 18px; color: var(--muted); }}
    li {{ margin: 4px 0; }}
    @media (max-width: 980px) {{
      .hero, .grid, .notes {{ grid-template-columns: 1fr; }}
      .section-head {{ display: block; }}
      .small-link {{ margin-top: 10px; }}
      table {{ display: block; overflow-x: auto; }}
    }}
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <div class="hero">
        <div>
          <h1>Adaptive Expert-24 Merge Vergleich</h1>
          <p>Neue Merge-Logik fuer Paint-by-Numbers: kompakte kontrastreiche Details bleiben eher erhalten, ruhige farbnahe Bereiche werden frueher zusammengefuehrt. Verglichen werden Camper, sieben bestehende Expert-Beispiele und die historische Drake-Quelle.</p>
        </div>
        <div class="decision">
          <h3>Empfehlung</h3>
          <p><strong>Expert-24 auf adaptive 2600 setzen:</strong> 3000+ Flaechen werden abgefangen, aber Hochdetailbilder wie Specht und Drake werden weniger stark zusammengedrueckt als bei 2200.</p>
        </div>
      </div>
      <nav>
        <a href="#summary">Summary</a>
        <a href="#configs">Parameter</a>
        <a href="#findings">Findings</a>
        {''.join(f'<a href="#{html.escape(source_id)}">{html.escape(next(iter(grouped[source_id].values()))["sourceLabel"])}</a>' for source_id in sorted(grouped.keys(), key=source_sort_key))}
      </nav>
    </div>
  </header>
  <main class="wrap">
    <section id="summary" class="grid">
      <div class="metric"><strong>{rec_facets}</strong><span>Adaptive 2600 avg. Flaechen</span></div>
      <div class="metric"><strong>{rec_f1}</strong><span>Adaptive 2600 avg. Kanten-F1</span></div>
      <div class="metric"><strong>{unlimited_facets}</strong><span>Adaptive ohne Budget, zu hoch bei Specht/Drake</span></div>
      <div class="metric"><strong>{strict_facets}</strong><span>Adaptive 1800, strengere Paintability</span></div>
    </section>

    <section id="configs" class="panel">
      <div class="section-head">
        <div>
          <h2>Parameter- und Metrikvergleich</h2>
          <p>MAE und Kantenmetriken vergleichen `cleanColor` gegen die KI-Quelle nach Resize auf Arbeitsgroesse. Drake ist nur fuer Foto 1 vorhanden und wird deshalb separat in der Durchschnittstabelle mit einer Quelle gefuehrt.</p>
        </div>
      </div>
      <table>
        <thead><tr><th>Config</th><th>Avg. Flaechen</th><th>Avg. Farben</th><th>Avg. MAE</th><th>Kanten-Recall</th><th>Kanten-F1</th><th>Flaechen/MP</th><th>Settings</th></tr></thead>
        <tbody>{''.join(config_summary_html(summary) for summary in summaries)}</tbody>
      </table>
    </section>

    <section id="findings" class="notes">
      <div class="note">
        <h3>Warum adaptiv?</h3>
        <p>Pauschales Mindestflaechen-Merging entfernt auch Fenster, Augen, Reifenkanten oder Federdetails. Der neue Score schuetzt kleine kompakte Hochkontrastinseln und bevorzugt farbnahe, lang angrenzende Merge-Ziele.</p>
      </div>
      <div class="note">
        <h3>Warum 2600?</h3>
        <p>{max_facets} Flaechen im Max-Detail-Pfad und unbegrenzte adaptive Ausreisser sind fuer echte Malbarkeit zu viel. 2600 bremst Ausreisser, ohne Hochdetailbilder so stark zu glaetten wie 2200.</p>
      </div>
      <div class="note">
        <h3>Drake als Vergleich</h3>
        <p>Drake bleibt bei Foto 1 deutlich grober und paintbarer. Unsere 2600-Variante ist detailreicher, aber durch das Budget nicht mehr so offen nach oben wie der unbegrenzte Lauf.</p>
      </div>
    </section>

    {''.join(source_sections)}

    <section class="panel">
      <h2>Artefakte</h2>
      <p>Verwendete Pipeline-Lab-Runs:</p>
      <ul>{run_links}</ul>
      <p style="margin-top:10px">Rohdaten: <a href="analysis.json">analysis.json</a></p>
    </section>
  </main>
</body>
</html>
"""
    (report_dir / "index.html").write_text(html_text, encoding="utf-8")


def main() -> None:
    args = parse_args()
    run_dirs = [Path(run).resolve() for run in args.run]
    report_dir = Path(args.out).resolve()
    assets_dir = report_dir / "assets"
    crops_dir = assets_dir / "crops"
    strips_dir = assets_dir / "strips"
    if report_dir.exists():
        shutil.rmtree(report_dir)
    crops_dir.mkdir(parents=True, exist_ok=True)
    strips_dir.mkdir(parents=True, exist_ok=True)

    rows, _configs = load_runs(run_dirs)
    drake_dir = Path(args.drake_dir).resolve() if args.drake_dir else None
    if drake_dir is not None:
        rows.append(load_drake_reference(drake_dir))

    grouped = group_rows(rows)
    summaries = summarize(rows)

    strips: dict[str, str] = {}
    crops: dict[str, list[str]] = {}
    for source_id, rows_by_config in grouped.items():
        strips[source_id] = make_strip(source_id, rows_by_config, strips_dir)
        crops[source_id] = make_crop_montages(source_id, rows_by_config, crops_dir)

    analysis = {
        "runs": [str(run_dir) for run_dir in run_dirs],
        "drakeDir": str(drake_dir) if drake_dir is not None else None,
        "summaries": summaries,
        "rows": rows,
        "strips": strips,
        "crops": crops,
        "recommendation": {
            "configId": "expert24-adaptive-2600",
            "settings": {
                "nearIdenticalPaletteMergeLabDistance": 2,
                "removeFacetsSmallerThanImageRatio": 0.000012,
                "maximumNumberOfFacets": 2600,
                "narrowPixelStripCleanupRuns": 0,
                "nrOfTimesToHalveBorderSegments": 0,
            },
        },
    }
    (report_dir / "analysis.json").write_text(json.dumps(analysis, indent=2), encoding="utf-8")
    write_report(report_dir, rows, summaries, grouped, strips, crops, run_dirs, drake_dir)
    print(report_dir / "index.html")


if __name__ == "__main__":
    main()
