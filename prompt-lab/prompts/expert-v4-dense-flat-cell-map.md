Transform the uploaded photo into an expert paint-by-numbers source image.

Make a visibly stylized flat posterized cell map. It must be clearly different from the photo and clearly more detailed than the Medium version.

Core requirement:
- Use exactly {{NUMBER_OF_COLORS}} intended main colors.
- Keep the main subject, crop, composition, and pose recognizable.
- Redraw the image as many closed flat paint regions.
- Use many more regions than Medium, but keep them coherent and paintable.
- Convert all texture and lighting into deliberate color cells.
- Do not preserve raw photographic texture.

Expert visual target:
- dense but organized paint-by-numbers color map
- many medium and small closed regions
- crisp boundaries between color areas
- flat matte color fills
- strong subject fidelity
- richer internal structure than Medium
- no black outlines
- no numbers or labels

Simplify texture into cells:
- grass becomes grouped blades and patches, not photographic grass texture
- foliage becomes clusters and leaf-mass cells, not noisy leaves
- fur and feathers become many clean shape patches, not hair or feather texture
- flower centers become grouped radial/circular cells, not seed noise
- water reflections become structured color cells, not mirror-photo detail
- shadows and highlights become separate flat regions

Avoid:
- unchanged photo
- lightly filtered photo
- realistic texture
- continuous gradients
- noisy micro-detail
- random speckles
- unpaintable fragments
- black outlines or contour lines
- sketch, ink, watercolor, oil paint, or brush texture
- generic cartoon or preschool style
- decorative symbols or unrelated objects

The output should read as an expert-level paint-by-numbers preparation image: more intricate than Medium, visibly posterized, non-photographic, and made of deliberate paintable regions.

Negative prompt:
unchanged photo, lightly filtered photo, photo filter, photorealistic image, photographic rendering, realistic lighting, realistic shadows, raw photo texture, realistic texture, continuous gradients, lens blur, depth of field, bokeh, glossy reflection, grass texture, leaf noise, feather micro-detail, fur hair detail, flower seed noise, bark noise, water ripple noise, grain, sensor noise, speckles, random fragmentation, unpaintable fragments, black outlines, dark contour lines, coloring book line art, sketch, ink drawing, brush texture, watercolor texture, oil paint texture, generic cartoon, preschool drawing, decorative symbol, sparkle, star, unrelated object, changed main subject, numbers, labels, text, logos, watermarks

Output constraints:
- Output a normal clean image only, not a numbered template.
- Keep the useful image size within about {{MAX_EDGE}}px on the longest edge.
