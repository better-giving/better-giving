# card-css

Registry item `card-css` (files: `styles/card-css.css`; depends on `variables`). Plain CSS: no Tailwind. The look of the `card` item.

## Markup contract

Import `styles/variables.css` and `styles/card-css.css`:

```html
<section class="ds-card">
  <header class="ds-card-header"><h2>Plan</h2></header>
  <div class="ds-card-body">Seats, billing and usage.</div>
  <footer class="ds-card-footer"><button type="button">Upgrade</button></footer>
</section>
```

- `ds-card`: the container on the 12px corner, the card fill and a hairline edge, no shadow. It clips overflow so a slot's rule stays inside the corner.
- `ds-card-header`: a rule below it, 24px by 16px padding. A heading anywhere inside it has no margin and takes the header's size and line-height, in the display face at 700, so the header is the same height with or without a CSS reset. For a heading size, give the heading a class of your own, declared after `card-css.css`; beside a `ds-card-status`, size the header instead (below).
- `ds-card-status`: the box for a status, badge, count or icon beside text that can wrap (below).
- `ds-card-body`: 24px by 20px padding.
- `ds-card-footer`: the actions row, on the well fill one rung in from the card, with a rule above it. It is a flex row with a 12px gap.
- Use the slots you need. Use `<section>`, `<header>`, `<footer>` as above, or `<div>` for any of them.

### A status beside text that can wrap

A status, badge, count or icon beside text that can wrap sits on the text's first line, not in the middle of the block:

```html
<header class="ds-card-header title-lg">
  <h2>Food bank winter drive for families</h2>
  <span class="ds-card-status"><span>Ends soon</span></span>
</header>
```

- `ds-card-status` is a flex box exactly one line tall (`block-size: 1lh`), the mark centred in it, kept at its own width. `1lh` is the box's own line-height, which it inherits from its row.
- A `ds-card-header` with a `ds-card-status` as a direct child is the row: a flex row aligned to the start (`align-items: flex-start`), the title first and the status at the end, 8px apart. A one-line title looks as a centred row would; a wrapped one keeps the mark on its first line. Don't centre that row's items: it centres the box against the whole title again.
- Give the title's size to the header (a class of your own, `title-lg` above, setting `font-size` and `line-height`), not to the heading. The heading and the box then inherit the same size and line-height, so the box is one of the title's lines tall. A size on the heading alone gives it a taller line than the box, and the mark sits high.
- Any row of yours does the same: `display: flex; align-items: flex-start` on the row, `ds-card-status` around the mark, the text's size set on the row.
- The mark is yours: a badge from the `badge-css` item (add it alongside), a count or an icon. The plain `<span>Ends soon</span>` above stands in for it. `card-css` draws only the box around it.

### Create card

- `ds-card-create`: the card that starts making a new one, on an `<a href>` or a `<button type="button">`, with an icon (an inline `<svg aria-hidden="true">`, drawn at 20px; a class on the icon can size it instead, wherever its stylesheet loads) before the label. The 12px corner, a 1px dashed `--input` edge and no fill; the label in the display face at 700 and 16px, centred under the icon. In a grid it stretches to the row's height; alone, or in one column, it is at least 96px.

```html
<div class="grid">
  <section class="ds-card">…</section>
  <a class="ds-card-create" href="/projects/new">
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5v14"/></svg>
    New project
  </a>
</div>
```

- Its states come from the class: hover fills `--gray-4` and turns the edge `--input-hover`, inside `@media (hover: hover)`; pressed fills `--gray-5`, with no nudge; `:focus-visible` draws a 2px `--ring` outline 2px out.
- Disabled is `aria-disabled="true"`, never the native attribute, so it stays focusable and a reason beside it (`aria-describedby`) can be read: `--gray-3` fill, `--hairline` edge, `--gray-11` ink, a not-allowed cursor. On a `<button>`, stop the click in script. On an `<a>`, the class takes the pointer off it, and the attribute alone does not stop Enter: stop it in script, or drop the `href`.

## Accessibility

Give a section card a heading, or an `aria-label`, so it is a named region. A content card is not interactive. `ds-card-create` is: its own text is its name, so the icon carries `aria-hidden="true"`, and the label says what it creates ("New project", not "Add").

## Theming

Reads roles from `variables` (`--card`, `--panel`, `--hairline`, `--radius-card`, and `--input`, `--input-hover`, `--ring` for `ds-card-create`), so `data-theme`, `.dark` and `.light` recolor it. The spacing step Tailwind owns is declared on each class as `--ds-spacing` with the same value; `ds-card-create` also declares the base type size and the ease-in-out curve as `--ds-*`. It and `--radius-card` are in rem, so the card's padding follows the reader's browser font size. A test holds the look equal to the React `card`, and `ds-card-create` to `CardCreate` at rest, hovered, pressed, focused and disabled, in light and dark, in the default and example themes. Each of those rem sizes is declared as `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root and gets this size back (see the `variables` note). The corner comes from `variables` and stays in rem.
