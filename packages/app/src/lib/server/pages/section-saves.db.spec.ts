import { beforeAll, describe, expect, it } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '../../forms/definition';
import { type Page, parsePage } from '../../page/catalog';
import { defaultCampaign } from '../../page/defaults';
import {
	type CampaignEditFormId,
	type DonationPageEditFormId,
	EDIT_FORMS,
	type EditFormId
} from '../../page/edit-forms';
import { createDb, type Db } from '../db/client';
import { eq } from 'drizzle-orm';
import { page, program } from '../db/schema';
import { readForm } from '../forms/queries';
import { createImage, stored as imageStored } from '../images/image.testing';
import { endAsItStands, heroShowing, insertPage, SETTINGS } from './page-row.testing';
import { publishPage } from './publish';
import { readPage } from './queries';
import { saveCampaignSection, saveDonationPageSection } from './section-saves';
import { client } from '$lib/server/db/database.testing';

// a db spec because every card's Save reads the page's draft and writes it back against the
// version the editor was drawn at. the campaign's cards unless a test says the Donation page.

let db: Db;

beforeAll(() => {
	db = createDb(client);
});

const GONE = 'no campaign has that id';

async function stored(pageId: string) {
	const row = await readPage(db, pageId);
	if (row === null) throw new Error('the page is gone');
	const draft = parsePage(row.type, JSON.parse(row.draft));
	if (!draft.ok) throw new Error(draft.message);
	return { row, draft: draft.page };
}

async function press(
	pageId: string,
	form: EditFormId,
	fields: [string, string][],
	version?: number
) {
	const { row } = await stored(pageId);
	const body = new FormData();
	body.set(WHICH_FORM, form);
	body.set(RECORD_VERSION, String(version ?? row.updatedAt.getTime()));
	for (const [name, value] of fields) body.append(name, value);
	return row.type === 'campaign'
		? saveCampaignSection(
				db,
				{ type: 'campaign', id: pageId },
				form as CampaignEditFormId,
				body,
				GONE
			)
		: saveDonationPageSection(
				db,
				{ type: 'donation_page' },
				form as DonationPageEditFormId,
				body,
				GONE
			);
}

/** what a save leaves alone: the live page, and the settings row gifts are charged against. */
async function untouched(pageId: string) {
	const { row } = await stored(pageId);
	const owned = await readForm(db, row.formId);
	return { published: row.published, owned };
}

function withPage(extra: Partial<Page>): Page {
	return { ...defaultCampaign(), settings: SETTINGS, ...extra };
}

/** a rejection as the editor reads it: the status, the messages by box, and the boxes sent back. */
function refusal(answer: unknown) {
	const { data, init } = answer as {
		data: { form: { id: string; result: { error: unknown; initialValue: unknown } } };
		init: { status: number };
	};
	return {
		status: init.status,
		form: data.form.id,
		error: data.form.result.error,
		typed: data.form.result.initialValue
	};
}

const GOAL_BOXES = (
	amounts: [string, string][],
	goal: [string, string] = ['none', '']
): [string, string][] => [
	['goal_mode', goal[0]],
	['goal_amount', goal[1]],
	...amounts.flatMap(([amount, label], at): [string, string][] => [
		[`amount[${at}]`, amount],
		[`amount_label[${at}]`, label]
	])
];

