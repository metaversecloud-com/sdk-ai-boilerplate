## Topia SDK Styles Guide

This document outlines the CSS architecture and styling patterns to use when developing with the Topia SDK.

**All client-side components MUST adhere to these rules.**

## CSS Architecture (Cascade Layers)

Three style sources coexist in every app via CSS cascade layers, declared in `client/src/index.css`:

1. **Tailwind** (lowest) — utility classes (`flex`, `grid`, `gap-*`, `mt-*`, …) for layout and spacing
2. **SDK** — Topia's design system (`.btn`, `.card`, `.h1`-`.h4`, `.p1`-`.p4`, form inputs, modals) loaded from `https://sdk-style.s3.amazonaws.com/styles-3.0.2.css`
3. **Unlayered project CSS** (highest) — app-specific theme/component CSS imported from `client/src/styles/*.css`

CSS cascade rules: rules **not** in a layer beat rules in any layer; later-declared layers beat earlier ones. So app classes win over SDK, SDK wins over Tailwind, with no `!important` needed.

Reference implementation: [`sdk-escape-room/client/src/index.css`](../../sdk-escape-room/client/src/index.css).

### `client/src/index.css`

```css
/*
 * Cascade layer order (lowest → highest priority):
 *   1. tailwind   — utility classes
 *   2. sdk        — Topia SDK component styles (.btn, .card, .p2, etc.)
 *   3. unlayered  — our tokens.css + components.css (always win)
 */
@layer tailwind, sdk;

@import url("https://sdk-style.s3.amazonaws.com/styles-3.0.2.css") layer(sdk);

@import "./styles/tokens.css";
@import "./styles/components.css";

@layer tailwind {
  @tailwind base;
  @tailwind components;
  @tailwind utilities;
}
```

### `client/index.html`

Remove the inline `<link>` to the SDK stylesheet — it's loaded via `@import layer(sdk)` in `index.css` instead, so the SDK's rules end up in the `sdk` layer and project CSS can override them without specificity hacks.

```html
<!-- ❌ Don't load the SDK CSS as a top-level <link>; it lands outside any cascade
     layer and wins over everything else.
<link href="https://sdk-style.s3.amazonaws.com/styles-3.0.2.css" rel="stylesheet" />
-->

<!-- Fonts are fine as <link> tags. -->
<link href="https://fonts.googleapis.com/css?family=Quicksand" rel="stylesheet" />
```

Keep `<body class="rtsdk">` so the SDK's `.rtsdk h1 { … }` typography rules still scope correctly.

### `client/tailwind.config.js`

Disable Tailwind's preflight reset:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  // The Tailwind v3 PostCSS plugin hoists preflight to the top level
  // (unlayered) regardless of an outer @layer wrapper, which clobbers SDK
  // typography rules like `.rtsdk h3 { font-size: 24px }`. The SDK already
  // provides sensible defaults for h1-h6/body/a/etc., so we don't need it.
  // All utility classes (flex, grid, mt-4, bg-zinc-700, …) still work.
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
};
```

### `client/src/styles/`

App-specific CSS lives here and is imported unlayered (i.e. without a `@layer { … }` wrapper) so it wins over both SDK and Tailwind. Typical split:

- `tokens.css` — design tokens (CSS variables for colors, gradients, shadows, glows). Also a good home for app-wide resets like `*, *::before, *::after { box-sizing: border-box; }` if you've disabled preflight.
- `components.css` — themed component classes that build on SDK classes (e.g. variants of `.card`, full-viewport background, glows).

Use an **app prefix** on all custom class names (e.g. `.er-card--running` for escape-room, `.kr-tile` for kitchen-rush) so the project-specific CSS is self-contained and obviously not part of the SDK or Tailwind vocabulary.

## Core Principles

1. **Use SDK classes for the design system.** Buttons, cards, typography, form inputs, and modals come from the SDK — don't recreate them.
2. **Use Tailwind utilities for layout and spacing.** `flex`, `grid`, `gap-*`, `mt-*`, `w-full`, `text-center`, etc. are first-class — they sit in the lowest layer so they never fight SDK component styles.
3. **Write custom CSS only for theme and app-specific visuals.** Custom gradients, glows, themed card variants, animated effects, full-viewport backgrounds. Keep these in `styles/components.css`, prefixed with the app name, consuming tokens from `styles/tokens.css`.
4. **No inline styles** — except for genuinely dynamic positioning (e.g. a draggable element's `transform`) or values that come from runtime data (e.g. a progress bar's `width: ${percent}%`).
5. **No `!important`.** Cascade layers handle priority; if a project class isn't winning, the cause is that something is unlayered when it shouldn't be (or the SDK CSS is being loaded outside `layer(sdk)` — re-check `index.html`).
6. **Accessibility is non-negotiable.** Every example below already includes the required ARIA / `alt` / label attributes and focus styles. Read [`.ai/accessibility.md`](./accessibility.md) before building any new component — it covers icon buttons, modals, focus management, contrast, motion, and the testing checklist.

## Typography

```tsx
// Headings (from the SDK)
<h1 className="h1">Heading 1</h1>
<h2 className="h2">Heading 2</h2>
<h3 className="h3">Heading 3</h3>
<h4 className="h4">Heading 4</h4>

