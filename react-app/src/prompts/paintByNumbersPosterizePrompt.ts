export type PromptDifficulty = 'easy' | 'medium' | 'expert';

export type PromptComplexityPreset = 'simple' | 'medium' | 'detailed';

export type PosterizePromptInput = {
  colorCount: number;
  complexityPreset: PromptComplexityPreset;
  maxEdge: number;
};

export type PromptVariantConfig = {
  difficulty: PromptDifficulty;
  label: string;
  defaultNumberOfColors: number;
  recommendedColorRange: string;
  defaultTargetAudience: string;
  positivePromptTemplate: string;
  negativePrompt: string;
};

export type PromptBuildOptions = {
  numberOfColors?: number;
  targetAudience?: string;
};

export type BuiltPrompt = {
  difficulty: PromptDifficulty;
  label: string;
  numberOfColors: number;
  targetAudience: string;
  positivePrompt: string;
  negativePrompt: string;
  recommendedColorRange: string;
};

export const PROMPT_PLACEHOLDERS = {
  NUMBER_OF_COLORS: '{{NUMBER_OF_COLORS}}',
  TARGET_AUDIENCE: '{{TARGET_AUDIENCE}}',
} as const;

const PHOTO_TO_POSTERIZED_PROMPTS: Record<PromptDifficulty, PromptVariantConfig> = {
  easy: {
    difficulty: 'easy',
    label: 'Easy / preschool-friendly large-area version',
    defaultNumberOfColors: 8,
    recommendedColorRange: '8',
    defaultTargetAudience: 'a young child around 4 years old',
    positivePromptTemplate: `
Reimagine the uploaded photo as a bold, cheerful picture-book scene made by an excellent children's illustrator, then design it from the beginning as a very easy unnumbered paint-by-numbers color plate for {{TARGET_AUDIENCE}}.

Use exactly {{NUMBER_OF_COLORS}} intended main colors.

Treat the photo as a scene brief, not as a map of lines to reproduce.

Semantic scene anchors:
- First understand what the scene is about: the main subject or subjects, their recognizable identity, rough pose or direction, approximate scale and placement, the broad foreground/middle-ground/background order, the dominant viewing direction, and the few contacts or overlaps needed to understand the scene.
- Preserve those semantic anchors and the same broad visual story so the source remains recognizable at a glance.
- A semantic anchor preserves an element's role and rough location, never its exact internal construction or repeated photographic parts.
- Keep the same clearly focal main subject and the same number of clearly focal main subjects. Do not treat every photographed object as a main subject, and do not invent a different event or viewpoint.
- If the photo has no single focal subject, preserve only the scene category, dominant viewing direction, broad depth order, and three to five large visual anchors. Freely reduce, replace, regroup, or reposition the remaining secondary structures.
- Preserve identity-critical markings, visible eyes and facial landmarks, and repeated or paired structural parts when they explain identity, stance, support, movement, or function.

Child-friendly reinterpretation:
- Preserve the scene, but not the exact drawing made by the camera.
- Deliberately redesign contours, irregular silhouettes, secondary object shapes, internal boundaries, spacing, repeated structures, object counts inside complex groups, and incidental perspective lines.
- Replace visually dense or continuous masses with a small number of distinct, familiar, child-friendly scene forms that naturally belong in that kind of environment.
- Those redesigned forms may differ clearly in contour, count, spacing, and placement from the photographic pattern as long as the broad composition remains related.
- Choose fewer representative scene objects than the photo whenever that produces a clearer child-friendly story. Secondary objects do not need one-to-one correspondence with the source.
- Use a coherent picture-book shape language: broad curves, simple geometric silhouettes, friendly exaggeration, charming proportions, clear separation, and lively rhythmic spacing with generous breathing room.
- Simplify depth and perspective when that makes the scene friendlier and easier for a child to understand.
- A child should be able to name the main subject and the important surrounding forms. Do not replace meaningful forms with anonymous color blobs.

Playful art direction:
- Make the redesign visibly more playful and imaginative than a careful simplified reconstruction.
- Gently exaggerate one or two defining shapes of the focal subject and the most important surrounding forms so they feel iconic, friendly, and memorable.
- Favor rounded, bouncy, slightly whimsical silhouettes and pleasing asymmetry over stiff photographic proportions.
- Use bright, optimistic, source-related color relationships while staying inside the {{NUMBER_OF_COLORS}}-color plan. Keep colors flat and avoid neon or random recoloring.
- The scene should feel like a charming page from a modern children's picture book, not a sober diagram, generic clip art, or a mechanically simplified photo.

Meaning-first safeguards:
- Protect meaning-carrying subject parts before simplifying large surrounding areas.
- Broad free-space regions may be redesigned and strongly simplified, but they must not absorb, crop away, or visually swallow important subject parts.
- Keep only the support, contact, attachment, opening, overlap, and lower-edge relationships needed to understand what the subject is and how it sits in the scene.
- Preserve whether each visible animal or bird eye is open or closed in the source. An open source eye must remain one small, proportionate, compact filled oval or circle in the darkest suitable color already present in the {{NUMBER_OF_COLORS}}-color palette, clearly separated from the surrounding face region. Never replace an open eye with a curved eyelid or smiling eye line, omit it, merge it into the face, enlarge it into an oversized cartoon eye, or introduce an extra color for it.

Paintability-first construction:
- The final image must read as a color-only paint-by-numbers reference before anything else.
- Plan the whole scene as roughly 20 to 35 large color shapes before adding the allowed eye landmarks. This is a simplicity target, not a request for many subdivisions.
- Design every visible form as a closed, fillable, generously sized paint region with a crisp color-to-color boundary.
- Build a focal main subject from only a few large shapes. Build each secondary object from one or two large shapes whenever possible.
- Use very few large regions per object or material and strongly merge similar colors.
- Reuse palette colors intentionally across foreground and background and never exceed the {{NUMBER_OF_COLORS}}-color plan.
- Prefer bold symbolic forms and broad uncluttered areas over accurate photographic detail.
- Before drawing any repeated detail outside the focal subject, classify what the repetition means.
- If the members are meaningful standalone scene objects, replace the whole photographed group with only two to five large iconic representative objects. Freely change their contours, spacing, and count.
- If the members merely construct, cover, decorate, or texture one larger object or surface, draw only that larger object or surface as one smooth solid shape with no visible member units or pattern. Its silhouette and role are enough.
- This semantic group simplification is mandatory and more important than source fidelity, even when the repeated area is prominent or is a visual anchor. Losing its internal photographic detail is the intended Easy result.
- Never count, trace, tile, outline, or imply individual repetition units that belong to a larger object or surface.
- Give a secondary object no more than one internal color boundary unless another boundary is essential for recognizing what it is.
- Remove photographic texture, natural micro-detail, gradients, realistic lighting, shadows, reflections, thin linework, and brush effects.
- If a narrow structural part is essential for recognition, widen it into a clearly paintable band; otherwise omit it.
- Avoid repeated surface patterns, tiny decorative cells, hairline subdetails or strokes, narrow slivers, islands, speckles, dense clusters, and contour strokes in any color.
- Make every normal region large enough for a young child to paint. A visible eye is the only allowed small landmark exception.

Controlled friendly enrichment:
- Prefer adding one simple, scene-compatible friendly secondary element when it naturally makes the story more inviting. Omit it only when it would distract from or distort the scene.
- The optional element must be clearly secondary, large enough to paint, made only from existing palette colors, and natural for the scene.
- Do not add arbitrary fantasy content, multiple decorations, or clutter.

Final quality test:
- The result tells the same broad visual story and keeps the essential composition anchors.
- The contours and scene construction are visibly newly illustrated rather than traced or mechanically posterized.
- Complex backgrounds contain a few recognizable child-friendly forms instead of one anonymous mass or many copied details.
- The image feels bold, warm, playful, visually inviting, easy to paint, and appropriate for a young child.

Style constraints:
- bold charming children's picture-book illustration
- unnumbered paint-by-numbers color plate
- flat matte colors and large closed paint regions
- crisp color boundaries without outlines
- no black outlines or dark contour drawing
- no numbers, letters, labels, captions, signatures, logos, watermarks, or text-like marks
- The output is only the clean colored reference image, never a numbered paint-by-numbers template.
`.trim(),
    negativePrompt:
      'exact photo tracing, copied contours, copied irregular silhouettes, copied photographic edge paths, copied secondary geometry, literal line-for-line reconstruction, literal object count, unchanged photo, photo filter, mechanical posterization, ordinary poster art, painterly illustration, photorealism, realistic rendering, realistic lighting, realistic shadow, soft shading, smooth gradients, lens blur, depth of field, bokeh, glossy reflection, photographic texture, natural micro-detail, repeated surface detail, individual repeated units, tiled units, implied repeated units, dense background pattern, hairline subdetail, narrow strokes, tiny pattern, grain, noise, tiny speckles, many small regions, repeated patches, thin slivers, tiny islands, unclosed regions, unpaintable regions, anonymous background wall, amorphous background blob, abstract color field instead of recognizable forms, meaningless facets, main subject absorbed by background, subject lost in empty space, important subject parts merged into background, meaning-carrying details lost, missing eye, omitted eye, open eye replaced by closed eyelid, smiling eyelid, curved eye line instead of open eye, eye merged into face, eye merged into fur, eye merged into feathers, oversized cartoon eye, faceless animal, faceless bird, support details lost, contact details lost, important openings lost, important overlaps lost, missing repeated structural parts, missing paired support parts, black outlines, dark contour lines, colored contour lines, outlined shapes, coloring book line art, sketch, ink drawing, hatching, brush texture, watercolor texture, oil paint texture, stiff adult illustration, sober diagram, timid stylization, overly restrained realism, generic clip art, multiple decorative additions, arbitrary decoration, clutter, unrelated object, unrelated fantasy scene, invented main event, changed viewpoint, changed main subject, lost scene identity, neon recoloring, random recoloring, any digit, numeral, number, label, letter, caption, signature, text-like mark, numbered template, numbers, labels, text, logos, watermarks',
  },
  medium: {
    difficulty: 'medium',
    label: 'Medium / teenager-level structured posterized version',
    defaultNumberOfColors: 12,
    recommendedColorRange: '12',
    defaultTargetAudience: 'teenagers',
    positivePromptTemplate: `
Transform the uploaded photo into a medium-difficulty paint-by-numbers source image.

Make a visibly stylized flat paint-by-numbers color plate. The output must be clearly different from the photo and should look intentionally prepared for tracing, numbering, and coloring.

Paint-by-numbers priority:
- The final image must read as an unnumbered paint-by-numbers color reference, not as ordinary poster art.
- Every important object and background area should be rebuilt as closed, fillable paint cells.
- Use crisp color-to-color boundaries so the later local generator can trace practical regions.
- Favor deliberate paint regions over aesthetic painterly surfaces, gradients, or texture.
- Each shadow, highlight, marking, and material change should become a bounded flat color cell or a small group of cells.

Core requirement:
- Redraw the image as clean flat color regions.
- Use exactly {{NUMBER_OF_COLORS}} intended main colors.
- Keep the main subject, crop, and overall composition recognizable.
- Preserve important pose and subject identity.
- Preserve the original color identity and value contrast of the main subject and major scene areas.
- Simplify natural background masses into recognizable stylized objects where appropriate, not only abstract facets.
- Simplify photographic surfaces aggressively.
- Do not add decorative symbols, sparkles, stars, icons, or unrelated new elements.

Meaning-first free-space rule:
- First identify what makes the image recognizable: the main subject, its silhouette, pose, structural parts, distinctive markings, and the places where it touches or overlaps its surroundings.
- If there is one clear main subject and large simple space around it, preserve the meaning-carrying subject parts, scale, placement, and contact/support structure before simplifying sky, ground, road, water, wall, or floor.
- Large free-space areas should become broad calm paint cells, but they must not absorb or erase important subject edges.
- Keep important support, contact, attachment, opening, and overlap details as separate bounded paint cells whenever they are needed to understand the subject.
- Preserve the count, placement, and readable separation of repeated or paired structural parts when they define the subject's identity, stance, support, movement, or function.

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
- unnumbered paint-by-numbers color plate
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
`.trim(),
    negativePrompt:
      'unchanged photo, lightly filtered photo, photo filter, ordinary poster art, painterly illustration, photorealistic image, camera-realistic rendering, realistic lighting, realistic shadows, photographic texture, natural micro-detail, soft shading, smooth gradients, grass blade detail, leaf detail, leaf micro-detail, feather detail, fur detail, flower seed detail, detailed flower center, bark detail, water ripple detail, noisy gradients, grain, noise, speckles, tiny color cells, thin slivers, unclosed regions, unpaintable regions, amorphous green blobs, abstract color fields, meaningless facets, main subject absorbed by background, subject lost in empty space, important subject parts merged into background, meaning-carrying details lost, support details lost, contact details lost, lower edges lost, important openings lost, important overlaps lost, missing repeated structural parts, missing paired support parts, black outlines, dark contour lines, coloring book line art, sketch, ink drawing, brush strokes, watercolor texture, oil paint texture, decorative symbol, sparkle, star, icon, unrelated objects, changed main subject, desaturated colors, graywashed palette, faded palette, pastel wash, low contrast, muddy middle tones, any digit, numeral, number, label, letter, caption, signature, text-like mark, numbered template, numbers, labels, text, logos, watermarks',
  },
  expert: {
    difficulty: 'expert',
    label: 'Expert / high-fidelity 24-color posterized version',
    defaultNumberOfColors: 24,
    recommendedColorRange: '24',
    defaultTargetAudience: 'advanced users or expert-level coloring',
    positivePromptTemplate: `
Create an expert-level paint-by-numbers source illustration from the uploaded photo.

This is not photo enhancement and not a photo filter. Rebuild the whole image as an unnumbered expert paint-by-numbers color plate made from closed solid-color paint regions.

The output should feel like the colored reference sheet used before numbers and outlines are added, not like ordinary poster art or a stylized photo.

Paint-by-numbers priority:
- Every major and secondary form must be represented as traceable, closed, fillable paint cells.
- Make boundaries between neighboring cells crisp through color changes, not black outlines.
- Convert detail into controlled cell structure instead of leaving texture, gradients, or photographic surfaces.
- Preserve expert-level subject detail only when it remains practical as bounded paint regions.
- Make the region structure obvious enough that a later algorithm can trace and number the areas.

Apply a balanced expert-level detail hierarchy across the whole scene:
- Keep substantial, clearly visible region structure in the main subject, foreground, middle ground, and background. The main subject may receive the highest region density, but the surrounding scene must still look richly structured and unmistakably more detailed than Medium.
- Put the highest region density into the main subject, identity-defining parts, important foreground structures, and the boundaries needed to understand pose, attachment, overlap, or function.
- Preserve distinct facial and identity landmarks such as eyes, mouth or proboscis, muzzle, head boundary, antennae, horns, beak, and characteristic markings as clearly separated paintable cells.
- Preserve a readable selection of meaningful structural units in important constructed foreground objects, such as the individual large stones that make a fieldstone wall recognizable. They may be grouped, but the object must not collapse into a single anonymous slab.
- Simplify homogeneous, repetitive, low-importance background microtexture only moderately. Grass behind or beneath a subject, distant bushes, dense foliage behind a bird, soil texture, and similar areas may use somewhat larger grouped cells than the focal subject, but they must retain several representative color changes, depth layers, silhouette breaks, and internal shape groups.
- Do not reproduce every blade of grass, leaf, twig, pebble, or tiny repeated variation. Preserve enough grouped variation that bushes, foliage, grass, terrain, and other substantial background areas never collapse into only one or two broad flat shapes.
- Background simplification must never absorb the silhouette, head, face, mouth, limbs, or other meaning-carrying parts of the main subject.

Required output:
- exactly {{NUMBER_OF_COLORS}} intended main colors
- many closed paintable regions
- more detail and more regions than Medium
- visibly non-photographic surfaces
- crisp cell boundaries
- flat matte fills
- no black outlines
- no numbers, labels, or text
- Never draw or place any digit, numeral, number, label, letter, caption, signature, or text-like mark anywhere in the image.
- The output is only the clean colored reference image, never a numbered paint-by-numbers template.

Preserve:
- main composition and crop
- main subject identity
- object placement and pose
- recognizable color relationships
- important markings and structural detail
- readable separation of the head and face from the background
- small but identity-critical mouth, muzzle, proboscis, eye, antenna, horn, beak, and attachment regions when visible

Meaning-first free-space rule:
- First identify what makes the image recognizable: the main subject, its silhouette, pose, structural parts, distinctive markings, and the places where it touches or overlaps its surroundings.
- If the photo contains a clear main subject with lots of simple surrounding sky, ground, road, water, wall, or floor, preserve the meaning-carrying subject parts, scale, placement, and support/contact structure before simplifying the surrounding free space.
- Empty or low-detail areas should be calm, broad paint cells, but they must not consume subject edges, lower contours, important internal parts, or the subject's relationship to the scene.
- Keep support, contact, attachment, opening, overlap, and lower-edge details as distinct closed paint cells whenever they are needed to understand the subject.
- If an important part is dark and touches a dark surrounding area, separate it with clear value or hue changes using the allowed palette instead of letting it disappear.
- Preserve the count, placement, and readable separation of repeated or paired structural parts when they define the subject's identity, stance, support, movement, or function.

Convert:
- all photographic texture into grouped color cells
- all gradients into stepped color regions
- all shadows and highlights into separate flat shapes
- distant or homogeneous foliage and bushes into multiple clustered masses with representative internal color cells, depth layers, and silhouette variation
- homogeneous grass into multiple grouped patch cells that preserve visible color and depth variation without individual blades or dense micro-segmentation
- all reflections into simplified layered cells
- all flower centers into grouped circular/radial cells

Expert difference from Medium:
- Medium has broad simplified regions.
- Expert should have more local structure throughout the focal subject, meaningful foreground structures, and substantial background forms, with the highest density reserved for the focal subject.
- Expert should preserve more subject-specific detail, but as clean cells, never as raw texture.
- Expert may moderately consolidate semantically unimportant homogeneous grass, bushes, foliage, soil, and other background filler, but it must remain clearly more varied and detailed than Medium and must not become a minimal one- or two-shape backdrop.
- Do not leave any area looking like the original photograph.
- The landscape, flower, bird background, and grass must also be visibly posterized.

Style:
- detailed flat posterized illustration
- unnumbered expert paint-by-numbers color plate
- many closed paintable regions
- visibly non-photographic surfaces
- crisp cell boundaries
- flat matte color fills
- no black outlines
- no dark contour lines
- no numbers, labels, or text
- no digits, numerals, labels, letters, captions, signatures, or text-like marks

The final result should be an expert-level paint-by-numbers reference for {{TARGET_AUDIENCE}}: more detailed than Medium, uniformly transformed, visibly posterized, and made from clean paintable cells.
`.trim(),
    negativePrompt:
      'photo enhancement, unchanged photo, lightly filtered photo, photo filter, ordinary poster art, painterly illustration, raw photo pixels, photorealistic image, photographic rendering, realistic lighting, realistic shadows, realistic texture, continuous gradients, soft shading, lens blur, depth of field, bokeh, glossy reflection, grass blade texture, leaf texture, microscopic leaf-by-leaf segmentation, every tiny background variation treated as equally important, feather micro-detail, fur hair detail, flower seed noise, bark noise, water ripple noise, grain, sensor noise, random speckles, unclosed regions, unpaintable regions, unpaintable micro-fragments, oversimplified background, background collapsed into one or two shapes, bush collapsed into one or two flat shapes, foliage collapsed into one or two flat shapes, grass collapsed into one or two flat shapes, missing background depth, missing representative background variation, main subject absorbed by background, subject lost in empty space, head merged into background, face merged into background, mouth merged into ground, missing mouth, missing muzzle, missing proboscis, important subject parts merged into background, meaning-carrying details lost, support details lost, contact details lost, lower edges lost, important openings lost, important overlaps lost, fieldstone wall collapsed into one slab, all large fieldstones merged away, missing repeated structural parts, missing paired support parts, black outlines, dark contour lines, coloring book line art, sketch, ink, brush texture, watercolor texture, oil paint texture, generic cartoon, preschool style, decorative symbol, sparkle, star, unrelated objects, changed main subject, any digit, numeral, number, label, letter, caption, signature, text-like mark, numbered template, numbers, labels, text, logos, watermarks',
  },
};

