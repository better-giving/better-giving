import { type Page as PageDocument, type PageRefusal, parsePage } from '../../page/catalog';
import type { PageType } from '../../page/keys';
import type { Page as PageRow } from '../db/schema';

// the read policy for a page row's three stored documents — `draft`, `published` and
// `last_published` — and the one door every reader takes them through, held by ./sole-reader.spec.ts.
//
// a stored document is read under the page rule (`parsePage` in ../../page/catalog.ts) as it stands
// today, not as it stood when it was written, so an upgrade that narrows the rule leaves documents
// behind that it now refuses. reading one never throws: the refusal is logged, naming the page and
// the column, and handed back, and each reader falls back from it — a donor page to its donation box
// alone (./view.ts), the Campaigns list to a row without its goal and end (./campaign.ts), and an
// editor to a notice with the presses that repair the page (./editor.ts, ./reset.ts), since the
// editor is the one screen that can.
//
// a missing document reads as one the rule refuses, and so does text that is not JSON, which
// `page_draft_object_check` and its two siblings in ../db/schema.ts keep from being stored: no read
// of a stored document is the thing that throws.

/** a stored document as the page rule reads it now. */
export type StoredDocument = { readonly ok: true; readonly page: PageDocument } | PageRefusal;

export type DocumentColumn = 'draft' | 'published' | 'last_published';

/** `text`, stored in `column` of the page `row`, as the page rule reads it; a refusal is logged. */
export function readDocument(
	row: { readonly id: string; readonly type: PageType },
	column: DocumentColumn,
	text: string | null
): StoredDocument {
	const read = parsePage(row.type, storedJson(text));
	if (!read.ok) {
		console.error(
			`page ${row.id} (${row.type}): its ${column} fails the read rule at \`${read.path.join('.')}\`:`,
			read.message
		);
	}
	return read;
}

function storedJson(text: string | null): unknown {
	if (text === null) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * the draft of `row`, for an editor that has found it readable (`unreadableEditor` in ./editor.ts)
 * and a write that builds on it. a refusal throws: the editor drawn over a draft the rule refuses
 * offers no press that writes it, so a write reaching one was posted from a page drawn before the
 * rule narrowed, or by hand.
 */
export function readableDraft(row: PageRow): PageDocument {
	const draft = readDocument(row, 'draft', row.draft);
	if (!draft.ok) throw new Error(`page ${row.id}'s stored draft fails its rule: ${draft.message}`);
	return draft.page;
}
