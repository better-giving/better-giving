import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { POSTING_ACCOUNTS } from './accounts';

// the constraints `page`, `chat_turn` and `org_presentation` carry, each a table rebuild to change
// once shipped — the reason ./donation-schema.workers.spec.ts opens with.
//
// `STRICT` on the three tables and `NO ACTION` on their foreign keys are read off sqlite's
// catalogue by ./strict.workers.spec.ts and not repeated here.
//
// the pool gives per-file storage, not per-test: every case starts with one Donation page, and a
// case probing a Donation page row takes that slot through `refusedAsDonationPage` and puts it back.

const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';
const SQLITE_CONSTRAINT_UNIQUE = 'SQLITE_CONSTRAINT_UNIQUE';
const SQLITE_CONSTRAINT_FOREIGNKEY = 'SQLITE_CONSTRAINT_FOREIGNKEY';

/** runs `fn` and requires D1 to have rejected it; same helper as the sibling schema specs. */
async function rejection(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn();
	} catch (e) {
		return String((e as Error).message);
	}
	throw new Error('expected D1 to reject this statement, but it succeeded');
}

let formSequence = 0;

/** a donation-settings row for a page to own; every page owns its own. */
async function settingsRow(): Promise<string> {
	formSequence += 1;
	const id = `frm_pageschema${String(formSequence).padStart(4, '0')}`;
	await env.DB.prepare(
		`insert into form (id, name, revenue_account_id, currency, created_at, updated_at)
		 values (?, 'page settings', ?, 'USD', 0, 0)`
	)
		.bind(id, POSTING_ACCOUNTS.donationsDeductible.id)
		.run();
	return id;
}

type PageRow = {
	type: string;
	name: string | null;
	slug: string | null;
	state: string;
	draft: string;
	published: string | null;
	last_published: string | null;
	editor_visited_at: number | null;
};

const DONATION_PAGE: PageRow = {
	type: 'donation_page',
	name: null,
	slug: null,
	state: 'live',
	draft: '{"blocks":[]}',
	published: '{"blocks":[]}',
	last_published: null,
	editor_visited_at: null
};

let pageSequence = 0;

async function insertPage(row: PageRow): Promise<string> {
	pageSequence += 1;
	const id = `019fc400-0000-7000-8000-${String(pageSequence).padStart(12, '0')}`;
	await env.DB.prepare(
		`insert into page (id, type, name, slug, state, form_id, draft, published, last_published,
		                   editor_visited_at, created_at, updated_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`
	)
		.bind(
			id,
			row.type,
			row.name,
			row.slug,
			row.state,
			await settingsRow(),
			row.draft,
			row.published,
			row.last_published,
			row.editor_visited_at
		)
		.run();
	return id;
}

beforeAll(async () => {
	await insertPage(DONATION_PAGE);
});

/** D1's refusal of `row` as the Donation page, tried with that slot emptied and refilled after. */
async function refusedAsDonationPage(row: PageRow): Promise<string> {
	await env.DB.prepare(`delete from page where type = 'donation_page'`).run();
	try {
		return await rejection(() => insertPage(row));
	} finally {
		await insertPage(DONATION_PAGE);
	}
}

describe('one Donation page, held by the table', () => {
	it('refuses a second Donation page', async () => {
		const message = await rejection(() => insertPage(DONATION_PAGE));
		expect(message).toContain(SQLITE_CONSTRAINT_UNIQUE);
		expect(message).toContain('page.type');
	});
});

const CAMPAIGN: PageRow = {
	type: 'campaign',
	name: 'Winter coat drive',
	slug: 'winter-coat-drive',
	state: 'never_published',
	draft: '{"blocks":[],"goalMinor":1500000}',
	published: null,
	last_published: null,
	editor_visited_at: null
};

describe('a page is the Donation page or a campaign, and no other kind', () => {
	it.each([['event'], ['Campaign'], ['']])('refuses the type %j', async (type) => {
		const message = await rejection(() => insertPage({ ...CAMPAIGN, slug: null, type }));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_type_check');
	});
});

