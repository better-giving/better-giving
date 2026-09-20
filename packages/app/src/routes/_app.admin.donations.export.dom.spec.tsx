import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, Link, Outlet, useLoaderData } from 'react-router';
import { expect, it, onTestFinished, vi } from 'vitest';
import {
	JOURNAL_PRESS_COOKIE,
	JOURNAL_PRESS_FIELD,
	JOURNAL_REFUSAL_FIELD,
	RANGE_REVERSED,
	readJournalProblem,
	REFUSAL_ON_SCREEN
} from '$lib/ledger/journal-range';
import ExportEntries from './_app.admin.donations.export';

// the Export screen, drawn.
//
// what it covers is everything the workers spec beside it cannot reach. that file drives the
// `loader` and renders nothing — so the markup this screen composes has no reader at all: which
// boxes exist, which presses are drawn, what each press carries, where a refusal lands, how long
// it stands there, and how long the press that caused it is held.
//
// **a press goes at the file itself and never at this screen**, so what a case reads is the submit
// rather than a navigation: whether the press was let through, and the body it would have carried.
// the address it reaches is the journal route's, which answers with a file and is a document
// navigation the router is deliberately not in — so there is nothing here for a stub's loader to be
// asked for, and a case that expects the screen to stay reads the visits that never happened.
//
// **the target is the pressed button's own value**, which is the one thing here a server render
// cannot show either: what makes one form carry two targets is what the submitter puts in the body.
//
// **and the refusals the browser itself makes**: a press over a range the boxes refuse is stopped
// before it reaches the file at all, so a case reads the sentence under the box and the submit that
// was prevented.
//
// **each end of the range is a date field whose label stands inside it**, so the chunks an operator
// writes a day into and the control that day is submitted under are two different elements:
// `dayBox` below is the group of chunks and `carrier` is the control. a case reaching for the wrong
// one reads a value nobody submits, or names an element no label points at.
//
// mounted rather than rendered to a string, and that is why this file is in the dom pool: the
// refusals above are conform's, and nothing about them exists until the form is in a document
// somebody can press.
//
// it is not the browser spec CLAUDE.md bans over a dashboard screen. nothing here reads a computed
// style: what is asserted is which controls exist, what each is named, what each carries and which
// state the screen is in.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** the address the screen is served on in every stub below. */
const SCREEN = '/admin/donations/export';

/** the address the file itself is served at, which is where every press goes. */
const JOURNAL = '/admin/donations/export/journal';

/** the id the stub's screen route is mounted under, which is what its hydration data is keyed by. */
const STUB_ROUTE = 'export';

/** the range a case reaches by pressing the link beside the screen, rather than by a submit. */
const ELSEWHERE = '?from=2026-04-01&to=2026-04-30&target=xero';

/** a refused range reached the same way, which is a refusal arriving under a screen already open. */
const REFUSED_ELSEWHERE = `${ELSEWHERE}&problem=nothing_posted`;

type LoaderData = Parameters<typeof ExportEntries>[0]['loaderData'];

/** the two packages this app shapes a file for, as the loader hands them over. */
const TARGETS = [
	{ value: 'quickbooks', label: 'QuickBooks Online', brand: 'quickbooks' },
	{ value: 'xero', label: 'Xero', brand: 'xero' }
];

/**
 * what the screen is handed at one address, read off it the way the real loader reads it: the
 * range and the target the boxes go back to holding, and the problem a refused press was sent back
 * with.
 */
function loaderData(search: string): LoaderData {
	const params = new URLSearchParams(search);
	return {
		asked: {
			from: params.get('from') ?? '',
			to: params.get('to') ?? '',
			target: params.get('target') ?? ''
		},
		problem: readJournalProblem(params),
		answering: params.get(JOURNAL_PRESS_FIELD) ?? '',
		targets: TARGETS
	} as LoaderData;
}

/**
 * the screen at one address, and the addresses the router was asked for.
 *
 * inside a `createRoutesStub` because the screen's form is the router's and resolves its own
 * action through it. the screen sits under a layout carrying one link, which is how a case reaches
 * a second range without submitting the boxes — a range arrived at any other way is one the boxes
 * already held.
 *
 * the landing is hydrated, so the screen renders in one synchronous pass and every call of the
 * loader is a move a case made. a press is not one of them: it goes at the file as a document
 * navigation, which leaves `visited` exactly as it was.
 */
