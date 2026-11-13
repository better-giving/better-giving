# button-css

Registry item `button-css` (files: `styles/button-css.css`; depends on `variables`). Plain CSS: no Tailwind, no build step. The look of the `button` item for a page that has only `variables`.

## Markup contract

Import `styles/variables.css` and `styles/button-css.css`. A button is a `<button>` or `<a>` with `ds-btn`, one variant class and, optionally, one size class:

```html
<button type="button" class="ds-btn ds-btn-primary">Save</button>
<a href="/next" class="ds-btn ds-btn-secondary ds-btn-sm">Next</a>
```

- Variants (pick one): `ds-btn-primary`, `ds-btn-secondary`, `ds-btn-ghost`, `ds-btn-soft` (the neutral rank between ghost and secondary, for toolbars and row actions: `--gray-3`, `--gray-4` hovered, `--gray-5` pressed, no visible edge, no nudge), `ds-btn-outline`, `ds-btn-destructive`, `ds-btn-destructive-outline` (a destructive action that opens a confirm step; keep `ds-btn-destructive` for the confirm), `ds-btn-success`, `ds-btn-warning`, `ds-btn-inverse` (on a `--primary` fill), `ds-btn-inverse-deep` (on the `--primary-deep` ground: a `--primary-deep-fg` fill with `--primary-deep` ink), `ds-btn-form-primary` (a fill from the `--form-*` slots).
- Sizes: bare `ds-btn` is the md tier (36px). `ds-btn-sm` (24px), `ds-btn-lg` (52px), `ds-btn-field` (50px, the height of a form field, for a button beside one). `ds-btn-md` is a name only, for stepping back to md after another size. Every variant at a size is that height, edged or not: each carries an edge (transparent where none shows) whose width comes out of the vertical padding, so buttons side by side, and the `ds-btn-icon` square, line up.
- Modifiers: `ds-btn-icon` squares a button on its tier's height (icon only; add an `aria-label`). `ds-btn-sentence` keeps the label's case.
- An icon beside the label is an `<svg aria-hidden="true">` child, before the label or, for a chevron, after it. The gap is `--spacing × 2` (8px) at md, lg and field, `× 1.5` (6px) at sm; the icon is 16px at md, 14px at sm, 20px at lg. A class on the icon can size it instead, wherever its stylesheet loads: the icon rule has no specificity. Padding does not change.
- Every class carries the `ds-` prefix, so it does not collide with the `btn-*` classes of `tokens`.

## States

- Hover and press come from the class. `ds-btn-destructive-outline` fills `--destructive-subtle` on hover and `--destructive-subtle-active` pressed, with no nudge; disabled, busy or a disabled link, its edge goes to `--gray-7` with the gray fill. `ds-btn-inverse` and `ds-btn-inverse-deep` take the shared gray disabled and busy look, as the Tailwind `btn-inverse` and `btn-inverse-deep` do. A press nudges filled variants 1px down.
- Hover and press colors (fill, edge and ink) change over `--duration-fast` with the ease-in-out curve, as on the Tailwind `.btn`. Under `prefers-reduced-motion: reduce`, `variables` collapses `--duration-fast`, so the change is immediate; the press nudge is not animated. A test that reads a hover or press color should wait for the transition to finish (`element.getAnimations()`).
- `disabled` on a `<button>`, or `aria-disabled="true"` on an `<a>`, shows the disabled fill and ink. Anchors that are `aria-disabled` also stop taking pointer events; block the click in script, because the attribute alone does not stop keyboard activation.
- `aria-disabled="true"` on a `<button>` shows the same look with a not-allowed cursor and no press nudge, but the button stays focusable and keeps its pointer events, so a tooltip or an `aria-describedby` line can say why it is off. Stop the click in script (`preventDefault` on it also stops a submit).
- Held open: `aria-expanded="true"` on a button that opens a menu or popover holds its pressed rung with no nudge: `--gray-5` on secondary, ghost and soft, `--primary-hover` on primary, the 15% mix on outline, `--destructive-subtle-active` on destructive-outline. A trailing chevron with `ds-btn-chevron` turns 180° over `--duration-fast`, at once under reduced motion. No menu part ships here.
- Toggle: `aria-pressed="true"` on secondary, soft or ghost fills `--secondary-active` (accent 5) with `--accent-12` ink; secondary also takes an `--accent-7` edge, `--accent-8` hovered. `aria-pressed="false"` is the plain button. A disabled toggle shows the disabled look.
- Done: `data-done="true"` after the work succeeded fills `--success-subtle` with `--success-subtle-fg` ink and no edge, and takes no pointer events while it shows; it stays focusable and is not the disabled look. Enter and Space still click the focused button, so ignore the click in script while it shows. Swap the label for the done label with a check icon before it, fill a `role="status"` region with the outcome (a region in the page from the start, empty at rest), and after 2000ms put the label, the icon and `data-done="false"` back. Give the button a `min-inline-size` that fits the longest label so the row does not shift. Never set it for a failed attempt; that is an error, not done. `aria-busy` stays the gray in-flight look.
- `aria-busy="true"` is the in-flight state: the disabled fill, no pointer events, and no hover look even while the pointer is still on it. It does not disable the control, so the label can say what is happening and focus stays put. Set `disabled` as well if it must not be submitted twice.
- Focus shows a 2px outline in `--ring` with a 2px offset (`--primary-ring` on `ds-btn-inverse`, `--primary-deep-fg` on `ds-btn-inverse-deep`, `--form-ring` on `ds-btn-form-primary`).

## Accessibility

- Use a `<button>` for an action and an `<a href>` for navigation.
- An icon-only button needs `aria-label`.
- Target size: `ds-btn-sm` is drawn at 24px. Where the pointer is coarse its hit area grows to 44px tall, and at least 44px wide, centred on it, through a `::after` on the button; the drawn size and the layout do not change. Every `ds-btn` is `position: relative` with no specificity, so a class of yours that positions it (a close button `absolute` in a corner) wins wherever its stylesheet loads, and the hit area still follows the button. Keep at least 20px between neighbouring icon-only `ds-btn-sm` buttons, or use md; where areas meet, the later button takes the tap.

## Theming

Reads only roles and scale steps from `variables` (`--primary`, `--gray-3`, `--ring`, `--radius` and so on), so `data-theme`, `.dark` and `.light` recolor it. The spacing and type sizes Tailwind owns are declared on the class as `--ds-*` with the same values. Those, the tier heights and the corner are in rem, so the button follows the reader's browser font size, while its edge and focus ring stay in px. A test holds the look equal to the Tailwind `.btn` in light and dark, in the default and example themes. Each of those rem sizes is declared as `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root and gets this size back (see the `variables` note). The corner comes from `variables` and stays in rem.
