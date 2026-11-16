import { eq } from 'drizzle-orm';
import { createStaticHandler, type LoaderFunction, type MiddlewareFunction } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { client } from '$lib/server/db/database.testing';
import { supporterPage } from '$lib/server/db/schema';
import { createImage } from '$lib/server/images/image.testing';
import { putLogo } from '$lib/server/org/logo.testing';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { hideFundraiser } from '$lib/server/supporters/admin';
import { endOwnFundraiser } from '$lib/server/supporters/pages';
import { requestContext } from '../request-context';
import { queryDocument } from '../route-request.testing';
import {
	freshSupporterDeployment,
	liveFundraiser,
	ORIGIN,
	STARTED,
	supporterEnv
} from '../supporter-routes.testing';
import type { Route } from './+types/f.$slug';
import * as fundraiserPage from './f.$slug';

// what `/f/{slug}` is shared with when its address is pasted into a chat or a post: the head tags
// `meta` draws from the live page's loader data, through react router's own handler and the page's
// meter against the real database. how the story is cut is
// `$lib/server/supporters/share.spec.ts`'s.
//
// the mail transport is stubbed for ./fundraise.journey.db.spec.ts's reason: the confirm link is
// how a page goes live.

type Message = { to: string; subject: string; html: string; text: string };

const mailed = vi.hoisted(() => [] as Message[]);

vi.mock('$lib/server/email/factory', () => ({
	createEmailProvider: () => ({
		async send(message: Message) {
			mailed.push(message);
			return { ok: true as const };
		}
	})
}));

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	mailed.length = 0;
	await freshSupporterDeployment();
});

let callers = 0;

/** `/f/{slug}` asked for at `origin`, as a browser or a link preview asks for it. */
async function visit(slug: string, origin = ORIGIN, env: Env = supporterEnv()) {
	callers += 1;
	const handler = createStaticHandler([
		{
			id: 'page',
			path: 'f/:slug',
			middleware: fundraiserPage.middleware as MiddlewareFunction[],
			loader: fundraiserPage.loader as LoaderFunction
		}
	]);
	const drawn = await queryDocument(
		handler,
		new Request(`${origin}/f/${slug}`, {
			headers: { [CLIENT_IP_HEADER]: `203.0.113.${callers % 250}` }
		}),
		requestContext({ env, deferred: createDeferredWork(), client })
	);
	const loaderData = drawn.loaderData.page;
	return {
		status: drawn.statusCode,
		body: JSON.stringify(loaderData),
		meta: fundraiserPage.meta({ loaderData } as unknown as Route.MetaArgs)
	};
}

const PHOTO = { contentType: 'image/webp', width: 1200, height: 800 } as const;

async function withPhoto(pageId: string): Promise<string> {
	const photoId = await createImage(
		db,
		{ kind: 'photo', ...PHOTO, alt: null },
		new Uint8Array([1])
	);
	await db.update(supporterPage).set({ photoId }).where(eq(supporterPage.id, pageId));
	return photoId;
}

const TEXT_TAGS = [
	{ title: 'Run for the shelter' },
	{ property: 'og:title', content: 'Run for the shelter' },
	{ property: 'og:description', content: 'I am running 10k for the shelter.' },
	{ property: 'og:url', content: `${ORIGIN}/f/run-for-the-shelter` }
];

describe('the share tags of /f/{slug}', () => {
	it('shares a live page with its own photo, over the logo', async () => {
		const { pageId, slug } = await liveFundraiser(db, mailed);
		await putLogo(db, { contentType: 'image/png', width: 400, height: 400 });
		const photoId = await withPhoto(pageId);

		const drawn = await visit(slug);
		expect(drawn.status).toBe(200);
		expect(drawn.meta).toEqual([
			...TEXT_TAGS,
			{ property: 'og:image', content: `${ORIGIN}/image/${photoId}` },
			{ name: 'twitter:card', content: 'summary_large_image' }
		]);
	});

	it('shares a live page with no photo with the organisation’s logo', async () => {
		const { slug } = await liveFundraiser(db, mailed);
		const logoId = await putLogo(db, { contentType: 'image/png', width: 400, height: 400 });

		expect((await visit(slug)).meta).toEqual([
			...TEXT_TAGS,
			{ property: 'og:image', content: `${ORIGIN}/image/${logoId}` },
			{ name: 'twitter:card', content: 'summary_large_image' }
		]);
	});

	it('names no image with neither a photo nor a logo, and asks for the small card', async () => {
		const { slug } = await liveFundraiser(db, mailed);
		expect((await visit(slug)).meta).toEqual([
			...TEXT_TAGS,
			{ name: 'twitter:card', content: 'summary' }
		]);
	});

	it('names no address and no image where no origin is pinned, and asks for the small card', async () => {
		const { pageId, slug } = await liveFundraiser(db, mailed);
		await withPhoto(pageId);
		await putLogo(db, { contentType: 'image/png', width: 400, height: 400 });

		const { BETTER_AUTH_URL: _pinned, ...unpinned } = supporterEnv();
		const drawn = await visit(slug, ORIGIN, unpinned);
		expect(drawn.status).toBe(200);
		expect(drawn.meta).toEqual([
			{ title: 'Run for the shelter' },
			{ property: 'og:title', content: 'Run for the shelter' },
			{ property: 'og:description', content: 'I am running 10k for the shelter.' },
			{ name: 'twitter:card', content: 'summary' }
		]);
	});

	it('builds every address on the configured origin, whatever host the request named', async () => {
		const { pageId, slug } = await liveFundraiser(db, mailed);
		const photoId = await withPhoto(pageId);

		const drawn = await visit(slug, 'https://attacker.example');
		expect(drawn.meta).toContainEqual({
			property: 'og:url',
			content: `${ORIGIN}/f/run-for-the-shelter`
		});
		expect(drawn.meta).toContainEqual({
			property: 'og:image',
			content: `${ORIGIN}/image/${photoId}`
		});
		expect(drawn.body).not.toContain('attacker.example');
	});

	it('answers a hidden page with the refused 404, its photo nowhere in the answer', async () => {
		const { pageId, slug } = await liveFundraiser(db, mailed, {
			...STARTED,
			story: 'A story nobody should see.'
		});
		const photoId = await withPhoto(pageId);
		await hideFundraiser(db, pageId, null, new Date());

		const drawn = await visit(slug);
		expect(drawn.status).toBe(404);
		expect(drawn.meta).toEqual([{ title: 'Donate' }]);
		expect(drawn.body).not.toContain(photoId);
		expect(drawn.body).not.toContain('nobody should see');
	});

	it('keeps an ended page’s head to its title, with no share tags', async () => {
		const { pageId, slug } = await liveFundraiser(db, mailed);
		await withPhoto(pageId);
		const [row] = await db
			.select({ supporterId: supporterPage.supporterId })
			.from(supporterPage)
			.where(eq(supporterPage.id, pageId));
		await endOwnFundraiser(db, row?.supporterId ?? '', pageId, new Date());

		const drawn = await visit(slug);
		expect(drawn.status).toBe(200);
		expect(drawn.meta).toEqual([{ title: expect.stringContaining('Run for the shelter') }]);
	});
});
