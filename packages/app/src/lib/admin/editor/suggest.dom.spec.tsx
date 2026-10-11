import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data, redirect } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { BLOCK_FORMS, type EditorBlock } from '$lib/page/block-edit';
import { richTextOf } from '$lib/page/suggest-fields';
import { parseRichText, type RichTextDocument } from '$lib/rich-text/document';
import { BlockEditSheet } from './block-edit';
import { NameSheet } from './name-sheet';
import { revalidatesAfter } from './suggest-url';

// Write with AI on every box a page's editors let the AI write (./suggest.tsx): which boxes carry
// it, what one press asks the suggest route, the fill and its Undo, what takes the "AI suggestion"
// mark away, every answer that writes nothing said at the box, what the box's region says, the
// press while it is out, and a Done pressed over it. the route is a stand-in at the suggest
// route's address, answering each ask with what the case queued and recording what was asked;
// the editor's own route is a stand-in too, for Done, with the editors' `shouldRevalidate` and a
// loader that counts its reads.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SUGGEST = '/admin/pages/p1/suggest';
const SIGN_IN = '/login';

type Reply = { readonly status: number; readonly body: unknown } | 'signed-out';

/** each ask as the route would read it, with the address it went to. */
let asked: Record<string, string>[];
/** what the route answers each ask, in turn; a promise holds the answer until the case settles it. */
let replies: (Reply | Promise<Reply>)[];
/** what the editor's action answers a Done; a promise holds it until the case settles it. */
let doneAnswer: unknown;
/** how often the editor's loader has been read. */
let reads: number;

beforeEach(() => {
	asked = [];
	replies = [];
	doneAnswer = { saved: 'block' };
	reads = 0;
});

