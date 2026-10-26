import { and, eq } from 'drizzle-orm';
import { type Page as PageDocument, parsePage } from '../../page/catalog';
import { placedImageIds } from '../../page/image-src';
import type { Db } from '../db/client';
import { page, type Page as PageRow } from '../db/schema';
import { freeLetGoStatements } from '../images/free';
import { placedPhotos, readableDraft } from './document';
import type { SettingsTarget } from './queries';

// the one writer of a page's draft document. every edit in document terms — a section's content,
// its photos, the share message, the name, the goal and the end — reaches the `page` row through
// `editPageDraft`; ./content.ts and ./page-settings.ts are the dashboard's form adapters over it,
// and ../connector/ is the connector's. what it holds once, so no caller restates it:
//
//   - the write lands only while the page is still the version the edit was made against, and the
//     draft text the edit read: a save landing between the read and the write writes nothing.
//   - the draft that results passes the page rule (`parsePage`) before it is written; a refusal
//     names the path the rule refused, for an adapter to put under a box or a chat to act on.
//   - every photo the old draft placed and the new one does not is freed in the same `batch()`,
//     unless something else still names it (../images/free.ts).

/** what an edit makes of the draft: the next document, or a refusal of its own at a path. */
export type DraftCommand = (
	draft: PageDocument,
	row: PageRow
) =>
	| { readonly ok: true; readonly draft: unknown }
	| { readonly ok: false; readonly path: readonly (string | number)[]; readonly message: string }
	| Promise<
			| { readonly ok: true; readonly draft: unknown }
			| {
					readonly ok: false;
					readonly path: readonly (string | number)[];
					readonly message: string;
			  }
	  >;

/** what `editPageDraft` did. `refused` carries the path and sentence the rule or the edit gave. */
export type DraftWritten =
	| { readonly kind: 'written'; readonly page: PageDocument; readonly version: Date }
	| { readonly kind: 'stale' }
	| { readonly kind: 'gone' }
	| {
			readonly kind: 'refused';
			readonly path: readonly (string | number)[];
			readonly message: string;
	  };

/**
 * the version an edit is made against: the `updated_at` the editor drew, or `current` for a caller
 * holding no drawn version (the connector), which takes the row as read and is still guarded on it.
 */
export type DraftVersion = Date | 'current';

/**
 * the draft of the page `target` names, replaced by what `command` makes of it while the page is
 * still `version` and still holds the draft text the command read.
 */
export async function editPageDraft(
	db: Db,
	target: SettingsTarget,
	version: DraftVersion,
	command: DraftCommand
): Promise<DraftWritten> {
	const [row] = await db
		.select()
		.from(page)
		.where(
			target.type === 'campaign'
				? and(eq(page.id, target.id), eq(page.type, 'campaign'))
				: eq(page.type, 'donation_page')
		);
	if (!row) return { kind: 'gone' };
	const at = version === 'current' ? row.updatedAt : version;
	if (row.updatedAt.getTime() !== at.getTime()) return { kind: 'stale' };
	const edited = await command(readableDraft(row), row);
	if (!edited.ok) return { kind: 'refused', path: edited.path, message: edited.message };
	const checked = parsePage(row.type, edited.draft);
	if (!checked.ok) return { kind: 'refused', path: checked.path, message: checked.message };
	const [written] = await db.batch([
		db
			.update(page)
			.set({ draft: JSON.stringify(checked.page) })
			.where(and(eq(page.id, row.id), eq(page.updatedAt, at), eq(page.draft, row.draft)))
			.returning({ id: page.id, updatedAt: page.updatedAt }),
		...freeLetGoStatements(
			db,
			placedPhotos(row, { draft: row.draft }),
			placedImageIds(checked.page)
		)
	]);
	const [landed] = written;
	return landed === undefined
		? { kind: 'stale' }
		: { kind: 'written', page: checked.page, version: landed.updatedAt };
}
