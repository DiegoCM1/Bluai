---
version: alpha
name: Bluai
description: >-
  Hurricane early-warning app. Dark-first, high-contrast UI. The palette is
  alert-severity-driven: color carries meaning (safe → emergency), it is not
  decorative.
# ── Canonical source of truth for colors is frontend/tailwind.config.js ──
# utils/theme.ts mirrors these in camelCase (brandBlue) for IMPERATIVE use
# (inline styles, gradients). If you change a hex, change BOTH. tailwind wins.
colors:
  # Primary
  brand-blue: "#3167ff"     # CTAs, active tab, interactive elements
  brand-indigo: "#3900ff"   # deep accent, gradients
  brand-cyan: "#2ecaff"     # highlights, map accents
  brand-black: "#000000"    # true black, rarely used directly
  # Secondary / semantic (severity-bearing — see Colors section)
  brand-purple: "#9200ff"   # subtitle/hint text — NOT a severity color, see below
  brand-orange: "#ff8500"   # SIAT NARANJA (level 4, peligro alto)
  brand-yellow: "#ffce00"   # SIAT AMARILLO (level 3, peligro moderado)
  brand-green: "#00e774"    # SIAT VERDE (level 2, peligro bajo); also success
  brand-red: "#e24337"      # SIAT ROJO (level 5, peligro máximo); also error/validation
  brand-teal: "#4ed5de"     # map elements, secondary icons — NOT a severity color
  # Surfaces — tokenized. Lives in tailwind.config.js as `brand-surface`;
  # reach for the class (`bg-brand-surface`), never the hex.
  brand-surface: "#0a1c32"
typography:
  # Families registered in tailwind.config.js, loaded via expo-font in app/_layout.tsx
  hero:
    fontFamily: Square721        # tailwind: font-square721 — app name, hero titles
  body:
    fontFamily: Poppins-Light    # tailwind: font-poppins — body, labels, descriptions
  emphasis:
    fontFamily: Poppins-SemiBold # tailwind: font-poppins-semibold — titles, buttons, emphasis
rounded:
  lg: 8px       # rounded-lg  — most common (rows, inputs, small cards)
  xl: 12px      # rounded-xl
  2xl: 16px     # rounded-2xl — content cards (DarkCard)
  full: 9999px  # rounded-full — pill CTAs, tab bar, avatars
spacing:
  # Tailwind default 4px base. Prefer even steps; avoid odd one-off paddings.
  base: 4px
  sm: 8px       # p-2
  md: 16px      # p-4 — default screen padding
  lg: 24px      # p-6
components:
  # These reference tokens above. NOTE: some are design SPEC, not yet extracted
  # as named components in code — see the Components section for status.
  cta-button:
    backgroundColor: "{colors.brand-blue}"
    textColor: "#ffffff"
    typography: "{typography.emphasis}"
    rounded: "{rounded.full}"
    padding: 16px
  dark-card:
    backgroundColor: "{colors.brand-surface}"
    rounded: "{rounded.2xl}"
---

# Bluai — Brand & Design System

> Format follows Google's [`design.md`](https://github.com/google-labs-code/design.md):
> machine-readable tokens in the front matter, design intent in the body.
> Front matter is the contract AI agents read — keep it true to the code.
> Anything marked **TODO(design)** needs the design director to decide.

---

## Overview

A dark-first emergency interface. Information density and **legibility under stress**
beat decoration — a user opens this app during a hurricane, not for fun. Color is
functional: it encodes alert severity. High contrast on a deep-navy canvas, with
`brand-blue` reserved for "this is the thing you tap."

---

## Colors

Canonical tokens live in `frontend/tailwind.config.js`; this front matter mirrors them.
`utils/theme.ts` holds a **second copy in camelCase** (`brandBlue`) for imperative use
(gradients, inline styles). That dual definition is a drift risk — tailwind is the
source of truth; theme.ts must follow it.

**Alert severity → color (canonical mapping):**

Severity in this app *is* the official SIAT-CT 5-level scale — there is no separate
"Safe/Watch/Advisory/Warning/Emergency" tier system, and `brand-purple` does not
carry severity (nothing in the app maps a SIAT level to purple). The single source
of truth for this table is code, not this doc — see
`backend/app/features/siat/levels.py` and `frontend/utils/siatLevels.ts`; every
screen that shows a SIAT color/label imports from one of those two.

| Level | Color | Token | Danger |
|---|---|---|---|
| 1 | Azul | neutral gray `#6B7280` (informational-only, never pushes — deliberately not a brand token) | Peligro mínimo |
| 2 | Verde | `brand-green` | Peligro bajo |
| 3 | Amarillo | `brand-yellow` | Peligro moderado |
| 4 | Naranja | `brand-orange` | Peligro alto |
| 5 | Rojo | `brand-red` | Peligro máximo |

`brand-red` doubles as the generic error/validation color (`text-brand-red`);
`brand-green` doubles as success. `brand-teal`/`brand-cyan` are map/icon accents,
**not** severity colors — don't use them to signal alert state. `brand-purple` is
reserved for hint/subtitle text, not severity.

---

## Typography

Three families, mapped to tailwind classes:

| Token | Class | Use |
|---|---|---|
| `hero` (Square721) | `font-square721` | App name, hero titles |
| `body` (Poppins-Light) | `font-poppins` | Body, labels, descriptions |
| `emphasis` (Poppins-SemiBold) | `font-poppins-semibold` | Section titles, button labels |

**Type scale (Tailwind sizes):**

