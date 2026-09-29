import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { type Page, parsePage } from '../../page/catalog';
import { defaultCampaign, defaultDonationPage } from '../../page/defaults';
import { createDb, type Db } from '../db/client';
import { createImage } from '../images/queries';
import { jpegHeader } from '../images/headers.testing';
import { chatTurn, image, page } from '../db/schema';
import { draftIllustrations, editorDraft } from './blocks';
import { draftTurn, readChat } from './draft';
import { answering, insertPage, SETTINGS } from './page-row.testing';

// a workers spec because every turn reads a page and its chat and writes them back. the model is
// the one stand-in: a binding whose `run` answers with the text given, as ../ai/generate.spec.ts
// stubs it, so what is asserted is what reaches the page and the chat from a known reply.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

const NOW = Date.parse('2026-09-28T16:00:00Z');
const ZONE = 'America/New_York';

function turn(pageId: string, message: string, AI: { run: unknown }, extra: object = {}) {
	return draftTurn(
		db,
		{ ...env, AI, ...extra },
		{ pageId, message, imageIds: [], timeZone: ZONE, now: NOW }
	);
}

async function stored(pageId: string) {
	const [row] = await db.select().from(page).where(eq(page.id, pageId));
	if (!row) throw new Error('the page is gone');
	const draft = parsePage(row.type, JSON.parse(row.draft));
	if (!draft.ok) throw new Error(draft.message);
	return { ...row, draft: draft.page };
}

async function chat(pageId: string) {
	return db
		.select({
			author: chatTurn.author,
			text: chatTurn.text,
			model: chatTurn.model,
			note: chatTurn.note
		})
		.from(chatTurn)
		.where(eq(chatTurn.pageId, pageId))
		.orderBy(chatTurn.seq);
}

describe('an accepted reply', () => {
	it('becomes the draft, and the published page stays as it was', async () => {
		const live: Page = { ...defaultCampaign(), settings: SETTINGS };
		const pageId = await insertPage(db, 'campaign', live, live);
		const AI = answering({
			say: 'Two-tone now.',
			page: { kind: 'merge', doc: { palette: 'duo' } }
		});

		expect(await turn(pageId, 'make it two-tone', AI)).toMatchObject({
			ok: true,
			outcome: 'accepted'
		});

		const after = await stored(pageId);
		expect(after.draft.palette).toBe('duo');
		expect(JSON.parse(after.published ?? 'null')).toEqual(live);
		expect(await chat(pageId)).toEqual([
			{ author: 'operator', text: 'make it two-tone', model: null, note: null },
			{
				author: 'assistant',
				text: 'Two-tone now.',
				model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
				note: null
			}
		]);
	});

	it('whose words open as a refusal would is still no refusal', async () => {
		const pageId = await insertPage(db, 'campaign');
		const say = 'I couldn’t apply that: only joking, it is two-tone now.';
		const AI = answering({ say, page: { kind: 'merge', doc: { palette: 'duo' } } });

		await turn(pageId, 'make it two-tone', AI);

		expect(await readChat(db, pageId)).toEqual([
			expect.objectContaining({ role: 'operator' }),
			{ id: expect.any(String), role: 'assistant', text: say, imageIds: [] }
		]);
	});

	it('sent twice lands once: the second reply was written against a page already changed', async () => {
		const pageId = await insertPage(db, 'campaign');
		const reply = { say: 'Two-tone now.', page: { kind: 'merge', doc: { palette: 'duo' } } };
		const second = turn(pageId, 'make it two-tone', answering(reply));
		const first = turn(pageId, 'make it two-tone', answering(reply));

		const results = await Promise.all([first, second]);

		expect(results.filter(({ ok }) => !ok)).toEqual([{ ok: false, reason: 'stale' }]);
		expect(await chat(pageId)).toHaveLength(2);
	});
});

describe('a refused reply', () => {
	it('leaves the draft as it was, and the chat says why', async () => {
		const before = { ...defaultCampaign(), settings: SETTINGS };
		const pageId = await insertPage(db, 'campaign', before);
		const AI = answering({ say: 'Neon!', page: { kind: 'merge', doc: { palette: 'neon' } } });

		const result = await turn(pageId, 'make it neon', AI);

		expect((await stored(pageId)).draft).toEqual(before);
		expect(result).toMatchObject({
			ok: true,
			outcome: 'refused',
			turns: [{ role: 'operator' }, { role: 'assistant', note: 'refused' }]
		});
		const [, answer] = await chat(pageId);
		expect(answer).toMatchObject({
			text: expect.stringMatching(/^I couldn’t apply that: palette: /),
			note: 'refused'
		});
	});
});