describe('Goal and amounts', () => {
	it('writes the goal, the amounts and their labels to the draft alone', async () => {
		const pageId = await insertPage(db, 'campaign', withPage({}), withPage({}));
		const before = await untouched(pageId);

		const answer = await press(
			pageId,
			EDIT_FORMS.campaignGoal,
			GOAL_BOXES(
				[
					['25', 'A coat'],
					['100', '']
				],
				['fixed', '15,000']
			)
		);

		expect(answer).toEqual({ saved: 'campaign-goal' });
		const { draft } = await stored(pageId);
		expect(draft.goalMinor).toBe(1_500_000);
		expect(draft.settings?.suggestedAmounts).toEqual([2500, 10_000]);
		expect(draft.amountLabels).toEqual([{ amountMinor: 2500, label: 'A coat' }]);
		expect(await untouched(pageId)).toEqual(before);
	});

	it('refuses a fifth amount under the list, and writes nothing', async () => {
		const pageId = await insertPage(db, 'campaign');

		const answer = await press(
			pageId,
			EDIT_FORMS.campaignGoal,
			GOAL_BOXES([
				['10', ''],
				['20', ''],
				['30', ''],
				['40', ''],
				['50', '']
			])
		);

		expect(refusal(answer)).toMatchObject({ status: 400, error: { amount: ['at most 4'] } });
		expect((await stored(pageId)).draft.settings?.suggestedAmounts).toEqual([2500, 5000]);
	});

	it('refuses a label over 40 characters under its own box', async () => {
		const pageId = await insertPage(db, 'campaign');

		const answer = await press(
			pageId,
			EDIT_FORMS.campaignGoal,
			GOAL_BOXES([
				['25', 'fine'],
				['50', 'x'.repeat(41)]
			])
		);

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { 'amount_label[1]': ['at most 40 characters'] }
		});
	});

	it('drops the label beside an amount taken out', async () => {
		const pageId = await insertPage(db, 'campaign');

		await press(
			pageId,
			EDIT_FORMS.campaignGoal,
			GOAL_BOXES([
				['25', 'A coat'],
				['', 'Two coats']
			])
		);

		const { draft } = await stored(pageId);
		expect(draft.settings?.suggestedAmounts).toEqual([2500]);
		expect(draft.amountLabels).toEqual([{ amountMinor: 2500, label: 'A coat' }]);
	});

	it('holds each amount to the smallest and largest gift the draft holds', async () => {
		const pageId = await insertPage(db, 'campaign');

		const answer = await press(pageId, EDIT_FORMS.campaignGoal, GOAL_BOXES([['2', '']]));

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { 'amount[0]': [expect.stringContaining('$5')] }
		});
	});

	it('clears the goal on No goal', async () => {
		const pageId = await insertPage(db, 'campaign', withPage({ goalMinor: 500_000 }));

		await press(pageId, EDIT_FORMS.campaignGoal, GOAL_BOXES([['25', '']], ['none', '']));

		expect((await stored(pageId)).draft.goalMinor).toBeUndefined();
	});

	it('refuses a fixed goal with no amount under its box', async () => {
		const pageId = await insertPage(db, 'campaign');

		const answer = await press(pageId, EDIT_FORMS.campaignGoal, GOAL_BOXES([], ['fixed', '']));

		expect(refusal(answer)).toMatchObject({ status: 400, error: { goal_amount: ['required'] } });
	});

	it.each(['0', '-500', '12.345', 'lots', '1e15'])(
		'refuses the fixed goal %j under its box, and writes nothing',
		async (goal) => {
			const pageId = await insertPage(db, 'campaign', withPage({ goalMinor: 500_000 }));

			const answer = await press(
				pageId,
				EDIT_FORMS.campaignGoal,
				GOAL_BOXES([['25', '']], ['fixed', goal])
			);

			expect(refusal(answer)).toMatchObject({
				status: 400,
				error: { goal_amount: [expect.any(String)] }
			});
			expect((await stored(pageId)).draft.goalMinor).toBe(500_000);
		}
	);

	it('refuses a press drawn before another save, and writes nothing', async () => {
		const pageId = await insertPage(db, 'campaign');
		const drawn = (await stored(pageId)).row.updatedAt.getTime();
		await press(pageId, EDIT_FORMS.campaignGoal, GOAL_BOXES([['30', '']]));

		const answer = await press(pageId, EDIT_FORMS.campaignGoal, GOAL_BOXES([['40', '']]), drawn);

		expect(refusal(answer)).toMatchObject({ status: 409, form: 'campaign-goal' });
		expect((await stored(pageId)).draft.settings?.suggestedAmounts).toEqual([3000]);
	});
});

/** an active program called `name`, and its id. */
async function aProgram(name: string): Promise<string> {
	const [made] = await db.insert(program).values({ name }).returning({ id: program.id });
	if (!made) throw new Error('inserting the fixture program returned no row');
	return made.id;
}

const SETTINGS_BOXES = (over: Record<string, string> = {}): [string, string][] =>
	Object.entries({
		program_mode: 'none',
		program_id: '',
		min_minor: '5',
		max_minor: '1,000',
		share_message: '',
		end_date: '',
		time_zone: '',
		...over
	});

