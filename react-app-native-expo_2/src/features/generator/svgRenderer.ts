import { delay, type RGB } from '../../vendor/paintbynumbersgenerator/common';
import type { FacetResult } from '../../vendor/paintbynumbersgenerator/facetmanagement';
import type { Point } from '../../vendor/paintbynumbersgenerator/structs/point';

type SvgRenderOptions = {
  sizeMultiplier: number;
  fill: boolean;
  stroke: boolean;
  addColorLabels: boolean;
  fontSize: number;
  fontColor: string;
};

function buildFacetPathData(path: Point[], sizeMultiplier: number): string {
  let data = `M ${path[0].x * sizeMultiplier} ${path[0].y * sizeMultiplier} `;
  for (let index = 1; index < path.length; index += 1) {
    const midpointX = (path[index].x + path[index - 1].x) / 2;
    const midpointY = (path[index].y + path[index - 1].y) / 2;
    data += `Q ${midpointX * sizeMultiplier} ${midpointY * sizeMultiplier} ${path[index].x * sizeMultiplier} ${path[index].y * sizeMultiplier} `;
  }
  data += 'Z';
  return data;
}

export async function createSvgString(
  facetResult: FacetResult,
  colorsByIndex: RGB[],
  options: SvgRenderOptions,
  onUpdate: ((progress: number) => void) | null = null,
): Promise<string> {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${options.sizeMultiplier * facetResult.width}" height="${options.sizeMultiplier * facetResult.height}" viewBox="0 0 ${options.sizeMultiplier * facetResult.width} ${options.sizeMultiplier * facetResult.height}">`,
  );

  let count = 0;
  for (const facet of facetResult.facets) {
    if (facet != null && facet.borderSegments.length > 0) {
      let path = facet.getFullPathFromBorderSegments(false);
      if (path[0].x !== path[path.length - 1].x || path[0].y !== path[path.length - 1].y) {
        path = [...path, path[0]];
      }

      const data = buildFacetPathData(path, options.sizeMultiplier);
      const rgb = colorsByIndex[facet.color];
      const strokeColor = options.stroke
        ? '#000'
        : options.fill
          ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
          : 'none';
      const fillColor = options.fill ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : 'none';

      parts.push(
        `<path data-facet-id="${facet.id}" d="${data}" stroke="${strokeColor}" stroke-width="1" fill="${fillColor}" />`,
      );

      if (options.addColorLabels && facet.labelBounds != null) {
        const nrOfDigits = String(facet.color).length;
        parts.push(
          `<g class="label" transform="translate(${facet.labelBounds.minX * options.sizeMultiplier},${facet.labelBounds.minY * options.sizeMultiplier})">` +
            `<svg width="${facet.labelBounds.width * options.sizeMultiplier}" height="${facet.labelBounds.height * options.sizeMultiplier}" overflow="visible" viewBox="-50 -50 100 100" preserveAspectRatio="xMidYMid meet">` +
            `<text font-family="Tahoma" font-size="${options.fontSize / nrOfDigits}" dominant-baseline="middle" text-anchor="middle" fill="${options.fontColor}">${facet.color}</text>` +
            `</svg>` +
          `</g>`,
        );
      }

      if (count % 100 === 0) {
        await delay(0);
        onUpdate?.(facet.id / facetResult.facets.length);
      }
    }

    count += 1;
  }

  parts.push('</svg>');
  onUpdate?.(1);
  return parts.join('');
}

