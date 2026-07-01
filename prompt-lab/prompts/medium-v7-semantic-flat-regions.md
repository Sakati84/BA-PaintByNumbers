Transform the uploaded photo into a medium-difficulty paint-by-numbers source image.

Make a visibly stylized flat posterized illustration. The output must be clearly different from the photo and should look intentionally prepared for paint-by-numbers.

Core requirement:
- Redraw the image as clean flat color regions.
- Use exactly {{NUMBER_OF_COLORS}} intended main colors.
- Keep the main subject, crop, and overall composition recognizable.
- Preserve important pose and subject identity.
- Preserve the original color identity and value contrast of the main subject and major scene areas.
- Simplify natural background masses into recognizable stylized objects where appropriate, not only abstract facets.
- Simplify photographic surfaces aggressively.
- Do not add decorative symbols, sparkles, stars, icons, or unrelated new elements.

Visual target:
- stylized flat poster artwork
- medium-sized closed paint regions
- crisp boundaries between colors
- clear color cells for shadows, highlights, and material changes
- more detailed than Easy, much simpler than a photo
- practical for paint-by-numbers segmentation

Color and contrast rules:
- Use clear, lively, source-based colors with stronger contrast, closer to the Expert version's color punch.
- Preserve saturated subject colors and important accent colors instead of muting them.
- Keep sky, foliage, water, petals, fur, feathers, and markings separated by readable value and hue contrast.
- Avoid graywashed, pastel, faded, low-contrast, or desaturated palettes.
- Shadows and highlights should become distinct flat color regions, not muddy middle tones.

Simplify aggressively:
- grass becomes grouped green areas
- leaves and foliage become grouped color masses with simplified cell shapes, plus readable tree silhouettes/canopies/trunks when the source contains obvious trees
- fur and feathers become clean color patches
- flower centers become a few clear shapes, not tiny seeds
- petal shading becomes broad color bands
- water reflections become broad simplified shapes
- background clutter becomes larger color areas

Keep medium detail:
- enough shape information to understand the subject
- visible regional color variation
- important markings on animals and birds
- important petal and subject structure
- recognizable landscape depth
- recognizable simplified tree, shore, mountain, water, flower, animal, or architectural forms when those are important to the scene

Style:
- clean medium-level paint-by-numbers color reference
- visibly posterized image
- deliberate flat paintable regions
- vivid but source-faithful flat colors
- clear contrast between neighboring paint regions
- no black outlines
- no dark contour lines
- no sketch or coloring-book line art
- no numbers, labels, or text
- Never draw or place any digit, numeral, number, label, letter, caption, signature, or text-like mark anywhere in the image.
- The output is only the clean colored reference image, never a numbered paint-by-numbers template.
- no preschool drawing
- no generic cartoon replacement
- no realistic texture
- no tiny repeated details
- no dense micro-regions
- no muddy noisy gradients
- no desaturated gray cast
- no washed-out low-contrast palette

The result should look like a clean medium-level paint-by-numbers color reference for {{TARGET_AUDIENCE}}: recognizably based on the uploaded photo, visibly posterized, made from deliberate flat paintable regions, and noticeably more colorful and contrasted than a muted photo filter.

Negative prompt:
unchanged photo, lightly filtered photo, photo filter, photorealistic image, camera-realistic rendering, realistic lighting, realistic shadows, photographic texture, natural micro-detail, grass blade detail, leaf detail, leaf micro-detail, feather detail, fur detail, flower seed detail, detailed flower center, bark detail, water ripple detail, noisy gradients, grain, noise, speckles, tiny color cells, thin slivers, amorphous green blobs, abstract color fields, meaningless facets, black outlines, dark contour lines, coloring book line art, sketch, ink drawing, brush strokes, watercolor texture, oil paint texture, decorative symbol, sparkle, star, icon, unrelated objects, changed main subject, desaturated colors, graywashed palette, faded palette, pastel wash, low contrast, muddy middle tones, any digit, numeral, number, label, letter, caption, signature, text-like mark, numbered template, numbers, labels, text, logos, watermarks

Output constraints:
- Output a normal clean image only, not a numbered template.
- Never include digits, numerals, numbers, labels, letters, captions, signatures, watermarks, or text-like marks.
- Keep the useful image size within about {{MAX_EDGE}}px on the longest edge.
