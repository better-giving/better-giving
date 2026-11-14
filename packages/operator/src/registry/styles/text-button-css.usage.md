# text-button-css

Registry item `text-button-css` (files: `styles/text-button-css.css`; depends on `variables`). Plain CSS: no Tailwind, no build step. The look of the `text-button` item for a page that has only `variables`.

## Markup contract

Import `styles/variables.css` and `styles/text-button-css.css`. A text button is a `<button type="button">` with `ds-text-btn` and, optionally, one tone and one size:

```html
<p>Saved 2 minutes ago. <button type="button" class="ds-text-btn">Undo</button></p>
<button type="button" class="ds-text-btn ds-text-btn-primary ds-text-btn-sm">Show all</button>
```

- Tones: bare `ds-text-btn` is neutral (`--gray-11`, `--gray-12` hovered and pressed); `ds-text-btn-primary` (`--link`, then `--link-hover`); `ds-text-btn-destructive` (`--destructive-subtle-fg`, then `--destructive-12`). Each hover is the next step of the same Radix text role.
- Sizes: bare takes the font size and line of the text around it. `ds-text-btn-xs`, `ds-text-btn-sm`, `ds-text-btn-base` and `ds-text-btn-lg` set the type ladder's 12, 14, 16 and 18px steps with their lines.
- Weight 600 in every state. No underline at rest, hovered or pressed: only a real `<a href>` underlines.

## States

- Hover (where the pointer can hover) and press take the hover ink; a press also nudges 1px down.
- `disabled`, or `aria-disabled="true"` on a button that must keep focus so a reason can be shown: opacity .6, `not-allowed`, no hover ink. Stop an `aria-disabled` button's click in script (`preventDefault` also stops a submit).
- In flight, `aria-busy="true"` (with `aria-disabled="true"`, so focus stays): `--gray-11`, no pointer events, and a turning glyph before an "…" label. The glyph is lucide's `loader-circle` as an `<svg class="ds-text-btn-spin" aria-hidden="true">`; it turns on `ds-spin` once a second and stands still under `prefers-reduced-motion: reduce`.
- Done, `data-done="true"`: `--success-subtle-fg`, no pointer events, lucide's `check` as an `<svg aria-hidden="true">` before the done label. Ignore the click in script while it shows (Enter and Space still click a focused button), and after 2000ms put the label back and `data-done="false"`.
- A glyph inside is 1em, 4px before the words, middle-aligned.
- Say a busy or done change in a `role="status"` region of the page's own, mounted empty at rest.
- Focus shows a 2px `--ring` outline 2px outside.

## Accessibility

- A `<button>` for an action; an `<a href>` for navigation.
- Hit area: a `::after` one line tall plus what `--ds-hit-target` needs (24px, 44px on a coarse pointer; declared by `variables`), and at least that wide, centred on the label, without changing the drawn box or its line. The button is `position: relative` for it. Where the areas of two neighbours meet, the later one takes the tap.

## Theming

Reads only roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, the type sizes, the weight and the easing Tailwind owns are declared on the class as `--ds-*` with the same values; the sizes are in rem, so the button follows the reader's browser font size. Each is `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). A test holds the look equal to the React `TextButton` in light and dark, in the default and the example themes.
