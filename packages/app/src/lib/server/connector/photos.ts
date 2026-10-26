import { and, eq, gt, isNull } from 'drizzle-orm';
import { PHOTOS_MAX, type Page as PageDocument } from '../../page/catalog';
import { parseSlot } from '../../page/content-edit';
import { readDocument } from '../pages/document';
import type { Db } from '../db/client';
import { connectorKey, photoLink, type PhotoLink } from '../db/schema';
import { freeImageStatements } from '../images/free';
import { readPostedPhoto } from '../images/intake';
import { editPageDraft } from '../pages/draft-writer';
import { readPage } from '../pages/queries';
import { hashOf, randomToken } from './keys';

// the photo link: the one way a chat adds a photo, since a chat app cannot hand this deployment a
// file. `photos.upload_link` makes a single-use link for one photo on one page; the operator opens
// it on their phone (src/routes/photo.$token.tsx), which needs no dashboard session — the link is
// the permission, and it is good for `PHOTO_LINK_TTL_MS`, for one upload, while the connection that
// asked for it stands. the photo lands in the draft only, through `editPageDraft`. only a campaign
// holds photos: the donation page draws one fixed layout with none.

export const PHOTO_LINK_TTL_MS = 30 * 60_000;

/** the address a photo link opens, under this deployment's own origin. */
export const PHOTO_LINK_PATH = '/photo';

/** what `photos.upload_link` is asked: the campaign, and optionally the slot the photo fills. */
export type PhotoTarget = { readonly kind: 'campaign'; readonly id: string };

export type MadeLink =
	| { readonly ok: true; readonly url: string; readonly expiresAt: Date }
	| {
			readonly ok: false;
			readonly status: 404 | 422;
			readonly code: string;
			readonly detail: string;
	  };

/** a link for one photo on the page `body.target` names, handed to the connection `keyId`. */
export async function makePhotoLink(
	db: Db,
	origin: string,
	keyId: string,
	body: unknown,
	now = new Date()
): Promise<MadeLink> {
	const input = (typeof body === 'object' && body !== null ? body : {}) as {
		target?: { kind?: unknown; id?: unknown };
		slot?: unknown;
	};
	const kind = input.target?.kind;
	if (kind === 'donation_page') {
		return {
			ok: false,
			status: 422,
			code: 'invalid',
			detail:
				'The donation page holds no photos: it draws one fixed layout. A photo goes on a campaign, as its cover or beside it.'
		};
	}
	if (kind !== 'campaign' || typeof input.target?.id !== 'string') {
		return {
			ok: false,
			status: 422,
			code: 'invalid',
			detail: 'target is { "kind": "campaign", "id": "<campaign id>" }.'
		};
	}
	const row = await readPage(db, input.target.id);
	if (row === null || row.type !== 'campaign') {
		return {
			ok: false,
			status: 404,
			code: 'not_found',
			detail: `Campaign ${input.target.id} does not exist on this deployment.`
		};
	}
	if (
		input.slot !== undefined &&
		(typeof input.slot !== 'string' || parseSlot(input.slot) === null)
	) {
		return {
			ok: false,
			status: 422,
			code: 'invalid',
			detail:
				'slot is "cover" for the cover photo, "new" for a photo after the rest, or the place of a photo beside the cover to replace, "0" for the first; leave it out to fill the cover where there is none, or add a photo after the rest.'
		};
	}
	const slot = typeof input.slot === 'string' ? input.slot : null;
	const draft = readDocument(row, 'draft', row.draft);
	if (
		draft.ok &&
		placeOf(draft.page, slot) === 'added' &&
		(draft.page.photos ?? []).length >= PHOTOS_MAX
	) {
		return {
			ok: false,
			status: 422,
			code: 'invalid',
			detail: `This campaign already holds ${PHOTOS_MAX} photos beside its cover place, the most it can, so a new photo has no place. Ask the operator which photo it replaces, and make the link with that slot: "cover", or the place of a photo beside it, "0" for the first.`
		};
	}
	const token = randomToken();
	const expiresAt = new Date(now.getTime() + PHOTO_LINK_TTL_MS);
	await db.insert(photoLink).values({
		tokenHash: hashOf(token),
		pageId: row.id,
		slot,
		connectorKeyId: keyId,
		createdAt: now,
		expiresAt
	});
	return { ok: true, url: `${origin}${PHOTO_LINK_PATH}/${token}`, expiresAt };
}

