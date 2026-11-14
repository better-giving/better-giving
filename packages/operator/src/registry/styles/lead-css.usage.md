# lead-css

Registry item `lead-css` (files: `styles/lead-css.css`; depends on `variables`). Plain CSS: no Tailwind. The look of `lead-row`, `lead-1lh` and `eyebrow` in the `tokens` item.

## Markup contract

Import `styles/variables.css` and `styles/lead-css.css`.

```html
<div class="ds-lead-row title-lg">
  <h3>Food bank winter drive for families</h3>
  <span class="ds-lead-1lh"><span>Ends soon</span></span>
</div>
```

A status, badge, count or icon beside text that can wrap sits on the text's first line, not in the middle of the block. Use it for a title with a status, a nav row with a count, a tab with a count, a menu item, a header with a close button, a field label with a hint icon.

- `ds-lead-row`: a flex row aligned to the start (`align-items: start`), 12px between the text and the box (8px between lines if it wraps). Its first child is the text: it takes the room (`flex: 1 1 0%`, `min-inline-size: 0`), so the box sits at the row's end. That rule has the specificity of one class, so a class of yours on the text, loaded after `lead-css.css`, wins it: `flex: 0 1 auto` keeps a mark right beside a short title.
- `ds-lead-1lh`: the box around the mark. A flex box exactly one line tall (`block-size: 1lh`), the mark centred in it, kept at its own width, several marks 8px apart. `1lh` is the box's own line-height, which it inherits from the row.
- Give the text's size to the row (a class of your own, `title-lg` above, setting `font-size` and `line-height`), not to the text alone. The text and the box then inherit the same line, so the box is one of the text's lines tall. A size on the text alone gives it a taller line than the box, and the mark sits high.
- Don't centre the row's items: that centres the box against the whole block of text again. A one-line text looks as a centred row would.
- The box is for marks no taller than a line. A taller one, such as a 36px button beside a 20px line, spills out of it above and below.
- The mark is yours: a badge from `badge-css` (add it alongside), a count, an icon. The plain `<span>Ends soon</span>` above stands in for it. `lead-css` draws only the row and the box.
- `card-css` draws the same box under the card's name, for its header.

## The eyebrow

```html
<p class="ds-eyebrow">Campaign</p>
<h2>Food bank winter drive for families</h2>
```

- `ds-eyebrow`: the small uppercase label above a section heading, the `eyebrow` utility's look: 12px on a 16px line, bold, uppercase, on `--ds-tracking-label` (0.12em, from `variables` 1.3.0 or later). Its colour is yours, as the utility leaves it to you: a text ink such as `--gray-11` or `--accent-11`. Another size comes from a class of your own declared after `lead-css`.

## Accessibility

The classes add no role. The mark reads after the text, in source order; give an icon-only mark its own name (`aria-label`) or `aria-hidden="true"` when the text already says it.

## Theming

Reads only the `--ds-rem` base and, for `ds-eyebrow`, `--ds-tracking-label` from outside: the gaps are the spacing step, declared on each class as `--ds-spacing`, in rem, so they follow the reader's browser font size. Each is `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root and gets this size back (see the `variables` note). A test holds the row and the box equal to the Tailwind `lead-row` and `lead-1lh`, and `ds-eyebrow` to `eyebrow`.