| Role | Size | Family | Color |
|---|---|---|---|
| Screen title | `text-2xl` | emphasis | white |
| Section label | `text-lg` | emphasis | white |
| Body | `text-sm` | body | white |
| Hint / accent | `text-xs` | body | `brand-purple` |
| CTA label | `text-base` | emphasis, uppercase | white |

---

## Layout

**Spacing:** Tailwind 4px base unit. Default screen padding is `p-4` (16px). Prefer the
`sm`/`md`/`lg` steps above over arbitrary values — consistency reads as polish.

**Naming conventions** (full rules in `frontend/CLAUDE.md`):
- Routes are files under `app/` (expo-router, file-based).
- **Underscore-prefixed dirs are private, NOT routes:** `_components`, `_hooks`,
  `_services`, `_utils`, `_types.ts` — colocated with the route that owns them
  (feature-colocation pattern, e.g. `app/ai/`, `app/alerts/`).
- Components: `PascalCase.tsx`. Hooks: `useXxx.ts`. Services: `xxxService.ts`.

**NativeWind vs RN Reusables — when to use which:**
- **Default: NativeWind `className`.** This is the styling system. (A few files use
  `StyleSheet.create`; that's the legacy minority, not the pattern to copy.)
- Reach for **RN Reusables (shadcn-style) components** when you need an interactive
  primitive with variants/accessibility baked in (button, switch, dialog, select).
- Use **inline `style={}` / imperative values** only for things `className` can't express
  (dynamic computed values, animated styles, gradient color arrays from `theme.ts`).

---

## Elevation & Depth

Depth is carried by **gradients**, not heavy shadows (RN `elevation`/shadow is used
sparingly). Gradients live in `utils/theme.ts`, rendered with `expo-linear-gradient`.

| Key | Description |
|---|---|
| `primary` | Deep navy — default app background (final) |
| `morado` | Purple-tinted dark |
| `naranja` | Orange-tinted dark |
| `verde` | Green-tinted dark |
| `header` | Blue-tinted (`#060f1e` → `brand-blue`) |

---

## Shapes

See `rounded` tokens. In practice: `rounded-full` for pills/CTAs/tab bar,
`rounded-2xl` for content cards, `rounded-lg` for rows and inputs.

---

## Components

> **Status legend:** ✅ extracted as a named component · 🎯 design spec (referenced in
> screens but not yet a reusable component under this name — extract when touched).

| Component | Status | Spec |
|---|---|---|
| `ScreenHeader` | ✅ `components/ScreenHeader.tsx` | Left-anchored blue rounded tab, white bold text |
| `OptionCard` | ✅ `components/OptionCard.tsx` | Selectable card (onboarding/preferences) |
| `ThemeProvider` | ✅ `components/ThemeProvider.jsx` | Wraps app, drives `useTheme` |
| `CTAButton` | 🎯 | Full-width, `rounded-full`, `brand-blue`, white uppercase `emphasis` text |
| `DarkCard` | 🎯 | `brand-surface` bg, `rounded-2xl` content container |
| `BottomTabBar` | 🎯 | Pill dark container, 4 tabs + elevated logo button, active = `brand-blue` |
| `AlertMarker` (map) | 🎯 | Triangle + icon, color = severity, sourced from `frontend/utils/siatLevels.ts` (see severity table above). |

---

## Do's and Don'ts

**Theming — read `colorScheme` the persisted way:**

```tsx
// ✅ correct — respects AsyncStorage persistence
import { useTheme } from "../context/ThemeContext";
const { colorScheme } = useTheme();

// ❌ wrong — bypasses persistence, theme won't survive reload
import { useColorScheme } from "nativewind";
import { useColorScheme } from "react-native";
```

NativeWind's `dark:` class prefix works automatically — no hook needed for that. Reach
for `useTheme` only when you need the value *imperatively* (icon colors, switch tints).

- ✅ **Do** use severity tokens for alert state; ✅ map/icon accents (`teal`/`cyan`) for chrome.
- ✅ **Do** add new surface/elevation values as tokens, not inline hexes.
- ❌ **Don't** hardcode `#0a1c32` — it is tokenized; use `bg-brand-surface`.
- ❌ **Don't** dim body copy (`text-white/70` and friends). The type scale puts body
  at plain white; 70% is for genuinely secondary chrome only (hints, skip links).
- ❌ **Don't** define a color in `theme.ts` that isn't in `tailwind.config.js` (drift).
- ❌ **Don't** reach for `StyleSheet.create` by default — `className` is the system.

---

## Appendix — Screen Inventory

> ⚠️ Status column last audited 2026-05-04 — **likely stale**, re-audit before relying on it.

| Screen | Route | Status (stale) |
|---|---|---|
| Splash | `app/index.jsx` | Built |
| Login | `app/(auth)/index.tsx` | Styled |
| Map | `app/(tabs)/MapScreen` | Needs styling |
| Alert detail | `app/alerts/[id]` | Needs styling |
| Onboarding 1/2 | `app/onboarding/step1`,`step2` | Needs styling |
| Settings | `app/SettingsScreen` | Needs styling |

---

## Appendix — App Icons

| Asset | Purpose |
|---|---|
| `icon.png` | Universal app icon (iOS direct; Android fallback). Home screen, switcher, store. |
| `adaptive-icon.png` | Android-only foreground; OS clips to circle/squircle. Background = `#DCF0FF`. |
| `splash-icon.png` | Image inside the boot splash. `backgroundColor` in `app.json` is the canvas. |
| `notification-icon.png` | Android tray icon. **Must be white-on-transparent** (Android ignores color). iOS uses app icon. |
| `favicon.png` | Expo Web only — not needed for this mobile app; scaffold leftover. |
