Transform the uploaded photo into a medium-difficulty paint-by-numbers source image.

Make a visibly simplified flat posterized illustration. The output must be clearly different from the photo.

Core requirement:
- Redraw the image as clean flat color regions.
- Use exactly {{NUMBER_OF_COLORS}} intended main colors.
- Keep the same main subject, crop, and overall composition.
- Preserve important object identity and pose.
- Do not preserve photographic texture, realistic lighting, or fine detail.

Visual target:
- flat vector-like posterized artwork
- medium-sized closed paint regions
- crisp boundaries between colors
- clear color cells for shadows, highlights, and material changes
- more detailed than Easy, much simpler than a photo
- practical for paint-by-numbers segmentation

Simplify aggressively:
- grass becomes grouped green areas, not individual blades
- leaves and foliage become grouped color masses
- fur and feathers become clean color patches
- flower centers become a few clear shapes, not tiny seeds
- water reflections become broad simplified shapes
- background clutter becomes larger color areas

Avoid:
- unchanged or lightly filtered photo
- realistic texture
- tiny repeated details
- dense micro-regions
- muddy noisy gradients
- black outlines
- dark contour lines
- sketch or coloring-book line art
- numbers, labels, or text
- generic cartoon replacement
- unrelated new objects

The result should look like a clean medium-level paint-by-numbers color reference: recognizably based on the uploaded photo, but made from deliberate flat paintable regions.

Negative prompt:
unchanged photo, lightly filtered photo, photo filter, photorealistic image, camera-realistic rendering, realistic lighting, realistic shadows, photographic texture, natural micro-detail, grass blade detail, leaf detail, feather detail, fur detail, flower seed detail, bark detail, water ripple detail, noisy gradients, grain, noise, speckles, tiny color cells, thin slivers, black outlines, dark contour lines, coloring book line art, sketch, ink drawing, brush strokes, watercolor texture, oil paint texture, generic cartoon, preschool drawing, unrelated objects, changed main subject, numbers, labels, text, logos, watermarks

Output constraints:
- Output a normal clean image only, not a numbered template.
- Keep the useful image size within about {{MAX_EDGE}}px on the longest edge.
