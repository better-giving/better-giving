import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import type { RichTextDocument } from '$lib/rich-text/document';
import { createDb } from '$lib/server/db/client';
import { ORIGIN, signIn } from '../program-routes.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as organisation from './_app.admin.organisation';

// a workers spec because every case reads or writes `org_presentation`. the chain is mounted rather
// than the loader or the action called, for ./_app.admin.programs.$id.workers.spec.ts's reason: the
// session gate is a `middleware` on ./_app.tsx.

const SCREEN = '/admin/organisation';
const STORY_FORM = 'org-story';
const UNDO_FORM = 'org-story-undo';

let request: RouteRequester;
let session: string;

beforeAll(async () => {
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/organisation', module: organisation }
	]);
	session = await signIn(createDb(env.DB));
});

// no row is seeded by the migrations, so every case starts where a fresh deployment does.
beforeEach(async () => {
	await env.DB.prepare('delete from org_presentation').run();
});

/** a document of one paragraph holding `text`, as the editor posts one. */
function words(text: string): RichTextDocument {
	return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

type Loaded = {
	mission: RichTextDocument | null;
	vision: RichTextDocument | null;
	version: string;
	saved: 'story' | 'story-undone' | null;
};

async function load(flash = ''): Promise<Loaded> {
	const cookie = [session, flash].filter((value) => value !== '').join('; ');
	const response = await request(new Request(`${ORIGIN}${SCREEN}`, { headers: { cookie } }), {
		env
	});
	expect(response.status).toBe(200);
	return (await response.json()) as Loaded;
}

type Answer =
	| { redirected: true; location: string | null; flash: string }
	| {
			redirected: false;
			status: number;
			errors: Record<string, string[]>;
			message: string | undefined;
			typed: Record<string, unknown>;
	  };

async function post(form: string, version: string, fields: Record<string, string> = {}) {
	const body = new FormData();
	body.set(WHICH_FORM, form);
	body.set(RECORD_VERSION, version);
	for (const [field, value] of Object.entries(fields)) body.set(field, value);
	const response = await request(
		new Request(`${ORIGIN}${SCREEN}`, { method: 'POST', headers: { cookie: session }, body }),
		{ env }
	);
	if (response.status === 303) {
		return {
			redirected: true,
			location: response.headers.get('Location'),
			flash: response.headers.get('Set-Cookie')?.split(';')[0] ?? ''
		} satisfies Answer;
	}
	const answered = (await response.json()) as {
		form: { result: { error?: Record<string, string[]>; initialValue?: Record<string, unknown> } };
	};
	const keyed = answered.form.result.error ?? {};
	return {
		redirected: false,
		status: response.status,
		errors: Object.fromEntries(Object.entries(keyed).filter(([field]) => field !== '')),
		message: keyed['']?.at(-1),
		typed: answered.form.result.initialValue ?? {}
	} satisfies Answer;
}

/** a save of the story as the page drawn this moment would post it. */
async function save(mission: RichTextDocument, vision: RichTextDocument | null = null) {
	const { version } = await load();
	return post(STORY_FORM, version, {
		mission: JSON.stringify(mission),
		vision: JSON.stringify(vision ?? { type: 'doc', content: [{ type: 'paragraph' }] })
	});
}

describe('the story', () => {
	it('is saved and read back', async () => {
		const answer = await save(words('We keep families warm.'), words('No child goes cold.'));
		expect(answer).toMatchObject({ redirected: true, location: SCREEN });
		if (!answer.redirected) return;

		const landed = await load(answer.flash);
		expect(landed.mission).toEqual(words('We keep families warm.'));
		expect(landed.vision).toEqual(words('No child goes cold.'));
		expect(landed.saved).toBe('story');
	});

	it('refuses a document the rule refuses, naming where, and hands back what was typed', async () => {
		const typed = JSON.stringify({
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'We keep families warm.' }] },
				{ type: 'heading', content: [{ type: 'text', text: 'Our work' }] }
			]
		});
		const { version } = await load();
		const answer = await post(STORY_FORM, version, {
			mission: typed,
			vision: JSON.stringify(words('No child goes cold.'))
		});

		expect(answer).toMatchObject({ redirected: false, status: 400 });
		if (answer.redirected) return;
		expect(answer.errors.mission?.[0]).toMatch(/heading.*at `content\[1\]`$/);
		expect(answer.errors.vision).toBeUndefined();
		expect(answer.typed.mission).toBe(typed);
		expect((await load()).mission).toBeNull();
	});

	it('refuses a save from a page drawn before another save, at a 409, and keeps that save', async () => {
		const { version: drawn } = await load();
		await save(words('Saved from the other tab.'));

		const answer = await post(STORY_FORM, drawn, {
			mission: JSON.stringify(words('Saved from this tab.')),
			vision: JSON.stringify(words('Warm.'))
		});

		expect(answer).toMatchObject({ redirected: false, status: 409 });
		if (answer.redirected) return;
		expect(answer.message).toMatch(/saved since this page was opened/);
		expect((await load()).mission).toEqual(words('Saved from the other tab.'));
	});

	it('is saved beside a look saved meanwhile, which moves the row but not the story', async () => {
		const { version: drawn } = await load();
		await env.DB.prepare(
			`insert into org_presentation (id, look, created_at, updated_at)
			 values ('default', '{"shade":"warm"}', 1, 1)
			 on conflict (id) do update set look = excluded.look, updated_at = 2`
		).run();

		const answer = await post(STORY_FORM, drawn, {
			mission: JSON.stringify(words('We keep families warm.')),
			vision: JSON.stringify(words('Warm.'))
		});
		expect(answer).toMatchObject({ redirected: true });
	});

	it('refuses a body whose version is not a story digest, naming the box', async () => {
		const body = new FormData();
		body.set(WHICH_FORM, STORY_FORM);
		body.set(RECORD_VERSION, '1760000000000');
		body.set('mission', JSON.stringify(words('Warm.')));
		body.set('vision', JSON.stringify(words('Warm.')));
		const response = await request(
			new Request(`${ORIGIN}${SCREEN}`, { method: 'POST', headers: { cookie: session }, body }),
			{ env }
		);
		expect(response.status).toBe(400);
		expect(await response.text()).toContain(`\`${RECORD_VERSION}\``);
	});

	it('refuses a blank mission, since every page’s About us reads it', async () => {
		const answer = await save({ type: 'doc', content: [{ type: 'paragraph' }] }, words('Warm.'));
		expect(answer).toMatchObject({
			redirected: false,
			status: 400,
			errors: { mission: ['required'] }
		});
	});
});