function screen(options: { search?: string } = {}): { root: HTMLElement; visited: string[] } {
	const search = options.search ?? '';
	const visited: string[] = [];
	const Stub = createRoutesStub([
		{
			id: 'frame',
			path: SCREEN,
			Component: () =>
				createElement(
					'div',
					null,
					createElement(Link, { to: SCREEN + ELSEWHERE }, 'elsewhere'),
					createElement(Link, { to: SCREEN + REFUSED_ELSEWHERE }, 'refused elsewhere'),
					createElement(Outlet)
				),
			children: [
				{
					id: STUB_ROUTE,
					index: true,
					loader: ({ request }: { request: Request }) => {
						const asked = new URL(request.url).search;
						visited.push(asked);
						return loaderData(asked);
					},
					Component: () =>
						createElement(ExportEntries as never, {
							loaderData: useLoaderData(),
							params: {},
							matches: []
						})
				}
			]
		}
	]);
	return {
		root: mount(
			createElement(Stub, {
				initialEntries: [SCREEN + search],
				hydrationData: { loaderData: { [STUB_ROUTE]: loaderData(search) } }
			})
		),
		visited
	};
}

/**
 * mounts `tree` into a document that lives as long as the case, and hands back its root element.
 *
 * `appendChild` rather than `append`: worker-configuration.d.ts declares HTMLRewriter's `Element`,
 * which merges into the DOM's and brings an `append(content, options)` that wins here.
 */
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

/** the control the form carries `name` in, which is the day as the file's route reads it. */
function carrier(root: HTMLElement, name: string): HTMLInputElement {
	const found = root.querySelector(`form [name="${name}"]`);
	if (found === null) throw new Error(`the screen submits nothing under "${name}"`);
	return found as unknown as HTMLInputElement;
}

/**
 * the box one end of the range is written into: the group its year, month and day chunks stand in.
 *
 * found through the carrier's own field rather than by the name, because the name is on the
 * carrier: what a reader meets is the one group of chunks in that field the caret can go into.
 */
function dayBox(root: HTMLElement, name: string): HTMLElement {
	const field = carrier(root, name).closest('.adm-field');
	if (field === null) throw new Error(`the control named "${name}" stands in no field`);
	const group = field.querySelector('[data-part="segment-group"]');
	if (group === null) throw new Error(`the field carrying "${name}" drew no chunks to write in`);
	return group as unknown as HTMLElement;
}

/** the chunks of one end a caret can land in: the separators between them are not among them. */
function chunks(root: HTMLElement, name: string): HTMLElement[] {
	return [...dayBox(root, name).querySelectorAll<HTMLElement>('[data-part="segment"][tabindex]')];
}

/** what the chunks of one end are showing, separators included, as one string. */
const written = (root: HTMLElement, name: string) =>
	[...dayBox(root, name).querySelectorAll('[data-part="segment"]')]
		.map((chunk) => chunk.textContent)
		.join('');

/**
 * the visible words labelling the box named `name`, which is what an operator reads.
 *
 * read through the name the chunks actually carry rather than off a `for`: a group of chunks is
 * named by `aria-labelledby`, and the `for` on the same label points at the control the day is
 * submitted under — the one element of the two a label may point at.
 */
function labelOf(root: HTMLElement, name: string): string {
	const named = dayBox(root, name).getAttribute('aria-labelledby');
	const label = named === null ? null : root.querySelector(`#${named}`);
	if (label === null) throw new Error(`the box named "${name}" carries no label`);
	return label.textContent ?? '';
}

/** the group the two days stand in, which is what names the pair as one range. */
function rangeGroup(root: HTMLElement): HTMLElement {
	const found = root.querySelector('form fieldset');
	if (found === null) throw new Error('the screen drew no group around the two days');
	return found as HTMLElement;
}

/** every submit press the screen draws, in the order a reader meets them. */
function presses(root: HTMLElement): HTMLButtonElement[] {
	return [...root.querySelectorAll('form button[type="submit"]')] as HTMLButtonElement[];
}

/** the press reading `label`. */
function pressNamed(root: HTMLElement, label: string): HTMLButtonElement {
	const found = presses(root).find((button) => button.textContent === label);
	if (found === undefined) throw new Error(`the screen drew no press reading "${label}"`);
	return found;
}

/** the one row the presses stand on. */
function actionsRow(root: HTMLElement): HTMLElement {
	const row = root.querySelector('form .adm-actions');
	if (row === null) throw new Error('the screen drew no row for the presses');
	return row as HTMLElement;
}

/**
 * the sentence a press is described by, or `null` where it is described by nothing.
 *
 * read through the press's own `aria-describedby` rather than by position, because that pointer is
 * the whole of what puts the two together: the sentence stands under the row both presses are on,
 * so nothing about where it sits says which press it answered.
 */
