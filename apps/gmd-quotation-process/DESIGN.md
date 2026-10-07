---
name: GMD Quotation Process
description: Internal console for the valve quotation lifecycle - dense, instrument-blue data tables
colors:
  instrument-blue: "#0f62fe"
  instrument-blue-hover: "#0353e9"
  admin-emerald: "#059669"
  ink: "oklch(0.205 0 0)"
  near-black: "oklch(0.145 0 0)"
  paper: "oklch(1 0 0)"
  card: "oklch(1 0 0)"
  muted-wash: "oklch(0.97 0 0)"
  muted-ink: "oklch(0.556 0 0)"
  hairline: "oklch(0.922 0 0)"
  ring: "oklch(0.708 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  status-won-bg: "#d1fae5"
  status-won-fg: "#065f46"
  status-lost-bg: "#fee2e2"
  status-lost-fg: "#991b1b"
  status-eval-bg: "#fef3c7"
  status-eval-fg: "#92400e"
  status-submitted-bg: "#dbeafe"
  status-submitted-fg: "#1e40af"
typography:
  display:
    fontFamily: "Poppins, sans-serif"
    fontSize: "32px"
    lineHeight: "40px"
    fontWeight: 600
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Poppins, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  body:
    fontFamily: "Poppins, sans-serif"
    fontSize: "14px"
    lineHeight: "20px"
    fontWeight: 400
  table:
    fontFamily: "Poppins, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "Poppins, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    letterSpacing: "0.05em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  gutter: "20px"
  container-max: "1440px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "oklch(0.205 0 0 / 80%)"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.near-black}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.near-black}"
    rounded: "{rounded.lg}"
    height: "32px"
  nav-pill:
    backgroundColor: "{colors.instrument-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  nav-pill-hover:
    backgroundColor: "{colors.instrument-blue-hover}"
  nav-pill-admin:
    backgroundColor: "{colors.admin-emerald}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  input:
    backgroundColor: "transparent"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  badge-pill:
    backgroundColor: "{colors.status-submitted-bg}"
    textColor: "{colors.status-submitted-fg}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
    height: "20px"
  page-button-active:
    backgroundColor: "{colors.instrument-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    height: "28px"
    width: "28px"
---

# Design System: GMD Quotation Process

## Overview

**Creative North Star: "The Control Room Console"**

The GMD quotation dashboard is an instrument panel for pricing valves. The interface is a neutral, engineered chassis - paper-white surfaces, near-black ink, hairline borders - and the single loud color, Instrument Blue (`#0f62fe`), behaves like a live indicator light: it marks where the operator is, what is actionable, and what has switched on. Every blue element is a signal, never decoration.

The system is built for the day's load: dense data tables with 10-13px type, 24-36px hit targets, resizable columns, and inline editing. Density is a feature. The screen reads like gauges on a console - calm, evenly lit, each row scannable at a glance - rather than like a brochure or a dashboard mock. Controls are dense and decisive: small, clearly bordered, with unmistakable pressed and focused states. Focus is a first-class citizen (3px ring at 50% opacity), because most work here happens on the keyboard.

Depth is lightly lifted. Surfaces are flat by default; modest separation comes from hairline borders and muted washes. Shadows appear only where something genuinely floats above the table plane - sticky bars, popovers, dropdowns, the navbar. The table itself never casts a shadow; it is the floor of the console.

**Key Characteristics:**
- Neutral chassis, one signal color (Instrument Blue) plus emerald reserved for admin.
- Dense by design: small type, small targets, many rows visible per screen.
- Flat surfaces with light lift for floating chrome only.
- Every interactive element announces its state clearly (hover, focus, active, disabled).
- Poppins everywhere, tight tracking, labels uppercase and small.
- Light theme is canonical; a full neutral dark theme ships and inverts the chassis.

A second, scoped Material 3 palette lives in `app/raw_material/globals.css` and applies only to `/raw_material`. It keeps the same Poppins family and the same Instrument Blue as its primary, but re-tints the neutral chassis to a lavender-washed surface family (`#fbf8ff`). New work on that route follows its local tokens; work elsewhere follows the global tokens.

## Colors

The palette is achromatic with two live accents: Instrument Blue for navigation and active states, emerald for admin-only actions. Signal colors are rare by design - the neutrals carry the density, the blue carries the meaning.