describe('Settings', () => {
	it('writes the program, the bounds, the switches, the share message and the end date to the draft alone', async () => {
		const pageId = await insertPage(db, 'campaign', withPage({}), withPage({}));
		const before = await untouched(pageId);
		const coats = await aProgram('Winter coats');

		const answer = await press(pageId, EDIT_FORMS.campaignSettings, [
			...SETTINGS_BOXES({
				program_mode: 'pinned',
				program_id: coats,
				min_minor: '10',
				max_minor: '2,000',
				share_message: 'Keep a child warm',
				end_date: '2099-12-31',
				time_zone: 'America/New_York'
			}),
			['open_on_monthly', 'on']
		]);

		expect(answer).toEqual({ saved: 'campaign-settings' });
		const { draft } = await stored(pageId);
		expect(draft.settings).toMatchObject({
			programMode: 'pinned',
			programId: coats,
			minMinor: 1000,
			maxMinor: 200_000,
			suggestedAmounts: [2500, 5000]
		});
		expect(draft.switches).toEqual({ openOnMonthly: true, dedicationOn: false });
		expect(draft.shareMessage).toBe('Keep a child warm');
		expect(draft.endsZone).toBe('America/New_York');
		expect(draft.endsAt).toBeGreaterThan(Date.parse('2099-12-31T00:00:00Z'));
		expect(await untouched(pageId)).toEqual(before);
	});

	it('clears the end date and the share message when their boxes are blank', async () => {
		const pageId = await insertPage(
			db,
			'campaign',
			withPage({ shareMessage: 'Old', endsAt: Date.parse('2099-01-01'), endsZone: 'UTC' })
		);

		await press(pageId, EDIT_FORMS.campaignSettings, SETTINGS_BOXES());

		const { draft } = await stored(pageId);
		expect([draft.shareMessage, draft.endsAt, draft.endsZone]).toEqual([
			undefined,
			undefined,
			undefined
		]);
	});

	it('refuses a smallest gift above an amount the campaign suggests, naming where those are', async () => {
		const pageId = await insertPage(db, 'campaign');

		const answer = await press(
			pageId,
			EDIT_FORMS.campaignSettings,
			SETTINGS_BOXES({ min_minor: '30' })
		);

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { '': [expect.stringContaining('Goal and amounts')] }
		});
		expect((await stored(pageId)).draft.settings?.minMinor).toBe(500);
	});

	it('refuses a program no longer offered under the program box', async () => {
		const pageId = await insertPage(db, 'campaign');

		const answer = await press(
			pageId,
			EDIT_FORMS.campaignSettings,
			SETTINGS_BOXES({ program_mode: 'pinned', program_id: crypto.randomUUID() })
		);

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { program_id: ['Choose an active program.'] }
		});
	});

	it('refuses an end date already over under its box', async () => {
		const pageId = await insertPage(db, 'campaign');

		const answer = await press(
			pageId,
			EDIT_FORMS.campaignSettings,
			SETTINGS_BOXES({ end_date: '2001-01-01', time_zone: 'UTC' })
		);

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { end_date: ['today or later; Jan 1, 2001 is already over'] }
		});
	});
});

const upload = () =>
	createImage(
		db,
		{ kind: 'photo', contentType: 'image/webp', width: 4, height: 3, alt: null },
		new Uint8Array([1, 2, 3])
	);

describe('Media', () => {
	it('places the banner and the logo by their uploads’ ids, in the draft alone', async () => {
		const pageId = await insertPage(db, 'campaign', withPage({}), withPage({}));
		const before = await untouched(pageId);
		const [banner, logo] = [await upload(), await upload()];

		const answer = await press(pageId, EDIT_FORMS.campaignMedia, [
			['hero_image_id', banner],
			['logo_image_id', logo]
		]);

		expect(answer).toEqual({ saved: 'campaign-media' });
		const { draft } = await stored(pageId);
		expect([draft.hero, draft.logo]).toEqual([
			{ imageId: banner, alt: null },
			{ imageId: logo, alt: null }
		]);
		expect(await untouched(pageId)).toEqual(before);
	});

	it('keeps a kept photo’s description, and takes a blank box’s photo off', async () => {
		const banner = await upload();
		const logo = await upload();
		const pageId = await insertPage(
			db,
			'campaign',
			withPage({
				hero: { imageId: banner, alt: 'Coats on a rail' },
				logo: { imageId: logo, alt: null }
			})
		);

		await press(pageId, EDIT_FORMS.campaignMedia, [
			['hero_image_id', banner],
			['logo_image_id', '']
		]);

		const { draft } = await stored(pageId);
		expect([draft.hero, draft.logo]).toEqual([
			{ imageId: banner, alt: 'Coats on a rail' },
			undefined
		]);
		expect(await imageStored(db, logo)).toEqual({ row: false, bytes: false });
	});

	it('frees the banner it replaces, and keeps one the live page still places', async () => {
		const first = await upload();
		const draftOnly = await insertPage(db, 'campaign', heroShowing(first));
		const live = await upload();
		const published = await insertPage(db, 'campaign', heroShowing(live), heroShowing(live));

		await press(draftOnly, EDIT_FORMS.campaignMedia, [
			['hero_image_id', await upload()],
			['logo_image_id', '']
		]);
		await press(published, EDIT_FORMS.campaignMedia, [
			['hero_image_id', await upload()],
			['logo_image_id', '']
		]);

		expect(await imageStored(db, first)).toEqual({ row: false, bytes: false });
		expect(await imageStored(db, live)).toEqual({ row: true, bytes: true });
	});

	it('refuses an id no stored photo has, under its box', async () => {
		const pageId = await insertPage(db, 'campaign');
		const missing = crypto.randomUUID();

		const answer = await press(pageId, EDIT_FORMS.campaignMedia, [
			['hero_image_id', ''],
			['logo_image_id', missing]
		]);

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { logo_image_id: [`no stored photo has the id "${missing}"`] }
		});
	});
});