describe('a campaign’s goal and end date', () => {
	it('are set from "goal $15k by Dec 31", and the reply names both', async () => {
		const pageId = await insertPage(db, 'campaign');
		const AI = answering({
			say: 'Drafted your coat drive.',
			page: {
				kind: 'patch',
				ops: [
					{ op: 'add', path: '/blocks/1/props/lede', value: 'Help us reach $15,000 by winter.' }
				]
			},
			set: { goalMinor: 1_500_000, endDate: '2026-12-31' }
		});

		await turn(pageId, 'coats for 300 kids, goal $15k by Dec 31', AI);

		const after = await stored(pageId);
		expect(after.draft.goalMinor).toBe(1_500_000);
		expect(after.draft.endsAt).toBe(Date.parse('2027-01-01T05:00:00Z') - 1);
		const [, answer] = await chat(pageId);
		expect(answer?.text).toBe('Drafted your coat drive.\nGoal set to $15,000. Ends Dec 31, 2026.');
	});

	it('is set on a later turn from "Raise $15,000"', async () => {
		const pageId = await insertPage(db, 'campaign', {
			...defaultCampaign(),
			settings: SETTINGS,
			goalMinor: 500_000
		});
		await turn(pageId, 'Winter coat drive', answering({ say: 'Drafted.' }));

		await turn(
			pageId,
			'Raise $15,000',
			answering({ say: 'Raised the goal.', set: { goalMinor: 1_500_000 } })
		);

		expect((await stored(pageId)).draft.goalMinor).toBe(1_500_000);
	});
});

describe('a campaign’s name', () => {
	it('changes on "call it Coats for Kids", and the reply names it', async () => {
		const pageId = await insertPage(db, 'campaign');

		await turn(
			pageId,
			'call it Coats for Kids',
			answering({ say: 'Done.', set: { name: 'Coats for Kids' } })
		);

		const after = await stored(pageId);
		expect([after.draft.name, after.name]).toEqual(['Coats for Kids', 'Winter coat drive']);
		const [, answer] = await chat(pageId);
		expect(answer?.text).toBe('Done.\nRenamed to “Coats for Kids”.');
	});
});

describe('the Donation page', () => {
	it.each([
		['a name', { name: 'Coats for Kids' }, 'name'],
		['a goal', { goalMinor: 1_500_000 }, 'goal'],
		['an end date', { endDate: '2026-12-31' }, 'end date']
	])('asked for %s changes nothing, and the reply says why', async (_, set, what) => {
		const before = { ...defaultDonationPage(), settings: SETTINGS };
		const pageId = await insertPage(db, 'donation_page', before);

		await turn(pageId, 'set it', answering({ say: 'Set.', set }));

		const after = await stored(pageId);
		expect([after.draft, after.name]).toEqual([before, null]);
		const [, answer] = await chat(pageId);
		expect(answer?.text).toBe(
			`I couldn’t apply that: the Donation page has no ${what}; only a campaign does`
		);
	});
});

describe('a credit-billed model that fails', () => {
	it('is answered by the free model, whose turn carries its note', async () => {
		const pageId = await insertPage(db, 'campaign');
		const AI = answering(new Error('3036: insufficient credits'), {
			say: 'Two-tone now.',
			page: { kind: 'merge', doc: { palette: 'duo' } }
		});

		const result = await turn(pageId, 'make it two-tone', AI, {
			AI_MODEL: 'anthropic/claude-sonnet-4.6'
		});

		expect((await stored(pageId)).draft.palette).toBe('duo');
		expect(await chat(pageId)).toMatchObject([
			{ author: 'operator' },
			{
				author: 'assistant',
				text: 'Two-tone now.',
				model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
				note: 'fell-back'
			}
		]);
		const answer = { role: 'assistant', text: 'Two-tone now.', note: 'fell-back' };
		expect(result).toMatchObject({ turns: [{ role: 'operator' }, answer] });
		expect(await readChat(db, pageId)).toMatchObject([{ role: 'operator' }, answer]);
	});
	it('that the free model then answers off the page is marked refused, since nothing changed', async () => {
		const pageId = await insertPage(db, 'campaign');
		const AI = answering(new Error('3036: insufficient credits'), {
			say: 'Neon!',
			page: { kind: 'merge', doc: { palette: 'neon' } }
		});

		await turn(pageId, 'make it neon', AI, { AI_MODEL: 'anthropic/claude-sonnet-4.6' });

		const [, answer] = (await readChat(db, pageId)) ?? [];
		expect(answer).toMatchObject({
			note: 'refused',
			text: expect.stringMatching(/^I couldn’t apply that: palette: /)
		});
	});
});

