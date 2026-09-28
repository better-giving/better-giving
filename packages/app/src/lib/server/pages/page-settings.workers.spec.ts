import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { SHARE_MESSAGE_MAX } from '$lib/page/catalog';
import { defaultDonationPage } from '$lib/page/defaults';
import {
	PAGE_END_DATE_FORM_ID,
	PAGE_GOAL_FORM_ID,
	PAGE_LOOK_FORM_ID,
	PAGE_SHARE_FORM_ID
} from '$lib/page/page-settings-form';
import { createDb, type Db } from '$lib/server/db/client';
import { page } from '$lib/server/db/schema';
import { insertPage, SETTINGS } from '$lib/server/pages/page-row.testing';
import { ORIGIN, signIn } from '../../../program-routes.testing';
import { mountRoutes, type RouteRequester } from '../../../route-request.testing';
import * as layout from '../../../routes/_app';
import * as campaignEditor from '../../../routes/_app.admin.campaigns.$pageId';
import * as donationEditor from '../../../routes/_app.admin.donation-page';

// the Settings sheet's look, goal, end date and share message, posted to both editors' actions as
// the sheets post them. a workers spec because each press writes a page's draft; the chain is
// mounted for ../../../route-request.testing.ts's reason: the session gate is a `middleware` on
// ../../../routes/_app.tsx.

let db: Db;
/** each editor's chain: a mounted chain is one route inside the next, so one per editor. */
let campaignRequest: RouteRequester;
let donationRequest: RouteRequester;
let session: string;

beforeAll(async () => {
	db = createDb(env.DB);
	campaignRequest = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/campaigns/:pageId', module: campaignEditor }
	]);
	donationRequest = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/donation-page', module: donationEditor }
	]);
	session = await signIn(db);
});

beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare('delete from chat_turn'),
		env.DB.prepare('delete from page'),
		env.DB.prepare('delete from form'),
		env.DB.prepare('delete from org_presentation')
	]);
});

async function stored(pageId: string) {
	const [row] = await db.select().from(page).where(eq(page.id, pageId));
	if (!row) throw new Error(`no page ${pageId}`);
	return row;
}

async function draftOf(pageId: string): Promise<Record<string, unknown>> {
	return JSON.parse((await stored(pageId)).draft);
}

/** a press on the page's editor, drawn at the version the row holds now unless `drawn` says. */
async function post(pageId: string, form: string, fields: Record<string, string>, drawn?: number) {
	const body = new FormData();
	body.set(WHICH_FORM, form);
	const row = await stored(pageId);
	body.set(RECORD_VERSION, String(drawn ?? row.updatedAt.getTime()));
	for (const [name, value] of Object.entries(fields)) body.set(name, value);
	const campaign = row.type === 'campaign';
	return (campaign ? campaignRequest : donationRequest)(
		new Request(`${ORIGIN}${campaign ? `/admin/campaigns/${pageId}` : '/admin/donation-page'}`, {
			method: 'POST',
			headers: { cookie: session },
			body
		}),
		{ env }
	);
}

/** the one Donation page, live as it always is. */
function donationPage(): Promise<string> {
	return insertPage(db, 'donation_page', { ...defaultDonationPage(), settings: SETTINGS });
}

const CUSTOM = { look: 'custom', shade: 'warm', corner: 'round', brand_colour: '#1d6b4f' };

describe('the look', () => {
	it('stores a custom look whole on the draft', async () => {
		const pageId = await insertPage(db, 'campaign');

		const response = await post(pageId, PAGE_LOOK_FORM_ID, CUSTOM);

		expect(response.status).toBe(200);
		expect((await draftOf(pageId)).look).toEqual({
			shade: 'warm',
			corner: 'round',
			brandColour: '#1d6b4f'
		});
	});

	it('stores a look with no brand colour as none', async () => {
		const pageId = await insertPage(db, 'campaign');

		const response = await post(pageId, PAGE_LOOK_FORM_ID, { ...CUSTOM, brand_colour: '' });

		expect(response.status).toBe(200);
		expect((await draftOf(pageId)).look).toEqual({
			shade: 'warm',
			corner: 'round',
			brandColour: null
		});
	});

	it('drops the page’s own look when it goes back to the Organisation’s', async () => {
		const pageId = await insertPage(db, 'campaign');
		await post(pageId, PAGE_LOOK_FORM_ID, CUSTOM);

		const response = await post(pageId, PAGE_LOOK_FORM_ID, {
			look: 'organisation',
			shade: '',
			corner: '',
			brand_colour: ''
		});

		expect(response.status).toBe(200);
		expect(await draftOf(pageId)).not.toHaveProperty('look');
	});

	it.each([
		['shade', 'dusk', '"dusk" is not a shade; a shade is light, warm or cool'],
		['corner', 'pill', '"pill" is not a corner; a corner is square, soft or round']
	])(
		'refuses an off-list %s naming it, keeps what was sent and writes nothing',
		async (box, value, sentence) => {
			const pageId = await insertPage(db, 'campaign');
			const before = await stored(pageId);

			const response = await post(pageId, PAGE_LOOK_FORM_ID, { ...CUSTOM, [box]: value });

			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				form: {
					id: PAGE_LOOK_FORM_ID,
					result: { initialValue: { [box]: value }, error: { [box]: [sentence] } }
				}
			});
			expect((await stored(pageId)).draft).toBe(before.draft);
		}
	);
});

