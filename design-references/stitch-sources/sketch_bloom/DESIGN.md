---
name: Sketch & Bloom
colors:
  surface: '#f4fafd'
  surface-dim: '#d4dbdd'
  surface-bright: '#f4fafd'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eef5f7'
  surface-container: '#e8eff1'
  surface-container-high: '#e2e9ec'
  surface-container-highest: '#dde4e6'
  on-surface: '#161d1f'
  on-surface-variant: '#404945'
  inverse-surface: '#2b3234'
  inverse-on-surface: '#ebf2f4'
  outline: '#707974'
  outline-variant: '#bfc9c3'
  surface-tint: '#296956'
  primary: '#296956'
  on-primary: '#ffffff'
  primary-container: '#a7e8d0'
  on-primary-container: '#2a6a57'
  inverse-primary: '#93d3bc'
  secondary: '#386380'
  on-secondary: '#ffffff'
  secondary-container: '#b1dcff'
  on-secondary-container: '#36627f'
  tertiary: '#675f32'
  on-tertiary: '#ffffff'
  tertiary-container: '#e7dba4'
  on-tertiary-container: '#686033'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#aff0d8'
  primary-fixed-dim: '#93d3bc'
  on-primary-fixed: '#002118'
  on-primary-fixed-variant: '#06513f'
  secondary-fixed: '#c9e6ff'
  secondary-fixed-dim: '#a1cced'
  on-secondary-fixed: '#001e2f'
  on-secondary-fixed-variant: '#1c4b67'
  tertiary-fixed: '#efe3ab'
  tertiary-fixed-dim: '#d2c791'
  on-tertiary-fixed: '#201c00'
  on-tertiary-fixed-variant: '#4e471d'
  background: '#f4fafd'
  on-background: '#161d1f'
  surface-variant: '#dde4e6'
typography:
  headline-lg:
    fontFamily: Spline Sans
    fontSize: 40px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Spline Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '500'
    lineHeight: '1.6'
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-bold:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 24px
  lg: 48px
  xl: 64px
  canvas-margin: 32px
---

## Brand & Style

This design system is built on the philosophy of the "Living Canvas." It targets a diverse demographic—from children developing motor skills to adults seeking a meditative creative outlet. The personality is inherently encouraging, playful, and low-pressure.

The visual style is a hybrid of **Minimalism** and **Tactile** design. By keeping the interface unobtrusive with vast amounts of "paper-white" space, the user's artwork remains the focal point. Tactile elements, such as buttons that appear physically pressable, bridge the gap between digital interaction and the sensory experience of physical art supplies. The emotional goal is to evoke the feeling of opening a fresh, high-quality sketchbook: organized, clean, and full of potential.

## Colors

The palette utilizes "Art-Supply Pastels" to maintain a creative atmosphere without overstimulating the user. 

- **Primary (Mint Green):** Used for "Action" states, such as 'Start Coloring' or 'Confirm.' It represents growth and creative energy.
- **Secondary (Soft Blue):** Used for navigation and utility elements. It evokes calm and focus.
- **Tertiary (Pale Yellow):** Reserved for highlights, rewards, and "Magic" generation features.
- **Canvas White (#F9FBFB):** A slightly cool, off-white background that reduces eye strain compared to pure white while mimicking premium paper.
- **Ink Black (#2D3436):** Used for all typography and iconography to ensure a high-contrast, accessible reading experience against the pastel and canvas backgrounds.

## Typography

Typography in this design system prioritizes legibility and a friendly, geometric cadence. **Spline Sans** is used for headlines to provide a youthful, dynamic energy with its slightly wider apertures. **Plus Jakarta Sans** handles all functional and body text, offering a soft, rounded aesthetic that complements the overall shape language.

High contrast is maintained by using heavy weights (700+) for headlines and primary labels, ensuring that users with visual impairments can easily navigate the interface. All text should be rendered in "Ink Black" to maintain a crisp, sketched appearance.

## Layout & Spacing

The layout follows a **Fixed Grid** philosophy for menus and galleries to provide a sense of order, while the coloring interface itself utilizes a **Safe Area** model to maximize the digital canvas.

A 12-column grid is used for the home and library screens with generous 24px gutters. The "Canvas View" employs a 32px outer margin, creating a frame effect that makes the UI feel like a physical sketchbook resting on a table. Spacing follows an 8px rhythmic scale to ensure consistent vertical harmony between tactile components.

## Elevation & Depth

Depth is conveyed through **Tonal Layers** and **Ambient Shadows** rather than traditional drop shadows. Surfaces do not "float" high above each other; instead, they feel layered like sheets of paper or stickers.

- **Level 0 (Canvas):** The base background, flat and non-interactive.
- **Level 1 (Cards/Sheets):** Subtle 1px borders in a darker tint of the background color to define boundaries without adding visual weight.
- **Level 2 (Tactile Buttons):** These use a "Soft-Press" effect—a 4px bottom-offset shadow in a saturated version of the button's color (e.g., a dark mint shadow for a mint button). This creates a chunky, physical look.
- **Active State:** When pressed, buttons lose their bottom shadow and shift 2px downward, mimicking a physical click.

## Shapes

The shape language is defined by "Squircle" geometry. Hard corners are strictly avoided to maintain the friendly and safe personality of the app.

- **Standard Components:** Use a 0.5rem (8px) radius for a soft, approachable look.
- **Large Tactile Buttons:** Use 1.5rem (24px) or full pill-shapes to invite touch and emphasize their "interactive toy" nature.
- **Progress Bars:** Fully rounded (pill) containers with a secondary pill shape inside for the fill.
- **Input Fields:** Generously rounded corners (1rem) to differentiate them from static cards.

## Components

### Buttons
Buttons are the primary tactile element. They must be "chunky" with a minimum height of 56px for easy tapping. They feature a thick bottom border (offset shadow) that disappears on press. Labels are always centered and bold.

### Progress Indicators
For the "Generation Flow," use a "Crayon-Trace" bar. The bar fills with a textured pastel color, and the leading edge of the progress is marked by a small pencil or brush icon that "draws" the line as it moves.

### Chips & Tags
Used for categories (e.g., "Animals," "Mandala"). These should be pill-shaped with a light pastel fill and a 2px stroke of the same color in a darker shade.

### Tool Selection (The Palette)
The drawing tools should be represented as vertical icons at the bottom or side of the screen, styled to look like actual pens or brushes. The active tool is elevated slightly and gains a "glow" in its specific pastel color.

### Selection Cards
Cards in the gallery have a 1px soft-gray border and no shadow. When a user hovers or selects a card, it gains a thick, colored border (Mint or Blue) to indicate focus clearly.