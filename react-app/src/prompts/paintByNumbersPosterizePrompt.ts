export type PosterizePromptInput = {
  colorCount: number;
  complexityLabel: string;
  maxEdge: number;
};

export function buildPaintByNumbersPosterizePrompt(input: PosterizePromptInput): string {
  return `
Convert the attached image into a strict paint-by-numbers style illustration.

Preserve the original composition, proportions, layout, and main silhouettes of the source image. Keep the image clearly recognizable, but simplify it into a posterized ${input.complexityLabel.toLowerCase()} interpretation.

Create a simplified, posterized paint-by-numbers image using medium-to-large closed color regions. Group similar tones together, reduce small details, and replace realistic shading with discrete, layered tonal zones. Favor large readable shapes over fine detail.

Palette requirement:
- Use exactly ${input.colorCount} flat colors in the final image.
- Use one limited palette only.
- Separate neighboring tones into clearly defined regions instead of blending them.

Critical flat-color requirement:
- Render the image as if it were a vector segmentation map for a paint-by-numbers kit.
- Every enclosed shape must be a solid flat-color cell with exactly one uniform RGB color value.
- Inside each color region, there must be no gradient, no texture, no brush grain, no mottling, no noise, no feathering, no transparency, no anti-aliased color drift, and no internal variation of any kind.
- One region = one perfectly uniform color.

Boundary requirement:
- Boundaries between regions should be clean, crisp, and clearly readable.
- Boundaries may remain slightly organic in contour so the result does not feel mechanically rigid.

Visual style:
- Flat acrylic / gouache-inspired paint-by-numbers aesthetic.
- Matte finish.
- Simplified forms.
- Low detail.
- Clean posterized shape design.
- Decorative wall-art quality.
- The result should feel hand-composed in design, but technically flat-filled like vector art.

Important constraints:
- Do not add numbers.
- Do not add labels.
- Do not add text.
- Do not add logos or watermarks.
- Do not add outlines everywhere unless needed for shape separation.
- Do not use gradients.
- Do not use painterly texture.
- Do not use visible brush strokes inside regions.
- Do not use realistic lighting or photorealistic shading.
- Do not create tiny speckled patches or micro-fragments.
- Do not blend colors.
- Do not change the original composition.

Output constraint:
- Output a normal clean image only, not a numbered template.
- Keep the useful image size within about ${input.maxEdge}px on the longest edge.

Final goal:
A clean, highly readable paint-by-numbers illustration where every distinct color area is a single solid uniform color region, with clearly separated shapes and no internal color variation.
`.trim();
}