const story = (text: string) =>
	JSON.stringify({
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
	});

const GENERAL = (
	over: { name?: string; slug?: string; story?: string } = {}
): [string, string][] => [
	['name', over.name ?? 'Winter coat drive'],
	['slug', over.slug ?? ''],
	['story', over.story ?? story('Every child warm by December.')]
];

/** General's boxes as the card draws them over `pageId`, with `over` typed in. */
async function general(pageId: string, over: Parameters<typeof GENERAL>[0] = {}) {
	const { row } = await stored(pageId);
	return GENERAL({ slug: row.slug ?? '', ...over });
}

let slugs = 0;
/** a link no other test's campaign holds, since the file shares one database. */
const fresh = (base: string) => `${base}-${(slugs += 1)}`;

/** Publish on `pageId`, at the version it holds now. */
async function publish(pageId: string) {
	const { row } = await stored(pageId);
	return publishPage(db, { type: 'campaign', id: pageId }, row.updatedAt, { now: Date.now() });
}

async function slugged(pageId: string, slug: string) {
	await db.update(page).set({ slug }).where(eq(page.id, pageId));
}

describe('General', () => {
	it('writes the name, the link and the description to the draft alone, and Publish takes them live', async () => {
		const pageId = await insertPage(db, 'campaign', withPage({}), withPage({}));
		const [from, to] = [fresh('coats'), fresh('spring-coats')];
		await slugged(pageId, from);
		const before = await stored(pageId);

		const answer = await press(pageId, EDIT_FORMS.campaignGeneral, [
			...(await general(pageId, {
				name: 'Spring coat drive',
				slug: to,
				story: story('Warm by May.')
			})),
			['move', 'on']
		]);

		expect(answer).toEqual({ saved: 'campaign-general' });
		const saved = await stored(pageId);
		expect(saved.row).toMatchObject({
			name: 'Winter coat drive',
			slug: from,
			published: before.row.published
		});
		expect((await readForm(db, saved.row.formId))?.name).not.toBe('Spring coat drive');
		expect(saved.draft).toMatchObject({ name: 'Spring coat drive', slug: to });
		expect(saved.draft.story).toEqual(JSON.parse(story('Warm by May.')));

		expect((await publish(pageId)).kind).toBe('published');
		const live = await stored(pageId);
		expect(live.row).toMatchObject({ name: 'Spring coat drive', slug: to });
		expect((await readForm(db, live.row.formId))?.name).toBe('Spring coat drive');
		expect(JSON.parse(live.row.published ?? '{}')).not.toHaveProperty('slug');
		expect(live.draft).not.toHaveProperty('slug');
	});

	it('keeps a never-published campaign’s link until its first Publish', async () => {
		const pageId = await insertPage(db, 'campaign');
		const [from, to] = [fresh('coats'), fresh('spring-coats')];
		await slugged(pageId, from);

		await press(pageId, EDIT_FORMS.campaignGeneral, await general(pageId, { slug: to }));

		expect((await stored(pageId)).row.slug).toBe(from);
		expect((await publish(pageId)).kind).toBe('published');
		expect((await stored(pageId)).row.slug).toBe(to);
	});

	it('asks before moving a published campaign’s link, writing nothing, and drafts the move once answered yes', async () => {
		const pageId = await insertPage(db, 'campaign', withPage({}), withPage({}));
		const [from, to] = [fresh('coats'), fresh('warm-coats')];
		await slugged(pageId, from);
		const fields = await general(pageId, { name: 'Renamed', slug: to });
		const before = (await stored(pageId)).row.draft;

		const asked = await press(pageId, EDIT_FORMS.campaignGeneral, fields);

		expect(asked).toEqual({ ask: { kind: 'move', from: `/${from}`, to: `/${to}` } });
		expect((await stored(pageId)).row.draft).toBe(before);

		const answered = await press(pageId, EDIT_FORMS.campaignGeneral, [...fields, ['move', 'on']]);

		expect(answered).toEqual({ saved: 'campaign-general' });
		expect((await stored(pageId)).row).toMatchObject({ slug: from, name: 'Winter coat drive' });
		expect((await stored(pageId)).draft).toMatchObject({ slug: to, name: 'Renamed' });
	});

	it('asks before taking an ended campaign’s link, which that one gives up at Publish', async () => {
		const holder = await insertPage(db, 'campaign', withPage({}), withPage({}));
		const held = fresh('coats');
		await slugged(holder, held);
		await endAsItStands(db, holder);
		const pageId = await insertPage(db, 'campaign');
		const fields = await general(pageId, { slug: held });

		expect(await press(pageId, EDIT_FORMS.campaignGeneral, fields)).toEqual({
			ask: { kind: 'takeover', holder: 'Winter coat drive', to: `/${held}` }
		});
		expect(
			await press(pageId, EDIT_FORMS.campaignGeneral, [...fields, ['takeover', 'on']])
		).toEqual({ saved: 'campaign-general' });
		expect((await stored(holder)).row.slug).toBe(held);

		expect((await publish(pageId)).kind).toBe('published');
		expect((await stored(pageId)).row.slug).toBe(held);
		expect((await stored(holder)).row.slug).toBeNull();
	});

	it('takes the link of an unpublished campaign past its published end at Publish, ending that one', async () => {
		const ended = withPage({ endsAt: Date.now() - 60_000, endsZone: 'America/New_York' });
		const holder = await insertPage(db, 'campaign', withPage({}), ended);
		const held = fresh('coats');
		await slugged(holder, held);
		await db.update(page).set({ state: 'unpublished' }).where(eq(page.id, holder));
		const pageId = await insertPage(db, 'campaign');
		const fields = await general(pageId, { slug: held });

		expect(await press(pageId, EDIT_FORMS.campaignGeneral, fields)).toEqual({
			ask: { kind: 'takeover', holder: 'Winter coat drive', to: `/${held}` }
		});
		await press(pageId, EDIT_FORMS.campaignGeneral, [...fields, ['takeover', 'on']]);
		expect((await publish(pageId)).kind).toBe('published');

		expect((await stored(pageId)).row.slug).toBe(held);
		expect((await stored(holder)).row).toMatchObject({ state: 'ended', slug: null });
	});

	it('refuses Publish where a live campaign has taken the drafted link since, moving nothing', async () => {
		const pageId = await insertPage(db, 'campaign');
		const [from, to] = [fresh('coats'), fresh('spring-coats')];
		await slugged(pageId, from);
		await press(pageId, EDIT_FORMS.campaignGeneral, await general(pageId, { slug: to }));
		const taker = await insertPage(db, 'campaign', withPage({}), withPage({}));
		await db.update(page).set({ slug: to, name: 'Spring fund' }).where(eq(page.id, taker));

		const refused = await publish(pageId);

		expect(refused).toMatchObject({ kind: 'refused' });
		expect(JSON.stringify(refused)).toContain(`the link /${to} is taken by Spring fund`);
		expect((await stored(pageId)).row).toMatchObject({ slug: from, state: 'never_published' });
	});

	it('refuses a link another campaign holds, an unpublished one included, naming it', async () => {
		const holder = await insertPage(db, 'campaign', withPage({}), withPage({}));
		const held = fresh('coats');
		await slugged(holder, held);
		await db.update(page).set({ state: 'unpublished', name: 'Coats' }).where(eq(page.id, holder));
		const pageId = await insertPage(db, 'campaign');

		const answer = await press(
			pageId,
			EDIT_FORMS.campaignGeneral,
			await general(pageId, { slug: held })
		);

		expect(refusal(answer)).toMatchObject({ status: 409, error: { slug: ['taken by Coats'] } });
	});

	it.each([
		['donate', 'taken by the Donation page'],
		['Coats!', 'lowercase letters, numbers and single hyphens between words, not “!”'],
		['', 'required']
	])('refuses the link %j under its box', async (slug, said) => {
		const pageId = await insertPage(db, 'campaign');

		const answer = await press(pageId, EDIT_FORMS.campaignGeneral, await general(pageId, { slug }));

		expect(refusal(answer)).toMatchObject({ status: 400, error: { slug: [said] } });
	});

	it('refuses a description over 3,000 characters under its box, and renames nothing', async () => {
		const pageId = await insertPage(db, 'campaign');

		const answer = await press(
			pageId,
			EDIT_FORMS.campaignGeneral,
			await general(pageId, { name: 'Renamed', story: story('x'.repeat(3001)) })
		);

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { story: ['at most 3,000 characters'] }
		});
		expect((await stored(pageId)).row.name).toBe('Winter coat drive');
	});

	it('refuses a press drawn before another save, and renames nothing', async () => {
		const pageId = await insertPage(db, 'campaign');
		const drawn = (await stored(pageId)).row.updatedAt.getTime();
		await press(pageId, EDIT_FORMS.campaignGoal, GOAL_BOXES([['30', '']]));

		const answer = await press(
			pageId,
			EDIT_FORMS.campaignGeneral,
			await general(pageId, { name: 'Renamed' }),
			drawn
		);

		expect(refusal(answer)).toMatchObject({ status: 409 });
		const { row } = await stored(pageId);
		expect(row.name).toBe('Winter coat drive');
		expect((await readForm(db, row.formId))?.name).not.toBe('Renamed');
	});
});