// Body text
<p className="p1">Standard body text</p>
<p className="p2">Medium body text</p>
<p className="p3">Small body text</p>
<p className="p4">XSmall body text</p>

// Alignment (Tailwind utilities — these layer below SDK, so safe to use freely)
<p className="text-left">Left aligned text</p>
<p className="text-center">Center aligned text</p>

// Text variants (SDK)
<p className="p2 text-success">Success text</p>
<p className="p3 text-error">Error text</p>
```

## Buttons

Always include `type="button"` on non-submit buttons inside forms; otherwise they default to `type="submit"` and accidentally submit the surrounding form.

```tsx
<button type="button" className="btn">Primary Action</button>
<button type="button" className="btn btn-outline">Secondary Action</button>
<button type="button" className="btn btn-text">Text Button</button>
<button type="button" className="btn btn-danger">Destructive Action</button>

// Icon-only buttons need aria-label; the <img> is decorative (alt="" + aria-hidden).
<button type="button" className="btn btn-icon" aria-label="Edit set">
  <img src="https://sdk-style.s3.amazonaws.com/icons/edit.svg" alt="" aria-hidden="true" />
</button>
```

## Form Elements

Every input must have an associated label — either via `htmlFor`/`id` or by wrapping the input. `placeholder` is **not** a label; it disappears once the user types and usually fails contrast.

```tsx
// Explicit association via htmlFor + id
<label className="label" htmlFor="set-title">Set title</label>
<input id="set-title" className="input" type="text" placeholder="e.g. Capitals quiz" />

// With character count + helper text (linked via aria-describedby)
<div className="input-group">
  <label className="label" htmlFor="set-summary">Summary</label>
  <input
    id="set-summary"
    className="input"
    type="text"
    maxLength={10}
    aria-describedby="set-summary-help"
  />
  <span className="input-char-count">0/10</span>
  <p id="set-summary-help" className="p3">A maximum of 10 characters is allowed.</p>
</div>

// Error state: aria-invalid + aria-describedby + role="alert" on the message
<label className="label" htmlFor="set-name">Name</label>
<input
  id="set-name"
  className="input input-error"
  type="text"
  value=""
  aria-invalid
  aria-describedby="set-name-error"
/>
<p id="set-name-error" className="p3 text-error" role="alert">Name is required.</p>

<label className="label" htmlFor="set-description">Description</label>
<textarea id="set-description" className="input" rows={5} maxLength={120}></textarea>

// Wrapping pattern — implicit association, no id needed
<label className="label">
  <input className="input-checkbox" type="checkbox" />
  Show advanced settings
</label>

// Group related radios with <fieldset> + <legend>
<fieldset>
  <legend className="label">Speed</legend>
  <label className="label">
    <input className="input-radio" type="radio" name="speed" value="slow" /> Slow
  </label>
  <label className="label">
    <input className="input-radio" type="radio" name="speed" value="fast" /> Fast
  </label>
</fieldset>
```

## Card Components

```tsx
<div className="card">
  <div className="card-image">
    {/* Meaningful images get a real alt; decorative images get alt="" + aria-hidden. */}
    <img src="image-url.jpg" alt="Set thumbnail showing world capitals" />
  </div>
  <div className="card-details">
    <h3 className="card-title">Title</h3>
    <p className="card-description p2">Description text</p>
    <div className="card-actions">
      <button type="button" className="btn btn-icon" aria-label="Edit set">
        <img src="https://sdk-style.s3.amazonaws.com/icons/edit.svg" alt="" aria-hidden="true" />
      </button>
    </div>
  </div>
</div>

// Card variants
<div className="card small">…</div>
<div className="card horizontal">…</div>
<div className="card success">…</div>
<div className="card danger">…</div>
```

## Layout (Tailwind utilities)

Tailwind utilities are encouraged for layout and spacing — they sit in the lowest cascade layer and never collide with SDK component styles.

```tsx
<div className="flex items-center justify-between gap-4">
  <div>Item 1</div>
  <div>Item 2</div>
</div>

<div className="grid grid-cols-3 gap-3 mt-6">
  <div className="card">…</div>
  <div className="card">…</div>
  <div className="card">…</div>
