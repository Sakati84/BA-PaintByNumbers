Transform the uploaded photo into an expert-level paint-by-numbers source image.

The result must be visibly redrawn as a high-detail posterized illustration. It should preserve far more structure than Medium, but it must not remain a photograph or photo filter.

Core requirements:
- Use exactly {{NUMBER_OF_COLORS}} intended main colors.
- Keep the main subject, crop, composition, pose, and spatial relationships recognizable.
- Redraw the entire image as many coherent closed color regions.
- Preserve important small and medium structures as paintable shapes.
- Convert texture, light, shadow, reflections, and material changes into discrete matte color cells.
- Do not preserve raw photographic texture, sensor noise, blur, or continuous gradients.

Expert-level detail:
- More segmented and information-rich than Medium.
- Many distinct but controlled paint regions.
- Small features may be preserved only when they become clean closed cells.
- Avoid noise-like fragmentation and unpaintable speckles.
- Preserve subject-specific markings, shape transitions, and regional variation.

Subject handling:
- Landscapes: segment sky, cloud layers, tree groups, shoreline, grass, water, and reflections into many readable color planes. Reflections may be detailed, but must be simplified into clean regions.
- Animals: preserve anatomy, pose, muscles, mane, legs, tail, and key markings as separated paint cells. Fur texture becomes grouped shape regions, not hair.
- Birds: preserve beak, eye, head pattern, wing/body markings, tail colors, and perch/background structure as clean cells. Foliage becomes grouped leaf masses, not individual noisy leaves.
- Flowers: preserve petal layout, petal folds, center structure, stem, vase, and background planes. Flower center detail becomes grouped radial/circular cells, not tiny seed noise.

Style:
- expert paint-by-numbers source artwork
- high-detail flat posterization
- crisp boundaries between regions
- matte color fills
- no black outlines
- no dark contour lines
- no numbers, labels, or text
- more detailed than Medium, but still practical for paint-by-numbers extraction

The final image should clearly differ from Medium output: it should have more deliberate paint cells, richer internal structure, and stronger fidelity while remaining non-photographic and paintable.

Negative prompt:
unchanged photo, lightly filtered photo, photo filter, photorealistic image, camera-realistic rendering, realistic lighting, realistic shadows, photographic texture, raw photo surface, continuous gradients, lens blur, depth of field, bokeh, glossy reflection, grass blade texture, leaf micro-detail, feather micro-detail, fur hair detail, flower seed noise, bark noise, water ripple noise, grain, sensor noise, tiny speckles, random fragmentation, unpaintable micro-cells, black outlines, dark contour lines, coloring book line art, sketch, ink drawing, brush texture, watercolor texture, oil paint texture, preschool drawing, medium-detail simplification, generic cartoon, decorative symbols, unrelated objects, changed main subject, numbers, labels, text, logos, watermarks

Output constraints:
- Output a normal clean image only, not a numbered template.
- Keep the useful image size within about {{MAX_EDGE}}px on the longest edge.