function describing(root: HTMLElement, press: HTMLButtonElement): HTMLElement | null {
	const id = press.getAttribute('aria-describedby');
	return id === null ? null : root.querySelector(`#${id}`);
}

/** every sentence the screen draws under the row. */
function sentences(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll('form .adm-hint')] as HTMLElement[];
}

/**
 * presses one of the links the frame draws, which is how a case reaches another range without a
 * submit — a press on this screen goes at the file and never at the router.
 */
async function goTo(root: HTMLElement, words: string): Promise<void> {
	const link = [...root.querySelectorAll('a')].find((anchor) => anchor.textContent === words);
	if (link === undefined) throw new Error(`the frame drew no link reading "${words}"`);
	await act(async () => {
		link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	});
	await flushed();
}

/**
 * lets the date field's machine finish, and the redraw that follows it.
 *
 * what was typed is settled into a day a tick after the caret leaves, so a case reading the
 * carrier on the next line would be reading the box before the day reached it.
 */
const flushed = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

/**
 * writes a day into one end of the range the way an operator does, a keystroke at a time.
 *
 * a chunk is a `contenteditable` span and what it reads is the text the platform is about to insert
 * into it, which react hands a component as `onBeforeInput` and dispatches from `textInput`
 * (`BeforeInputEventPlugin` in react-dom). the caret steps on to the next chunk as each one fills,
 * so eight digits fill three chunks — and the control the form carries is written on the last of
 * them, because half a date is not a day.
 */
async function typeDay(root: HTMLElement, name: string, day: string): Promise<void> {
	const first = chunks(root, name)[0];
	if (first === undefined) throw new Error(`the box named "${name}" drew no chunk to write in`);
	await act(async () => {
		first.focus();
	});
	await flushed();
	for (const character of day.replace(/-/g, '')) {
		const at = document.activeElement;
		if (at === null) throw new Error('nothing is holding the caret');
		await act(async () => {
			at.dispatchEvent(
				new InputEvent('textInput', {
					data: character,
					inputType: 'insertText',
					bubbles: true,
					cancelable: true
				})
			);
		});
		await flushed();
	}
}

/**
 * the refusal drawn under the box named `name`, or `null` where it carries none.
 *
 * named from the carrier's own id, which is the id `boxProps` in $lib/admin/use-admin-form.ts gives
 * that field — the chunks are a group of elements and no one of them is the field.
 */
function refusalAt(root: HTMLElement, name: string): string | null {
	const message = root.querySelector(`#${carrier(root, name).id}-err`);
	return message === null ? null : (message.textContent ?? '');
}

/** what a press did: whether the browser was left to make it, and the body it would have carried. */
type Pressed = { readonly allowed: boolean; readonly body: URLSearchParams };

/**
 * presses one target's own submit, as an operator does, over whatever the boxes hold.
 *
 * `allowed` is read off the event at the document rather than at the form: react delivers a form's
 * own `onSubmit` at the root it mounted into, so a listener on the form would read the event
 * before conform has had the chance to stop it.
 *
 * the body is read with the submitter, which is where the target is. happy-dom takes a submitter in
 * `new FormData(form, submitter)` and still fails react router's probe for it
 * (`isFormDataSubmitterSupported` in react-router/dist/development/lib/dom/dom.js), so the pressed
 * button's pair can be appended twice — `params.get` answers the same either way.
 */
async function pressTarget(press: HTMLButtonElement): Promise<Pressed> {
	const form = press.form;
	if (form === null) throw new Error('that press stands in no form');
	let allowed = false;
	const watch = (event: Event) => {
		allowed = !event.defaultPrevented;
	};
	document.addEventListener('submit', watch);
	try {
		await act(async () => {
			form.requestSubmit(press);
		});
	} finally {
		document.removeEventListener('submit', watch);
	}
	return {
		allowed,
		body: new URLSearchParams([...new FormData(form, press)] as [string, string][])
	};
}

/** fills the range and presses one target's own submit, as an operator does. */
async function exportRange(
	root: HTMLElement,
	from: string,
	to: string,
	press: HTMLButtonElement
): Promise<Pressed> {
	await typeDay(root, 'from', from);
	await typeDay(root, 'to', to);
	return pressTarget(press);
}