describe('what the model is told', () => {
	const handEdited = (): Page => {
		const draft = { ...defaultCampaign(), settings: SETTINGS };
		draft.blocks[1] = {
			id: 'title',
			type: 'title',
			variant: 'left',
			background: 'none',
			heading: 'Coats for every kid'
		};
		return draft;
	};

	it('is the draft with its hand edits, the page’s type and its donation settings, and the chat so far', async () => {
		const pageId = await insertPage(db, 'campaign', handEdited());
		await turn(pageId, 'Winter coat drive', answering({ say: 'Drafted.' }));
		const AI = answering({ say: 'Warmer.' });

		await turn(pageId, 'warmer colours', AI);

		const [, input] = AI.run.mock.calls[0] ?? [];
		const [system, ...chatSoFar] = input.messages;
		expect(system.content).toContain('"heading":"Coats for every kid"');
		expect(system.content).toContain('- page: a campaign named "Winter coat drive"');
		expect(system.content).toContain(
			'- donation settings: minimum $5, maximum $1,000, suggested amounts $25, $50, program none'
		);
		expect(chatSoFar).toEqual([
			{ role: 'user', content: 'Winter coat drive' },
			{ role: 'assistant', content: 'Drafted.' },
			{ role: 'user', content: 'warmer colours' }
		]);
	});

	it('states where the donation box opens, as the operator’s to set and never the reply’s', async () => {
		const pageId = await insertPage(db, 'campaign', {
			...handEdited(),
			switches: { openOnMonthly: true, dedicationOn: false }
		});
		const AI = answering({ say: 'Warmer.' });

		await turn(pageId, 'warmer colours', AI);

		const [, input] = AI.run.mock.calls[0] ?? [];
		const [system] = input.messages;
		expect(system.content).toContain(
			'- donation box: Open on monthly on, Dedication on by default off'
		);
		expect(system.content).toContain(
			'- where the donation box opens is the operator’s to set in Donation settings; when asked to change it, change nothing and say so.'
		);
	});

	const MONTHLY_WORDING =
		'- the donation box opens on a monthly gift: impact tiers say what each amount does every month, and the story may invite a monthly gift';
	const DEDICATION_WORDING =
		'- the donation box opens with a dedication: the words may speak of giving in honour or in memory of someone';

	async function toldWith(switches: Page['switches']) {
		const pageId = await insertPage(db, 'campaign', { ...handEdited(), switches });
		const AI = answering({ say: 'Warmer.' });
		await turn(pageId, 'warmer colours', AI);
		const [, input] = AI.run.mock.calls[0] ?? [];
		const [system] = input.messages;
		return system.content as string;
	}

	it('with Open on monthly on, asks for monthly wording and no dedication wording', async () => {
		const told = await toldWith({ openOnMonthly: true, dedicationOn: false });

		expect(told).toContain(`${MONTHLY_WORDING}\n`);
		expect(told).not.toMatch(/honou?r|memory/);
	});

	it('with Dedication on by default on, asks for dedication wording and no monthly wording', async () => {
		const told = await toldWith({ openOnMonthly: false, dedicationOn: true });

		expect(told).toContain(`${DEDICATION_WORDING}\n`);
		expect(told).not.toMatch(/each month|every month|monthly gift/);
	});

	it('with both donation box switches on, asks for the wording of each', async () => {
		const told = await toldWith({ openOnMonthly: true, dedicationOn: true });

		expect(told).toContain(`${MONTHLY_WORDING}\n${DEDICATION_WORDING}\n`);
	});

	it('with both donation box switches off, asks for no wording of either', async () => {
		const told = await toldWith({ openOnMonthly: false, dedicationOn: false });

		expect(told).toMatchInlineSnapshot(`
			"You draft a fundraising campaign.

			A page is one JSON object:
			{"layout": ..., "palette": ..., "blocks": [{"id": ..., "type": ..., "variant": ..., "background": ..., "props": {...}}, {"id": ..., "type": "DonationFlow", "background": "none", "props": {}}]}

			LAYOUTS:
			- box-right: the donation box stands in its own column beside the other blocks
			- banner: a band across the top holds the blocks up to the donation box, with the box beside them; the blocks after it run full width below
			- column: one narrow column at every width, the donation box where it is listed
			- cover: a cover photo with the title over it; without a hero photo it draws as box-right

			PALETTES:
			- plain: greys only; the brand colour stays on buttons
			- tint: pale and full grounds of the brand colour
			- duo: the brand colour, with tint grounds in a second, contrasting hue
			- bright: livelier grounds in a hue beside the brand colour
			- bold: grey soft grounds and the deepest brand colour for strong ones

			BLOCKS:
			- title: the page’s heading, with an optional lede under it
			  variants: left | center | compact
			  backgrounds: none | soft | tint | strong
			  props: { heading: string, lede?: string }
			- story: why this matters, in the organisation’s words; body is a rich-text document; a listItem's content is one paragraph, then any paragraphs, bulletLists and orderedLists, nested at most 3 lists deep
			  variants: plain | lede | split
			  backgrounds: none | soft | tint
			  props: { body: { type: "doc", content: Array<{ type: "paragraph", content?: Array<{ type: "text", text: string, marks?: Array<{ type: "bold" } | { type: "italic" } | { type: "link", attrs: { href: string } }> }> } | { type: "bulletList", content: Array<{ type: "listItem", content: unknown }> } | { type: "orderedList", attrs?: { start?: number }, content: Array<{ type: "listItem", content: unknown }> }> } }
			- impact-tiers: up to 6 amounts, each with what it buys; amountMinor is in minor units
			  variants: cards | list
			  backgrounds: none | soft | tint | strong
			  props: { tiers: Array<{ amountMinor: number, buys: string }> }
			- faq: up to 10 questions, each answer a rich-text document; a listItem's content is one paragraph, then any paragraphs, bulletLists and orderedLists, nested at most 3 lists deep
			  variants: accordion | open
			  backgrounds: none | soft | tint
			  props: { items: Array<{ question: string, answer: { type: "doc", content: Array<{ type: "paragraph", content?: Array<{ type: "text", text: string, marks?: Array<{ type: "bold" } | { type: "italic" } | { type: "link", attrs: { href: string } }> }> } | { type: "bulletList", content: Array<{ type: "listItem", content: unknown }> } | { type: "orderedList", attrs?: { start?: number }, content: Array<{ type: "listItem", content: unknown }> }> } }> }
			- about-us: what the organisation does, drawn from its own profile
			  variants: stacked | side-by-side | statement
			  backgrounds: none | soft | tint | strong
			  props: {  }
			- org-info: the organisation’s name, address and legal details
			  variants: footer | card
			  backgrounds: none
			  props: {  }
			- share: buttons that share the page
			  variants: buttons | icons
			  backgrounds: none | soft | tint
			  props: {  }
			- hero: the page’s opening photo; under the cover layout the title lies over it
			  variants: wide | framed
			  backgrounds: none
			  props: { imageId: string | { illustrate: string }, alt?: string }
			- image: a photo among the other blocks
			  variants: column | wide
			  backgrounds: none
			  props: { imageId: string | { illustrate: string }, alt?: string }
			- goal-bar: the campaign’s progress toward its goal
			  variants: bar | figure
			  backgrounds: none
			  props: {  }
			- DonationFlow: where the donor gives; takes no props and no variant
			  backgrounds: none
			  props: {  }

			RULES:
			- exactly one DonationFlow, with no variant and empty props
			- every id is unique on the page, 1 to 32 letters, digits, "-" or "_"
			- use only the names above; no colour, HTML or action anywhere
			- add no link; keep a link already in the text exactly as it is
			- a photo’s imageId is an id from "(attached photos: …)" in the chat or one the page already holds, never an address; null leaves the block out
			- where no photo attached in the chat or already on the page fits a hero or image block, its imageId may be {"illustrate": "a short description of the picture wanted"} and an illustration is drawn from it; a photo that fits always wins, and a reply asks for at most 2

			REPLY:
			Answer with one JSON object and nothing else: {"say": ..., "page": ..., "set": ...}
			- say: one or two sentences to the operator saying what you changed, naming each value you set.
			- page: an edit to the page as it stands, changing only what the message asks for and keeping every word it does not mention. Either {"kind": "patch", "ops": [RFC 6902 operations, e.g. {"op": "replace", "path": "/blocks/0/props/heading", "value": ...}]} or {"kind": "merge", "doc": {an RFC 7396 merge of layout, palette or blocks}}. Leave it out when the page does not change.
			- set: only what the operator asked for, of {"name": ..., "goalMinor": ..., "endDate": "YYYY-MM-DD", "programId": ..., "suggestedAmounts": [...]}. Amounts are in minor units ($15,000 is 1500000); suggested amounts stay within the donation settings' minimum and maximum; programId is one of the active programs.
			- where the donation box opens is the operator’s to set in Donation settings; when asked to change it, change nothing and say so.
			- write an amount in the words, or an impact tier, only from a figure the operator stated in the chat; with none, leave the impact tiers out.

			CONTEXT:
			- page: a campaign named "Winter coat drive"
			- today: 2026-09-28, in the operator's time zone America/New_York
			- mission: (not written)
			- vision: (not written)
			- look: light shade, soft corners, brand colour none
			- goal: none
			- end date: none
			- donation settings: minimum $5, maximum $1,000, suggested amounts $25, $50, program none
			- donation box: Open on monthly off, Dedication on by default off
			- active programs: none

			THE PAGE AS IT STANDS, hand edits included:
			{"layout":"box-right","palette":"tint","blocks":[{"id":"hero","type":"hero","variant":"framed","background":"none","props":{"imageId":null,"alt":null}},{"id":"title","type":"title","variant":"left","background":"none","props":{"heading":"Coats for every kid"}},{"id":"goal","type":"goal-bar","variant":"bar","background":"none","props":{}},{"id":"story","type":"story","variant":"plain","background":"none","props":{"body":{"type":"doc","content":[{"type":"paragraph"}]}}},{"id":"donate","type":"DonationFlow","background":"none","props":{}},{"id":"share","type":"share","variant":"buttons","background":"none","props":{}},{"id":"footer","type":"org-info","variant":"footer","background":"none","props":{}}]}"
		`);
	});

	it('states the end date as the day chosen, in the zone it was chosen in', async () => {
		// the end of 31 December in los angeles, already 1 January in new york where it is read
		const pageId = await insertPage(db, 'campaign', {
			...defaultCampaign(),
			settings: SETTINGS,
			endsAt: Date.parse('2027-01-01T08:00:00Z') - 1,
			endsZone: 'America/Los_Angeles'
		});
		const AI = answering({ say: 'Warmer.' });

		await turn(pageId, 'warmer colours', AI);

		const [, input] = AI.run.mock.calls[0] ?? [];
		const [system] = input.messages;
		expect(system.content).toContain('- end date: 2026-12-31\n');
	});

	it('of the chat so far, is only what the model said, leaving out each exchange that changed nothing', async () => {
		const pageId = await insertPage(db, 'campaign');
		await turn(
			pageId,
			'Winter coat drive',
			answering({ say: 'Drafted.', set: { goalMinor: 1_500_000 } })
		);
		await turn(
			pageId,
			'make it neon',
			answering({ say: 'Neon!', page: { kind: 'merge', doc: { palette: 'neon' } } })
		);
		await turn(pageId, 'hello?', undefined as never);
		const AI = answering({ say: 'Warmer.' });

		await turn(pageId, 'warmer colours', AI);

		const [, input] = AI.run.mock.calls[0] ?? [];
		const [, ...chatSoFar] = input.messages;
		expect(chatSoFar).toEqual([
			{ role: 'user', content: 'Winter coat drive' },
			{ role: 'assistant', content: 'Drafted.' },
			{ role: 'user', content: 'warmer colours' }
		]);
	});

	it('keeps a hand edit the follow-up did not ask to change', async () => {
		const pageId = await insertPage(db, 'campaign', handEdited());
		const AI = answering({
			say: 'Two-tone.',
			page: { kind: 'patch', ops: [{ op: 'replace', path: '/palette', value: 'duo' }] }
		});

		await turn(pageId, 'two-tone please', AI);

		const after = await stored(pageId);
		expect([after.draft.palette, after.draft.blocks[1]]).toEqual(['duo', handEdited().blocks[1]]);
	});
});

