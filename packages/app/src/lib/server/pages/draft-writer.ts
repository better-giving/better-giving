import { and, eq, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { type Page as PageDocument, parsePage } from '../../page/catalog';
import { placedImageIds } from '../../page/image-src';
import type { Db } from '../db/client';
import { page, type Page as PageRow } from '../db/schema';
import { freeLetGoStatements } from '../images/free';
import { placedPhotos, readableDraft } from './document';
import type { SettingsTarget } from './queries';

// the one writer of a page's draft document. every edit in document terms — a section's content,
// its photos, the share message, the name, the goal and the end — reaches the `page` row through
// `editPageDraft`; ./section-saves.ts is the dashboard's form adapter over it,
// and ../connector/ is the connector's. what it holds once, so no caller restates it:
//
//   - the write lands only while the page is still the version the edit was made against, and the
//     draft text the edit read: a save landing between the read and the write writes nothing.
//   - the draft that results passes the page rule (`parsePage`) before it is written; a refusal
//     names the path the rule refused, for an adapter to put under a box or a chat to act on.
//   - every photo the old draft placed and the new one does not is freed in the same `batch()`,
//     unless something else still names it (../images/free.ts).
//   - an edit that moves more than the draft — the General save's name and link (./section-saves.ts)
//     — hands its row columns and its own statements over as `alongside`, and they land in that
//     same `batch()` under the same guard or not at all.

/** what lands beside the draft in its write, under the guard the draft's update is under. */
export type DraftAlongside = {
	/** the page row's columns the draft's update sets too. */
	readonly columns?: { readonly name?: string; readonly slug?: string | null };
	/**
	 * statements that run ahead of the draft's update in its `batch()`, each made under `drawn`, the
	 * guard over the page row as the edit read it, since the update moves what that guard reads.
	 */
	readonly before?: (drawn: SQL) => readonly BatchItem<'sqlite'>[];
};

type CommandResult =
	| { readonly ok: true; readonly draft: unknown; readonly alongside?: DraftAlongside }
	| { readonly ok: false; readonly path: readonly (string | number)[]; readonly message: string };

/** what an edit makes of the draft: the next document, or a refusal of its own at a path. */
export type DraftCommand = (
	draft: PageDocument,
	row: PageRow
) => CommandResult | Promise<CommandResult>;

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
	const drawn = and(eq(page.id, row.id), eq(page.updatedAt, at), eq(page.draft, row.draft));
	if (drawn === undefined) throw new Error('a guard of three conditions came back empty');
	const before = edited.alongside?.before?.(drawn) ?? [];
	const update = db
		.update(page)
		.set({ ...edited.alongside?.columns, draft: JSON.stringify(checked.page) })
		.where(drawn)
		.returning({ id: page.id, updatedAt: page.updatedAt });
	const results = await db.batch([
		...before,
		update,
		...freeLetGoStatements(
			db,
			placedPhotos(row, { draft: row.draft }),
			placedImageIds(checked.page)
		)
	] as unknown as [typeof update, ...BatchItem<'sqlite'>[]]);
	const [landed] = results[before.length] as Awaited<typeof update>;
	return landed === undefined
		? { kind: 'stale' }
		: { kind: 'written', page: checked.page, version: landed.updatedAt };
}
