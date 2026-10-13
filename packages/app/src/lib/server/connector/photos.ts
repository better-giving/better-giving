import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Page as PageDocument } from '../../page/catalog';
import { startingBlock } from '../../page/defaults';
import type { Db } from '../db/client';
import { connectorKey, page, photoLink, type PhotoLink } from '../db/schema';
import { freeImageStatements } from '../images/free';
import { readPostedPhoto } from '../images/intake';
import { editPageDraft } from '../pages/draft-writer';
import { readPage } from '../pages/queries';
import { hashOf, randomToken } from './keys';

// the photo link: the one way a chat adds a photo, since a chat app cannot hand this deployment a
// file. `photos.upload_link` makes a single-use link for one photo on one page; the operator opens
// it on their phone (src/routes/photo.$token.tsx), which needs no dashboard session — the link is
// the permission, and it is good for `PHOTO_LINK_TTL_MS`, for one upload, while the connection that
// asked for it stands. the photo lands in the draft only, through `editPageDraft`.

export const PHOTO_LINK_TTL_MS = 30 * 60_000;

/** the address a photo link opens, under this deployment's own origin. */
export const PHOTO_LINK_PATH = '/photo';

/** what `photos.upload_link` is asked: the page, and optionally the photo block it fills. */
export type PhotoTarget =
	| { readonly kind: 'campaign'; readonly id: string }
	| { readonly kind: 'donation_page' };

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
	let pageId: string | null = null;
	if (kind === 'campaign' && typeof input.target?.id === 'string') {
		const row = await readPage(db, input.target.id);
		if (row === null || row.type !== 'campaign') {
			return {
				ok: false,
				status: 404,
				code: 'not_found',
				detail: `Campaign ${input.target.id} does not exist on this deployment.`
			};
		}
		pageId = row.id;
	} else if (kind === 'donation_page') {
		const [row] = await db.select({ id: page.id }).from(page).where(eq(page.type, 'donation_page'));
		if (!row)
			return {
				ok: false,
				status: 404,
				code: 'not_found',
				detail: 'This deployment has no donation page yet.'
			};
		pageId = row.id;
	} else {
		return {
			ok: false,
			status: 422,
			code: 'invalid',
			detail:
				'target is { "kind": "campaign", "id": "<campaign id>" } or { "kind": "donation_page" }.'
		};
	}
	if (input.slot !== undefined && typeof input.slot !== 'string') {
		return {
			ok: false,
			status: 422,
			code: 'invalid',
			detail:
				'slot is the id of the hero or image block the photo fills; leave it out for the first empty one.'
		};
	}
	const token = randomToken();
	const expiresAt = new Date(now.getTime() + PHOTO_LINK_TTL_MS);
	await db.insert(photoLink).values({
		tokenHash: hashOf(token),
		pageId,
		blockId: typeof input.slot === 'string' ? input.slot : null,
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
 * the photo `request` posts, placed on the link's page: in the block the link names, or the first
 * hero or image block with no photo, or a new image block above the donation box. the link is taken
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
		(draft) => ({ ok: true, draft: withPhoto(draft, link.blockId, photo.id) })
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

/** `draft` with `imageId` in the block `blockId`, the first empty photo block, or a new one. */
export function withPhoto(
	draft: PageDocument,
	blockId: string | null,
	imageId: string
): PageDocument {
	const isPhoto = (block: PageDocument['blocks'][number]) =>
		block.type === 'hero' || block.type === 'image';
	const at =
		blockId !== null
			? draft.blocks.findIndex((block) => block.id === blockId && isPhoto(block))
			: draft.blocks.findIndex(
					(block) => isPhoto(block) && 'imageId' in block && block.imageId === null
				);
	if (at !== -1) {
		return {
			...draft,
			blocks: draft.blocks.map((block, index) => (index === at ? { ...block, imageId } : block))
		};
	}
	const taken = new Set(draft.blocks.map((block) => block.id));
	let n = 1;
	while (taken.has(`photo-${n}`)) n += 1;
	const added = {
		...startingBlock('image', `photo-${n}`),
		imageId
	} as PageDocument['blocks'][number];
	const box = draft.blocks.findIndex((block) => block.type === 'donation-box');
	const blocks = [...draft.blocks];
	blocks.splice(box === -1 ? blocks.length : box, 0, added);
	return { ...draft, blocks };
}