describe('an impact tier', () => {
	it('stands only on a figure the operator gave, and the reply names the one left out', async () => {
		const pageId = await insertPage(db, 'campaign');
		const tiers = {
			id: 'impact',
			type: 'impact-tiers',
			variant: 'cards',
			background: 'none',
			props: {
				tiers: [
					{ amountMinor: 2500, buys: 'a warm coat' },
					{ amountMinor: 7500, buys: 'a coat, hat and boots' }
				]
			}
		};
		const AI = answering({
			say: 'Added what a gift buys.',
			page: { kind: 'patch', ops: [{ op: 'add', path: '/blocks/4', value: tiers }] }
		});

		await turn(pageId, '$25 buys a coat', AI);

		const impact = (await stored(pageId)).draft.blocks.find(({ type }) => type === 'impact-tiers');
		expect(impact).toMatchObject({ tiers: [{ amountMinor: 2500, buys: 'a warm coat' }] });
		const [, answer] = await chat(pageId);
		expect(answer?.text).toBe(
			'Added what a gift buys.\nLeft out the $75 tier: you haven’t given that figure.'
		);
	});
});

describe('a turn no model answers', () => {
	it('leaves the draft as it was and says so plainly, with what the operator can do', async () => {
		const before = { ...defaultCampaign(), settings: SETTINGS };
		const pageId = await insertPage(db, 'campaign', before);

		const result = await turn(pageId, 'make it two-tone', undefined as never);

		expect(result).toMatchObject({ ok: true, outcome: 'unanswered' });
		expect((await stored(pageId)).draft).toEqual(before);
		const [, answer] = await chat(pageId);
		expect(answer).toMatchObject({
			text: expect.stringMatching(
				/^No model answered, so nothing changed\. This deployment was uploaded without the Workers AI binding `AI`/
			),
			model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
			note: 'unanswered'
		});
		const [, drawn] = (await readChat(db, pageId)) ?? [];
		expect(drawn).not.toHaveProperty('note');
	});
});