describe('Undo', () => {
	it('restores the previous mission and vision, and a second Undo puts the save back', async () => {
		await save(words('First mission.'), words('First vision.'));
		await save(words('Second mission.'));

		const undone = await post(UNDO_FORM, (await load()).version);
		expect(undone).toMatchObject({ redirected: true, location: SCREEN });
		if (!undone.redirected) return;
		const landed = await load(undone.flash);
		expect(landed).toMatchObject({
			mission: words('First mission.'),
			vision: words('First vision.'),
			saved: 'story-undone'
		});

		await post(UNDO_FORM, landed.version);
		expect(await load()).toMatchObject({ mission: words('Second mission.'), vision: null });
	});

	it('takes the first save back to no story at all', async () => {
		await save(words('First mission.'));
		await post(UNDO_FORM, (await load()).version);
		expect(await load()).toMatchObject({ mission: null, vision: null });
	});

	it('refuses an Undo from a page drawn before another save, at a 409, and keeps that save', async () => {
		await save(words('First mission.'));
		const { version: drawn } = await load();
		await save(words('Saved from the other tab.'));

		const answer = await post(UNDO_FORM, drawn);
		expect(answer).toMatchObject({ redirected: false, status: 409 });
		expect((await load()).mission).toEqual(words('Saved from the other tab.'));
	});

	it('refuses an Undo with no story saved to go back to, on a row a look save made', async () => {
		await env.DB.prepare(
			`insert into org_presentation (id, look, created_at, updated_at)
			 values ('default', '{"shade":"warm"}', 1, 1)`
		).run();
		const answer = await post(UNDO_FORM, (await load()).version);
		expect(answer).toMatchObject({ redirected: false, status: 409 });
	});
});
