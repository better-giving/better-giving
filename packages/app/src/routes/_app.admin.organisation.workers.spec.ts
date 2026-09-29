import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import type { RichTextDocument } from '$lib/rich-text/document';
import { createDb } from '$lib/server/db/client';
import { createImage } from '$lib/server/images/queries';
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
const LOOK_FORM = 'org-look';
const LOOK_UNDO_FORM = 'org-look-undo';
const SHARING_FORM = 'org-sharing';
const SHARING_UNDO_FORM = 'org-sharing-undo';
const LOGO_FORM = 'org-logo';
const LOGO_UNDO_FORM = 'org-logo-undo';

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
	landing: string | null;
	look: { shade: string; corner: string; brandColour: string | null };
	lookVersion: string;
	sharing: {
		channels: string[];
		message: string | null;
		links: { label: string; href: string }[];
	};
	sharingVersion: string;
	sharingSaved: 'sharing' | 'sharing-undone' | null;
	logo: { imageId: string; width: number; height: number } | null;
	logoVersion: string;
	logoUndoable: boolean;
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

/** each value a box posts; a list is posted as the same name repeated, as ticked boxes are. */
async function post(
	form: string,
	version: string,
	fields: Record<string, string | readonly string[]> = {}
) {
	const body = new FormData();
	body.set(WHICH_FORM, form);
	body.set(RECORD_VERSION, version);
	for (const [field, value] of Object.entries(fields)) {
		for (const one of typeof value === 'string' ? [value] : value) body.append(field, one);
	}
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

describe('Undo of the story', () => {
	it('lands under a name of its own, apart from the save it undid, where a plain load names none', async () => {
		const saved = await save(words('First mission.'));
		if (!saved.redirected) throw new Error('the save did not land');
		const afterSave = await load(saved.flash);

		const undone = await post(UNDO_FORM, afterSave.version);
		if (!undone.redirected) throw new Error('the Undo did not land');
		const afterUndo = await load(undone.flash);

		expect(afterSave.landing).toEqual(expect.any(String));
		expect(afterUndo.landing).toEqual(expect.any(String));
		expect(afterUndo.landing).not.toBe(afterSave.landing);
		expect((await load()).landing).toBeNull();
	});

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

type LookAnswer = {
	status: number;
	saved?: 'look' | 'look-undone' | 'logo' | 'logo-undone';
	version?: string;
	errors: Record<string, string[]>;
	message: string | undefined;
	typed: Record<string, unknown>;
};

/** a look press as the section's fetcher posts one: it answers in place, never by a redirect. */
async function postLook(
	form: string,
	version: string,
	fields: Record<string, string> = {}
): Promise<LookAnswer> {
	const body = new FormData();
	body.set(WHICH_FORM, form);
	body.set(RECORD_VERSION, version);
	for (const [field, value] of Object.entries(fields)) body.set(field, value);
	const response = await request(
		new Request(`${ORIGIN}${SCREEN}`, { method: 'POST', headers: { cookie: session }, body }),
		{ env }
	);
	const answered = (await response.json()) as {
		saved?: 'look' | 'look-undone' | 'logo' | 'logo-undone';
		version?: string;
		form?: { result: { error?: Record<string, string[]>; initialValue?: Record<string, unknown> } };
	};
	const keyed = answered.form?.result.error ?? {};
	return {
		status: response.status,
		...(answered.saved === undefined ? {} : { saved: answered.saved }),
		...(answered.version === undefined ? {} : { version: answered.version }),
		errors: Object.fromEntries(Object.entries(keyed).filter(([field]) => field !== '')),
		message: keyed['']?.at(-1),
		typed: answered.form?.result.initialValue ?? {}
	};
}

/** a pick as the page drawn this moment would post it. */
async function pick(look: { shade: string; corner: string; brandColour: string }) {
	return postLook(LOOK_FORM, (await load()).lookVersion, look);
}

describe('the look', () => {
	it('is light and soft with no brand colour before anything is saved', async () => {
		expect((await load()).look).toEqual({ shade: 'light', corner: 'soft', brandColour: null });
	});

	it('is saved and read back, answering in place with the version it wrote', async () => {
		const answer = await pick({ shade: 'warm', corner: 'round', brandColour: '#1d6b4f' });
		expect(answer).toMatchObject({ status: 200, saved: 'look' });

		const landed = await load();
		expect(landed.look).toEqual({ shade: 'warm', corner: 'round', brandColour: '#1d6b4f' });
		expect(answer.version).toBe(landed.lookVersion);
	});

	it('is saved with no brand colour where the colour box is blank', async () => {
		await pick({ shade: 'cool', corner: 'square', brandColour: '#1d6b4f' });
		await pick({ shade: 'cool', corner: 'square', brandColour: '' });
		expect((await load()).look).toEqual({ shade: 'cool', corner: 'square', brandColour: null });
	});

	it('refuses a shade and a corner off their lists, naming each, and hands back what was picked', async () => {
		const picked = { shade: 'dusk', corner: 'bevel', brandColour: '#1d6b4f' };
		const answer = await pick(picked);

		expect(answer.status).toBe(400);
		expect(answer.errors.shade?.[0]).toBe('"dusk" is not a shade; a shade is light, warm or cool');
		expect(answer.errors.corner?.[0]).toBe(
			'"bevel" is not a corner; a corner is square, soft or round'
		);
		expect(answer.errors.brandColour).toBeUndefined();
		expect(answer.typed).toMatchObject(picked);
		expect((await load()).look).toEqual({ shade: 'light', corner: 'soft', brandColour: null });
	});

	it('refuses a pick from a page drawn before another save, at a 409, and keeps that save', async () => {
		const { lookVersion: drawn } = await load();
		await pick({ shade: 'warm', corner: 'soft', brandColour: '#1d6b4f' });

		const answer = await postLook(LOOK_FORM, drawn, {
			shade: 'cool',
			corner: 'round',
			brandColour: '#8a3b12'
		});
		expect(answer.status).toBe(409);
		expect(answer.message).toMatch(/look has been saved since this page was opened/);
		expect((await load()).look).toEqual({ shade: 'warm', corner: 'soft', brandColour: '#1d6b4f' });
	});

	it('is saved from a page drawn before a story save, which moves the row but not the look', async () => {
		const { lookVersion: drawn } = await load();
		await save(words('We keep families warm.'));

		const answer = await postLook(LOOK_FORM, drawn, {
			shade: 'warm',
			corner: 'round',
			brandColour: ''
		});
		expect(answer).toMatchObject({ status: 200, saved: 'look' });
	});

	it('leaves a story typed on a page drawn before a look save saveable', async () => {
		const { version: drawn } = await load();
		await pick({ shade: 'cool', corner: 'square', brandColour: '#1d6b4f' });

		const answer = await post(STORY_FORM, drawn, {
			mission: JSON.stringify(words('We keep families warm.')),
			vision: JSON.stringify(words('Warm.'))
		});
		expect(answer).toMatchObject({ redirected: true });
	});

	it('refuses a brand colour that is not a lowercase #rrggbb, naming it', async () => {
		const answer = await pick({ shade: 'warm', corner: 'soft', brandColour: '#1D6B4F' });
		expect(answer.status).toBe(400);
		expect(answer.errors).toEqual({
			brandColour: [
				'"#1D6B4F" is not a brand colour; a brand colour is a lowercase #rrggbb, or blank for none'
			]
		});
	});
});

describe('Undo of the look', () => {
	it('restores the previous look, and a second Undo puts the save back', async () => {
		await pick({ shade: 'warm', corner: 'round', brandColour: '#1d6b4f' });
		await pick({ shade: 'cool', corner: 'square', brandColour: '#8a3b12' });

		const undone = await postLook(LOOK_UNDO_FORM, (await load()).lookVersion);
		expect(undone).toMatchObject({ status: 200, saved: 'look-undone' });
		const landed = await load();
		expect(landed.look).toEqual({ shade: 'warm', corner: 'round', brandColour: '#1d6b4f' });
		expect(undone.version).toBe(landed.lookVersion);

		await postLook(LOOK_UNDO_FORM, landed.lookVersion);
		expect((await load()).look).toEqual({
			shade: 'cool',
			corner: 'square',
			brandColour: '#8a3b12'
		});
	});

	it('takes the first save back to the default look', async () => {
		await pick({ shade: 'warm', corner: 'round', brandColour: '#1d6b4f' });
		await postLook(LOOK_UNDO_FORM, (await load()).lookVersion);
		expect((await load()).look).toEqual({ shade: 'light', corner: 'soft', brandColour: null });
	});

	it('refuses an Undo from a page drawn before another save, at a 409, and keeps that save', async () => {
		await pick({ shade: 'warm', corner: 'round', brandColour: '#1d6b4f' });
		const { lookVersion: drawn } = await load();
		await pick({ shade: 'cool', corner: 'square', brandColour: '#8a3b12' });

		const answer = await postLook(LOOK_UNDO_FORM, drawn);
		expect(answer.status).toBe(409);
		expect(answer.message).toMatch(/look has been saved since this page was opened/);
		expect((await load()).look).toEqual({
			shade: 'cool',
			corner: 'square',
			brandColour: '#8a3b12'
		});
	});

	it('refuses an Undo with no look saved to go back to, on a row a story save made', async () => {
		await save(words('We keep families warm.'));
		const answer = await postLook(LOOK_UNDO_FORM, (await load()).lookVersion);
		expect(answer.status).toBe(409);
	});

	it('leaves the story where it is', async () => {
		await save(words('First mission.'));
		await save(words('Second mission.'));
		await pick({ shade: 'warm', corner: 'round', brandColour: '#1d6b4f' });
		await postLook(LOOK_UNDO_FORM, (await load()).lookVersion);
		expect((await load()).mission).toEqual(words('Second mission.'));
	});
});

/** a sharing save as the page drawn this moment would post it: each link a row of two boxes. */
async function share(
	channels: readonly string[],
	message: string,
	links: readonly (readonly [string, string])[] = []
) {
	const { sharingVersion } = await load();
	return post(SHARING_FORM, sharingVersion, {
		channels,
		message,
		...Object.fromEntries(
			links.flatMap(([label, url], row) => [
				[`linkLabel[${row}]`, label],
				[`linkUrl[${row}]`, url]
			])
		)
	});
}

describe('the sharing', () => {
	it('is saved and read back, the channels in the order they were posted', async () => {
		const answer = await share(['whatsapp', 'x', 'copy-link'], 'Every meal counts.', [
			['Instagram', 'https://instagram.com/hope']
		]);
		expect(answer).toMatchObject({ redirected: true, location: SCREEN });
		if (!answer.redirected) return;

		const landed = await load(answer.flash);
		expect(landed.sharing).toEqual({
			channels: ['whatsapp', 'x', 'copy-link'],
			message: 'Every meal counts.',
			links: [{ label: 'Instagram', href: 'https://instagram.com/hope' }]
		});
		expect(landed.sharingSaved).toBe('sharing');
	});

	it('offers the default channels, no message and no links before anything is saved', async () => {
		expect((await load()).sharing).toEqual({
			channels: ['facebook', 'email', 'copy-link'],
			message: null,
			links: []
		});
	});

	it('is saved with no channels ticked as a page with no share buttons, and no blank message', async () => {
		await share([], '   ');
		expect((await load()).sharing).toMatchObject({ channels: [], message: null });
	});

	it('drops a link row left wholly blank', async () => {
		await share(['email'], '', [
			['', ''],
			['Facebook', 'https://facebook.com/hope']
		]);
		expect((await load()).sharing.links).toEqual([
			{ label: 'Facebook', href: 'https://facebook.com/hope' }
		]);
	});

	it('saves a link typed without its scheme as https', async () => {
		await share(['email'], '', [['Instagram', ' instagram.com/hope ']]);
		expect((await load()).sharing.links).toEqual([
			{ label: 'Instagram', href: 'https://instagram.com/hope' }
		]);
	});

	it('refuses a channel off the list, naming it, and hands back what was typed', async () => {
		const answer = await share(['email', 'myspace'], 'Every meal counts.', [
			['Instagram', 'https://instagram.com/hope']
		]);

		expect(answer).toMatchObject({ redirected: false, status: 400 });
		if (answer.redirected) return;
		expect(answer.errors).toEqual({
			channels: [
				'"myspace" is not a share channel; a channel is facebook, whatsapp, email, copy-link, linkedin or x'
			]
		});
		expect(answer.typed).toMatchObject({
			channels: ['email', 'myspace'],
			message: 'Every meal counts.',
			linkLabel: ['Instagram'],
			linkUrl: ['https://instagram.com/hope']
		});
		expect((await load()).sharing.channels).toEqual(['facebook', 'email', 'copy-link']);
	});

	it('refuses a link that is not an http(s) address, naming it at its row', async () => {
		const answer = await share(['email'], '', [
			['Facebook', 'https://facebook.com/hope'],
			['Site', 'javascript:alert(1)']
		]);

		expect(answer).toMatchObject({ redirected: false, status: 400 });
		if (answer.redirected) return;
		expect(answer.errors).toEqual({
			'linkUrl[1]': [
				'"javascript:alert(1)" is not a web address; a social link starts with https:// or http://'
			]
		});
		expect(answer.typed).toMatchObject({
			linkUrl: ['https://facebook.com/hope', 'javascript:alert(1)']
		});
		expect((await load()).sharing.links).toEqual([]);
	});

	it('refuses a link row with one of its two boxes blank, naming the blank one', async () => {
		const answer = await share(['email'], '', [['', 'https://facebook.com/hope']]);
		expect(answer).toMatchObject({
			redirected: false,
			status: 400,
			errors: { 'linkLabel[0]': ['required'] }
		});
	});

	it('refuses a message past the share message bound, naming its length', async () => {
		const answer = await share(['email'], 'x'.repeat(281));
		expect(answer).toMatchObject({
			redirected: false,
			status: 400,
			errors: { message: ['holds 281 characters; a share message holds at most 280'] }
		});
	});

	it('refuses a save from a page drawn before another save, at a 409, and keeps that save', async () => {
		const { sharingVersion: drawn } = await load();
		await share(['x'], 'From the other tab.');

		const answer = await post(SHARING_FORM, drawn, { channels: ['email'], message: 'This tab.' });
		expect(answer).toMatchObject({ redirected: false, status: 409 });
		if (answer.redirected) return;
		expect(answer.message).toMatch(/sharing has been saved since this page was opened/);
		expect((await load()).sharing.message).toBe('From the other tab.');
	});

	it('is saved beside a story saved meanwhile, which moves the row but not the sharing', async () => {
		const { sharingVersion: drawn } = await load();
		await save(words('We keep families warm.'));

		const answer = await post(SHARING_FORM, drawn, { channels: ['email'], message: '' });
		expect(answer).toMatchObject({ redirected: true });
	});
});

describe('Undo of the sharing', () => {
	it('restores the previous sharing, and a second Undo puts the save back', async () => {
		await share(['whatsapp', 'email'], 'First.', [['Facebook', 'https://facebook.com/hope']]);
		await share(['x'], 'Second.');

		const undone = await post(SHARING_UNDO_FORM, (await load()).sharingVersion);
		expect(undone).toMatchObject({ redirected: true, location: SCREEN });
		if (!undone.redirected) return;
		const landed = await load(undone.flash);
		expect(landed.sharing).toEqual({
			channels: ['whatsapp', 'email'],
			message: 'First.',
			links: [{ label: 'Facebook', href: 'https://facebook.com/hope' }]
		});
		expect(landed.sharingSaved).toBe('sharing-undone');
		expect(landed.saved).toBeNull();

		await post(SHARING_UNDO_FORM, landed.sharingVersion);
		expect((await load()).sharing).toMatchObject({ channels: ['x'], message: 'Second.' });
	});

	it('takes the first save back to the defaults', async () => {
		await share(['x'], 'First.');
		await post(SHARING_UNDO_FORM, (await load()).sharingVersion);
		expect((await load()).sharing).toEqual({
			channels: ['facebook', 'email', 'copy-link'],
			message: null,
			links: []
		});
	});

	it('refuses an Undo from a page drawn before another save, at a 409, and keeps that save', async () => {
		await share(['x'], 'First.');
		const { sharingVersion: drawn } = await load();
		await share(['email'], 'From the other tab.');

		const answer = await post(SHARING_UNDO_FORM, drawn);
		expect(answer).toMatchObject({ redirected: false, status: 409 });
		expect((await load()).sharing.message).toBe('From the other tab.');
	});

	it('leaves the story where it is', async () => {
		await save(words('First mission.'));
		await save(words('Second mission.'));
		await share(['x'], 'First.');
		await post(SHARING_UNDO_FORM, (await load()).sharingVersion);
		expect((await load()).mission).toEqual(words('Second mission.'));
	});
});

/** an image stored as the images route stores an upload, or as an illustration is stored. */
async function stored(kind: 'photo' | 'illustration', width = 640, height = 320) {
	return createImage(
		createDb(env.DB),
		{ kind, contentType: 'image/png', width, height, alt: null },
		new Uint8Array([1])
	);
}

/** a logo write as the page drawn this moment would post it; an empty id is Remove. */
async function setLogo(imageId: string) {
	return postLook(LOGO_FORM, (await load()).logoVersion, { imageId });
}

describe('the logo', () => {
	it('is none, with nothing to undo, before anything is saved', async () => {
		expect(await load()).toMatchObject({ logo: null, logoUndoable: false });
	});

	it('is set and read back with its size, answering in place with the version it wrote', async () => {
		const id = await stored('photo', 640, 320);
		const answer = await setLogo(id);
		expect(answer).toMatchObject({ status: 200, saved: 'logo' });

		const landed = await load();
		expect(landed.logo).toEqual({ imageId: id, width: 640, height: 320 });
		expect(answer.version).toBe(landed.logoVersion);
	});

	it('keeps the logo it replaced, which Undo swaps back, and a second Undo swaps again', async () => {
		const first = await stored('photo');
		const second = await stored('photo');
		await setLogo(first);
		await setLogo(second);
		expect((await load()).logoUndoable).toBe(true);

		const undone = await postLook(LOGO_UNDO_FORM, (await load()).logoVersion);
		expect(undone).toMatchObject({ status: 200, saved: 'logo-undone' });
		const landed = await load();
		expect(landed.logo?.imageId).toBe(first);
		expect(undone.version).toBe(landed.logoVersion);

		await postLook(LOGO_UNDO_FORM, landed.logoVersion);
		expect((await load()).logo?.imageId).toBe(second);
	});

	it('is removed by an empty id, and Undo puts it back', async () => {
		const id = await stored('photo');
		await setLogo(id);

		expect(await setLogo('')).toMatchObject({ status: 200, saved: 'logo' });
		expect(await load()).toMatchObject({ logo: null, logoUndoable: true });

		await postLook(LOGO_UNDO_FORM, (await load()).logoVersion);
		expect((await load()).logo?.imageId).toBe(id);
	});

	it('takes the first logo back to none', async () => {
		await setLogo(await stored('photo'));
		await postLook(LOGO_UNDO_FORM, (await load()).logoVersion);
		expect(await load()).toMatchObject({ logo: null, logoUndoable: true });
	});

	it('refuses a write from a page drawn before another, at a 409, and keeps that write', async () => {
		const { logoVersion: drawn } = await load();
		const theirs = await stored('photo');
		await setLogo(theirs);

		const answer = await postLook(LOGO_FORM, drawn, { imageId: await stored('photo') });
		expect(answer.status).toBe(409);
		expect(answer.message).toMatch(/logo has been changed since this page was opened/);
		expect((await load()).logo?.imageId).toBe(theirs);
	});

	it('refuses an illustration, naming it, and writes nothing', async () => {
		const drawing = await stored('illustration');
		const answer = await setLogo(drawing);
		expect(answer.status).toBe(400);
		expect(answer.errors).toEqual({
			imageId: [`"${drawing}" is an illustration; a logo is a photo uploaded here`]
		});
		expect(await load()).toMatchObject({ logo: null, logoUndoable: false });
	});

	it('refuses an id no stored image has, naming it, and writes nothing', async () => {
		const unknown = '0192a4c1-0000-7000-8000-00000000dead';
		const answer = await setLogo(unknown);
		expect(answer.status).toBe(400);
		expect(answer.errors).toEqual({
			imageId: [`"${unknown}" names no stored image; a logo is a photo uploaded here`]
		});
		expect(await load()).toMatchObject({ logo: null, logoUndoable: false });
	});

	it('refuses an Undo with nothing to undo, before any logo and after a Remove of none', async () => {
		const before = await postLook(LOGO_UNDO_FORM, (await load()).logoVersion);
		expect(before.status).toBe(409);
		expect(before.message).toMatch(/nothing to undo/);

		await setLogo('');
		expect((await load()).logoUndoable).toBe(false);
		const after = await postLook(LOGO_UNDO_FORM, (await load()).logoVersion);
		expect(after.status).toBe(409);
		expect(after.message).toMatch(/nothing to undo/);
	});
});