it('draws the two days as one named range, each end named inside it', () => {
	const { root } = screen();

	const group = rangeGroup(root);
	expect(group.querySelector('legend')?.textContent).toBe('Date range');
	// the group names the subject once, and each box then says which end of it this one is — a box
	// labelled for the range would be the same word read out twice.
	expect(labelOf(root, 'from')).toBe('From');
	expect(labelOf(root, 'to')).toBe('To');
	expect(group.contains(dayBox(root, 'from'))).toBe(true);
	expect(group.contains(dayBox(root, 'to'))).toBe(true);
});

it('names each end with a real label, on the box that end is typed into', () => {
	const { root } = screen();

	for (const name of ['from', 'to']) {
		const typed = dayBox(root, name);
		// the words stand inside this box rather than over it, and they are still a label: a real
		// `<label>` element, naming the chunks the caret goes into and pointing at the control this
		// end submits through — which is the one element of the two a `for` may name.
		const named = typed.getAttribute('aria-labelledby');
		expect(named).not.toBeNull();
		expect(root.querySelector(`label#${named}`)).not.toBeNull();
		expect(root.querySelector(`label#${named}`)?.getAttribute('for')).toBe(carrier(root, name).id);
		// no chunk carries the name, so `elements.namedItem` finds the carrier and nothing else.
		for (const chunk of chunks(root, name)) expect(chunk.getAttribute('name')).toBeNull();
		expect(root.querySelectorAll(`form [name="${name}"]`)).toHaveLength(1);
	}
});

it('draws one press per accounting system and no box to choose one in', () => {
	const { root } = screen();

	// each press is the package and nothing else: what the row does is written once over it.
	expect(presses(root).map((press) => press.textContent)).toEqual(['QuickBooks Online', 'Xero']);
	// the target is the press, so there is nothing for a browser to fall to the first option of.
	expect(root.querySelector('form select')).toBeNull();
});

it('names what the row does once, above it', () => {
	const { root } = screen();

	expect([...root.querySelectorAll('form .adm-caption')].map((words) => words.textContent)).toEqual(
		['Export to']
	);
	for (const press of presses(root)) expect(press.textContent).not.toContain('Export to');
});

it('stands both presses on one row', () => {
	const { root } = screen();

	const row = actionsRow(root);
	expect(presses(root).every((press) => press.parentElement === row)).toBe(true);
	expect(root.querySelectorAll('form .adm-actions')).toHaveLength(1);
});

it('sets each package’s own mark before its name, and out of the reading', () => {
	const { root } = screen();

	for (const target of TARGETS) {
		const press = pressNamed(root, target.label);
		const mark = press.querySelector('.adm-brand');
		// the brand the loader named, rather than the target's own value read as one: the two are
		// separate sets, and a press drawn from the wrong one carries another company's logo.
		expect(mark?.className).toContain(`adm-brand--${target.brand}`);
		// a logo standing beside the company's own name in the text it is drawn with takes no
		// label, because a label there is the package announced twice in one control.
		expect(mark?.getAttribute('aria-hidden')).toBe('true');
		expect(mark?.getAttribute('role')).toBeNull();
		expect(mark?.getAttribute('aria-label')).toBeNull();
		// so the press is named by its text alone.
		expect(press.textContent).toBe(target.label);
	}
});

it('sends a press at the file itself, and asks the router nothing about that address', () => {
	const { root } = screen();

	const form = root.querySelector('form');
	expect(form?.getAttribute('action')).toBe(JOURNAL);
	// the router never draws this address, so it has no manifest entry to go and fetch for it on
	// render. that the submit itself is the browser's is what `allowed` reads, below.
	expect(form?.getAttribute('data-discover')).toBeNull();
});

it('hands a good range to the browser, carrying the pressed target', async () => {
	const { root, visited } = screen();

	const pressed = await exportRange(
		root,
		'2026-03-01',
		'2026-03-31',
		pressNamed(root, 'QuickBooks Online')
	);

	// let through rather than prevented, which is the whole of "the browser makes this navigation":
	// a routed submit is one react router stops and answers itself.
	expect(pressed.allowed).toBe(true);
	expect(pressed.body.get('from')).toBe('2026-03-01');
	expect(pressed.body.get('to')).toBe('2026-03-31');
	expect(pressed.body.get('target')).toBe('quickbooks');
	// what tells the file's route to send a refusal back here to be worded, rather than answering
	// it as the text a hand-typed address gets.
	expect(pressed.body.get(JOURNAL_REFUSAL_FIELD)).toBe(REFUSAL_ON_SCREEN);
	// the screen the operator is standing on is the screen they stay on.
	expect(visited).toEqual([]);
});