describe('the Donation page’s cards', () => {
	const donationPage = (extra: Partial<Page> = {}): Page => ({
		heading: '',
		switches: { openOnMonthly: false, dedicationOn: false },
		...extra
	});

	it('writes the title to the draft alone', async () => {
		const pageId = await insertPage(db, 'donation_page', donationPage());
		const before = await untouched(pageId);

		const answer = await press(pageId, EDIT_FORMS.donationPageGeneral, [['heading', 'Give today']]);

		expect(answer).toEqual({ saved: 'donation-page-general' });
		expect((await stored(pageId)).draft.heading).toBe('Give today');
		expect(await untouched(pageId)).toEqual(before);
	});

	it('writes the program, the bounds and up to twelve suggested amounts to the draft, switches kept', async () => {
		const pageId = await insertPage(
			db,
			'donation_page',
			donationPage({ switches: { openOnMonthly: true, dedicationOn: false } })
		);
		const before = await untouched(pageId);
		const amounts = Array.from({ length: 12 }, (_, at) => String((at + 1) * 10));

		const answer = await press(pageId, EDIT_FORMS.donationPageGiving, [
			['program_mode', 'none'],
			['program_id', ''],
			['min_minor', '5'],
			['max_minor', '1,000'],
			...amounts.map((amount, at): [string, string] => [`suggested_amounts[${at}]`, amount])
		]);

		expect(answer).toEqual({ saved: 'donation-page-giving' });
		const { draft } = await stored(pageId);
		expect(draft.settings).toMatchObject({ minMinor: 500, maxMinor: 100_000 });
		expect(draft.settings?.suggestedAmounts).toHaveLength(12);
		expect(draft.switches).toEqual({ openOnMonthly: true, dedicationOn: false });
		expect(draft.amountLabels).toBeUndefined();
		expect(await untouched(pageId)).toEqual(before);
	});

	it('refuses a thirteenth suggested amount', async () => {
		const pageId = await insertPage(db, 'donation_page', donationPage());
		const amounts = Array.from({ length: 13 }, (_, at) => String((at + 1) * 10));

		const answer = await press(pageId, EDIT_FORMS.donationPageGiving, [
			['program_mode', 'none'],
			['program_id', ''],
			['min_minor', '5'],
			['max_minor', '1,000'],
			...amounts.map((amount, at): [string, string] => [`suggested_amounts[${at}]`, amount])
		]);

		expect(refusal(answer)).toMatchObject({
			status: 400,
			error: { suggested_amounts: ['at most 12'] }
		});
	});

	it('writes the switches and the share message to the draft alone', async () => {
		const pageId = await insertPage(db, 'donation_page', donationPage());
		const before = await untouched(pageId);

		const answer = await press(pageId, EDIT_FORMS.donationPageSettings, [
			['dedication_on', 'on'],
			['share_message', 'Join me']
		]);

		expect(answer).toEqual({ saved: 'donation-page-settings' });
		const { draft } = await stored(pageId);
		expect(draft.switches).toEqual({ openOnMonthly: false, dedicationOn: true });
		expect(draft.shareMessage).toBe('Join me');
		expect(await untouched(pageId)).toEqual(before);
	});
});