/** the live link `token` is — unexpired, unused, its connection not disconnected — or `null`. */
export async function readLiveLink(
	db: Db,
	token: string,
	now = new Date()
): Promise<PhotoLink | null> {
	const [row] = await db
		.select({ link: photoLink })
		.from(photoLink)
		.innerJoin(connectorKey, eq(connectorKey.id, photoLink.connectorKeyId))
		.where(
			and(
				eq(photoLink.tokenHash, hashOf(token)),
				isNull(photoLink.usedAt),
				gt(photoLink.expiresAt, now),
				isNull(connectorKey.revokedAt)
			)
		);
	return row?.link ?? null;
}

export type PhotoPlaced =
	| { readonly ok: true }
	| {
			readonly ok: false;
			readonly status: 400 | 404 | 409 | 410 | 413 | 500;
			readonly error: string;
	  };

/**
 * the photo `request` posts, placed on the link's campaign: in the slot the link names, or the cover
 * where there is none, or after the photos beside it. the link is taken
 * first, by one guarded UPDATE, so two uploads racing on it place one photo between them.
 */
export async function placePostedPhoto(
	db: Db,
	token: string,
	request: Request,
	now = new Date()
): Promise<PhotoPlaced> {
	const link = await readLiveLink(db, token, now);
	if (link === null)
		return {
			ok: false,
			status: 410,
			error:
				'This link was used already, has expired, or was disconnected. Ask the chat for a new one.'
		};
	const photo = await readPostedPhoto(db, request);
	if (!photo.ok)
		return { ok: false, status: photo.refusal === 'too-large' ? 413 : 400, error: photo.error };
	const [taken] = await db
		.update(photoLink)
		.set({ usedAt: now })
		.where(and(eq(photoLink.id, link.id), isNull(photoLink.usedAt)))
		.returning({ id: photoLink.id });
	if (!taken)
		return {
			ok: false,
			status: 410,
			error: 'This link was used already. Ask the chat for a new one.'
		};
	await db.batch(photo.statements);
	const target = await readPage(db, link.pageId);
	if (target === null) {
		await db.batch(freeImageStatements(db, photo.id));
		return { ok: false, status: 404, error: 'The page this photo was for is gone.' };
	}
	const written = await editPageDraft(
		db,
		target.type === 'campaign' ? { type: 'campaign', id: target.id } : { type: 'donation_page' },
		'current',
		(draft) => ({ ok: true, draft: withPhoto(draft, link.slot, photo.id) })
	);
	if (written.kind === 'written') return { ok: true };
	console.error(`placing photo ${photo.id} from link ${link.id} failed: ${written.kind}`);
	// nothing names the photo yet, so it is freed rather than left stored for nobody.
	await db.batch(freeImageStatements(db, photo.id));
	return {
		ok: false,
		status: 409,
		error:
			'The photo was stored but could not be placed on the page; the page changed meanwhile. Ask the chat for a new link and try again.'
	};
}

type Place = 'cover' | { readonly replaces: number } | 'added';

/**
 * where a photo for `slot` lands on `draft`: the cover, or the place of a photo beside it where the
 * draft holds one; `new` after the rest; with none named, or a place it does not hold, the cover
 * where there is none, else after the rest. a slot read as nothing — a link made before slots,
 * naming a block — is none named.
 */
function placeOf(draft: PageDocument, slot: string | null): Place {
	const read = slot === null ? null : parseSlot(slot);
	if (read?.kind === 'cover') return 'cover';
	if (read?.kind === 'new') return 'added';
	if (read?.kind === 'photo' && read.at < (draft.photos ?? []).length) return { replaces: read.at };
	return draft.hero === undefined ? 'cover' : 'added';
}

/** `draft` with `imageId` where `placeOf` puts a photo for `slot`. */
export function withPhoto(draft: PageDocument, slot: string | null, imageId: string): PageDocument {
	const photo = { imageId, alt: null };
	const photos = draft.photos ?? [];
	const place = placeOf(draft, slot);
	if (place === 'cover') return { ...draft, hero: photo };
	if (place === 'added') return { ...draft, photos: [...photos, photo] };
	return { ...draft, photos: photos.map((one, at) => (at === place.replaces ? photo : one)) };
}