describe('a hand edit saved while the model was answering', () => {
	it('stands, and the turn writes nothing', async () => {
		const pageId = await insertPage(db, 'campaign');
		const edited = { ...defaultCampaign(), settings: SETTINGS, palette: 'bold' as const };
		const run = vi.fn(async () => {
			await db
				.update(page)
				.set({ draft: JSON.stringify(edited) })
				.where(eq(page.id, pageId));
			return {
				response: JSON.stringify({
					say: 'Two-tone.',
					page: { kind: 'merge', doc: { palette: 'duo' } }
				})
			};
		});

		expect(await turn(pageId, 'two-tone', { run })).toEqual({ ok: false, reason: 'stale' });

		expect((await stored(pageId)).draft).toEqual(edited);
		expect(await chat(pageId)).toEqual([]);
	});
});

it('answers a page that does not exist with not_found, asking no model', async () => {
	const AI = answering({ say: 'Hi.' });
	expect(await turn('no-such-page', 'hello', AI)).toEqual({ ok: false, reason: 'not_found' });
	expect(AI.run).not.toHaveBeenCalled();
});

describe('a photo sent with a turn', () => {
	const photo = () =>
		createImage(
			db,
			{ kind: 'photo', contentType: 'image/webp', width: 4, height: 3, alt: null },
			new Uint8Array([1, 2, 3])
		);

	it('is kept on the operator’s turn and named to the model', async () => {
		const pageId = await insertPage(db, 'campaign');
		const imageId = await photo();
		const AI = answering({ say: 'Nice photo.' });

		await draftTurn(
			db,
			{ ...env, AI },
			{ pageId, message: 'our volunteers', imageIds: [imageId], timeZone: ZONE, now: NOW }
		);

		expect(await readChat(db, pageId)).toMatchObject([
			{ role: 'operator', imageIds: [imageId] },
			{ role: 'assistant' }
		]);
		const [, input] = AI.run.mock.calls[0] ?? [];
		expect(input.messages.at(-1)).toEqual({
			role: 'user',
			content: `our volunteers\n\n(attached photos: ${imageId})`
		});
	});

	it('attached on an earlier turn is placed in the hero when a later one asks', async () => {
		const pageId = await insertPage(db, 'campaign');
		const imageId = await photo();
		await draftTurn(
			db,
			{ ...env, AI: answering({ say: 'Lovely photo.' }) },
			{ pageId, message: 'our volunteers', imageIds: [imageId], timeZone: ZONE, now: NOW }
		);
		const AI = answering({
			say: 'Your photo is in the hero.',
			page: {
				kind: 'patch',
				ops: [{ op: 'replace', path: '/blocks/0/props/imageId', value: imageId }]
			}
		});

		expect(await turn(pageId, 'put it in the hero', AI)).toMatchObject({ outcome: 'accepted' });
		expect((await stored(pageId)).draft.blocks[0]).toMatchObject({ type: 'hero', imageId });
	});

	it('attached in another page’s chat is refused, and the draft stays as it was', async () => {
		const elsewhere = await insertPage(db, 'campaign');
		const imageId = await photo();
		await draftTurn(
			db,
			{ ...env, AI: answering({ say: 'Nice.' }) },
			{ pageId: elsewhere, message: 'ours', imageIds: [imageId], timeZone: ZONE, now: NOW }
		);
		const pageId = await insertPage(db, 'campaign');
		const before = await stored(pageId);
		const AI = answering({
			say: 'Your photo is in the hero.',
			page: {
				kind: 'patch',
				ops: [{ op: 'replace', path: '/blocks/0/props/imageId', value: imageId }]
			}
		});

		expect(await turn(pageId, 'use the photo from the other campaign', AI)).toMatchObject({
			outcome: 'refused'
		});
		expect((await stored(pageId)).draft).toEqual(before.draft);
	});

	it('that is no stored image is refused by its id, asking no model', async () => {
		const pageId = await insertPage(db, 'campaign');
		const AI = answering({ say: 'Nice photo.' });

		const result = await draftTurn(
			db,
			{ ...env, AI },
			{ pageId, message: 'look', imageIds: ['img_nope'], timeZone: ZONE, now: NOW }
		);

		expect(result).toEqual({ ok: false, reason: 'unknown_image', imageId: 'img_nope' });
		expect(AI.run).not.toHaveBeenCalled();
		expect(await chat(pageId)).toEqual([]);
	});
});

