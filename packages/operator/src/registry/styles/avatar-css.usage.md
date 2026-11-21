# avatar-css

Registry item `avatar-css` (files: `styles/avatar-css.css`; depends on `variables`). Plain CSS: no Tailwind, no build step. The look of the `avatar` item for a page that has only `variables`.

## Markup contract

Import `styles/variables.css` and `styles/avatar-css.css`.

```html
<span class="ds-avatar" role="img" aria-label="Maya Reyes">
  <span aria-hidden="true">MR</span>
  <img class="ds-avatar-img" src="/people/maya.webp" alt="">
</span>

<span class="ds-avatar ds-avatar-lg ds-avatar-square ds-avatar-logo" role="img" aria-label="Spring clean-up fund">
  <span aria-hidden="true">SC</span>
  <img class="ds-avatar-img" src="/logos/spring.svg" alt="">
</span>

<span class="ds-avatar ds-avatar-xs ds-avatar-logo" role="img" aria-label="Apple Pay">
  <img class="ds-avatar-img" src="/logos/apple-pay.svg" alt="">
</span>

<button type="button" class="ds-avatar" aria-label="Account menu" aria-haspopup="menu" aria-expanded="false">
  <span aria-hidden="true">AL</span>
</button>

<span class="ds-avatar-group" role="group" aria-label="Maya Reyes, Dan Ortiz and 11 more supporters">
  <span class="ds-avatar ds-avatar-sm" role="img" aria-label="Maya Reyes">…</span>
  <span class="ds-avatar ds-avatar-sm" role="img" aria-label="Dan Ortiz">…</span>
  <span class="ds-avatar ds-avatar-sm ds-avatar-more" aria-hidden="true">+11</span>
</span>
```

- `ds-avatar`: a 32px circle, initials (the first letter of the first and the last word) uppercase at weight 700 in `--accent-12` on `--secondary`. Sizes: `ds-avatar-xs` 14px, `ds-avatar-sm` 24px, bare 32px, `ds-avatar-lg` 40px, `ds-avatar-xl` 64px, `ds-avatar-2xl` 96px, with the initials at 12, 12, 14, 20 and 30px (none at `ds-avatar-xs`).
- `ds-avatar-xs` is 14px and only for logos, flags and coin marks in a compact control. It always draws the logo tile and never draws initials or a glyph, so give it an image or leave the avatar out. It has no `+N` chip and no button or link form. Its ring is 1.5px. `ds-avatar-logo` beside it changes nothing; it draws no hairline. Its `color` is `--accent-12`; a mark in the `<img>` keeps its own colors.
- `ds-avatar-img`: an `<img alt="">` that fills the avatar over the initials, cropped to cover. The initials show while it loads; remove the image on its `error` event so they show if it fails.
- No name: lucide's `user-round` as an `<svg aria-hidden="true">` child, drawn at 55%; give the avatar `aria-hidden="true"`.
- `ds-avatar-square`: the control corner (`--radius`) up to `ds-avatar-lg`, the card corner (`--radius-card`) on `ds-avatar-xl` and `ds-avatar-2xl`.
- `ds-avatar-logo`: a logo tile, the page fill (`--gray-1`) with a 1px `--hairline` edge, the image contained.
- A `<button class="ds-avatar">` or `<a class="ds-avatar" href>` is a control: `--secondary-hover` hovered (where the pointer can hover), `--secondary-active` pressed and while `aria-expanded="true"` (under forced colors, which drop the fill, a 2px `Highlight` outline 2px out marks it held), a 2px `--ring` outline 2px outside on focus, and a hit area at least `--ds-hit-target` (24px, 44px on a coarse pointer; declared by `variables`) square, centred, without changing the drawn size.
- `ds-avatar-group`: a stack, each avatar a quarter of its size (3.5px at `ds-avatar-xs`) over the one before, the last on top, with a 2px ring (1.5px at `ds-avatar-xs`; `--ds-avatar-ring-w`) between them in `--ds-avatar-ring-on`, which is `--background` when unset. The ring is the surface the stack sits on: set `--ds-avatar-ring-on: var(--card)` on a group that sits on a card. On a surface that changes fill (a pill, a primary button), set `--ds-avatar-ring-on` on the host to the host's own fill for each state. The old `--ds-avatar-ring` still works as the fallback. Under forced colors, which drop the ring, each avatar gets a 1px `CanvasText` outline. A group inside a control is `aria-hidden="true"` and takes no `aria-label`.
- `ds-avatar-more`: the overflow chip, "+N", `--gray-3` fill and `--gray-12` ink; give it the avatars' size class and `aria-hidden="true"`, and say the count in the group's label.

## Accessibility

- Informative: `role="img"` and `aria-label` with the name; the initials `aria-hidden="true"`, the image `alt=""`.
- Beside a visible name: `aria-hidden="true"` on the avatar.
- A control is named by its `aria-label`.
- A group is `role="group"` with an `aria-label` that names who and how many; a group inside a control is `aria-hidden="true"` with neither.

## Theming

Reads only roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, the type sizes, the weight and the easing Tailwind owns are declared on the classes as `--ds-*` with the same values; the sizes are in rem, so the avatar follows the reader's browser font size. Each is `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). A test holds the look equal to the React `Avatar` and `AvatarGroup` in light and dark, in the default and the example themes.
