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
Use the uploaded photo as the recognizable source reference.

First, imagine a young child drawing this exact photo from memory: make a child-friendly drawing out of the image while preserving the main composition, subject placement, and scene identity.

Then turn that child-friendly drawing into a very easy paint-by-numbers source image.

The image should look like an unnumbered paint-by-numbers color plate: a simple child-friendly flat illustration made from a few big closed paint regions. It should be clearly transformed from the photo, not a filtered photo, but a viewer should still understand which photo it came from.

Paint-by-numbers priority:
- The final image must read as a color-only paint-by-numbers reference before anything else.
- Every visible form should be made from closed, fillable paint areas with clean color-to-color boundaries.
- Prefer paintable symbolic shapes over ordinary poster art, painterly rendering, or photographic smoothing.
- Make the region structure obvious enough that a later algorithm can trace and number the areas.
- Do not rely on texture, gradients, soft shading, or brush effects to describe the subject.

Preserve:
- the main subject or scene type
- the crop, framing, and composition of the uploaded photo
- the approximate size, pose, placement, and silhouette of the main objects
- the foreground, middle ground, background, and horizon structure where present
- the most important color identity of the subject

Meaning-first free-space rule:
- First identify what makes the image recognizable: the main subject, its silhouette, pose, structural parts, distinctive markings, and the places where it touches or overlaps its surroundings.
- If the photo has one clear main subject surrounded by large simple areas such as sky, ground, road, water, wall, or floor, protect those meaning-carrying subject parts first and simplify the empty areas second.
- Large free-space areas should become simple broad paint regions, but they must not absorb, crop away, or visually swallow the important subject parts.
- Preserve support, contact, attachment, opening, overlap, lower-edge, and shadow-boundary details whenever they explain what the subject is or how it sits in the scene.
- Preserve the count, placement, and readable separation of repeated or paired structural parts when they define the subject's identity, stance, support, movement, or function.

Readable simplification:
- Simplify the photo into child-friendly recognizable symbols and shapes, not abstract color blobs.
- Do not invent a totally new scene, new viewpoint, or unrelated object arrangement.
- Keep the same number of main subjects whenever the photo has one clear subject.
- Keep the subject occupying roughly the same part of the image as in the photo, but redraw it in a friendly simplified style.
- Keep sky/water/ground bands, flower heads, animal bodies, tree groups, and major background blocks in roughly the same relative positions.
- Within those areas, replace photographic masses with easy-to-recognize child-friendly forms.

Simplify strongly:
- redraw the scene as a faithful simple flat illustration
- remove small visual details
- remove realistic texture, lighting, shadows, and reflections
- reduce complex natural areas to simple recognizable shapes
- make every region large enough for a young child to paint

Region rules:
- Use exactly {{NUMBER_OF_COLORS}} intended main colors.
- Merge similar colors strongly.
- Use very few large regions per material or object.
- Do not create lots of small repeated patches.
- Avoid thin slivers, tiny islands, speckles, and detailed patterns.
- Prefer simple bands and blocks over accurate detail.

Subject rules:
- Landscapes: keep sky, water, grass, shore, paths, hills, and tree groups in the same approximate parts of the image. Redraw tree groups as a few clear child-friendly trees or tree silhouettes with simple trunks and rounded/triangular canopies, not just amorphous green facets. Water should be mostly one or two broad areas, with only a few simple reflection shapes.
- Animals: keep pose, head direction, legs, tail, and main markings, but simplify the body into broad color blocks.
- Birds: keep pose, beak, eye area, and main black/white/red or other key markings, but simplify feathers and foliage into broad color blocks.
- Flowers: keep the flower head size, center position, petal ring direction, stem or vase if visible, and overall crop. Simplify petal detail into broad petal groups, but do not turn the flower into a different generic icon.

Style:
- simple faithful paint-by-numbers reference
- unnumbered paint-by-numbers color plate
- simple flat matte colors
- large closed paintable areas
- friendly simplified shapes
- clear separation between neighboring colors
- simplified background that keeps the original layout but remains semantically readable
- no black outlines
- no dark contour lines
- no numbers, labels, or text
- Never draw or place any digit, numeral, number, label, letter, caption, signature, or text-like mark anywhere in the image.
- The output is only the clean colored reference image, never a numbered paint-by-numbers template.
- no photographic texture or shading

The final result should be a child-friendly paint-by-numbers reference for {{TARGET_AUDIENCE}}: simple, recognizable, strongly simplified, easy to paint, and still clearly tied to the uploaded photo.
`.trim(),
    negativePrompt:
      'unchanged photo, photo filter, ordinary poster art, painterly illustration, photorealistic image, realistic rendering, realistic lighting, realistic shadow, soft shading, smooth gradients, lens blur, depth of field, bokeh, glossy reflection, complex reflection detail, texture detail, grass blade detail, leaf detail, feather detail, fur detail, flower seed detail, tiny pattern, grain, noise, tiny speckles, many small regions, many repeated patches, thin slivers, unclosed regions, unpaintable regions, amorphous green blobs, abstract color fields, meaningless facets, main subject absorbed by background, subject lost in empty space, important subject parts merged into background, meaning-carrying details lost, support details lost, contact details lost, lower edges lost, important openings lost, important overlaps lost, missing repeated structural parts, missing paired support parts, black outlines, dark contour lines, coloring book line art, sketch, ink drawing, hatching, brush texture, watercolor texture, oil paint texture, adult illustration, unrelated object, invented scene, changed crop, changed viewpoint, changed main subject, wrong subject placement, any digit, numeral, number, label, letter, caption, signature, text-like mark, numbered template, numbers, labels, text, logos, watermarks',
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

Apply the transformation uniformly to every part of the image:
- main subject
- background
- foliage
- grass
- water
- reflections
- flower centers
- sky and clouds
- small supporting objects

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
- all foliage into clustered leaf-mass cells
- all grass into grouped patch cells
- all reflections into simplified layered cells
- all flower centers into grouped circular/radial cells

Expert difference from Medium:
- Medium has broad simplified regions.
- Expert should have more local structure inside each object and material.
- Expert should preserve more subject-specific detail, but as clean cells, never as raw texture.
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
      'photo enhancement, unchanged photo, lightly filtered photo, photo filter, ordinary poster art, painterly illustration, raw photo pixels, photorealistic image, photographic rendering, realistic lighting, realistic shadows, realistic texture, continuous gradients, soft shading, lens blur, depth of field, bokeh, glossy reflection, grass blade texture, leaf texture, feather micro-detail, fur hair detail, flower seed noise, bark noise, water ripple noise, grain, sensor noise, random speckles, unclosed regions, unpaintable regions, unpaintable micro-fragments, main subject absorbed by background, subject lost in empty space, important subject parts merged into background, meaning-carrying details lost, support details lost, contact details lost, lower edges lost, important openings lost, important overlaps lost, missing repeated structural parts, missing paired support parts, black outlines, dark contour lines, coloring book line art, sketch, ink, brush texture, watercolor texture, oil paint texture, generic cartoon, preschool style, decorative symbol, sparkle, star, unrelated objects, changed main subject, any digit, numeral, number, label, letter, caption, signature, text-like mark, numbered template, numbers, labels, text, logos, watermarks',
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