it('carries the other target when the other press is the one made', async () => {
	const { root } = screen();

	const pressed = await exportRange(root, '2026-03-01', '2026-03-31', pressNamed(root, 'Xero'));

	expect(pressed.allowed).toBe(true);
	expect(pressed.body.get('target')).toBe('xero');
});

/** the range every case about the press itself starts from, so no case has to write one in. */
const SEEDED = { search: '?from=2026-03-01&to=2026-03-31&target=xero' };

/**
 * the deployment answering a press of this browser's own, which is one cookie and two readings: a
 * file releases the press with it, and a refusal says with it that a press caused the document
 * that came back.
 *
 * written at the document's root path rather than the screen's, because that is the one this
 * document is at — what the deployment scopes the real cookie to is the journal route's
 * (`_app.admin.donations.export_.journal.ts`).
 */
function answeredPress(token: string): void {
	// biome-ignore-start lint/suspicious/noDocumentCookie: the screen reads the cookie the same way, for the reason its own `fileArrived` states.
	document.cookie = `${JOURNAL_PRESS_COOKIE}=${token}; path=/`;
	onTestFinished(() => {
		document.cookie = `${JOURNAL_PRESS_COOKIE}=; path=/; max-age=0`;
	});
	// biome-ignore-end lint/suspicious/noDocumentCookie: as above.
}

/** waits for the screen's own look at that cookie, which is what lets the press go again. */
async function rearmed(press: HTMLButtonElement): Promise<void> {
	for (let look = 0; look < 40 && press.getAttribute('aria-disabled') !== null; look += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 25));
		});
	}
}

it('holds the press while the file it asked for is on its way', async () => {
	const { root } = screen(SEEDED);
	const press = pressNamed(root, 'Xero');

	const pressed = await pressTarget(press);

	expect(pressed.allowed).toBe(true);
	// the token that press was minted with, which is the whole of what the file has to echo back
	// for this screen to learn its answer landed.
	expect(pressed.body.get(JOURNAL_PRESS_FIELD)).toMatch(/^[0-9a-f-]{36}$/);
	expect(press.getAttribute('aria-busy')).toBe('true');
	expect(press.getAttribute('aria-disabled')).toBe('true');
});

it('sends nothing on a second press while the first is still in flight', async () => {
	const { root } = screen(SEEDED);
	const press = pressNamed(root, 'Xero');
	await pressTarget(press);

	const again = await pressTarget(press);
	// the other package is held too: a second press of either kind is the same range read out of
	// the books a second time, and nothing on this screen knows the first one has landed.
	const other = await pressTarget(pressNamed(root, 'QuickBooks Online'));

	expect(again.allowed).toBe(false);
	expect(other.allowed).toBe(false);
	expect(pressNamed(root, 'QuickBooks Online').getAttribute('aria-disabled')).toBe('true');
	// only the press that asked is working; the other is merely held.
	expect(pressNamed(root, 'QuickBooks Online').getAttribute('aria-busy')).toBeNull();
});

it('lets the press go again once the file answers with the token it carried', async () => {
	const { root } = screen(SEEDED);
	const press = pressNamed(root, 'Xero');
	const pressed = await pressTarget(press);

	answeredPress(pressed.body.get(JOURNAL_PRESS_FIELD) ?? '');
	await rearmed(press);

	expect(press.getAttribute('aria-disabled')).toBeNull();
	expect(press.getAttribute('aria-busy')).toBeNull();
	const again = await pressTarget(press);
	expect(again.allowed).toBe(true);
	// a press of its own, so the file answering the first one cannot release the second.
	expect(again.body.get(JOURNAL_PRESS_FIELD)).not.toBe(pressed.body.get(JOURNAL_PRESS_FIELD));
});

it('holds the press over another press’s answer', async () => {
	const { root } = screen(SEEDED);
	const press = pressNamed(root, 'Xero');
	await pressTarget(press);

	answeredPress('019fb400-0000-7000-8000-00000000ffff');
	await rearmed(press);

	expect(press.getAttribute('aria-disabled')).toBe('true');
});

it('lets the press go after a bound, so an answer that never comes cannot leave it dead', async () => {
	const { root } = screen(SEEDED);
	const press = pressNamed(root, 'Xero');
	// installed before the press, because the hold is set going by it: the clock this case moves
	// has to be the one that hold is scheduled against.
	vi.useFakeTimers();
	onTestFinished(() => {
		vi.useRealTimers();
	});
	await pressTarget(press);
	expect(press.getAttribute('aria-disabled')).toBe('true');

	// no cookie ever lands: the file was refused by something outside this app, the request was
	// dropped, the operator cancelled the download. a minute is longer than the hold, which is
	// what this reads rather than the figure itself.
	await act(async () => {
		await vi.advanceTimersByTimeAsync(60_000);
	});

	expect(press.getAttribute('aria-disabled')).toBeNull();
});