describe('an illustration the reply asks for', () => {
	/** the model's picture, as the image model answers: base64 under `image`. */
	function picture() {
		let binary = '';
		for (const byte of jpegHeader(1024, 768)) binary += String.fromCharCode(byte);
		return { image: btoa(binary) };
	}

	/**
	 * a binding answering the chat with `reply`, then each illustration with the next of `drawn`: a
	 * picture where it is true, a throw where it is false.
	 */
	function drawing(reply: unknown, ...drawn: boolean[]) {
		const AI = answering(reply);
		for (const ok of drawn) {
			AI.run.mockImplementationOnce(async () => {
				if (!ok) throw new Error('the image model is down');
				return picture();
			});
		}
		return AI;
	}

	const inHero = (description: string) => ({
		op: 'replace',
		path: '/blocks/0/props/imageId',
		value: { illustrate: description }
	});

	async function kindOf(imageId: string | null | undefined) {
		if (imageId == null) return null;
		const [row] = await db
			.select({ kind: image.kind, alt: image.alt })
			.from(image)
			.where(eq(image.id, imageId));
		return row ?? null;
	}

	function heroOf(page: Page) {
		const [hero] = page.blocks;
		if (hero?.type !== 'hero') throw new Error('the fixture opens on a hero');
		return hero;
	}

	it('on the hero is drawn, stored as an illustration and placed, and the turn says a picture was made', async () => {
		const pageId = await insertPage(db, 'campaign');
		const AI = drawing(
			{ say: 'Added a picture.', page: { kind: 'patch', ops: [inHero('children in warm coats')] } },
			true
		);

		expect(await turn(pageId, 'we have no photo yet', AI)).toMatchObject({ outcome: 'accepted' });

		const { imageId } = heroOf((await stored(pageId)).draft);
		expect(await kindOf(imageId)).toEqual({ kind: 'illustration', alt: 'children in warm coats' });
		expect(AI.run).toHaveBeenLastCalledWith(
			'@cf/black-forest-labs/flux-1-schnell',
			{ prompt: 'children in warm coats' },
			expect.anything()
		);
		const [, answer] = await chat(pageId);
		expect(answer?.text).toBe(
			'Added a picture.\nMade an illustration of “children in warm coats”; a photo you attach can replace it.'
		);
	});

	it('placed over by a photo attached in the chat is flagged as one no longer, on the editor’s next load', async () => {
		const pageId = await insertPage(db, 'campaign');
		await turn(
			pageId,
			'we have no photo yet',
			drawing({ say: 'Added a picture.', page: { kind: 'patch', ops: [inHero('a van')] } }, true)
		);
		const hero = async () => {
			const [row] = await db.select().from(page).where(eq(page.id, pageId));
			if (!row) throw new Error('the page is gone');
			const { blocks } = editorDraft(row, SETTINGS.currency, await draftIllustrations(db, row));
			return blocks.find((block) => block.id === 'hero');
		};
		expect(await hero()).toMatchObject({ illustration: true });
		const photoId = await createImage(
			db,
			{ kind: 'photo', contentType: 'image/webp', width: 4, height: 3, alt: null },
			new Uint8Array([1, 2, 3])
		);

		await draftTurn(
			db,
			{
				...env,
				AI: answering({
					say: 'Your photo is in the hero.',
					page: {
						kind: 'patch',
						ops: [{ op: 'replace', path: '/blocks/0/props/imageId', value: photoId }]
					}
				})
			},
			{ pageId, message: 'use this one', imageIds: [photoId], timeZone: ZONE, now: NOW }
		);

		expect(await hero()).toMatchObject({ illustration: false });
	});

	it.each([
		[
			'refused on another ground',
			[inHero('children in warm coats'), { op: 'replace', path: '/palette', value: 'neon' }],
			'palette: '
		],
		['blank', [inHero('   ')], 'page.ops.0.value.illustrate: '],
		[
			'past a photo description’s length',
			[inHero('x'.repeat(251))],
			'page.ops.0.value.illustrate: '
		],
		['holding a figure nobody gave', [inHero('a banner reading $50,000 raised')], '"$50,000"']
	])(
		'in a reply %s draws nothing, stores no picture and refuses the turn',
		async (_, ops, reason) => {
			const pageId = await insertPage(db, 'campaign');
			const before = await db.$count(image);
			const AI = drawing({ say: 'A picture.', page: { kind: 'patch', ops } }, true);

			expect(await turn(pageId, 'a picture please', AI)).toMatchObject({ outcome: 'refused' });

			expect(AI.run).toHaveBeenCalledTimes(1);
			expect(await db.$count(image)).toBe(before);
			const [, answer] = await chat(pageId);
			expect(answer?.text).toContain(reason);
		}
	);

	it('that is not drawn leaves its block with no picture, and the rest of the reply lands', async () => {
		const pageId = await insertPage(db, 'campaign');
		const AI = drawing(
			{
				say: 'Two-tone, with a picture.',
				page: {
					kind: 'patch',
					ops: [inHero('children in warm coats'), { op: 'replace', path: '/palette', value: 'duo' }]
				}
			},
			false
		);

		expect(await turn(pageId, 'two-tone, and a picture', AI)).toMatchObject({
			outcome: 'accepted'
		});

		const { draft } = await stored(pageId);
		expect(draft.palette).toBe('duo');
		expect(heroOf(draft).imageId).toBeNull();
		const [, answer] = await chat(pageId);
		expect(answer?.text).toBe(
			'Two-tone, with a picture.\nCouldn’t make an illustration of “children in warm coats”, so its block is left out.'
		);
	});

	it('past the second in one turn is left out, and no picture is drawn for it', async () => {
		const pageId = await insertPage(db, 'campaign');
		const photoBlock = (id: string, description: string) => ({
			op: 'add',
			path: '/blocks/1',
			value: {
				id,
				type: 'image',
				variant: 'column',
				background: 'none',
				props: { imageId: { illustrate: description }, alt: null }
			}
		});
		const AI = drawing(
			{
				say: 'Three pictures.',
				page: {
					kind: 'patch',
					ops: [
						inHero('a coat rack'),
						photoBlock('second', 'a van'),
						photoBlock('third', 'a scarf')
					]
				}
			},
			true,
			true
		);

		expect(await turn(pageId, 'pictures please', AI)).toMatchObject({ outcome: 'accepted' });

		const { draft } = await stored(pageId);
		const ids = Object.fromEntries(
			draft.blocks.flatMap((block) => ('imageId' in block ? [[block.id, block.imageId]] : []))
		);
		expect(await kindOf(ids.hero)).toEqual({ kind: 'illustration', alt: 'a coat rack' });
		expect(await kindOf(ids.second)).toEqual({ kind: 'illustration', alt: 'a van' });
		expect(ids.third).toBeNull();
		expect(AI.run).toHaveBeenCalledTimes(3);
		const [, answer] = await chat(pageId);
		expect(answer?.text).toContain(
			'Left out an illustration of “a scarf”: a turn makes at most 2.'
		);
	});

	it('beside a photo attached with the turn, where the reply places the photo too, leaves the photo in place', async () => {
		const pageId = await insertPage(db, 'campaign');
		const photoId = await createImage(
			db,
			{ kind: 'photo', contentType: 'image/webp', width: 4, height: 3, alt: null },
			new Uint8Array([1, 2, 3])
		);
		const AI = drawing(
			{
				say: 'Your photo is in the hero.',
				page: {
					kind: 'patch',
					ops: [
						inHero('volunteers'),
						{ op: 'replace', path: '/blocks/0/props/imageId', value: photoId }
					]
				}
			},
			true
		);

		const result = await draftTurn(
			db,
			{ ...env, AI },
			{ pageId, message: 'our volunteers', imageIds: [photoId], timeZone: ZONE, now: NOW }
		);

		expect(result).toMatchObject({ outcome: 'accepted' });
		expect(heroOf((await stored(pageId)).draft).imageId).toBe(photoId);
		const [, answer] = await chat(pageId);
		expect(answer?.text).toBe('Your photo is in the hero.');
	});
});