</div>

<div className="container mx-auto">
  <p className="p2">Constrained-width content</p>
</div>
```

## Modals

Every modal needs `role="dialog"`, `aria-modal="true"`, and an accessible name. Move focus into the modal on open, trap focus inside, and close on Escape and overlay click. See [`.ai/accessibility.md` → Modals](./accessibility.md#modals-roledialog) for the full keyboard contract.

```tsx
<div
  className="modal-container"
  role="dialog"
  aria-modal="true"
  aria-labelledby="confirm-title"
  onClick={onClose}
>
  <div className="modal" onClick={(e) => e.stopPropagation()}>
    <h4 className="h4" id="confirm-title">
      Reset leaderboard?
    </h4>
    <p className="p2">This permanently deletes every score for this asset.</p>
    <div className="actions">
      <button type="button" className="btn btn-outline" onClick={onClose}>
        Cancel
      </button>
      <button type="button" className="btn btn-danger" onClick={onConfirm}>
        Reset
      </button>
    </div>
  </div>
</div>
```

Toasts and other non-modal status messages should use `role="status"` (polite) or `role="alert"` (assertive) so screen readers announce them:

```tsx
<div className="toast" role="status" aria-live="polite">
  Badge unlocked: {name}
</div>
```

## Custom Project CSS

When you need themed visuals beyond what the SDK provides — gradients, glows, animated effects, full-viewport backgrounds — define them in `client/src/styles/` and consume them via app-prefixed classes.

### Tokens (`styles/tokens.css`)

```css
:root {
  /* Brand */
  --er-cyan: #1be0f2;
  --er-gold: #f6b300;

  /* Surfaces */
  --er-bg-deep: #050b18;

  /* Gradients */
  --er-grad-card-running: linear-gradient(135deg, rgba(27, 224, 242, 0.15), rgba(155, 123, 255, 0.1));

  /* Shadows */
  --er-shadow-card-running: 0 0 32px rgba(27, 224, 242, 0.35);
}

/* Re-add the box-sizing reset that Tailwind preflight used to provide. */
*,
*::before,
*::after {
  box-sizing: border-box;
}
```

### Components (`styles/components.css`)

```css
/* Themed variants on top of the SDK's .card */
.er-card {
  position: relative;
  overflow: hidden;
}

.er-card--running {
  background: var(--er-grad-card-running);
  border-color: var(--er-cyan);
  box-shadow: var(--er-shadow-card-running);
}

/* Full-viewport background */
body {
  margin: 0;
  background: var(--er-grad-card-violet);
  background-attachment: fixed;
  background-size: cover;
}

/* Keep a visible focus ring on every custom interactive class. */
.er-tile:focus-visible {
  outline: 2px solid var(--er-cyan);
  outline-offset: 2px;
}

/* Honor the user's motion preference for decorative animation. */
.er-card--pulsing {
  animation: er-pulse 2s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .er-card--pulsing {
    animation: none;
  }
}
```

### Usage in JSX

```tsx
<div className="card er-card er-card--running">
  <h3 className="h3 er-title-gold">Game in progress</h3>
  <p className="p2">…</p>
</div>
```

`er-card--running` is unlayered → it wins over `.card` from the SDK layer. No specificity hacks.

## Common Mistakes to Avoid

### ❌ Loading the SDK CSS via `<link>` in `index.html`

```html
<!-- ❌ Lands outside any cascade layer; project CSS can't override without
     specificity hacks or !important. -->
<link href="https://sdk-style.s3.amazonaws.com/styles-3.0.2.css" rel="stylesheet" />
```

```css
/* ✅ Import into the sdk layer from index.css instead. */
@import url("https://sdk-style.s3.amazonaws.com/styles-3.0.2.css") layer(sdk);
```

### ❌ Leaving Tailwind preflight enabled

Tailwind v3's preflight is hoisted past your `@layer tailwind { … }` wrapper at build time. It then overrides SDK typography defaults (heading sizes, link colors, list resets) because it ends up in the unlayered cascade. Disable it:

```js
// tailwind.config.js
corePlugins: { preflight: false };
```

### ❌ Recreating SDK components with Tailwind

```tsx
// ❌
<button className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600">Click</button>

// ✅
<button className="btn">Click</button>
```

### ❌ Using `!important` to "win" over SDK styles

If a project class isn't winning, the cascade-layer setup is wrong — not the specificity. Check that:

1. The SDK CSS is loaded via `@import url(...) layer(sdk)`, not `<link>`.
2. The class is defined in an unlayered stylesheet (no `@layer { … }` wrapper in `tokens.css` / `components.css`).
3. Tailwind preflight is disabled.

### ❌ Inline styles for static values

```tsx
// ❌
<div style={{ padding: '1rem', backgroundColor: 'white', borderRadius: '0.5rem' }}>…</div>