it('leaves the browser nothing to bubble over the page', () => {
	const { root } = screen();

	// the form's own `noValidate`, which is what stops the browser drawing its tooltip in front of
	// the screen. every refusal here is drawn under the box it is about instead.
	expect(root.querySelector('form')?.noValidate).toBe(true);
});

it('refuses a press made over two empty boxes, at each box, and sends nothing', async () => {
	const { root } = screen();

	const pressed = await pressTarget(pressNamed(root, 'QuickBooks Online'));

	expect(refusalAt(root, 'from')).toBe('required');
	expect(refusalAt(root, 'to')).toBe('required');
	expect(pressed.allowed).toBe(false);
});

it('refuses a press over half a range at the end that is missing, and nowhere else', async () => {
	const { root } = screen();

	await typeDay(root, 'from', '2026-03-01');
	const pressed = await pressTarget(pressNamed(root, 'Xero'));

	expect(refusalAt(root, 'from')).toBeNull();
	expect(refusalAt(root, 'to')).toBe('required');
	expect(pressed.allowed).toBe(false);
});

it('refuses a range written backwards at the far end, before it reaches the file', async () => {
	const { root } = screen();

	const pressed = await exportRange(
		root,
		'2026-03-31',
		'2026-03-01',
		pressNamed(root, 'QuickBooks Online')
	);

	expect(refusalAt(root, 'from')).toBeNull();
	expect(refusalAt(root, 'to')).toBe(RANGE_REVERSED);
	// the box that is wrong is the one marked, and it is the box the operator types in rather than
	// the one the day is carried in — the mark is what a reader is told about on arriving in it.
	expect(dayBox(root, 'to').getAttribute('aria-invalid')).toBe('true');
	expect(dayBox(root, 'to').getAttribute('aria-describedby')).toContain(
		`${carrier(root, 'to').id}-err`
	);
	expect(dayBox(root, 'from').getAttribute('aria-invalid')).toBeNull();
	// under the far end rather than at the range it is about: the near day is a day the calendar
	// has, and the far one is the end read against it. the group's own message row stays unused.
	expect(rangeGroup(root).querySelector(':scope > .adm-field__error')).toBeNull();
	expect(pressed.allowed).toBe(false);
});

it('takes the two ends of one day, which is a range', async () => {
	const { root } = screen();

	const pressed = await exportRange(root, '2026-03-01', '2026-03-01', pressNamed(root, 'Xero'));

	expect(refusalAt(root, 'to')).toBeNull();
	expect(pressed.allowed).toBe(true);
});

it('says nothing about a box nobody has pressed over yet', async () => {
	const { root } = screen();

	// the near day typed and the far one still blank, which is every range mid-way through being
	// filled in. nobody has finished, so nobody is told they are wrong.
	await typeDay(root, 'from', '2026-03-01');

	expect(refusalAt(root, 'from')).toBeNull();
	expect(refusalAt(root, 'to')).toBeNull();
});

it('clears a refusal as the box it is about is typed in, and keeps the other', async () => {
	const { root } = screen();
	await pressTarget(pressNamed(root, 'Xero'));

	await typeDay(root, 'from', '2026-03-01');

	// told once and then helped: the press is what marked these, and after it a box re-checks on
	// every keystroke rather than making the operator press again to learn whether the fix took.
	expect(refusalAt(root, 'from')).toBeNull();
	expect(refusalAt(root, 'to')).toBe('required');
});

it('says nothing was posted over a range the books hold nothing in', () => {
	const { root } = screen({
		search: '?from=2026-03-01&to=2026-03-31&target=quickbooks&problem=nothing_posted'
	});

	expect(describing(root, pressNamed(root, 'QuickBooks Online'))?.textContent).toContain(
		'Nothing was posted'
	);
});

it('says a range holding more than one file’s worth is too long, at the press that asked', () => {
	const { root } = screen({
		search: '?from=2026-01-01&to=2026-12-31&target=xero&problem=too_many_rows'
	});

	const sentence = describing(root, pressNamed(root, 'Xero'));
	// the package by its own name, because the cap is that package's and not this deployment's.
	expect(sentence?.textContent).toContain('Xero');
	expect(sentence?.textContent).toContain('shorter range');
});

