---
name: Happy Lines Brand
colors:
  surface: '#f8faf9'
  surface-dim: '#d8dada'
  surface-bright: '#f8faf9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f3'
  surface-container: '#eceeed'
  surface-container-high: '#e6e9e8'
  surface-container-highest: '#e1e3e2'
  on-surface: '#191c1c'
  on-surface-variant: '#3f4943'
  inverse-surface: '#2e3131'
  inverse-on-surface: '#eff1f0'
  outline: '#6f7a73'
  outline-variant: '#bec9c1'
  surface-tint: '#156b4d'
  primary: '#066446'
  on-primary: '#ffffff'
  primary-container: '#2d7d5d'
  on-primary-container: '#d0ffe5'
  inverse-primary: '#88d6b1'
  secondary: '#006685'
  on-secondary: '#ffffff'
  secondary-container: '#8bd9fd'
  on-secondary-container: '#005f7c'
  tertiary: '#705d00'
  on-tertiary: '#ffffff'
  tertiary-container: '#caa900'
  on-tertiary-container: '#4c3e00'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#a3f3cc'
  primary-fixed-dim: '#88d6b1'
  on-primary-fixed: '#002114'
  on-primary-fixed-variant: '#005138'
  secondary-fixed: '#bee9ff'
  secondary-fixed-dim: '#82d0f4'
  on-secondary-fixed: '#001f2a'
  on-secondary-fixed-variant: '#004d65'
  tertiary-fixed: '#ffe173'
  tertiary-fixed-dim: '#e8c426'
  on-tertiary-fixed: '#221b00'
  on-tertiary-fixed-variant: '#554500'
  background: '#f8faf9'
  on-background: '#191c1c'
  surface-variant: '#e1e3e2'
typography:
  headline-xl:
    fontFamily: Spline Sans
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
  headline-lg:
    fontFamily: Spline Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-md:
    fontFamily: Spline Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Spline Sans
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
  body-md:
    fontFamily: Spline Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 26px
  label-lg:
    fontFamily: Spline Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.02em
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
  lg: 40px
  xl: 64px
  gutter: 24px
  margin-safe: 32px
---

## Brand & Style

The core philosophy of this design system is "Creative Confidence." It aims to provide a safe, digital playground that encourages children to explore without fear of making mistakes. The brand personality is joyful, energetic, and encouraging, utilizing high-clarity interfaces that minimize cognitive load for younger users.

The visual style is **Modern Minimalism with Tactile Accents**. It relies on expansive whitespace to keep the focus on the artwork while using saturated, "candy-like" colors for interactive elements. To maintain a modern feel, the design avoids dated skeuomorphism in favor of flat surfaces that use scale and subtle tonal shifts to indicate interactivity.

## Colors

This design system uses a curated palette of "Nature-Brights" to evoke an outdoor, sunny atmosphere.

- **Primary (Emerald Green):** Used for main navigation, "Go" actions, and success states. It represents growth and vitality.
- **Secondary (Sky Blue):** Used for background containers and secondary tools. It provides a calming counterpoint to the energetic green.
- **Tertiary (Sunny Yellow):** Reserved for highlights, rewards, and "Magic" tools.
- **Accent (Playful Coral):** Used for destructive actions (like clear canvas) or high-attention alerts, keeping them friendly rather than scary.
- **Neutrals:** The background uses a soft, warm off-white (#F8FAF9) rather than pure white to reduce eye strain during long coloring sessions.

## Typography

This design system utilizes **Spline Sans** across all levels to maintain a cohesive, friendly, and geometric look. The typography is characterized by its open apertures and rounded terminals, which match the high roundedness of the UI elements.

Information hierarchy is established through significant size differentials rather than weight alone. Headlines are always bold to ensure legibility for children who are still developing reading skills. Body text is kept at a minimum of 18px to provide an accessible touch target and easy readability on handheld devices.

## Layout & Spacing

This design system employs a **Fixed Grid** model optimized for tablet orientations, which is the primary device for coloring activities. 

The layout rhythm is based on an **8px linear scale**. However, because the target audience includes children with developing motor skills, the "safe zones" and interactive margins are intentionally oversized. A minimum 32px safe margin is maintained from the edges of the screen to prevent accidental closures. All interactive elements must have a minimum hit area of 48x48px, with 12px of clear space between adjacent buttons to prevent "fat-finger" errors.

## Elevation & Depth

This design system avoids traditional heavy dropshadows to keep the interface clean and modern. Depth is instead communicated through:

- **Tonal Layering:** Interactive elements sit on a background of a slightly darker or more saturated hue.
- **Low-Contrast Outlines:** Cards and buttons use a 2px solid border that is a darker shade of the element's own fill color (e.g., a Sky Blue card with a slightly darker Blue border).
- **Subtle Elevation:** When an element is "active" or "pressed," it may use a very soft, diffused ambient shadow (0px 4px 12px) with a color tint matching the object, creating a "glow" rather than a shadow.
- **Depth Stacking:** Content is organized in clear planes. The drawing canvas is always the lowest plane, with toolbars appearing as "floats" above the surface.

## Shapes

The shape language is defined by **Soft Geometric Fluidity**. Every corner is rounded to remove visual "sharpness" and create a sense of safety.

- **Primary Containers:** Use `rounded-lg` (16px) for cards and main panels.
- **Interactive Elements:** Buttons and toggles use `rounded-xl` (24px) or full pill shapes to invite touch.
- **Icons:** Must follow the same corner radius logic, avoiding any 90-degree angles in their paths.

## Components

### Buttons
Buttons are the primary interaction point. They should appear "plump." Use a 2px bottom-weighted border of a darker shade to create a subtle 3D effect without using shadows. Upon being pressed, the button should scale down by 5% and remove the bottom border to simulate being pushed into the screen.

### Chips & Color Swatches
Color swatches are large, circular elements with a thick white inner border to help the color pop against the UI. When selected, the swatch should "bounce" and expand slightly.

### Tool Cards
Cards used for tool selection (Brushes, Erasers) should be flat with a 2px colored outline. They should use a vertical layout: an icon on top and a bold label beneath.

### Sliders
For brush size or opacity, sliders use a thick track (12px height) and a large, circular thumb (32px diameter). The track should fill with the Primary Emerald Green as the thumb moves.

### Modals & Dialogs
Dialogs should be centered with a heavy "dim" background (60% opacity). They must feature large, clear "X" buttons in the top right, styled in Playful Coral to ensure they are easily found.