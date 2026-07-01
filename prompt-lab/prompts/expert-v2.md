Use the uploaded photo as the strict visual reference.

Create an expert-level flat posterized source image for paint-by-numbers generation.

Palette and color rules:
- Extract exactly {{NUMBER_OF_COLORS}} intended main colors from the uploaded photo.
- The palette must come from the actual photo, not from a decorative or invented color scheme.
- Prefer colors from broad, medium, and visually important smaller regions.
- Merge near-identical shades, sensor noise, tiny reflections, compression artifacts, and accidental pixel variation.
- Preserve the source image's recognizable color identity within the {{NUMBER_OF_COLORS}}-color limit.
- Use only the extracted palette as the image's intended color system.

Composition rules:
- Keep the original subject placement, horizon, perspective, crop, and spatial relationships.
- Preserve the main object silhouettes and important secondary forms.
- Keep the image recognizable as the uploaded photo at first glance.

Shape rules:
- Translate detail into clean, closed, paintable color regions.
- Preserve meaningful structure through separated flat shapes, not through texture.
- Keep many coherent regions for expert difficulty, but avoid noisy fragmentation.
- Turn shadows, highlights, material changes, foliage, ground, water, buildings, and object details into deliberate matte color cells.
- Remove ultra-fine texture, grain, photographic noise, and tiny unpaintable speckles.

Style rules:
- Flat matte posterized illustration.
- Crisp boundaries between color areas.
- No black outlines.
- No dark contour lines.
- No sketch, ink, coloring-book line art, hatching, brush texture, watercolor texture, or oil paint texture.
- No photorealistic rendering, photographic lighting, lens blur, depth of field, glossy realism, or realistic texture.
- Minimal gradients only where absolutely necessary; prefer discrete flat color planes.

The result should be a clean expert-level paint-by-numbers source artwork for {{TARGET_AUDIENCE}}: faithful to the photo, richly segmented, controlled, readable, non-photographic, and built from paintable flat regions.

Negative prompt:
black outlines, dark contour lines, sketch, ink drawing, coloring book line art, painterly brush strokes, watercolor texture, oil paint texture, photorealism, photographic rendering, camera-realistic image, lifelike lighting, realistic shadows, lens blur, depth of field, bokeh, glossy reflections, photorealistic texture, skin pores, fabric weave, noisy gradients, grain, blur, muddy colors, oversimplified shapes, too few color regions, childish simplification, unrelated palette, excessive micro-noise, meaningless speckling, numbers, labels, text, logos, watermarks

Output constraints:
- Output a normal clean image only, not a numbered template.
- Keep the useful image size within about {{MAX_EDGE}}px on the longest edge.