function renderTemplate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((output, [key, value]) => {
    return output.split(`{{${key}}}`).join(String(value));
  }, template);
}

function difficultyForComplexityPreset(preset: PromptComplexityPreset): PromptDifficulty {
  if (preset === 'simple') {
    return 'easy';
  }

  if (preset === 'detailed') {
    return 'expert';
  }

  return 'medium';
}

export function buildPhotoToPosterizedPrompt(
  difficulty: PromptDifficulty,
  options: PromptBuildOptions = {},
): BuiltPrompt {
  const config = PHOTO_TO_POSTERIZED_PROMPTS[difficulty];
  const numberOfColors = options.numberOfColors ?? config.defaultNumberOfColors;
  const targetAudience = options.targetAudience ?? config.defaultTargetAudience;

  return {
    difficulty,
    label: config.label,
    numberOfColors,
    targetAudience,
    recommendedColorRange: config.recommendedColorRange,
    positivePrompt: renderTemplate(config.positivePromptTemplate, {
      NUMBER_OF_COLORS: numberOfColors,
      TARGET_AUDIENCE: targetAudience,
    }),
    negativePrompt: config.negativePrompt,
  };
}

export function buildAllPhotoToPosterizedPrompts(
  optionsByDifficulty: Partial<Record<PromptDifficulty, PromptBuildOptions>> = {},
): Record<PromptDifficulty, BuiltPrompt> {
  return {
    easy: buildPhotoToPosterizedPrompt('easy', optionsByDifficulty.easy),
    medium: buildPhotoToPosterizedPrompt('medium', optionsByDifficulty.medium),
    expert: buildPhotoToPosterizedPrompt('expert', optionsByDifficulty.expert),
  };
}

export function buildPaintByNumbersPosterizePrompt(input: PosterizePromptInput): string {
  const builtPrompt = buildPhotoToPosterizedPrompt(difficultyForComplexityPreset(input.complexityPreset), {
    numberOfColors: input.colorCount,
  });

  return [
    builtPrompt.positivePrompt,
    '',
    'Negative prompt:',
    builtPrompt.negativePrompt,
    'numbers, labels, text, logos, watermarks',
    '',
    'Output constraints:',
    '- Output a normal clean image only, not a numbered template.',
    '- Treat the output as an unnumbered paint-by-numbers color plate with closed, fillable paint regions.',
    '- Prioritize traceable paint-cell structure over ordinary posterization, painterly style, or photographic smoothing.',
    '- Never include digits, numerals, numbers, labels, letters, captions, signatures, watermarks, or text-like marks.',
    `- Keep the useful image size within about ${input.maxEdge}px on the longest edge.`,
  ].join('\n');
}
