# dialog-css

Registry item `dialog-css` (files: `styles/dialog-css.css`; depends on `variables`). Plain CSS: no Tailwind, no React, no Ark. The look and the behavior of the React `dialog` item, on the browser's own `<dialog>`.

## Markup contract

Import `styles/variables.css` and `styles/dialog-css.css` (and `styles/button-css.css` for the buttons below).

```html
<button type="button" class="ds-btn ds-btn-secondary" id="share-open">Share</button>

<dialog id="share" class="ds-dialog" aria-labelledby="share-title" aria-describedby="share-body">
  <div class="ds-dialog-surface">
    <h2 id="share-title">Share this page</h2>
    <p id="share-body">Anyone with the link can see this page.</p>
    <button type="button" class="ds-btn ds-btn-primary" data-close>Done</button>
  </div>
</dialog>
```

- `ds-dialog` is the box: centered by `inset-block: var(--ds-dialog-top) calc(100dvh * var(--ds-view-lift, 0.2) + var(--ds-dialog-top))`, `inset-inline: 0` and `margin: auto` (`--ds-dialog-top` is the top gap, 24px, or the notch inset when that is larger: `max(calc(var(--ds-spacing) * 6), env(safe-area-inset-top, 0px))`), a band symmetric about 40% of the viewport, so the box's middle sits at 40% (`--ds-view-lift`, from `variables`; no translate, and no scale once it has scaled in, so a `position: fixed` panel inside, such as a `menu-css` panel without `popover`, is placed against the viewport and not held or clipped by the box), the `--shadow-floating` elevation and a 1px `--hairline` edge (the sheet draws the edge only from 40rem, where it stops filling the viewport), the card corner, at most the height of the band it is centered in, the viewport minus the lift and twice the gap (`min(90dvh, calc(100dvh * (1 - var(--ds-view-lift, 0.2)) - 2 * var(--ds-dialog-top)))`, so a tall box stops the gap below the top) and scrolling inside past that with a thin scrollbar. Geometry, elevation, edge and corner only, as the React box: it paints no background. Under 40rem every size is 90% wide.
- The size scale, from 40rem: the bare `ds-dialog` is 512px (React's `sm`, the default); `ds-dialog-panel` 448px, for prompts and confirms; `ds-dialog-md` 672px; `ds-dialog-lg` 768px; `ds-dialog-sheet` a 480px box that is the whole viewport under 40rem, with no corner, as React's `sheet`.
- `ds-dialog-surface` is the content's surface: the `--popover` fill, gray-12 text, the card corner and 24px inside. In a `ds-dialog-sheet` it fills the sheet and scrolls its own height there with the thin scrollbar, so a form taller than the phone keeps its submit in reach; under 40rem, where the sheet is the whole viewport, it has no corner.
- `ds-dialog-title` (18px bold display) and `ds-dialog-desc` (14px gray-11, 2px under the title) are the surface's heading and the sentence under it, with the sheet's values; the React `Modal` has no visible title of its own, so they are this item's alone. Point `aria-labelledby` and `aria-describedby` at them.
- `ds-dialog-foot` is the footer, 24px under the content, and holds `ds-dialog-actions`: the buttons at the end of the row with the primary last. Under 40rem they stack at full width, with the primary at the bottom.
- The scrim is the dialog's `::backdrop`, `--overlay` over the page.
- `ds-dialog-preview`, beside `ds-dialog` on a dialog with the `open` attribute, draws its scrim as a `--overlay` shadow spread on the box (`.ds-dialog-preview[open]:not(:modal)`, `z-index` 50), because `::backdrop` exists only in the modal top layer. It is for previews, docs and tests: not modal, with no focus trap, and the page stays interactive and scrollable. It is opt-in, so an `open` dialog without it, or one opened with `show()`, draws no scrim and does not dim the page. Call `showModal()` in production.
- The box scales and fades in over `--duration-fast`, the scrim over `--duration-base`, easing out; both leave the same way. A browser that cannot keep a closing dialog in the top layer drops it at once.

## Behavior

Open it with `showModal()` in production, not the `open` attribute (which is for previews with `ds-dialog-preview`, see above): only `showModal()` puts it in the top layer, traps focus, makes the page behind inert and closes it on Escape. The browser then moves focus into it (to the first focusable control, or the one with `autofocus`) and, on close, returns focus to the element that had it at open. No script ships with the item; these lines are the rest of the React dialog's behavior:

```js
const dialog = document.getElementById("share");
document.getElementById("share-open").addEventListener("click", () => dialog.showModal());
dialog.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) dialog.close();
});
// a press on the scrim, outside the box, closes it
dialog.addEventListener("pointerdown", (e) => {
  if (e.target !== dialog || "busy" in dialog.dataset) return;
  const r = dialog.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (!inside) dialog.close();
});
// busy: Escape does nothing while a submit is in flight
dialog.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && "busy" in dialog.dataset) e.preventDefault();
});
dialog.addEventListener("cancel", (e) => {
  if ("busy" in dialog.dataset) e.preventDefault();
});
```

- Busy: set `data-busy` on the `<dialog>` while a submit is in flight and remove it after. Escape and a press on the scrim then leave it open; your own close controls still close it, so disable them yourself if they must not. The `keydown` line is the one that holds: a browser may skip the `cancel` event for a second Escape in a row.
- While a modal `ds-dialog` is open, `<html>` takes `overflow: hidden`, so the page behind does not scroll. Where scrollbars take room (Windows, or macOS set to always show them) the page loses its scrollbar and shifts sideways by its width. CSS cannot tell whether the page had one, so the item does not reserve the gutter (that would shift a short page the other way); a page that scrolls can set `scrollbar-gutter: stable` on `:root` to keep it still. The React `Modal` pads `<html>` by the scrollbar's width instead.
- Anything floating over an open dialog (a listbox, a menu, a toast) lives inside the `<dialog>` element, or is itself in the top layer: a `popover` shown after the dialog opened. The dialog is in the top layer, where no `z-index` reaches, and the page outside it is inert, so anything placed outside it (appended to `<body>`) renders under the scrim and cannot be clicked.
- Focus return: when the opener has left the page by the time the dialog closes (a row the dialog's own action removed), the browser has nowhere to return focus and it lands on `<body>`. Focus a stand-in yourself in a `close` listener.

## Accessibility

- Name it: `aria-labelledby` pointing at its visible heading, or `aria-label` when it shows none. `aria-describedby` points at the sentence that says what it is for.
- `<dialog>` opened with `showModal()` is a modal dialog to assistive tech; the page behind it is inert until it closes.
- Under `prefers-reduced-motion` the motion collapses with the speed ladder in `variables`.

## Theming

Reads roles from `variables` (`--overlay`, `--shadow-floating`, `--hairline`, `--popover`, `--ring`, `--gray-6`, `--gray-12`, the speeds), so `data-theme`, `.dark` and `.light` recolor it: the dialog stays where it is in the page, so it takes the theme of the element it sits in, scrim included. The container widths and the easings Tailwind owns are declared on the class as `--ds-*` with the same values. The widths and the breakpoint are in rem, so the box follows the reader's browser font size; the sheet's 480px is in px, as the React one's is. Each of those rem sizes is declared as `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root and gets this size back (see the `variables` note). The breakpoints stay in rem: in a media query rem is the browser's default font size, so a host's root size does not move them. The corner comes from `variables` and stays in rem.
