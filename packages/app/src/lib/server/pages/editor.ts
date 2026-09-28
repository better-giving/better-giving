import { parsePage } from '../../page/catalog';
import type { Page } from '../db/schema';

// what the editor is drawn with, the Donation page's and a campaign's alike: where the page stands
// against what donors see, the version every press on it is written against, and the preview
// route that frames its draft (src/routes/preview.$pageId.tsx).
//
// the Settings sheet's rows read the draft, which is what the editor changes; a goal and an end
// date are a campaign's alone and read null on the Donation page.
//
// the version is the row's `updated_at`, which every write to the row moves — a chat turn's draft,
// a rename, an address — so a press drawn before any of them is refused rather than putting back
// what that write moved (`submittedVersion` in ../conform.ts). the preview is keyed on it too, so the
// frame reloads on the render any write's revalidation lands in.

/** where a page stands against what donors see. */
export type EditorState = 'unpublished' | 'changed' | 'live' | 'ended';

export type EditorPage = {
	readonly state: EditorState;
	/** the row's `updated_at` in unix ms. */
	readonly version: number;
	readonly preview: string;
	/** the draft's own share message, or null while it takes the Organisation's. */
	readonly shareMessage: string | null;
	readonly goalMinor: number | null;
	/** the draft's end, in unix ms. */
	readonly endsAt: number | null;
};

export function editorPage(row: Page): EditorPage {
	const draft = parsePage(row.type, JSON.parse(row.draft));
	if (!draft.ok) throw new Error(`page ${row.id}'s stored draft fails its rule: ${draft.message}`);
	return {
		state: editorState(row),
		version: row.updatedAt.getTime(),
		preview: `/preview/${row.id}`,
		shareMessage: draft.page.shareMessage ?? null,
		goalMinor: draft.page.goalMinor ?? null,
		endsAt: draft.page.endsAt ?? null
	};
}

function editorState(row: Page): EditorState {
	switch (row.state) {
		case 'never_published':
			return 'unpublished';
		case 'ended':
			return 'ended';
		case 'live':
			return row.draft === row.published ? 'live' : 'changed';
	}
}
