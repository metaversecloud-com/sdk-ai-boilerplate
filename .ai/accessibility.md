# Accessibility (a11y)

Every Topia drawer app must be usable by people who navigate with a keyboard, a screen reader, low-vision settings, or a motion-sensitivity preference. This is not optional — Topia hosts educational content, so the drawer regularly reaches students who depend on assistive tech, and WCAG 2.1 AA is the baseline expected in most jurisdictions.

The drawer is small (~400 px wide). That constraint actually helps: every screen has limited content, so labeling, focus order, and contrast must be deliberate from the start.

## Quick Checklist

Before sending a PR for any client-facing change:

- [ ] Every interactive element is `<button>`, `<a>`, or `<input>` — never `<div onClick>` / `<span onClick>`.
- [ ] Icon-only buttons have `aria-label`; decorative images have `alt=""` (or `aria-hidden="true"`); meaningful images have descriptive `alt`.
- [ ] Every form input has an associated `<label>` (via `htmlFor`/`id`, or by wrapping the input).
- [ ] Modals use `role="dialog"`, `aria-modal="true"`, an `aria-labelledby` (or `aria-label`), trap focus, and close on Escape.
- [ ] Toasts / score updates use `role="status"` or `aria-live="polite"` so screen readers announce them.
- [ ] Tab order matches visual order; every interactive element has a visible focus ring (`:focus-visible`).
- [ ] No information conveyed by color alone — pair red/green/etc. with an icon, text, or shape.
- [ ] All text/background and UI/background contrast combinations meet WCAG AA (4.5:1 for body text, 3:1 for ≥18 px or bold ≥14 px and for UI components/state borders).
- [ ] Animations honor `@media (prefers-reduced-motion: reduce)` — disable transforms/opacity sweeps, keep state changes.
- [ ] Touch targets are at least 44×44 px (the SDK's `.btn` already meets this; check any custom icon buttons).

## Patterns

### Semantic elements

```tsx
// ❌ Loses keyboard support, screen reader announcement, and disabled state.
<div className="btn" onClick={handleStart}>Start</div>

// ✅
<button type="button" className="btn" onClick={handleStart}>
  Start
</button>
```

For navigation between drawer states use `<button>` even if it doesn't change the URL — `<a>` without an `href` is not focusable and not announced as a link.

### Icon-only buttons

The icon image should be decorative; the button itself carries the accessible name.

```tsx
// ❌ Screen reader announces "button" with no label; sighted users see an icon, AT users get nothing.
<button className="btn btn-icon">
  <img src="https://sdk-style.s3.amazonaws.com/icons/edit.svg" />
</button>

// ✅
<button type="button" className="btn btn-icon" aria-label="Edit">
  <img src="https://sdk-style.s3.amazonaws.com/icons/edit.svg" alt="" aria-hidden="true" />
</button>
```

If the same icon repeats in a list, vary the label so it's contextual: `aria-label="Edit fruit set"` rather than just `aria-label="Edit"`.

### Form inputs

Associate every input with its label — either by `htmlFor`/`id` or by wrapping. Don't rely on `placeholder` as a label; it disappears once the user starts typing and has poor contrast.

```tsx
// ✅ Explicit association
<label className="label" htmlFor="set-title">Set title</label>
<input id="set-title" className="input" type="text" />

// ✅ Wrapping — no id needed
<label className="label">
  Set title
  <input className="input" type="text" />
</label>

// Multi-state announcement
<label className="label" htmlFor="set-title">Set title</label>
<input
  id="set-title"
  className={`input ${hasError ? "input-error" : ""}`}
  type="text"
  aria-invalid={hasError}
  aria-describedby={hasError ? "set-title-error" : undefined}
/>
{hasError && (
  <p id="set-title-error" className="p3 text-error" role="alert">
    Title is required.
  </p>
)}
```

`role="alert"` (or `aria-live="assertive"`) interrupts the screen reader to announce the error immediately. Use it sparingly — only when the user must respond now.

### Modals (`role="dialog"`)

Every drawer-level modal needs five things:

1. `role="dialog"` + `aria-modal="true"` on the overlay container.
2. An accessible name via `aria-labelledby` pointing at the heading id (or `aria-label` if there's no visible heading).
3. **Focus moved into the modal** when it opens (usually to the close button or primary action).
4. **Focus trapped** inside while it's open — Tab cycles within, doesn't escape.
5. **Esc closes** the modal, and **clicking the overlay** closes it (with `stopPropagation` on the inner panel).

```tsx
import { useEffect, useRef } from "react";

interface ConfirmationProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmationModal = ({ title, message, onConfirm, onClose }: ConfirmationProps) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Move focus to the close button when the modal mounts.
    closeButtonRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-container"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmation-title"
      onClick={onClose}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h4 className="h4" id="confirmation-title">
          {title}
        </h4>
        <p className="p2">{message}</p>
        <div className="actions">
          <button ref={closeButtonRef} type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger-outline" onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};
```

Focus trapping (Tab cycling) is omitted above for brevity; for production modals add a small util or use [`focus-trap-react`](https://github.com/focus-trap/focus-trap-react). The protected boilerplate `ConfirmationModal` already implements Escape + overlay click — extend the same pattern in custom modals.

### Toasts and live announcements

Toasts, score updates, badge unlocks, and any other content that appears without the user initiating it should be announced.

```tsx
// Non-urgent status (score change, badge unlocked, save confirmed)
<div className="toast" role="status" aria-live="polite">
  Badge unlocked: {badge.name}
</div>

// Urgent (form blocks submission, time about to run out)
<div className="toast toast-error" role="alert">
  Time's almost up!
</div>
```

`role="status"` ≈ `aria-live="polite"`: announces at the next pause. `role="alert"` ≈ `aria-live="assertive"`: interrupts. Don't make every feedback message assertive — it makes screen readers unusable.

### Focus management

- Every focusable element gets a visible focus ring. The SDK's `.btn`/`.input` provide this; if you add custom interactive classes, **do not** remove the outline without replacing it:

  ```css
  /* ❌ Strips the focus ring with nothing to replace it. */
  .app-tile:focus {
    outline: none;
  }

  /* ✅ Replace with a visible :focus-visible style. */
  .app-tile:focus-visible {
    outline: 2px solid var(--app-primary);
    outline-offset: 2px;
  }
  ```

- When switching views (tab change, modal open, page navigation) move focus into the new content so keyboard users don't get stranded.
- Don't autofocus inputs on every page — it's disorienting. Reserve autofocus for modals that the user explicitly opened to fill in.

### Color and contrast

- WCAG AA minimums: **4.5:1** for normal-weight body text, **3:1** for ≥18 px (or bold ≥14 px) and for UI component edges / state indicators.
- Tools: macOS Digital Color Meter, the WebAIM contrast checker, Chrome DevTools' Lighthouse a11y audit.
- The SDK palette is AA-compliant on standard surfaces. When you introduce a custom background or gradient, re-check every text color over it.
- Never use color alone to communicate state. Pair it with an icon, label, shape, or position:

  ```tsx
  // ❌ Only the border color signals "error".
  <input className="input input-error" />

  // ✅ Color + an icon + text + aria-invalid.
  <input className="input input-error" aria-invalid />
  <p className="p3 text-error">
    <img src="https://sdk-style.s3.amazonaws.com/icons/error.svg" alt="" aria-hidden="true" />
    Title is required.
  </p>
  ```

### Motion

Respect `prefers-reduced-motion` for anything that moves, scales, or fades persistently:

```css
.app-card--running {
  animation: pulse 2s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .app-card--running {
    animation: none;
  }
}
```

For keyframe-heavy designs (confetti, slides, full-viewport drains), wrap the whole animation declaration:

```css
@media (prefers-reduced-motion: no-preference) {
  .app-celebrate {
    animation: confetti-rain 1.6s cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
  }
}
```

In React, gate JS-driven animations on the same media query:

```ts
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (!reducedMotion) {
  confetti({ particleCount: 100, spread: 70, origin: { y: 0.4 } });
}
```

### Touch targets

The SDK's `.btn` is already at the recommended 44×44 px minimum. If you build a custom interactive element (an inventory tile, a board square, a topping chip), check that the **clickable region** is at least 44×44 — `padding` counts. Visual size can stay small if you grow the hit area with padding or absolute-positioned `::before` overlays.

## What the SDK gives you (and what it doesn't)

- ✅ The SDK CSS provides high-contrast text, focus rings on `.btn`/`.input`, and reasonable touch sizes.
- ❌ The SDK does **not** label your buttons, write your `aria-*` attributes, manage focus when modals open, or gate animations on `prefers-reduced-motion`. Those are your responsibility per component.

## Testing

Before merging:

1. **Keyboard-only walkthrough** — unplug your mouse. Tab through every interactive element. Open and dismiss every modal with Enter/Esc. The drawer should remain operable.
2. **Screen reader spot-check** — macOS VoiceOver (Cmd + F5) or Windows NVDA. Walk through one full game/session. Every button should announce a name, every form input should announce its label, every status update should be spoken.
3. **Reduced motion** — toggle macOS System Settings → Accessibility → Display → "Reduce motion". Reload the drawer. Confetti, slide-ins, pulses should stop or shorten dramatically.
4. **High contrast / dark schemes** — toggle macOS "Increase contrast" / Windows high-contrast mode. Verify focus rings and state borders remain visible.
5. **Browser zoom** — Cmd/Ctrl `+` until the drawer is at 200%. Content should reflow without horizontal scrolling.
6. **Lighthouse / axe** — run Chrome DevTools' "Accessibility" audit (Lighthouse) or the [axe DevTools](https://www.deque.com/axe/devtools/) extension. Aim for zero serious/critical findings.

## When in doubt

- Look at how the existing protected components (`PageContainer`, `ConfirmationModal`) are structured and follow the same conventions.
- The shipped SDK CSS classes are accessible by default — using them is almost always more accessible than writing a Tailwind/custom equivalent.
- If a layout requires a custom interactive widget (combobox, drag-and-drop list, custom slider), reach for an accessible primitive library (Radix, React Aria) rather than inventing the keyboard/aria contract from scratch.

## References

- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) — canonical patterns for dialogs, tabs, comboboxes, menus
- [Inclusive Components by Heydon Pickering](https://inclusive-components.design/) — practical write-ups of accessible UI patterns
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