it('says a range holding more than one currency holds more than one', () => {
	const { root } = screen({
		search: '?from=2026-03-01&to=2026-03-31&target=quickbooks&problem=mixed_currency'
	});

	expect(describing(root, pressNamed(root, 'QuickBooks Online'))?.textContent).toContain(
		'more than one currency'
	);
});

it('draws a refusal beside the press that asked and nowhere else', () => {
	const { root } = screen({
		search: '?from=2026-03-01&to=2026-03-31&target=xero&problem=nothing_posted'
	});

	// an answer about the other package is an answer about a file this press never asked for, and
	// the row holds both presses now — so the one sentence on the screen is the refused press's.
	expect(describing(root, pressNamed(root, 'QuickBooks Online'))).toBeNull();
	expect(sentences(root).map((sentence) => sentence.textContent)).toEqual([
		'Nothing was posted to the books between those two days.'
	]);
	expect(describing(root, pressNamed(root, 'Xero'))?.textContent).toContain('Nothing was posted');
});

it('moves focus nowhere on a first render carrying a refusal', () => {
	const { root } = screen({
		search: '?from=2026-03-01&to=2026-03-31&target=xero&problem=nothing_posted'
	});

	// an address holding a refusal is one that can be pasted, bookmarked or restored, and the
	// operator who opens it pressed nothing — taking focus off the document there is an answer to
	// a question nobody asked. the sentence is drawn all the same, and the press points at it.
	expect(document.activeElement).toBe(document.body);
	expect(describing(root, pressNamed(root, 'Xero'))).not.toBeNull();
});

it('puts the reader on the press a refusal came back from', () => {
	const token = '019fb400-0000-7000-8000-0000000000aa';
	// the cookie the journal route sent with the redirect, which only the browser that pressed gets.
	answeredPress(token);

	const { root } = screen({
		search: `?from=2026-03-01&to=2026-03-31&target=xero&problem=nothing_posted&press=${token}`
	});

	// the press is what asked, what the reason is about and what they press again once the range is
	// changed — and a fresh document otherwise lands them at the top of a page they did not ask for.
	expect(document.activeElement).toBe(pressNamed(root, 'Xero'));
});

it('moves focus nowhere for a press this browser never made', () => {
	const token = '019fb400-0000-7000-8000-0000000000aa';

	const { root } = screen({
		search: `?from=2026-03-01&to=2026-03-31&target=xero&problem=nothing_posted&press=${token}`
	});

	// the same address, pasted: the token rides on it and says nothing, because an address is
	// handed about and the cookie is not.
	expect(document.activeElement).toBe(document.body);
	expect(describing(root, pressNamed(root, 'Xero'))).not.toBeNull();
});

it('puts the reader on the press when a refusal arrives under an open screen', async () => {
	const { root } = screen({ search: '?from=2026-03-01&to=2026-03-31&target=xero' });

	await goTo(root, 'refused elsewhere');

	// arriving rather than standing there: the reason is beside a press the reader is not on, and
	// `aria-describedby` reads it out with that press's own name the moment it takes focus.
	expect(document.activeElement).toBe(pressNamed(root, 'Xero'));
});

it('describes the refused press by the sentence beside it', () => {
	const { root } = screen({
		search: '?from=2026-03-01&to=2026-03-31&target=xero&problem=nothing_posted'
	});

	const press = pressNamed(root, 'Xero');
	// the name and the reason arrive together on focus, which is what makes a live region
	// unnecessary here rather than merely absent.
	expect(describing(root, press)?.textContent).toBe(
		'Nothing was posted to the books between those two days.'
	);
});

it('describes the press nobody was refused at by nothing at all', () => {
	const { root } = screen({
		search: '?from=2026-03-01&to=2026-03-31&target=xero&problem=nothing_posted'
	});

	// its own sentence is empty, and a description that is the empty string is a description
	// announced as nothing.
	expect(pressNamed(root, 'QuickBooks Online').getAttribute('aria-describedby')).toBeNull();
});

it('drops a refusal as the near end of the range is written in', async () => {
	const { root } = screen({
		search: '?from=2026-03-01&to=2026-03-31&target=xero&problem=nothing_posted'
	});

	await typeDay(root, 'from', '2026-03-10');

	// the refusal belongs to the range that produced it, and that range is no longer in the boxes.
	// every other refusal on this screen clears as the box it is about is typed in.
	expect(sentences(root)).toEqual([]);
	expect(pressNamed(root, 'Xero').getAttribute('aria-describedby')).toBeNull();
});

