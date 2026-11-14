# file-dropzone-css

Registry item `file-dropzone-css` (files: `styles/file-dropzone-css.css`; depends on `variables`, `field-css`, `button-css`, `text-button-css` and `progress-css`). Plain CSS: no Tailwind, no React, no Ark. The look of the `file-dropzone` item; the page brings the picker, the drop handling and the upload.

## Markup contract

Import `styles/variables.css`, `styles/field-css.css`, `styles/button-css.css`, `styles/text-button-css.css`, `styles/progress-css.css` and `styles/file-dropzone-css.css`.

```html
<div class="ds-field">
  <span class="ds-label" id="photo-label" data-required="false">Photo</span>
  <div class="ds-dropzone" role="button" tabindex="0"
       aria-labelledby="photo-label" aria-describedby="photo-err photo-hint">
    <svg aria-hidden="true"><!-- lucide image-up --></svg>
    <span class="ds-dropzone-title">Drop a photo here, or <span class="ds-dropzone-link">choose a file</span></span>
    <span class="ds-dropzone-touch ds-btn ds-btn-secondary ds-btn-sm"><svg aria-hidden="true"><!-- image-up --></svg>Add photo</span>
  </div>
  <input type="file" accept="image/png,image/jpeg,image/webp" tabindex="-1" aria-hidden="true" hidden>
  <p class="ds-field-err" id="photo-err" role="alert"></p>
  <p class="ds-sr-only" role="status"></p>
  <p class="ds-dropzone-hint" id="photo-hint">PNG, JPEG or WebP, up to 5 MB.</p>
</div>
```

- `ds-dropzone`: the area. It declares `--ds-dropzone-edge: 1px dashed var(--input-hover)` and draws its edge with it, on `--panel`, the control corner, at least 128px tall (112px under 640px), 20px by 16px padding, its rows centred 8px apart. A direct `svg` child is the 24px glyph.
- `ds-dropzone-title`: the prompt, gray-12 at weight 500; `ds-dropzone-link` inside it the words that read as the action, `--link` at weight 600, not underlined (it is not a link).
- `ds-dropzone-touch`: the prompt as a button's look, with `ds-btn ds-btn-secondary ds-btn-sm`. It shows instead of `ds-dropzone-title` under 640px and on a coarse pointer, where there is nothing to drag from. Keep it a `<span>`: the area is the control. Its show and hide are scoped to `.ds-dropzone`, so they hold whichever stylesheet loads last.
- `ds-dropzone-file`: a file's row, its glyph (`svg`, 24px, gray-11), then `ds-dropzone-name` holding the name in a `<b>` (weight 600, one line, ellipsis) and the size in a `<span>` (`text-xs`, gray-11), then a `ds-text-btn` Cancel while it goes up.
- `ds-dropzone-preview`: the held file: `ds-dropzone-img` (a 16:9 hairline frame with the control corner, the `<img>` inside covering it), the `ds-dropzone-file` row and `ds-dropzone-actions` with Replace (`ds-btn ds-btn-secondary ds-btn-sm`) and Remove (`ds-btn ds-btn-ghost ds-btn-sm`).
- `ds-dropzone-hint`: the hint under the area, `text-sm` gray-11, 8px below the message or the area.
- The message is `field-css`'s `ds-field-err`, directly under the area, always in the page and empty at rest; `ds-sr-only` is field-css's too.

## States

- Hover (where the pointer can hover): `--gray-4`, except disabled or in flight.
- `:focus-visible`: the house ring, 2px of `--ring` 2px out.
- `data-dragging` on the area while a file is held over it: a 2px dashed `--ring` edge on `--secondary`, the title in accent-12, the padding 1px in so the box does not move. Set it on `dragenter`/`dragover` and remove it on `dragleave` and `drop`; write the drop line ("Drop the photo to upload") into the title.
- `aria-busy="true"` while the file goes up: a solid `--hairline` edge on `--card`, the rows from the start edge, `cursor: progress`. Give the area `role="group"` and `tabindex="-1"` then, and put the `ds-dropzone-file` row and a `progress-css` bar in it: `ds-progress` with a `ds-progress-track` named "Uploading <name>", `aria-valuenow` and `aria-valuetext="62%"`, and the `aria-hidden` `ds-progress-label`. Never `disabled`: focus stays where it was.
- `aria-invalid="true"`: the `--destructive` edge, still dashed. Write the message into the `ds-field-err` and keep its id first in the area's `aria-describedby`.
- `aria-disabled="true"`: opacity .6, `--gray-3`, `not-allowed`; keep `tabindex="0"` so the hint is read, and ignore presses and drops.
- The preview replaces the area. Replace calls the hidden input's `click()`; Remove clears the file and moves focus to the empty area once it is back. A file picked from the focused area, or through Replace, unmounts what held focus: move focus to Cancel while it goes up, then to the new preview's Replace (or to the area if the upload fails).
- Empty the input's `value` before each `click()`, or picking the same file again (the retry after Cancel, Remove or a failed upload) fires no `change`. Take one file per drop; count `dataTransfer.files` before checking any file's type or size, and refuse a drop of more, every file of it, with a message ("Drop one file at a time.").

## Accessibility

- The area is `role="button"`, `tabindex="0"`: open the picker (the hidden input's `click()`) on Enter, Space and a press. Name it with the label (`aria-labelledby`) and describe it with the message and the hint.
- Keep the file input out of the tab order and the accessibility tree: `tabindex="-1"`, `aria-hidden="true"`.
- Keep one `role="status"` region mounted and write into it: "Uploading harbor-van.jpg, 50%" at 25% steps, then "Uploaded harbor-van.jpg". A refused file's reason goes in the `role="alert"` message; to say the same reason again, replace the alert element rather than writing the same text into it.

## Theming

Reads roles from `variables` (`--panel`, `--gray-3`, `--gray-4`, `--gray-11`, `--gray-12`, `--input-hover`, `--ring`, `--secondary`, `--accent-12`, `--card`, `--hairline`, `--destructive`, `--link`, `--radius`, `--duration-fast`), so `data-theme`, `.dark` and `.light` recolor it. The spacing step, type sizes, weights, the tight line and the easing Tailwind owns are declared on the classes as `--ds-*` with the same values. Those sizes are in rem, so the area and its text follow the reader's browser font size, while its edges stay in px. Each rem size is declared as `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). The 40rem query width stays in rem, since a media condition cannot read a custom property.