### Primary
- **Instrument Blue** (#0f62fe): the console's signal color. Nav pills, active pagination, primary links. Hover deepens to `#0353e9`. Never decorative; never a background wash.
- **Ink** (oklch(0.205 0 0)): the near-black used for the default primary button and dark-mode primary surfaces. Reads as "switch engaged."

### Secondary
- **Admin Emerald** (#059669): reserved for the Admin nav pill and register action. It is the only green in the neutral chassis and never appears in data cells.

### Neutral
- **Paper** (oklch(1 0 0)): app background and card surface. The console floor.
- **Near-Black** (oklch(0.145 0 0)): body text and interactive text on paper.
- **Muted Wash** (oklch(0.97 0 0)): hover fills, footer bars, secondary surfaces, muted text backing.
- **Muted Ink** (oklch(0.556 0 0)): secondary text, placeholders, icons at rest.
- **Hairline** (oklch(0.922 0 0)): borders, dividers, scrollbar thumbs, table grid.
- **Ring** (oklch(0.708 0 0)): focus-ring color, applied at 50% opacity over a 3px radius.
- **Destructive** (oklch(0.577 0.245 27.325)): destructive text and actions, always at low-opacity tint (10-20%) rather than full-strength fill.

### Named Rules
**The One-Signal Rule.** On any given screen, Instrument Blue appears on fewer than 10% of pixels. Its rarity is what makes it read as a live indicator. When more than one element needs to be "on," they must compete or the blue loses meaning.

## Typography

**Display Font:** Poppins (with sans-serif fallback)
**Body Font:** Poppins (with sans-serif fallback)
**Label Font:** Poppins, 10-12px, 600 weight, 0.05em tracking

**Character:** One family, two weights, tight tracking. Poppins' geometric, slightly mechanical letterforms suit an instrument-panel aesthetic. All caps is avoided except in tiny uppercase labels; numerals (docket numbers, rates, quantities) are the most important characters on screen and get full weight at rest.

### Hierarchy
- **Display** (Poppins 600, 32px, 40px line-height, -0.02em tracking): page-level titles on dashboard screens. Used sparingly.
- **Headline** (Poppins 600, 18-24px, -0.01em): section headers and dialog titles.
- **Title** (Poppins 600, 14px): navbar links, button labels, card headers.
- **Body** (Poppins 400, 14px, 20px line-height): general interface text, forms, cell content at rest.
- **Table** (Poppins 400, 13px): dense grid cell content. This is the workhorse role.
- **Label** (Poppins 600, 10px, 0.05em tracking): column-filter selects, micro-labels, uppercase status text.

### Named Rules
**The Density Rule.** Table text is 13px and never grows for readability alone; density is the point. If a value cannot be read at 13px, the row layout is wrong, not the font size.

## Layout

The app is a fixed, full-viewport shell: `h-screen` body with `overflow-hidden`, a sticky 64px navbar (56px content) on top, and a flex column of content beneath. The quotation dashboard centers its content in a `max-w-full` padded main (`p-4`, 12px gutter) and never scrolls the page - only the table scrolls inside its own wrapper.

The data table is the layout's engine. It uses a dense grid with 48px footer bar, resizable columns (4px drag handle that tints on hover), and 8px horizontal scrollbar on the wrapper. Column-filter dropdowns sit in 24px-tall header cells. Density decisions are measured per-pixel because the operator's throughput depends on rows-per-viewport.

Spacing follows a 4px base rhythm: `xs` 4px, `sm` 8px, `md` 16px, `lg` 24px, `xl` 32px. Gutter is 20px; the widest content container is 1440px. Grouped controls share an 8px gap; card interiors breathe at 16-24px.

## Elevation & Depth

**Lightly lifted.** The console floor is flat: surfaces rest on hairline borders (`oklch(0.922 0 0)`) and muted washes, not shadows. Depth is reserved for things that truly float above the table plane - the sticky navbar, popovers, dropdowns, dialog overlays. The table never casts a shadow; it is the floor.

### Shadow Vocabulary
- **Navbar / sticky chrome**: a single bottom border (`hairline`) separates it from content; no drop shadow at rest.
- **Popovers / dropdowns / dialogs**: floating surfaces are lifted by `ring`-style borders and backdrop, with shadows supplied by the shadcn overlay primitives. They always carry a visible focus ring in the `ring` color.

### Named Rules
**The Flat-Floor Rule.** Nothing on the data table casts a shadow. If a surface needs to feel separate from the table, separate it with a border or a muted wash first, and reach for a shadow only when it floats.

## Shapes

The form language is simple and uniform: rectangles with a small, consistent radius. Buttons, inputs, selects, and page controls use `rounded-lg` (10px); navbar pills and smaller controls use `rounded-md` (8px); status badges and chips are full pills (`9999px`). Radius scales proportionally from a 10px base: `sm` 6px, `md` 8px, `lg` 10px, `xl` 14px.

Edges are soft enough to feel machined, sharp enough to stay dense. There are no circles, no blobs, no skewed or irregular silhouettes - every shape is a rounded rectangle or a pill.

## Components

### Buttons
- **Shape:** `rounded-lg` (10px), default height 32px.
- **Primary:** Ink (`oklch(0.205 0 0)`) fill, white text, 0 12px horizontal padding, 14px semibold. Hover dims to 80% ink. A pressed button translates down 1px.
- **Focus:** 3px ring at 50% `ring` color on the border. Focus is always visible.
- **Secondary / Ghost / Outline:** Outline uses a `hairline` border on paper with muted hover; Ghost is borderless with a muted-wash hover; Destructive is a 10-20% tint fill with destructive-red text and ring.
- **Disabled:** 50% opacity, `pointer-events: none`.
- **Icon:** square variants (`size-8`, `size-6`, `size-9`) with 16px icons.

### Navigation
- **Style:** solid Instrument Blue pills (`#0f62fe`), white semibold 14px text, `rounded-md` (8px), 36px tall, 16px side padding. Hover deepens to `#0353e9`. The Admin pill is the sole emerald. Nav is a horizontal strip in a sticky white header with the logo at far left and session info + notification bell at far right.
- **States:** hover darkens the fill; there is no underline navigation. Active route is implied by the pill's persistent color.

### Chips
- **Status Badges:** full pills (9999px), 11px 600 weight, 2px 10px padding, 1px transparent border, 0.15s ease transition. Each status owns a soft tinted pair:
  - **Won** - `#d1fae5` bg / `#065f46` text / `#a7f3d0` border
  - **Lost** - `#fee2e2` bg / `#991b1b` text / `#fecaca` border
  - **Eval** - `#fef3c7` bg / `#92400e` text / `#fde68a` border
  - **Submitted** - `#dbeafe` bg / `#1e40af` text / `#bfdbfe` border
- **Column Filters:** 24px-tall full-width selects, 10px type, 4px radius, hairline border, slate focus border.

### Cards / Containers
- **Corner Style:** `rounded-lg` (10px) for card primitives.
- **Background:** Paper (`oklch(1 0 0)`); secondary containers use Muted Wash.
- **Border:** hairline.
- **Shadow Strategy:** none at rest (see Flat-Floor Rule); floating variants only for overlays.
- **Internal Padding:** 16-24px.

### Inputs / Fields
- **Style:** 32px tall, transparent background, hairline border, `rounded-lg` (10px), 10px side padding, 14px text.
- **Focus:** border shifts to `ring` color with a 3px 50% ring. Unmistakable.
- **Error / Disabled:** invalid inputs get destructive border and ring at 20% opacity; disabled inputs dim to 50% with a muted fill.
- **Date inputs** dim their calendar-picker indicator to 50% opacity to stay quiet inside dense cells.

### Table (Signature Component)
The quotation grid is the signature surface: resizable columns via a 4px handle, per-column filter selects in the header row, inline cell editing, Excel-like bulk paste, and a 48px muted footer bar for pagination. Page buttons are 28px squares with 4px radius; the active page is Instrument Blue with white text, others are paper with hairline border, 11px 600 type, muted hover, 30% opacity when disabled.

## Do's and Don'ts

### Do:
- **Do** use Instrument Blue for navigation, active states, and live signals - and nowhere else.
- **Do** keep table type at 13px and let density win over readability theater.
- **Do** show focus on every interactive element (3px ring, 50% `ring` color).
- **Do** keep surfaces flat; use hairline borders and muted washes before shadows.
- **Do** use the status pill pairs verbatim - tinted backgrounds with same-hue darker text.
- **Do** reserve emerald for admin-only actions.

### Don't:
- **Don't** let any decorative element take Instrument Blue; it is a signal, not a theme.
- **Don't** cast shadows on the data table or its rows.
- **Don't** introduce a second display font; Poppins carries every role.
- **Don't** grow table text past 13px for readability; fix the layout instead.
- **Don't** add circles, gradients, or irregular silhouettes to the control vocabulary - rectangles and pills only.
- **Don't** style new work on `/raw_material` from the global tokens; use its scoped Material 3 palette.