it('drops a refusal as the far end of the range is written in', async () => {
	const { root } = screen({
		search: '?from=2026-03-01&to=2026-03-31&target=xero&problem=too_many_rows'
	});

	await typeDay(root, 'to', '2026-03-10');

	expect(sentences(root)).toEqual([]);
	expect(pressNamed(root, 'Xero').getAttribute('aria-describedby')).toBeNull();
});

it('moves focus nowhere on a load carrying no refusal', () => {
	const { root } = screen({ search: '?from=2026-03-01&to=2026-03-31&target=xero' });

	expect(document.activeElement).toBe(document.body);
	for (const press of presses(root)) {
		expect(press.getAttribute('aria-describedby')).toBeNull();
	}
});

it('names the two packages’ sentences apart, so neither press can point at the other’s', () => {
	const days = '?from=2026-03-01&to=2026-03-31';
	const onXero = screen({ search: `${days}&target=xero&problem=nothing_posted` });
	const onQuickBooks = screen({ search: `${days}&target=quickbooks&problem=nothing_posted` });

	const named = [
		describing(onXero.root, pressNamed(onXero.root, 'Xero'))?.id,
		describing(onQuickBooks.root, pressNamed(onQuickBooks.root, 'QuickBooks Online'))?.id
	];
	expect(new Set(named).size).toBe(2);
	expect(named.every((id) => id !== undefined && id !== '')).toBe(true);
});

it('says nothing about a problem the address does not name', () => {
	const { root } = screen({ search: '?from=2026-03-01&to=2026-03-31&target=xero' });

	expect(sentences(root)).toEqual([]);
	expect(describing(root, pressNamed(root, 'Xero'))).toBeNull();
});

it('keeps the boxes holding the range a refusal came back over', () => {
	const { root } = screen({
		search: '?from=2026-03-01&to=2026-03-31&target=xero&problem=nothing_posted'
	});

	// in both: the day the form would carry, and the same text standing in the box it is read and
	// corrected in.
	expect(carrier(root, 'from').value).toBe('2026-03-01');
	expect(carrier(root, 'to').value).toBe('2026-03-31');
	expect(written(root, 'from')).toBe('2026-03-01');
	expect(written(root, 'to')).toBe('2026-03-31');
});

it('hands a seeded range to the browser with no box touched', async () => {
	const { root } = screen({ search: '?from=2026-03-01&to=2026-03-31&target=xero' });

	const pressed = await pressTarget(pressNamed(root, 'Xero'));

	// a range reached over an address and pressed on unchanged is the range that is asked for: the
	// seed reaches the control the body is built from, and not only the box it is drawn in.
	expect(pressed.allowed).toBe(true);
	expect(pressed.body.get('from')).toBe('2026-03-01');
	expect(pressed.body.get('to')).toBe('2026-03-31');
});

it('re-seeds the boxes from the range the address holds, however it was arrived at', async () => {
	const { root } = screen({ search: '?from=2026-03-01&to=2026-03-31&target=quickbooks' });

	// typed over, which is what a box keeps across a load that does not remount it — and this form
	// never unmounts.
	await typeDay(root, 'from', '2026-05-05');
	const elsewhere = root.querySelector('a');
	if (elsewhere === null) throw new Error('the frame drew no link to another range');
	await act(async () => {
		elsewhere.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	});

	expect(carrier(root, 'from').value).toBe('2026-04-01');
	expect(carrier(root, 'to').value).toBe('2026-04-30');
	expect(written(root, 'from')).toBe('2026-04-01');
});

it('names itself once, at the rank the frame leaves free', () => {
	const { root } = screen();

	// the frame draws the trail in its top strip for a screen stating one and no heading at all
	// (../routes/_app.tsx), so the page's own `h1` is this screen's to draw.
	expect(
		[...root.querySelectorAll('h1, h2, h3')].map((held) => [held.tagName, held.textContent])
	).toEqual([['H1', 'Export']]);
});

it('says the one thing about an export the screen cannot show', () => {
	const { root } = screen();

	// what a second export of the same days does is not visible anywhere here: no file, no range
	// and no press on this screen carries a trace of the one before it.
	const standing = [...root.querySelectorAll('p.adm-standfirst')].map((words) => words.textContent);
	expect(standing).toHaveLength(1);
	expect(standing[0]).toContain('the same entries twice');
	// and nothing else stands: the only other `p` is the row of presses' own name, which is a
	// label rather than a sentence about the screen.
	expect([...root.querySelectorAll('p')].map((words) => words.className)).toEqual([
		'adm-standfirst',
		'adm-caption'
	]);
});