function mount(tree: ReactNode): HTMLElement {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

/** `screen` under the editor's route, beside the suggest route and the sign-in. */
function routed(screen: ReactNode): HTMLElement {
	const Stub = createRoutesStub([
		{
			id: 'editor',
			path: '/admin/donation-page',
			Component: () => screen,
			loader: () => {
				reads += 1;
				return null;
			},
			action: async () => doneAnswer,
			shouldRevalidate: revalidatesAfter
		},
		{
			path: '/admin/pages/:pageId/suggest',
			action: async ({ request }) => {
				const body = await request.formData();
				asked.push({
					url: new URL(request.url).pathname,
					...Object.fromEntries([...body].map(([k, v]) => [k, String(v)]))
				});
				const reply = await replies.shift();
				if (reply === undefined) throw new Error('asked with no reply queued');
				if (reply === 'signed-out')
					throw redirect(`${SIGN_IN}?next=${encodeURIComponent(SUGGEST)}`);
				return data(reply.body, { status: reply.status });
			}
		},
		{ path: SIGN_IN, Component: () => <h1>Sign in</h1> }
	]);
	// the first read is the server's, so the screen is drawn at once and `reads` counts only those
	// after it.
	return mount(
		<Stub
			initialEntries={['/admin/donation-page']}
			hydrationData={{ loaderData: { editor: null } }}
		/>
	);
}

/** `block`'s sheet, whose Done the editor's action answers with `doneAnswer`. */
const sheet = (block: EditorBlock) =>
	routed(
		<BlockEditSheet
			block={block}
			version={3}
			suggestUrl={SUGGEST}
			onDismiss={() => {}}
			onSaved={() => {}}
		/>
	);

const nameSheet = () =>
	routed(
		<NameSheet
			name="Winter coat drive"
			onDone={() => {}}
			applying={false}
			onDismiss={() => {}}
			suggestUrl={SUGGEST}
		/>
	);

/** a round of the event loop, so an answer and the redraw after it land. */
const settle = () => act(() => new Promise((done) => setTimeout(done, 0)));

async function press(control: HTMLElement | null | undefined) {
	if (!control) throw new Error('nothing to press');
	await act(async () => {
		control.focus();
		control.click();
	});
	await settle();
	await settle();
}

/** the `nth` field whose label reads `label`, the optional marker aside. */
function field(root: Element, label: string, nth = 0): HTMLElement {
	const found = [...root.querySelectorAll<HTMLElement>('.adm-field')].filter(
		(one) => one.querySelector('.adm-field__label')?.firstChild?.textContent?.trim() === label
	)[nth];
	if (found === undefined) throw new Error(`no field labelled ${label}`);
	return found;
}

const writePress = (box: Element) =>
	box.querySelector<HTMLButtonElement>('.adm-field__head button[aria-label="Write with AI"]');
const undoPress = (box: Element) =>
	[...box.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Undo');
const marked = (box: Element) =>
	box.querySelector('.adm-field__head .adm-state')?.textContent === 'AI suggestion';
/** the box's own region, which says what an ask could not write. */
const said = (box: Element) => box.querySelector('.adm-field__needed[role="status"]')?.textContent;
const plainBox = (box: Element) => {
	const found = box.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
	if (found === null) throw new Error('the field holds no box');
	return found;
};
/** what a rich box posts, run through the rule. */
const richPosted = (box: Element): RichTextDocument => {
	const value = box.querySelector<HTMLInputElement>('input[type="hidden"]')?.value ?? '';
	const parsed = parseRichText(JSON.parse(value));
	if (!parsed.ok) throw new Error('the box posts what the rule refuses');
	return parsed.doc;
};

/** writes `text` into a plain box the way typing would, so react hears it. */
function typeInto(box: HTMLInputElement | HTMLTextAreaElement, text: string) {
	act(() => {
		const proto = Object.getPrototypeOf(box) as object;
		Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(box, text);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

const VARIANTS = { variant: null, variants: [], illustration: false } as const;

const title: EditorBlock = {
	id: 'b1',
	type: 'title',
	label: 'Title',
	summary: 'Keep 300 kids warm this winter',
	...VARIANTS,
	text: { kind: 'title', heading: 'Keep 300 kids warm this winter', lede: '' }
};

const STORY_BEFORE = richTextOf('Last winter we ran out of coats.\n\nThis year we won’t.');

const story: EditorBlock = {
	id: 'b2',
	type: 'story',
	label: 'Story',
	summary: 'Last winter we ran out of coats.',
	...VARIANTS,
	text: { kind: 'story', body: STORY_BEFORE }
};

const tiers: EditorBlock = {
	id: 'b3',
	type: 'impact-tiers',
	label: 'Impact tiers',
	summary: '$40 buys one winter coat',
	...VARIANTS,
	text: {
		kind: 'impact-tiers',
		currency: 'USD',
		tiers: [
			{ amount: '40.00', buys: 'one winter coat' },
			{ amount: '120.00', buys: '' }
		]
	}
};

const faq: EditorBlock = {
	id: 'b4',
	type: 'faq',
	label: 'Questions',
	summary: 'Who gets the coats?',
	...VARIANTS,
	text: {
		kind: 'faq',
		items: [{ question: 'Who gets the coats?', answer: richTextOf('Kids at Elm Street School.') }]
	}
};

const hero: EditorBlock = {
	id: 'b5',
	type: 'hero',
	label: 'Cover photo',
	summary: 'Volunteers',
	...VARIANTS,
	text: { kind: 'photo', imageId: '0192a4c1-0000-7000-8000-000000000001', alt: 'Volunteers' }
};

describe('Write with AI', () => {
	it.each([
		['a title', () => sheet(title), ['Heading', 'Lead-in']],
		['a story, a rich box', () => sheet(story), ['Story']],
		[
			'a gift tier, on what it buys and not on its amount',
			() => sheet(tiers),
			['What it buys', 'What it buys']
		],
		['a question and its rich answer', () => sheet(faq), ['Question', 'Answer']],
		['a photo, and not on its description', () => sheet(hero), []],
		['a campaign’s name', nameSheet, ['Name']]
	])(
		'stands at the end of the label row of every box the AI can write on %s, reading Write',
		(_, open, boxes) => {
			const root = open();
			const carrying = [...root.querySelectorAll('.adm-field')].filter((one) => writePress(one));

			expect(
				carrying.map((one) =>
					one.querySelector('.adm-field__label')?.firstChild?.textContent?.trim()
				)
			).toEqual(boxes);
			expect(root.querySelectorAll('button[aria-label="Write with AI"]')).toHaveLength(
				boxes.length
			);
			for (const one of carrying) {
				expect(writePress(one)?.classList).toContain('adm-field__press');
				expect(writePress(one)?.textContent).toBe('Write');
			}
		}
	);

	it('leaves a photo’s description to the operator: the model never sees the photo', () => {
		const box = field(sheet(hero), 'Describe the photo');

		expect(plainBox(box).value).toBe('Volunteers');
		expect(writePress(box)).toBeNull();
	});

	it.each([
		[
			'a plain box',
			() => field(sheet(title), 'Heading'),
			{ block: 'b1', field: 'heading', current: 'Keep 300 kids warm this winter' }
		],
		[
			'an empty tier, for its amount as the box draws it',
			() => field(sheet(tiers), 'What it buys', 1),
			{ block: 'b3', field: 'tier_buys[1]', current: '', beside: '120.00' }
		],
		[
			'a rich answer, for its question',
			() => field(sheet(faq), 'Answer'),
			{
				block: 'b4',
				field: 'answer[0]',
				current: 'Kids at Elm Street School.',
				beside: 'Who gets the coats?'
			}
		],
		[
			'a rich box, as paragraphs',
			() => field(sheet(story), 'Story'),
			{
				block: 'b2',
				field: 'body',
				current: 'Last winter we ran out of coats.\n\nThis year we won’t.'
			}
		],
		[
			'the name, as the page’s own box',
			() => field(nameSheet(), 'Name'),
			{ block: 'page', field: 'name', current: 'Winter coat drive' }
		]
	])('asks for %s by its block, its name and the words it holds', async (_, box, ask) => {
		replies.push({ status: 200, body: { ok: true, text: 'Warm coats for every child' } });
		await press(writePress(box()));

		expect(asked).toEqual([{ url: SUGGEST, ...ask }]);
	});

	it.each([
		['an amount typed over the stored one, grouped as drawn', '1000', '1,000'],
		['a blank amount, sent blank rather than left out', '', '']
	])('asks for a tier’s words for %s', async (_, typed, beside) => {
		const root = sheet(tiers);
		typeInto(plainBox(field(root, 'Amount')), typed);
		replies.push({ status: 200, body: { ok: true, text: 'a coat, hat and gloves' } });

		await press(writePress(field(root, 'What it buys')));

		expect(asked).toEqual([
			{ url: SUGGEST, block: 'b3', field: 'tier_buys[0]', current: 'one winter coat', beside }
		]);
	});

	it('asks for an answer to the question as the sheet holds it, not as stored', async () => {
		const root = sheet(faq);
		typeInto(plainBox(field(root, 'Question')), 'Which school gets the coats?');
		replies.push({ status: 200, body: { ok: true, text: 'Elm Street School.' } });

		await press(writePress(field(root, 'Answer')));

		expect(asked[0]?.beside).toBe('Which school gets the coats?');
	});

	it('leaves the editor unread after an ask, which writes nothing', async () => {
		const box = field(sheet(title), 'Heading');
		replies.push({ status: 200, body: { ok: true, text: 'Every child warm by December' } });

		await press(writePress(box));

		expect(plainBox(box).value).toBe('Every child warm by December');
		expect(reads).toBe(0);
	});

	it('follows the sign-in redirect of a session that has ended', async () => {
		const root = sheet(title);
		replies.push('signed-out');

		await press(writePress(field(root, 'Heading')));

		expect(root.querySelector('h1')?.textContent).toBe('Sign in');
	});

	it('fills a plain box in place, marked, and Undo puts back the words before, the focus on the press', async () => {
		const box = field(sheet(title), 'Heading');
		replies.push({ status: 200, body: { ok: true, text: 'Every child warm by December' } });

		await press(writePress(box));
		expect(plainBox(box).value).toBe('Every child warm by December');
		expect(marked(box)).toBe(true);
		expect(said(box)).toBe('AI suggestion');
		// a small press in the label row, aimed at at the floor as the Write beside it is
		// (packages/operator/src/styles/touch-geometry.spec.ts).
		expect(undoPress(box)?.classList).toContain('adm-field__press');

		await press(undoPress(box));
		expect(plainBox(box).value).toBe('Keep 300 kids warm this winter');
		expect(marked(box)).toBe(false);
		expect(undoPress(box)).toBeUndefined();
		expect(document.activeElement).toBe(writePress(box));
		expect(said(box)).toBe('Put back');

		typeInto(plainBox(box), 'Keep 300 kids warm');
		expect(said(box)).toBe('');
	});

	it('fills a rich box as the document of its paragraphs, and Undo puts the one before back', async () => {
		const box = field(sheet(story), 'Story');
		replies.push({ status: 200, body: { ok: true, text: 'Coats ran out.\n\nNot this year.' } });

		await press(writePress(box));
		expect(richPosted(box)).toEqual(richTextOf('Coats ran out.\n\nNot this year.'));
		expect(marked(box)).toBe(true);

		await press(undoPress(box));
		expect(richPosted(box)).toEqual(STORY_BEFORE);
		expect(marked(box)).toBe(false);
	});

	it('fills the name, and a second fill over it still undoes to the name as stored', async () => {
		const box = field(nameSheet(), 'Name');
		replies.push({ status: 200, body: { ok: true, text: 'Coats for Kids' } });
		replies.push({ status: 200, body: { ok: true, text: 'Warm Winter Coats' } });

		await press(writePress(box));
		await press(writePress(box));
		expect(plainBox(box).value).toBe('Warm Winter Coats');
		expect(asked.map((one) => one.current)).toEqual(['Winter coat drive', 'Coats for Kids']);

		await press(undoPress(box));
		expect(plainBox(box).value).toBe('Winter coat drive');
	});

	it('takes the mark away once the operator types in the box, and keeps what they typed', async () => {
		const box = field(sheet(tiers), 'What it buys');
		replies.push({ status: 200, body: { ok: true, text: 'a coat, hat and gloves' } });
		await press(writePress(box));
		expect(marked(box)).toBe(true);

		typeInto(plainBox(box), 'a coat and a hat');

		expect(marked(box)).toBe(false);
		expect(undoPress(box)).toBeUndefined();
		expect(plainBox(box).value).toBe('a coat and a hat');
	});

	it('takes the mark away once the block’s Done lands, and keeps it through a Done refused', async () => {
		const root = sheet(title);
		const box = field(root, 'Heading');
		const done = [...root.querySelectorAll('button')].find((one) => one.textContent === 'Done');
		replies.push({ status: 200, body: { ok: true, text: 'Every child warm by December' } });
		await press(writePress(box));

		doneAnswer = {
			form: { id: BLOCK_FORMS.title, result: { status: 'error', error: { '': ['Reload.'] } } }
		};
		await press(done);
		expect(marked(box)).toBe(true);

		doneAnswer = { saved: 'block' };
		await press(done);
		expect(marked(box)).toBe(false);
		expect(plainBox(box).value).toBe('Every child warm by December');
	});

	it.each([
		[
			'no model answered (503)',
			{
				status: 503,
				body: {
					ok: false,
					reason: 'unanswered',
					text: 'The AI isn’t answering. Try again in a minute.'
				}
			},
			'The AI isn’t answering. Try again in a minute.'
		],
		[
			'the words were refused twice (422)',
			{
				status: 422,
				body: { ok: false, reason: 'refused', text: 'Couldn’t write that box. Try again.' }
			},
			'Couldn’t write that box. Try again.'
		],
		[
			'the suggestion threw (500)',
			{
				status: 500,
				body: { ok: false, reason: 'failed', text: 'Couldn’t write that box. Try again.' }
			},
			'Couldn’t write that box. Try again.'
		],
		[
			'a box the draft no longer holds (400), in its own words and never the agent’s',
			{ status: 400, body: { error: 'field "lede" is no text box of block "b1" (title)' } },
			'That didn’t go through. Try again.'
		],
		[
			'a page that is gone (404), in its own words and never the agent’s',
			{ status: 404, body: { error: 'no page has the id "p1"' } },
			'That didn’t go through. Try again.'
		]
	] as const)('says at the box what %s, and writes nothing', async (_, reply, words) => {
		const box = field(sheet(title), 'Lead-in');
		replies.push(reply);

		await press(writePress(box));

		expect(said(box)).toBe(words);
		expect(plainBox(box).value).toBe('');
		expect(marked(box)).toBe(false);
	});

	it('clears what it said at the next ask', async () => {
		const box = field(sheet(title), 'Lead-in');
		replies.push({ status: 400, body: { error: 'current holds at most 10000 characters' } });
		replies.push({ status: 200, body: { ok: true, text: 'Coats for 300 kids.' } });

		await press(writePress(box));
		await press(writePress(box));

		expect(said(box)).toBe('AI suggestion');
		expect(plainBox(box).value).toBe('Coats for 300 kids.');
	});

	it('is busy while its ask is out, asks once however often it is pressed, and leaves the box open', async () => {
		const box = field(sheet(title), 'Heading');
		let answer: (reply: Reply) => void = () => {};
		replies.push(new Promise<Reply>((resolve) => (answer = resolve)));

		await press(writePress(box));
		const out = writePress(box);
		expect(out?.getAttribute('aria-busy')).toBe('true');
		expect(out?.getAttribute('aria-disabled')).toBe('true');
		expect(out?.textContent).toBe('Write');
		expect(said(box)).toBe('Writing');
		expect(document.activeElement).toBe(out);
		await press(out);
		expect(asked).toHaveLength(1);
		expect(plainBox(box).disabled).toBe(false);
		typeInto(plainBox(box), 'Coats for every kid');
		expect(plainBox(box).value).toBe('Coats for every kid');

		await act(async () => answer({ status: 200, body: { ok: true, text: 'Warm by December' } }));
		await settle();
		expect(writePress(box)?.getAttribute('aria-busy')).toBe('false');
		expect(plainBox(box).value).toBe('Warm by December');

		await press(undoPress(box));
		expect(plainBox(box).value).toBe('Coats for every kid');
	});

	it('lets go of an ask still out when Done is pressed, so the box keeps what was saved', async () => {
		const root = sheet(title);
		const box = field(root, 'Heading');
		const done = [...root.querySelectorAll('button')].find((one) => one.textContent === 'Done');
		let answer: (reply: Reply) => void = () => {};
		replies.push(new Promise<Reply>((resolve) => (answer = resolve)));
		let saved: (reply: unknown) => void = () => {};
		doneAnswer = new Promise((resolve) => (saved = resolve));
		typeInto(plainBox(box), 'Coats for every kid');

		await press(writePress(box));
		await press(done);
		expect(writePress(box)?.getAttribute('aria-disabled')).toBe('true');
		expect(writePress(box)?.getAttribute('aria-busy')).toBe('false');

		await act(async () => saved({ saved: 'block' }));
		await settle();
		await act(async () => answer({ status: 200, body: { ok: true, text: 'Warm by December' } }));
		await settle();
		await settle();

		expect(plainBox(box).value).toBe('Coats for every kid');
		expect(marked(box)).toBe(false);
		expect(said(box)).toBe('');
		expect(writePress(box)?.hasAttribute('aria-disabled')).toBe(false);
	});

	it('is held while the block’s Done is out, and asks nothing', async () => {
		const root = sheet(title);
		const box = field(root, 'Heading');
		const done = [...root.querySelectorAll('button')].find((one) => one.textContent === 'Done');
		let saved: (reply: unknown) => void = () => {};
		doneAnswer = new Promise((resolve) => (saved = resolve));

		await press(done);
		await press(writePress(box));
		expect(writePress(box)?.getAttribute('aria-disabled')).toBe('true');
		expect(asked).toEqual([]);

		await act(async () => saved({ saved: 'block' }));
		await settle();
		expect(writePress(box)?.hasAttribute('aria-disabled')).toBe(false);
	});
});
