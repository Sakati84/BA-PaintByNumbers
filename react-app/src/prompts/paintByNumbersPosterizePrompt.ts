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
    defaultNumberOfColors: 12,
    recommendedColorRange: '8-12',
    defaultTargetAudience: 'a young child around 4 years old',
    positivePromptTemplate: `
Use the uploaded photo as the strict visual reference.

First, analyze the uploaded photo and extract exactly {{NUMBER_OF_COLORS}} dominant main colors from it. The palette must be derived from the broad, important visual areas of the photo, not from tiny details, compression artifacts, sensor noise, reflections, or isolated pixels.

When extracting the palette:
- Prioritize colors from large image regions.
- Merge similar shades into one representative color.
- Ignore insignificant micro-variations.
- Preserve the overall color identity of the original photo.
- Do not invent an unrelated decorative palette.
- If needed, slightly simplify or gently brighten the extracted colors so they work well in a clean child-friendly illustration, while remaining clearly related to the original photo.

Then transform the uploaded photo into an easy, child-friendly flat illustration suitable for {{TARGET_AUDIENCE}}.

Preserve:
- the main composition of the original photo
- the placement of the dominant objects
- the foreground, middle ground, and background structure
- the horizon line and perspective
- the overall scene type and mood
- the most recognizable visual elements

Simplify:
- reduce the image to very large, clear color areas
- merge small details into broad simplified shapes
- use rounded, friendly forms
- remove fine details, textures, tiny branches, small leaves, and visual clutter
- make the image very easy for a young child to understand

Style:
- flat poster-like illustration
- very large simplified shapes
- clean color-block areas
- crisp boundaries between color areas
- no black outlines
- no dark contour lines
- no coloring-book line art
- no thin strokes
- no realistic texture
- no grain, noise, hatching, sketch marks, or painterly effects
- minimal or no gradients
- bright, calm, clear, and friendly mood

Color rules:
- Use exactly {{NUMBER_OF_COLORS}} intended main colors, automatically extracted from the uploaded photo.
- Use those colors as the complete visual color system of the illustration.
- Do not intentionally introduce additional colors.
- Reuse the extracted colors across different objects where needed.
- Separate shapes through clean color-area boundaries, not outlines.

The final result should look like a simplified children's illustration based on the uploaded photo: recognizable in composition, built from very large clean areas, and visually suitable for {{TARGET_AUDIENCE}}.
`.trim(),
    negativePrompt:
      'black outlines, dark outlines, coloring book line art, ink drawing, sketch, thin strokes, photorealism, realistic texture, complex detail, tiny objects, detailed leaves, fine branches, visual clutter, noise, grain, hatching, watercolor texture, oil painting texture, 3D render, excessive shading, strong gradients, too many colors, arbitrary palette, unrelated colors, harsh contrast',
  },
  medium: {
    difficulty: 'medium',
    label: 'Medium / teenager-level structured posterized version',
    defaultNumberOfColors: 16,
    recommendedColorRange: '12-16',
    defaultTargetAudience: 'teenagers',
    positivePromptTemplate: `
Use the uploaded photo as the strict visual reference.

First, analyze the uploaded photo and extract exactly {{NUMBER_OF_COLORS}} dominant main colors from it. The palette must be derived from the major and secondary visual regions of the photo, not from tiny details, compression artifacts, sensor noise, random reflections, or isolated pixels.

When extracting the palette:
- Prioritize colors from large and medium-sized image regions.
- Merge very similar shades into one representative color when appropriate.
- Preserve meaningful color differences when they help describe important forms.
- Preserve the overall natural color identity of the source photo.
- Do not invent an unrelated decorative palette.
- If needed, simplify the extracted colors so they work well in a clean illustrated image, while remaining faithful to the original photo.

Then transform the uploaded photo into a medium-difficulty paint-by-numbers source illustration suitable for {{TARGET_AUDIENCE}}. The result should stay close to the original composition, but it must clearly look like a deliberately simplified flat artwork, not like a filtered or retouched photograph.

Preserve:
- the main composition of the original photo
- the placement of the dominant subjects
- the foreground, middle ground, and background structure
- the horizon line and perspective
- the overall scene type and mood
- the most recognizable visual elements
- the main secondary forms and shape transitions

Simplify:
- reduce photographic complexity into clear posterized color regions
- preserve more internal structure than in an easy version
- keep medium-sized forms, shape changes, and visible area separations
- remove tiny details, micro-textures, visual noise, and insignificant clutter
- simplify textures into readable color areas
- convert shadows, highlights, and material changes into a small number of intentional flat shape cells
- suppress camera-realistic cues such as lens softness, natural micro-detail, glossy reflections, and lifelike lighting
- make the image clearly structured but still approachable

Style:
- clean posterized paint-by-numbers illustration
- flat matte color regions
- medium number of separated color areas
- clear visual segmentation
- crisp boundaries between areas
- hand-composed graphic shapes
- visible color-block construction
- no black outlines
- no dark contour lines
- no coloring-book line art
- no sketch effect
- no realistic texture
- no photorealistic rendering
- no photographic lighting
- no camera-like depth of field
- minimal gradients only if absolutely necessary
- calm, clear, graphic appearance

Color-area behavior:
- break the image into a balanced number of distinct surfaces
- preserve important regional differences in sky, foliage, water, ground, buildings, people, objects, or other visible materials
- represent structure through posterized area segmentation, not through outlines
- avoid both excessive simplification and excessive micro-detail

Color rules:
- Use exactly {{NUMBER_OF_COLORS}} intended main colors, automatically extracted from the uploaded photo.
- Use those colors as the complete visual color system of the illustration.
- Do not intentionally introduce additional colors.
- Reuse the extracted colors where appropriate.
- Distinguish areas through shape and color separation, not through outlines.

The final result should look like a medium-difficulty paint-by-numbers source artwork based on the uploaded photo: clearly recognizable, more detailed than an easy version, visibly made from clean flat color cells, unmistakably non-photographic, and suitable for {{TARGET_AUDIENCE}}.
`.trim(),
    negativePrompt:
      'black outlines, dark outlines, coloring book line art, sketch, ink drawing, photorealism, photographic rendering, camera-realistic image, lifelike lighting, realistic shadows, lens blur, depth of field, bokeh, glossy reflections, tiny details, excessive texture, grain, noise, hatching, watercolor texture, painterly brushwork, 3D render, heavy gradients, too few color regions, oversimplified preschool style, unrelated palette, muddy colors, visual clutter',
  },
  expert: {
    difficulty: 'expert',
    label: 'Expert / high-fidelity 24-color posterized version',
    defaultNumberOfColors: 24,
    recommendedColorRange: '24',
    defaultTargetAudience: 'advanced users or expert-level coloring',
    positivePromptTemplate: `
Use the uploaded photo as the strict visual reference.

First, analyze the uploaded photo and extract exactly {{NUMBER_OF_COLORS}} dominant main colors from it. The palette must be derived from broad, medium, and visually important smaller regions of the source photo, while ignoring insignificant micro-variations, compression artifacts, sensor noise, isolated reflections, and accidental pixel noise.

When extracting the palette:
- Prioritize colors from large, medium, and visually important smaller regions.
- Preserve meaningful color distinctions when they help describe form, light, depth, and structure.
- Merge only near-identical shades.
- Keep the extracted palette clearly faithful to the source photo.
- Do not invent a decorative or unrelated palette.
- Slightly simplify the colors only as much as needed to support a clean posterized rendering.

Then transform the uploaded photo into a high-detail paint-by-numbers source illustration with strong composition and subject fidelity, suitable for {{TARGET_AUDIENCE}}. Keep the original scene highly recognizable, but stylize it into a flat color-area artwork; it must not read as a near-photographic rendering.

Preserve:
- the full main composition of the original photo
- subject placement and spatial relationships
- foreground, middle ground, and background structure
- horizon line, perspective, and depth cues
- the visual identity of the scene
- major and secondary objects
- important shape transitions
- recognizable internal structure in natural, architectural, human-made, or organic elements

Simplify:
- convert photographic detail into many clean posterized color regions
- keep substantially more segmented areas than in easy or medium versions
- preserve meaningful detail through separated flat shapes rather than texture
- remove only insignificant micro-noise and ultra-fine texture
- translate light, shadow, texture, and material variation into discrete matte color cells
- maintain a high level of visual fidelity in composition and shape relationships, while making the surface treatment clearly non-photographic
- avoid preserving detail as realistic texture; preserve it only as clean, paintable shape segmentation

Style:
- high-detail posterized paint-by-numbers illustration
- many clean, separated color fields
- flat matte fills
- crisp boundaries between color regions
- strong shape readability
- hand-composed graphic segmentation
- visible color-block construction
- no black outlines
- no dark contour lines
- no coloring-book line art
- no sketch effect
- no painterly texture
- no visible brushstrokes
- no photorealistic rendering
- no photographic lighting
- no lens effects
- minimal or no gradients
- clear, refined, graphic poster-like appearance

Color-area behavior:
- break the image into many distinct but coherent surfaces
- preserve visible regional variation in sky, foliage, ground, water, buildings, people, objects, shadows, highlights, and other major materials through separated color planes
- represent detail through posterized area segmentation, not through lines
- increase the number of visually distinct fill regions while remaining controlled and readable
- avoid noisy fragmentation and meaningless speckling

Color rules:
- Use exactly {{NUMBER_OF_COLORS}} intended main colors, automatically extracted from the uploaded photo.
- Use only those colors as the complete visual color system of the illustration.
- Do not intentionally introduce additional colors.
- Reuse the extracted palette intelligently across the whole image.
- Preserve as much of the source image's color identity as possible within the {{NUMBER_OF_COLORS}}-color limit.

The final result should look like a highly faithful, expert-level paint-by-numbers source artwork based on the uploaded photo: compositionally accurate, richly segmented into many clean flat color regions, visually refined, clearly more detailed than a medium version, and unmistakably non-photographic.
`.trim(),
    negativePrompt:
      'black outlines, dark contour lines, sketch, ink drawing, coloring book line art, painterly brush strokes, watercolor texture, oil paint texture, photorealism, photographic rendering, camera-realistic image, lifelike lighting, realistic shadows, lens blur, depth of field, bokeh, glossy reflections, photorealistic texture, skin pores, fabric weave, noisy gradients, grain, blur, muddy colors, oversimplified shapes, too few color regions, childish simplification, unrelated palette, excessive micro-noise, meaningless speckling',
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
    `- Keep the useful image size within about ${input.maxEdge}px on the longest edge.`,
  ].join('\n');
}
