# progress-css

Registry item `progress-css` (files: `styles/progress-css.css`; depends on `variables`). Plain CSS: no Tailwind, no build step. The look of the `progress` item for a page that has only `variables`.

## Markup contract

Import `styles/variables.css` and `styles/progress-css.css`. Work out the whole percent yourself, rounded down (`Math.floor(value * 100 / max)`), and write it four times:

```html
<div class="ds-progress">
  <div class="ds-progress-track" role="progressbar" aria-label="Amount raised"
       aria-valuemin="0" aria-valuemax="100" aria-valuenow="73"
       aria-valuetext="73% of goal">
    <div class="ds-progress-fill" style="width: 73%"></div>
  </div>
  <span class="ds-progress-label" aria-hidden="true">73%</span>
</div>
```

- `ds-progress` is the row: the track and the percentage, 12px apart.
- `ds-progress-track` is the 8px, fully rounded `--panel` track with the recessed shadow. `ds-progress-fill` inside it is `--primary`; its width is the percent, capped at 100%.
- `ds-progress-label` is the percentage, right-aligned in the display face with tabular figures.
- Every class carries the `ds-` prefix.

## States

- `data-state="met"` on the track at 100% or more turns the fill `--success`.
- `data-state="empty"` on the track at 0% drops the fill's shadow.
- Over the goal, keep the fill at `width: 100%` and `aria-valuenow="100"`, and let the label and `aria-valuetext` say the real figure (`123%`, `"123% of goal"`).
- The fill's width moves over `--duration-slow`; the `variables` reduced-motion guard collapses it.
- Under forced colors (Windows High Contrast) the fill is drawn in the system ink, `CanvasText`, and the track's extent as a 1px `CanvasText` outline.

## Accessibility

- `aria-valuetext` carries the percent, so the label beside the bar stays `aria-hidden`.
- Name the bar with `aria-label` ("Amount raised" or what it counts).
- It takes no focus and no keys. Captions around it are plain text.

## Theming

Reads roles from `variables` (`--panel`, `--primary`, `--success`, `--shadow-ink`, `--font-display`, `--duration-slow`), so `data-theme`, `.dark` and `.light` recolor it. The spacing step, type size and weight, easing and the two track shadows Tailwind owns are declared on the class as `--ds-*` with the same values. The spacing step and type size are in rem, so the bar and its figures follow the reader's browser font size; the shadows stay in px.