/** a campaign donors can see: its draft published as it stands. */
async function liveCampaign(): Promise<string> {
	const pageId = await insertPage(db, 'campaign');
	const { draft } = await stored(pageId);
	await db.update(page).set({ state: 'live', published: draft }).where(eq(page.id, pageId));
	return pageId;
}

describe('the goal', () => {
	it('is saved to the draft, and the live campaign is unchanged until Publish', async () => {
		const pageId = await liveCampaign();
		const before = await stored(pageId);

		const response = await post(pageId, PAGE_GOAL_FORM_ID, { goal_minor: '5000000' });

		expect(response.status).toBe(200);
		expect((await draftOf(pageId)).goalMinor).toBe(5_000_000);
		const after = await stored(pageId);
		expect(after.published).toBe(before.published);
		expect(after.formId).toBe(before.formId);
	});

	it('is removed by an emptied box', async () => {
		const pageId = await insertPage(db, 'campaign');
		await post(pageId, PAGE_GOAL_FORM_ID, { goal_minor: '5000000' });

		const response = await post(pageId, PAGE_GOAL_FORM_ID, { goal_minor: '' });

		expect(response.status).toBe(200);
		expect(await draftOf(pageId)).not.toHaveProperty('goalMinor');
	});

	it.each(['0', '-500', '12.5', 'lots'])(
		'refuses %s naming it, and writes nothing',
		async (sent) => {
			const pageId = await insertPage(db, 'campaign');
			const before = await stored(pageId);

			const response = await post(pageId, PAGE_GOAL_FORM_ID, { goal_minor: sent });

			expect(response.status).toBe(400);
			const answer = (await response.json()) as {
				form: { result: { error: { goal_minor: string[] } } };
			};
			expect(answer.form.result.error.goal_minor[0]).toContain(JSON.stringify(sent));
			expect((await stored(pageId)).draft).toBe(before.draft);
		}
	);

	it('is refused on the Donation page, which has none', async () => {
		const pageId = await donationPage();
		const before = await stored(pageId);

		const response = await post(pageId, PAGE_GOAL_FORM_ID, { goal_minor: '5000000' });

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			form: { result: { error: { '': ['the Donation page has no goal; only a campaign does'] } } }
		});
		expect((await stored(pageId)).draft).toBe(before.draft);
	});
});

describe('the end date', () => {
	const DAY = { end_date: '2099-12-31', time_zone: 'America/New_York' };

	it('stores the end of the day in the zone it was chosen in, on the draft only', async () => {
		const pageId = await liveCampaign();
		const before = await stored(pageId);

		const response = await post(pageId, PAGE_END_DATE_FORM_ID, DAY);

		expect(response.status).toBe(200);
		const draft = await draftOf(pageId);
		expect(draft.endsAt).toBe(Date.parse('2100-01-01T05:00:00Z') - 1);
		expect(draft.endsZone).toBe('America/New_York');
		expect((await stored(pageId)).published).toBe(before.published);
	});

	it('is removed whole by an emptied day', async () => {
		const pageId = await insertPage(db, 'campaign');
		await post(pageId, PAGE_END_DATE_FORM_ID, DAY);

		const response = await post(pageId, PAGE_END_DATE_FORM_ID, { end_date: '', time_zone: '' });

		expect(response.status).toBe(200);
		const draft = await draftOf(pageId);
		expect(draft).not.toHaveProperty('endsAt');
		expect(draft).not.toHaveProperty('endsZone');
	});

	it.each([
		[{ end_date: '2020-01-01' }, 'end_date', 'today or later; Jan 1, 2020 is already over'],
		[
			{ end_date: '2099-02-30' },
			'end_date',
			'"2099-02-30" is not a day; an end date is written YYYY-MM-DD'
		],
		[{ time_zone: 'Mars/Olympus' }, 'time_zone', '"Mars/Olympus" is not a time zone']
	])('refuses %j naming it, and writes nothing', async (sent, box, sentence) => {
		const pageId = await insertPage(db, 'campaign');
		const before = await stored(pageId);

		const response = await post(pageId, PAGE_END_DATE_FORM_ID, { ...DAY, ...sent });

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			form: { result: { error: { [box]: [sentence] } } }
		});
		expect((await stored(pageId)).draft).toBe(before.draft);
	});

	it('is refused on the Donation page, which has none', async () => {
		const pageId = await donationPage();
		const before = await stored(pageId);

		const response = await post(pageId, PAGE_END_DATE_FORM_ID, DAY);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			form: {
				result: { error: { '': ['the Donation page has no end date; only a campaign does'] } }
			}
		});
		expect((await stored(pageId)).draft).toBe(before.draft);
	});
});