describe('a campaign slug is unique; the Donation page has none', () => {
	it('refuses a second campaign at a slug another holds', async () => {
		await insertPage({ ...CAMPAIGN, slug: 'spring-appeal' });
		const message = await rejection(() => insertPage({ ...CAMPAIGN, slug: 'spring-appeal' }));
		expect(message).toContain(SQLITE_CONSTRAINT_UNIQUE);
		expect(message).toContain('page.slug');
	});

	it('refuses a slug on the Donation page, which is served at /donate', async () => {
		const message = await refusedAsDonationPage({ ...DONATION_PAGE, slug: 'donate' });
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_slug_check');
	});

	it.each([['never_published'], ['live']])('refuses a %s campaign with no slug', async (state) => {
		const published = state === 'live' ? CAMPAIGN.draft : null;
		const message = await rejection(() =>
			insertPage({ ...CAMPAIGN, slug: null, state, published })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_slug_check');
	});

	it('accepts an ended campaign whose slug another campaign has taken', async () => {
		const id = await insertPage({
			...CAMPAIGN,
			slug: null,
			state: 'ended',
			published: CAMPAIGN.draft
		});
		const row = await env.DB.prepare(`select slug, state from page where id = ?`).bind(id).first();
		expect(row).toEqual({ slug: null, state: 'ended' });
	});
});

describe('a campaign is named; the Donation page has no name of its own', () => {
	it.each([
		['a blank name', ''],
		['a lone NBSP', '\u00a0'],
		['no name', null]
	])('refuses a campaign with %s', async (_, name) => {
		const message = await rejection(() => insertPage({ ...CAMPAIGN, slug: 'name-probe', name }));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_name_check');
	});

	it('refuses a name on the Donation page', async () => {
		const message = await refusedAsDonationPage({ ...DONATION_PAGE, name: 'Donate' });
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_name_check');
	});
});

describe('a page is never published, live or ended', () => {
	it.each([['draft'], ['published'], ['']])('refuses the state %j', async (state) => {
		const message = await rejection(() => insertPage({ ...CAMPAIGN, slug: 'state-probe', state }));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_state_check');
	});

	it.each([['never_published'], ['ended']])('refuses a Donation page that is %s', async (state) => {
		const message = await refusedAsDonationPage({ ...DONATION_PAGE, state });
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_donation_page_live_check');
	});
});

describe('a published page exists exactly when the page has been live', () => {
	it('refuses a never-published campaign holding a published page', async () => {
		const message = await rejection(() =>
			insertPage({ ...CAMPAIGN, slug: 'published-probe', published: CAMPAIGN.draft })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_published_check');
	});

	it.each([['live'], ['ended']])('refuses a %s campaign with no published page', async (state) => {
		const message = await rejection(() =>
			insertPage({ ...CAMPAIGN, slug: 'published-probe', state, published: null })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_published_check');
	});

	it('refuses a last published page with no published page after it', async () => {
		const message = await rejection(() =>
			insertPage({ ...CAMPAIGN, slug: 'published-probe', last_published: CAMPAIGN.draft })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_last_published_check');
	});
});

describe('each page document is a JSON object', () => {
	const LIVE = { ...CAMPAIGN, slug: 'json-probe', state: 'live', published: CAMPAIGN.draft };

	it.each([
		['draft', 'not json'],
		['draft', '[]'],
		['draft', 'null'],
		['published', '"a string"'],
		['last_published', '{"blocks":'],
		['last_published', '42']
	] as const)('refuses %s holding %j', async (column, value) => {
		const message = await rejection(() => insertPage({ ...LIVE, [column]: value }));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain(`page_${column}_object_check`);
	});
});

describe('a goal or an end date belongs to a campaign, never to the Donation page', () => {
	const GOAL = '{"blocks":[],"goalMinor":1500000}';
	const END = '{"blocks":[],"endsAt":1798761599999}';

	it.each([
		['draft', 'a goal', GOAL],
		['draft', 'an end date', END],
		['published', 'a goal', GOAL],
		['published', 'an end date', END],
		['last_published', 'a goal', GOAL],
		['last_published', 'an end date', END]
	] as const)('refuses a Donation page whose %s carries %s', async (column, _, value) => {
		const row = { ...DONATION_PAGE, last_published: DONATION_PAGE.published, [column]: value };
		const message = await refusedAsDonationPage(row);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_campaign_only_settings_check');
	});

	it('accepts both on a campaign, in each of its documents', async () => {
		const both = '{"blocks":[],"goalMinor":1500000,"endsAt":1798761599999}';
		const id = await insertPage({
			...CAMPAIGN,
			slug: 'goal-probe',
			state: 'live',
			draft: both,
			published: both,
			last_published: both
		});
		const row = await env.DB.prepare(
			`select json_extract(published, '$.goalMinor') as goal from page where id = ?`
		)
			.bind(id)
			.first();
		expect(row).toEqual({ goal: 1500000 });
	});
});

describe("a page's own look takes the closed sets the organisation's does", () => {
	const LIVE = { ...CAMPAIGN, slug: 'look-probe', state: 'live', published: CAMPAIGN.draft };
	const withLook = (look: Record<string, unknown>) => JSON.stringify({ blocks: [], look });
	const DOCUMENTS = ['draft', 'published', 'last_published'] as const;

	it.each(
		DOCUMENTS.flatMap((column) => [
			[column, 'the shade', { shade: 'dark' }],
			[column, 'the corner', { corner: 'pill' }],
			[column, 'the brand colour', { brandColour: 'red' }]
		])
	)('refuses %s holding an off-list look: %s', async (column, _, look) => {
		const message = await rejection(() => insertPage({ ...LIVE, [column]: withLook(look) }));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain(`page_${column}_look_check`);
	});

	it.each(DOCUMENTS)('refuses %s holding a look that is not an object', async (column) => {
		const doc = JSON.stringify({ blocks: [], look: 'warm' });
		const message = await rejection(() => insertPage({ ...LIVE, [column]: doc }));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain(`page_${column}_look_check`);
	});

	it("accepts a page with its own look, and one using the organisation's", async () => {
		const own = withLook({ brandColour: '#1f6feb', shade: 'warm', corner: 'round' });
		const id = await insertPage({ ...LIVE, draft: own, published: '{"look":null}' });
		const row = await env.DB.prepare(
			`select json_extract(draft, '$.look.shade') as shade from page where id = ?`
		)
			.bind(id)
			.first();
		expect(row).toEqual({ shade: 'warm' });
	});
});

describe('the mission is asked for once, on the Donation page', () => {
	it('refuses an editor visit recorded on a campaign', async () => {
		const message = await rejection(() =>
			insertPage({ ...CAMPAIGN, slug: 'visit-probe', editor_visited_at: 1 })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('page_editor_visited_check');
	});
});

describe('every page owns its own donation-settings row', () => {
	it('refuses a second page naming a settings row another page owns', async () => {
		const owned = await env.DB.prepare(`select form_id from page where type = 'donation_page'`)
			.first<{ form_id: string }>()
			.then((row) => row?.form_id);
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into page (id, type, name, slug, state, form_id, draft, created_at, updated_at)
				 values ('019fc400-0000-7000-8000-00000000ffff', 'campaign', 'Borrowed', 'borrowed',
				         'never_published', ?, '{}', 0, 0)`
			)
				.bind(owned)
				.run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_UNIQUE);
		expect(message).toContain('page.form_id');
	});
});

type TurnRow = {
	seq: number;
	author: string;
	text: string;
	model: string | null;
	image_ids: string;
};

const OPERATOR_TURN: TurnRow = {
	seq: 1,
	author: 'operator',
	text: 'coats for 300 kids, goal $15k by Dec 31',
	model: null,
	image_ids: '[]'
};

let turnSequence = 0;

async function insertTurn(pageId: string, row: TurnRow): Promise<void> {
	turnSequence += 1;
	await env.DB.prepare(
		`insert into chat_turn (id, page_id, seq, author, text, model, image_ids, created_at)
		 values (?, ?, ?, ?, ?, ?, ?, 0)`
	)
		.bind(
			`019fc500-0000-7000-8000-${String(turnSequence).padStart(12, '0')}`,
			pageId,
			row.seq,
			row.author,
			row.text,
			row.model,
			row.image_ids
		)
		.run();
}

describe('the chat, a page at a time and in order', () => {
	let pageId: string;
	beforeAll(async () => {
		pageId = await insertPage({ ...CAMPAIGN, slug: 'chat-probe' });
		await insertTurn(pageId, OPERATOR_TURN);
	});

	it('refuses a turn for a page that does not exist', async () => {
		const message = await rejection(() =>
			insertTurn('019fc400-0000-7000-8000-00000000dead', { ...OPERATOR_TURN, seq: 99 })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_FOREIGNKEY);
	});

	it('refuses a second turn at a place in the chat another holds', async () => {
		const message = await rejection(() => insertTurn(pageId, OPERATOR_TURN));
		expect(message).toContain(SQLITE_CONSTRAINT_UNIQUE);
		expect(message).toContain('chat_turn.page_id, chat_turn.seq');
	});

	it.each([['system'], ['user'], ['']])('refuses the author %j', async (author) => {
		const message = await rejection(() => insertTurn(pageId, { ...OPERATOR_TURN, seq: 2, author }));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('chat_turn_author_check');
	});

	it('refuses an assistant turn that does not say which model wrote it', async () => {
		const turn = { ...OPERATOR_TURN, seq: 2, author: 'assistant', model: null };
		const message = await rejection(() => insertTurn(pageId, turn));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('chat_turn_model_check');
	});

	it('refuses a model on a turn the operator wrote', async () => {
		const turn = { ...OPERATOR_TURN, seq: 2, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' };
		const message = await rejection(() => insertTurn(pageId, turn));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('chat_turn_model_check');
	});

	it.each([
		['not json', 'a list'],
		['an object', '{}'],
		['a bare id', '"019fc600-0000-7000-8000-000000000001"']
	])('refuses image ids held as %s', async (_, imageIds) => {
		const turn = { ...OPERATOR_TURN, seq: 2, image_ids: imageIds };
		const message = await rejection(() => insertTurn(pageId, turn));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('chat_turn_image_ids_array_check');
	});

	it('refuses a turn with no words and no photo', async () => {
		const message = await rejection(() =>
			insertTurn(pageId, { ...OPERATOR_TURN, seq: 2, text: ' ' })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('chat_turn_text_check');
	});

	it('accepts a photo sent with no words', async () => {
		const turn = {
			...OPERATOR_TURN,
			seq: 3,
			text: '',
			image_ids: '["019fc600-0000-7000-8000-000000000001"]'
		};
		await insertTurn(pageId, turn);
		const row = await env.DB.prepare(`select text from chat_turn where page_id = ? and seq = 3`)
			.bind(pageId)
			.first();
		expect(row).toEqual({ text: '' });
	});
});

describe("the Organisation's story, look and sharing, one row of them", () => {
	const upsertLook = (look: string, previous: string | null = null) =>
		env.DB.prepare(
			`insert into org_presentation (id, look, look_previous, created_at, updated_at)
			 values ('default', ?, ?, 0, 0)
			 on conflict (id) do update set look = excluded.look, look_previous = excluded.look_previous`
		)
			.bind(look, previous)
			.run();

	it('refuses a second row', async () => {
		await upsertLook('{}');
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into org_presentation (id, created_at, updated_at) values ('second', 0, 0)`
			).run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('org_presentation_id_check');
	});

	it.each([['dark'], ['Light'], [''], [1]])('refuses the shade %j', async (shade) => {
		const message = await rejection(() => upsertLook(JSON.stringify({ shade })));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('org_presentation_look_check');
	});

	it.each([['pill'], ['Round'], ['']])('refuses the corner %j', async (corner) => {
		const message = await rejection(() => upsertLook(JSON.stringify({ corner })));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('org_presentation_look_check');
	});

	it.each([['red'], ['#FFAA00'], ['#fa0'], ['#ffaa00;x']])(
		'refuses the brand colour %j',
		async (brandColour) => {
			const message = await rejection(() => upsertLook(JSON.stringify({ brandColour })));
			expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
			expect(message).toContain('org_presentation_look_check');
		}
	);

	it('refuses an off-list look kept for Undo', async () => {
		const message = await rejection(() => upsertLook('{}', JSON.stringify({ shade: 'dark' })));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('org_presentation_look_previous_check');
	});

	it.each([
		['story', '[]'],
		['sharing', 'not json'],
		['story_previous', 'null'],
		['sharing_previous', '"x"']
	])('refuses %s holding %j', async (column, value) => {
		const message = await rejection(() =>
			env.DB.prepare(`update org_presentation set ${column} = ? where id = 'default'`)
				.bind(value)
				.run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain(`org_presentation_${column}_object_check`);
	});

	it('undoes a save in one statement, putting the previous look back', async () => {
		const warm = JSON.stringify({ brandColour: '#1f6feb', shade: 'warm', corner: 'round' });
		const cool = JSON.stringify({ brandColour: '#1f6feb', shade: 'cool', corner: 'square' });
		await upsertLook(cool, warm);
		await env.DB.prepare(
			`update org_presentation set look = look_previous, look_previous = look
			 where id = 'default' and look_previous is not null`
		).run();
		const row = await env.DB.prepare(
			`select look, look_previous from org_presentation where id = 'default'`
		).first();
		expect(row).toEqual({ look: warm, look_previous: cool });
	});
});