// ✅
<div className="card">…</div>

// ✅ Inline styles ARE OK for dynamic values
<div className="timer-bar" style={{ width: `${percentRemaining}%` }} />
```

### ❌ Relative imports

```tsx
// ❌
import { SomeComponent } from "../../components/SomeComponent";

// ✅
import { SomeComponent } from "@/components";
```

### ❌ Not using GlobalContext for errors

```tsx
// ❌
const [error, setError] = useState<string | null>(null);
try {
  // …
} catch (err) {
  setError("An error occurred");
}

// ✅
const dispatch = useContext(GlobalDispatchContext);
try {
  // …
} catch (err) {
  setErrorMessage(dispatch, err as ErrorType);
}
```

## Component Structure Pattern

All components must follow this structure:

```tsx
// Imports grouped by type
import { useContext, useState } from "react";

// components (using aliased imports)
import { PageContainer } from "@/components";

// context
import { GlobalDispatchContext, GlobalStateContext } from "@/context/GlobalContext";
import { ErrorType } from "@/context/types";

// utils
import { backendAPI, setErrorMessage } from "@/utils";

// Types defined outside the component
interface ComponentProps {
  // Props definition
}

// Component implementation
export const ComponentName = ({ prop1, prop2 }: ComponentProps) => {
  const dispatch = useContext(GlobalDispatchContext);
  const [localState, setLocalState] = useState(initialValue);

  const handleEvent = async () => {
    try {
      // Implementation using SDK classes and error handling
    } catch (err) {
      setErrorMessage(dispatch, err as ErrorType);
    }
  };

  return (
    <div className="container">
      <h2 className="h2">Title</h2>
      <div className="card">{/* Content using SDK classes */}</div>
    </div>
  );
};

export default ComponentName;
```

## Pre-Implementation Checklist

- [ ] `client/src/index.css` declares `@layer tailwind, sdk;`, imports SDK CSS via `@import url(...) layer(sdk)`, imports `styles/*.css` unlayered, and wraps `@tailwind` directives in `@layer tailwind { … }`
- [ ] `client/index.html` does **not** `<link>` the SDK stylesheet (it's loaded from `index.css`)
- [ ] `client/tailwind.config.js` sets `corePlugins: { preflight: false }`
- [ ] `client/src/styles/tokens.css` exists with design tokens (and a `box-sizing: border-box` reset)
- [ ] Custom CSS class names use an app-specific prefix (`.app-name-*`)
- [ ] You've read [`.ai/accessibility.md`](./accessibility.md) and have the patterns for icon buttons, form labels, modals, and motion in mind
- [ ] You've examined the relevant examples in `.ai/examples/` and the `sdk-escape-room` reference

## Validation Process

After implementation, verify:

**CSS architecture**

- [ ] SDK classes are used for buttons, cards, typography, form inputs, and modals
- [ ] Tailwind utilities are only used for layout/spacing — not for replicating component styles
- [ ] Custom CSS lives in `styles/*.css` and is unlayered
- [ ] No `!important` anywhere
- [ ] No inline styles except for genuinely dynamic values
- [ ] Imports use aliased paths (`@/components`, `@/utils`, …)
- [ ] Errors flow through `GlobalDispatchContext` / `setErrorMessage`
- [ ] DevTools' "Layers" pane shows `tailwind` → `sdk` → unlayered in priority order

**Accessibility** (full checklist in [`.ai/accessibility.md`](./accessibility.md))

- [ ] Every interactive element is a `<button>` / `<a>` / `<input>` — no `<div onClick>`
- [ ] Every `<button>` inside a form has an explicit `type="button"` unless it's the submit
- [ ] Icon-only buttons have `aria-label`; decorative `<img>` has `alt=""` + `aria-hidden="true"`
- [ ] Every form input has an associated `<label>`
- [ ] Modals declare `role="dialog"`, `aria-modal="true"`, an accessible name, trap focus, and close on Escape
- [ ] Toasts / live updates use `role="status"` (polite) or `role="alert"` (assertive)
- [ ] Custom interactive classes keep a visible `:focus-visible` ring
- [ ] Animations are gated on `@media (prefers-reduced-motion: reduce)`
- [ ] Keyboard-only walkthrough completes successfully
- [ ] VoiceOver / NVDA spot-check announces every button + every status update
- [ ] Lighthouse / axe DevTools shows no serious or critical findings

Remember: SDK classes are the design system, Tailwind is for layout, custom CSS is for theming, and accessibility is baked into every component — not a finishing pass.
