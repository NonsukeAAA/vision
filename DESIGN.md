---
version: alpha
name: vision
description: Local Stable Diffusion tag generator with Material 3 Expressive
colors:
  primary: "#386A20"
  on-primary: "#FFFFFF"
  primary-container: "#B8F397"
  on-primary-container: "#072100"
  secondary: "#55624C"
  on-secondary: "#FFFFFF"
  secondary-container: "#D8E7CB"
  on-secondary-container: "#131F0D"
  tertiary: "#386667"
  on-tertiary: "#FFFFFF"
  tertiary-container: "#BBEBEC"
  on-tertiary-container: "#002021"
  error: "#BA1A1A"
  on-error: "#FFFFFF"
  error-container: "#FFDAD6"
  on-error-container: "#410002"
  surface: "#F8FAF0"
  on-surface: "#191D16"
  surface-dim: "#D8DBD1"
  surface-bright: "#F8FAF0"
  surface-container-lowest: "#FFFFFF"
  surface-container-low: "#F2F5EB"
  surface-container: "#ECEFE5"
  surface-container-high: "#E6E9DF"
  surface-container-highest: "#E1E4DA"
  on-surface-variant: "#43483E"
  outline: "#74796D"
  outline-variant: "#C3C8BB"
  inverse-surface: "#2E312B"
  inverse-on-surface: "#F0F2E7"
  inverse-primary: "#9CD67E"
  scrim: "#000000"
  shadow: "#000000"
typography:
  display-lg:
    fontFamily: Roboto Flex
    fontSize: 57px
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: -0.02em
  display-md:
    fontFamily: Roboto Flex
    fontSize: 45px
    fontWeight: 700
    lineHeight: 1.16
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Roboto Flex
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.25
  headline-md:
    fontFamily: Roboto Flex
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.29
  title-lg:
    fontFamily: Roboto Flex
    fontSize: 22px
    fontWeight: 500
    lineHeight: 1.27
  title-md:
    fontFamily: Roboto Flex
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0.01em
  body-lg:
    fontFamily: Roboto Flex
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0.03em
  body-md:
    fontFamily: Roboto Flex
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: 0.02em
  label-lg:
    fontFamily: Roboto Flex
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.43
    letterSpacing: 0.01em
  label-md:
    fontFamily: Roboto Flex
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.33
    letterSpacing: 0.04em
rounded:
  none: 0px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 28px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  hero: 64px
  gutter: 24px
  margin: 24px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.xl}"
    padding: 16px
    height: 56px
  button-secondary:
    backgroundColor: "{colors.secondary-container}"
    textColor: "{colors.on-secondary-container}"
    rounded: "{rounded.xl}"
    padding: 16px
    height: 56px
  button-tonal:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.on-primary-container}"
    rounded: "{rounded.xl}"
    padding: 16px
  fab:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.on-primary-container}"
    rounded: "{rounded.lg}"
    size: 56px
  chip:
    backgroundColor: "{colors.surface-container-high}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
    padding: 8px
  chip-selected:
    backgroundColor: "{colors.secondary-container}"
    textColor: "{colors.on-secondary-container}"
    rounded: "{rounded.sm}"
  text-field:
    backgroundColor: "{colors.surface-container-highest}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.xs}"
  card-filled:
    backgroundColor: "{colors.surface-container-low}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: 24px
  dropzone:
    backgroundColor: "{colors.surface-container}"
    textColor: "{colors.on-surface-variant}"
    rounded: "{rounded.xl}"
    padding: 48px
---

# vision

## Overview

**vision** is a local-first Stable Diffusion tag generator. The product personality is calm, precise, and quietly expressive: an imaging tool that feels alive through Material 3 Expressive motion and shape, not through decorative noise.

Emotional goals: confidence while analyzing an image, clarity when reading tags, and a sense that the interface reacts physically (spring motion, morphing shapes) without distracting from the image and prompt output.

Audience: creators who reverse-engineer prompts from reference images on their own machine. Density is medium — one primary action per viewport, generous containment, no dashboard clutter.

Brand signal: the word **vision** is always the hero-level identity on the first screen. Supporting copy stays short and secondary.

## Colors

Tonal Material 3 palette seeded from a botanical green (`#386A20`) that reads as “seeing / growth / focus,” not entertainment-neon.

- **Primary (#386A20):** Primary actions — analyze, copy, confirm.
- **Primary container (#B8F397):** Soft emphasis surfaces, FAB, selected tonal buttons.
- **Secondary (#55624C):** Supporting actions and selected chips.
- **Tertiary (#386667):** Optional accent for status / analysis progress only.
- **Surface stack (#F8FAF0 → #E1E4DA):** Layered containment without heavy shadows.
- **Error (#BA1A1A):** Failures only (model load, unsupported file).

Light scheme is default. Dark scheme inverts to tonal surfaces with the same seed. Never invent a third accent outside primary / secondary / tertiary roles.

## Typography

**Roboto Flex** (variable) carries the full M3 type scale. Emphasized display and headline weights (600–700) create editorial moments for the brand name and result titles. Body and labels stay regular/medium for scanability of long tag lists.

- **Display / Headline:** Brand and screen titles only.
- **Title:** Section headers (Results, Settings).
- **Body:** Captions, helper text, empty states.
- **Label:** Chips, buttons, thresholds, metadata.

Do not introduce a second decorative font. Emphasized styles are weight/optical-size shifts within Roboto Flex, per M3 Expressive typography guidance.

## Layout

Mobile-first single column. Max content width 720px centered on large screens. Strict 8px spacing scale (`xs`–`xxl`) with `hero` (64px) reserved for the first-viewport brand block.

Containment: related controls live inside filled surface containers with 24px internal padding. The first viewport holds only brand, one short sentence, and one CTA group (drop / pick image). No stats, no secondary promos.

## Elevation & Depth

Hierarchy comes from **tonal surface layers** (surface → container → container-high), not multi-layer drop shadows. Use a single soft ambient shadow only for transient overlays (dialogs, menus). Scrim for modal focus.

## Shapes

Expressive corner scale: interactive primary buttons and dropzones use **xl (28px)**; chips and dense controls use **sm (8px)**; text fields use **xs (4px)**. Shape contrast between large hero actions and small chips is intentional — do not flatten everything to one radius.

## Components

- **Buttons:** Filled primary for Analyze / Copy; tonal for secondary mode switches; height 56px on primary CTAs; spring press feedback via expressive motion.
- **Chips:** Assist / filter chips for individual tags; removable; selected state uses secondary-container.
- **Dropzone:** Large filled container, dashed outline-variant border, xl radius; idle → drag-over morphs border color to primary.
- **Loading indicator:** Expressive indeterminate indicator during inference; tertiary tint allowed.
- **Slider:** Threshold control; labeled; primary track.
- **Segmented button / tabs:** Output mode (Booru / Caption / Hybrid).
- **Snackbar:** Copy confirmation only.

Cards are allowed only as interaction containers (results panel with editable chips). No decorative cards in the hero.

## Do's and Don'ts

- Do keep **vision** as the dominant first-viewport brand signal.
- Do map all colors to the DESIGN.md tokens / M3 roles.
- Do prefer tonal containment over shadows and glassmorphism.
- Do use expressive spring motion for open / close / press — not linear CSS-only fades for primary transitions.
- Don't send images to remote APIs; inference stays on localhost.
- Don't add purple-on-white default “AI” themes or neon glow.
- Don't put stats, schedules, or secondary marketing in the hero.
- Don't use more than one display-level headline competing with the brand name.
- Don't invent component styles that conflict with `@m3e` / Material 3 Expressive defaults.
