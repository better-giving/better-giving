// the editor's presses on the whole page as they post: Publish from the bar, a campaign's first
// Publish from its confirm, Undo, and Discard changes. named here, where both editors' components
// and `$lib/server/pages/publish.ts`, which reads them, import them from.

export const PUBLISH_FORM_ID = 'page-publish';
export const FIRST_PUBLISH_FORM_ID = 'page-first-publish';
export const UNDO_FORM_ID = 'page-undo';
export const DISCARD_FORM_ID = 'page-discard';

/** the presses both editors carry; a campaign's carries `FIRST_PUBLISH_FORM_ID` besides. */
export const PUBLISH_FORMS = [PUBLISH_FORM_ID, UNDO_FORM_ID, DISCARD_FORM_ID] as const;

/**
 * the first Publish's one box: a program's id, which the campaign's gifts are then pinned to, or
 * the draft's own program mode — `none` or `choice` — kept as it is.
 */
export const GIFTS_GO_TO = 'gifts_go_to';
