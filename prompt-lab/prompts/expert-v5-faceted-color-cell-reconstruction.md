Reconstruct the uploaded photo as an expert-level faceted paint-by-numbers color map.

Do not preserve the original photo pixels. Build a new image from many flat polygon-like and organic closed color cells.

The result should be clearly more detailed than Medium, but also clearly non-photographic.

Rules:
- Use exactly {{NUMBER_OF_COLORS}} intended main colors.
- Keep the same main subject, crop, composition, pose, and recognizable scene identity.
- Reconstruct every area as flat closed color cells.
- Use many coherent cells: more than Medium, fewer than noisy pixel fragments.
- Use crisp boundaries between cells.
- Use matte fills only.
- No black outlines, no dark contour lines, no numbers, no labels, no text.

Expert detail behavior:
- Preserve detailed structure by splitting it into paintable regions.
- Preserve important small features only as clean cells.
- Convert texture into grouped shapes.
- Convert highlights and shadows into separate flat cells.
- Convert gradients into stepped color regions.
- Convert reflections into layered cell shapes.

Subject behavior:
- Landscape: divide sky, clouds, water, shore, grass, trees, branches, and reflections into many readable faceted regions.
- Horse or animal: divide body, mane, legs, muscles, tail, and markings into many clean anatomical color cells.
- Bird: divide head, beak, eye area, body, wing, tail, red/black/white markings, feeder, ladder, and foliage into clear cells.
- Flower: divide petals, folds, center, stem, vase, leaves, and background planes into expert-level closed cells. The center may have grouped rings and radial shapes, not seed noise.

Visual style:
- faceted flat color reconstruction
- expert paint-by-numbers preparation image
- high detail color-cell artwork
- deliberate region boundaries
- non-photographic surface
- not Easy
- not Medium
- not cartoon replacement

The final image should look like a detailed paint-by-numbers source before numbering: many visible clean regions, high fidelity, and no raw photographic texture.

Negative prompt:
unchanged photo, lightly filtered photo, photo filter, raw photo pixels, photorealistic image, photographic rendering, realistic lighting, realistic shadows, realistic texture, continuous gradient, lens blur, depth of field, bokeh, glossy reflections, grass blade texture, leaf texture, feather micro-detail, fur hair detail, flower seed noise, bark noise, water ripple noise, grain, sensor noise, speckles, random pixel fragments, unpaintable micro-fragments, black outlines, dark contour lines, coloring book line art, sketch, ink, brush texture, watercolor texture, oil paint texture, generic cartoon, preschool style, decorative symbol, unrelated objects, changed main subject, numbers, labels, text, logos, watermarks

Output constraints:
- Output a normal clean image only, not a numbered template.
- Keep the useful image size within about {{MAX_EDGE}}px on the longest edge.