describe('the share message', () => {
	it('stores the page’s own, trimmed, on the Donation page as on a campaign', async () => {
		const pageId = await donationPage();

		const response = await post(pageId, PAGE_SHARE_FORM_ID, {
			share_message: 'custom',
			message: '  I just gave. Join me?  '
		});

		expect(response.status).toBe(200);
		expect((await draftOf(pageId)).shareMessage).toBe('I just gave. Join me?');
	});

	it('drops the page’s own when it goes back to the Organisation’s', async () => {
		const pageId = await insertPage(db, 'campaign');
		await post(pageId, PAGE_SHARE_FORM_ID, { share_message: 'custom', message: 'Join me?' });

		const response = await post(pageId, PAGE_SHARE_FORM_ID, {
			share_message: 'organisation',
			message: ''
		});

		expect(response.status).toBe(200);
		expect(await draftOf(pageId)).not.toHaveProperty('shareMessage');
	});

	it.each([
		['  ', 'required, or pick the Organisation’s'],
		['x'.repeat(SHARE_MESSAGE_MAX + 1), `at most ${SHARE_MESSAGE_MAX} characters`]
	])('refuses a message of %j, keeping it, and writes nothing', async (message, sentence) => {
		const pageId = await insertPage(db, 'campaign');
		const before = await stored(pageId);

		const response = await post(pageId, PAGE_SHARE_FORM_ID, { share_message: 'custom', message });

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			form: { id: PAGE_SHARE_FORM_ID, result: { error: { message: [sentence] } } }
		});
		expect((await stored(pageId)).draft).toBe(before.draft);
	});
});

describe('a press drawn before another save', () => {
	it.each([
		[PAGE_LOOK_FORM_ID, CUSTOM],
		[PAGE_GOAL_FORM_ID, { goal_minor: '5000000' }],
		[PAGE_END_DATE_FORM_ID, { end_date: '2099-12-31', time_zone: 'America/New_York' }],
		[PAGE_SHARE_FORM_ID, { share_message: 'custom', message: 'Join me?' }]
	])('%s is refused at 409 and writes nothing', async (form, fields) => {
		const pageId = await insertPage(db, 'campaign');
		const drawn = (await stored(pageId)).updatedAt.getTime();
		await post(pageId, PAGE_SHARE_FORM_ID, { share_message: 'custom', message: 'Earlier save' });
		const before = await stored(pageId);

		const response = await post(pageId, form, fields, drawn);

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			form: { id: form, result: { error: { '': [expect.stringMatching(/^Nothing was changed/)] } } }
		});
		expect((await stored(pageId)).draft).toBe(before.draft);
	});
});

describe('what the editor is drawn with', () => {
	async function open(pageId: string): Promise<Record<string, unknown>> {
		const response = await campaignRequest(
			new Request(`${ORIGIN}/admin/campaigns/${pageId}`, { headers: { cookie: session } }),
			{ env }
		);
		expect(response.status).toBe(200);
		return response.json();
	}

	it('follows the Organisation’s look and message until the page has its own', async () => {
		const pageId = await insertPage(db, 'campaign');

		expect(await open(pageId)).toMatchObject({
			pageSettings: {
				look: { source: 'organisation' },
				organisationLook: { shade: 'light', corner: 'soft', brandColour: null },
				organisationShareMessage: null
			}
		});
	});

	it('reads the page’s own look back as it was picked', async () => {
		const pageId = await insertPage(db, 'campaign');
		await post(pageId, PAGE_LOOK_FORM_ID, CUSTOM);

		expect(await open(pageId)).toMatchObject({
			pageSettings: {
				look: { source: 'custom', shade: 'warm', corner: 'round', brandColour: '#1d6b4f' }
			}
		});
	});
});
