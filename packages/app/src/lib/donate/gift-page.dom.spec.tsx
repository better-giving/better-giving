import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useActionData } from 'react-router';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { matchStatus } from '../matching/status';
import { type FilingDetails, filingDetailsText, type GiftPageView } from '../server/matching/views';
import * as copy from './copy';
import { GiftPage, type GiftPageResult } from './gift-page';

// a donor's page for one gift, as the donor meets it: which cards stand for which stamps, what the
// details say and what Copy details writes, and what each post sends. the view is built the way
// `readGiftPage` in $lib/server/matching/views.ts builds it, its copied text by the same function.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORG = 'Greenfield Food Bank';
const EMPLOYER = 'Northwind Logistics';
const ADDRESS = '1250 Mill Street, Suite 200, Cincinnati, OH 45202, United States';

const FILING: FilingDetails = {
	nonprofit: 'Greenfield Community Food Bank and Family Resource Network of Hamilton County, Inc.',
	ein: '84-2761093',
	mailingAddress: ADDRESS,
	amountMinor: 15000,
	givenMinor: 15000,
	currency: 'USD',
	givenAt: new Date('2026-11-12T15:00:00Z'),
	receiptSentAt: new Date('2026-11-12T15:01:00Z'),
	receiptEmail: 'maya.reyes@example.com'
};

type Stamps = {
	employer?: string | null;
	packSentAt?: Date | null;
	reminderDueAt?: Date | null;
	remindedAt?: Date | null;
	filedAt?: Date | null;
	matchedAt?: Date | null;
	voidedAt?: Date | null;
	refundedAt?: Date | null;
	filing?: Partial<FilingDetails>;
};

function view(stamps: Stamps = {}): GiftPageView {
	const filing = { ...FILING, ...stamps.filing };
	const row = {
		employer: stamps.employer ?? null,
		packSentAt: stamps.packSentAt ?? null,
		packFailedAt: null,
		remindedAt: stamps.remindedAt ?? null,
		filedAt: stamps.filedAt ?? null,
		matchedAt: stamps.matchedAt ?? null,
		voidedAt: stamps.voidedAt ?? null
	};
	return {
		...row,
		filing,
		copyText: filingDetailsText(filing),
		status: matchStatus(row),
		reminderDueAt: stamps.reminderDueAt ?? null,
		reminderPromised: (stamps.reminderDueAt ?? null) !== null,
		refundedAt: stamps.refundedAt ?? null
	};
}

const NAMED: Stamps = {
	employer: EMPLOYER,
	packSentAt: new Date('2026-11-12T15:02:00Z'),
	reminderDueAt: new Date('2026-11-15T15:02:00Z')
};

async function mount(tree: ReactNode): Promise<HTMLElement> {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	await act(async () => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

/** the page at its own address, with every post it makes recorded as the fields it sent. */
async function page(gift: GiftPageView, result?: GiftPageResult) {
	const posts: Record<string, string>[] = [];
	const Stub = createRoutesStub([
		{
			path: '/gift/:token',
			Component: () => (
				<GiftPage
					orgName={ORG}
					logo={null}
					look={{ brandColour: null }}
					gift={gift}
					result={result}
				/>
			),
			action: async ({ request }) => {
				const fields = await request.formData();
				posts.push(Object.fromEntries([...fields].map(([key, value]) => [key, String(value)])));
				return null;
			}
		}
	]);
	const root = await mount(<Stub initialEntries={['/gift/tok_1']} />);
	return { root, posts };
}

/**
 * the page as the route mounts it, `result` the action's own answer: each post is recorded, held
 * until `release` lets it answer, and answered with `answer`.
 */
async function answering(gift: GiftPageView, answer: GiftPageResult) {
	const posts: Record<string, string>[] = [];
	let release = () => {};
	const Stub = createRoutesStub([
		{
			path: '/gift/:token',
			Component: function Mounted() {
				const result = useActionData() as GiftPageResult | undefined;
				return (
					<GiftPage
						orgName={ORG}
						logo={null}
						look={{ brandColour: null }}
						gift={gift}
						result={result}
					/>
				);
			},
			action: async ({ request }) => {
				const fields = await request.formData();
				posts.push(Object.fromEntries([...fields].map(([key, value]) => [key, String(value)])));
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				return answer;
			}
		}
	]);
	const root = await mount(<Stub initialEntries={['/gift/tok_1']} />);
	return { root, posts, release: () => release() };
}

/**
 * the page with a loader that answers its first read at once and holds every later one until
 * `reload` lets it go, so a case can press while a post's answer is still landing.
 */
async function reloading(gift: GiftPageView) {
	const posts: Record<string, string>[] = [];
	let reads = 0;
	let reload = () => {};
	const Stub = createRoutesStub([
		{
			path: '/gift/:token',
			Component: () => (
				<GiftPage orgName={ORG} logo={null} look={{ brandColour: null }} gift={gift} />
			),
			loader: async () => {
				reads += 1;
				if (reads > 1) {
					await new Promise<void>((resolve) => {
						reload = resolve;
					});
				}
				return null;
			},
			action: async ({ request }) => {
				const fields = await request.formData();
				posts.push(Object.fromEntries([...fields].map(([key, value]) => [key, String(value)])));
				return null;
			}
		}
	]);
	const root = await mount(<Stub initialEntries={['/gift/tok_1']} />);
	return { root, posts, reload: () => reload() };
}

/** the cards the page stands, by their headings. */
function cards(root: HTMLElement): string[] {
	return [...root.querySelectorAll('h2')].map((heading) => heading.textContent ?? '');
}

function button(root: HTMLElement, words: string): HTMLButtonElement {
	const found = [...root.querySelectorAll('button')].find((node) => node.textContent === words);
	if (found === undefined) throw new Error(`no ${words} button`);
	return found;
}

/** the details as rows of label and value. */
function rows(root: HTMLElement): [string, string][] {
	return [...root.querySelectorAll('dl > div')].map((row) => [
		row.querySelector('dt')?.textContent ?? '',
		row.querySelector('dd')?.textContent ?? ''
	]);
}

function type(box: HTMLInputElement, value: string): void {
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, value);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

async function press(node: HTMLElement): Promise<void> {
	await act(async () => {
		node.click();
		for (let at = 0; at < 20; at += 1) await Promise.resolve();
	});
}

describe('the cards a gift’s stamps stand', () => {
	it('stands the details, the employer box and the filed press on a gift nobody has acted on', async () => {
		const { root } = await page(view());

		expect(root.querySelector('h1')?.textContent).toBe(copy.GIFT_HEADING);
		expect(cards(root)).toEqual([copy.FILING_HEADING, copy.EMPLOYER_HEADING, copy.FILED_HEADING]);
		expect(rows(root)).toEqual([
			['Nonprofit', FILING.nonprofit],
			['EIN', '84-2761093'],
			['Mailing address', ADDRESS],
			['Gift amount', '$150.00'],
			['Gift date', 'November 12, 2026'],
			['Receipt', 'Emailed to maya.reyes@example.com on November 12, 2026']
		]);
		expect(root.textContent).toContain('$150.00 on November 12, 2026');
	});

	it('states one figure where nothing was refunded', async () => {
		const { root } = await page(view());

		expect(rows(root)).toContainEqual(['Gift amount', '$150.00']);
		expect(root.querySelector('.gift-sum')?.textContent).toBe('$150.00 on November 12, 2026');
		expect(root.textContent).not.toContain('after refunds');
	});

	it('states what is left beside what was given after a partial refund, as the copied details do', async () => {
		const partial = view({ filing: { amountMinor: 10000 } });
		const { root } = await page(partial);

		expect(rows(root)).toContainEqual(['Gift amount', '$100.00 after refunds, of $150.00 given']);
		expect(root.querySelector('.gift-sum')?.textContent).toBe(
			'$100.00 after refunds, of $150.00 given on November 12, 2026'
		);
		expect(partial.copyText).toContain(
			'Gift amount: USD 100.00 after refunds, of USD 150.00 given'
		);
	});

	it('hides the details, the employer and the filed card on a refunded gift', async () => {
		const { root } = await page(
			view({
				...NAMED,
				voidedAt: new Date('2026-11-20T10:00:00Z'),
				refundedAt: new Date('2026-11-20T10:00:00Z')
			})
		);

		expect(cards(root)).toEqual([copy.GIFT_REFUNDED_TITLE]);
		expect(root.querySelector('dl')).toBeNull();
		expect(root.querySelector('form')).toBeNull();
		expect(root.textContent).toContain(copy.giftRefundedBody(ORG, 'November 20, 2026'));
		expect(root.querySelector('.ds-badge')?.textContent).toBe(copy.GIFT_REFUNDED_BADGE);
	});

	it('states what was given on a gift refunded whole, beside the badge', async () => {
		const { root } = await page(
			view({ filing: { amountMinor: 0 }, refundedAt: new Date('2026-11-20T10:00:00Z') })
		);

		expect(root.querySelector('.gift-sum > span')?.textContent).toBe(
			'$150.00 on November 12, 2026'
		);
		expect(root.textContent).not.toContain('after refunds');
	});

	it('keeps the details on a voided gift and hides the employer and the filed card', async () => {
		const { root } = await page(view({ ...NAMED, voidedAt: new Date('2026-11-18T10:00:00Z') }));

		expect(cards(root)).toEqual([copy.GIFT_CLOSED_TITLE, copy.FILING_HEADING]);
		expect(root.querySelector('form')).toBeNull();
		expect(root.textContent).toContain(copy.giftClosedBody(ORG));
		expect(root.textContent).not.toContain(EMPLOYER);
	});

	it('draws no void reason, whatever reaches it beside the view', async () => {
		const reason = 'Duplicate of a gift already matched';
		const leaked = { ...view({ voidedAt: new Date('2026-11-18T10:00:00Z') }), voidReason: reason };
		const { root } = await page(leaked);

		expect(root.innerHTML).not.toContain(reason);
	});

	it('names no employer on any state where none was named', async () => {
		for (const stamps of [
			{},
			{ filedAt: new Date('2026-11-16T10:00:00Z') },
			{ matchedAt: new Date('2026-11-25T10:00:00Z') },
			{ voidedAt: new Date('2026-11-18T10:00:00Z') }
		]) {
			const { root } = await page(view(stamps));
			expect(root.innerHTML).not.toContain(EMPLOYER);
			expect(root.querySelector('.gift-employer')).toBeNull();
		}
	});

	it('says the press on a filed gift as a status row, with the employer still named', async () => {
		const { root } = await page(view({ ...NAMED, filedAt: new Date('2026-11-16T10:00:00Z') }));

		expect(cards(root)).toEqual([copy.FILING_HEADING, copy.EMPLOYER_HEADING]);
		const row = root.querySelector('[role="status"].gift-done');
		expect(row?.textContent).toBe(`${copy.markedFiled('November 16, 2026')}${copy.orgCanSee(ORG)}`);
		expect(root.querySelector('form')).toBeNull();
		// the reminder is not coming once the gift is filed, and the name is no longer changed here.
		expect(root.textContent).toContain(copy.employerEmailed('November 12', null));
		expect([...root.querySelectorAll('button')].map((node) => node.textContent)).toEqual([
			copy.COPY_DETAILS
		]);
	});

	it('draws no employer box on a gift matched with nobody named', async () => {
		const { root } = await page(view({ matchedAt: new Date('2026-11-25T10:00:00Z') }));

		expect(cards(root)).toEqual([copy.FILING_HEADING]);
		expect(root.querySelector('input[name="employer"]')).toBeNull();
		expect(root.querySelector('[role="status"].gift-done')?.textContent).toBe(
			copy.matchArrived(null, 'November 25, 2026')
		);
	});

	it('says a match arrived in the filed row’s place', async () => {
		const { root } = await page(view({ ...NAMED, matchedAt: new Date('2026-11-25T10:00:00Z') }));

		expect(root.querySelector('[role="status"].gift-done')?.textContent).toBe(
			copy.matchArrived(EMPLOYER, 'November 25, 2026')
		);
		expect(root.querySelector('form')).toBeNull();
	});
});

describe('the details', () => {
	it('sets the EIN in the code face and the amount in the text face', async () => {
		const { root } = await page(view());
		const value = (label: string) =>
			[...root.querySelectorAll('dl > div')]
				.find((row) => row.querySelector('dt')?.textContent === label)
				?.querySelector('dd');

		expect(value('EIN')?.className).toBe('gift-mono');
		expect(value('Gift amount')?.className).toBe('');
		expect(root.querySelector('.page-profile-ein-number')?.textContent).toBe('84-2761093');
		expect(root.querySelector('.gift-sum')?.querySelector('.gift-mono')).toBeNull();
	});

	it('leaves a profile with no mailing address out of the rows and out of the copied text', async () => {
		const writes: string[] = [];
		vi.stubGlobal('navigator', {
			...navigator,
			clipboard: { writeText: async (text: string) => void writes.push(text) }
		});
		const { root } = await page(view({ filing: { mailingAddress: null } }));

		expect(rows(root).map(([label]) => label)).not.toContain('Mailing address');
		await press(button(root, copy.COPY_DETAILS));
		expect(writes).toHaveLength(1);
		expect(writes[0]).not.toContain('Mailing address');
		expect(writes[0]).toContain(`Nonprofit: ${FILING.nonprofit}`);
	});

	it('says Copied in a region on the page from its first paint', async () => {
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => {} } });
		const { root } = await page(view());
		const region = root.querySelector('.gift-card [role="status"]');
		expect(region?.textContent).toBe('');

		await press(button(root, copy.COPY_DETAILS));

		expect(root.querySelector('.gift-card [role="status"]')).toBe(region);
		expect(region?.textContent).toBe(copy.DETAILS_COPIED);
		// the press says it too, where a sighted donor's eye is.
		expect(button(root, copy.DETAILS_COPIED)).toBeDefined();
	});

	it('says a copy the browser refused', async () => {
		vi.stubGlobal('navigator', {
			...navigator,
			clipboard: { writeText: async () => Promise.reject(new Error('denied')) }
		});
		const { root } = await page(view());

		await press(button(root, copy.COPY_DETAILS));

		expect(root.querySelector('.gift-card [role="status"]')?.textContent).toBe(
			copy.DETAILS_NOT_COPIED
		);
		expect(button(root, copy.DETAILS_NOT_COPIED)).toBeDefined();
		expect(() => button(root, copy.COPY_DETAILS)).toThrow();
	});
});

describe('the posts', () => {
	function box(root: HTMLElement): HTMLInputElement {
		const found = root.querySelector('input[name="employer"]');
		if (!(found instanceof HTMLInputElement)) throw new Error('no employer box');
		return found;
	}

	it('refuses Save employer on a blank box under the box, with the caret in it, posting nothing', async () => {
		const { root, posts } = await page(view());
		const save = button(root, copy.SAVE_EMPLOYER);

		// muted while blank, by the registry's `button.ds-btn[aria-disabled="true"]`, and pressable.
		expect(save.getAttribute('aria-disabled')).toBe('true');
		expect(save.hasAttribute('disabled')).toBe(false);
		expect(save.className).toBe('ds-btn ds-btn-primary');
		expect(root.querySelector('.ds-field-err')).toBeNull();
		type(box(root), '   ');
		expect(save.getAttribute('aria-disabled')).toBe('true');
		await press(save);

		expect(posts).toEqual([]);
		const refusal = root.querySelector('.ds-field-err');
		expect(refusal?.textContent).toBe(copy.EMPLOYER_BLANK);
		expect(box(root).getAttribute('aria-describedby')?.split(' ')).toContain(refusal?.id);
		expect(box(root).getAttribute('aria-invalid')).toBe('true');
		expect(document.activeElement).toBe(box(root));

		// a name clears it as it is typed.
		type(box(root), EMPLOYER);
		expect(root.querySelector('.ds-field-err')).toBeNull();
		expect(box(root).hasAttribute('aria-invalid')).toBe(false);
		expect(save.hasAttribute('aria-disabled')).toBe(false);
	});

	it('posts the filed press once while its answer is still landing', async () => {
		const { root, posts, reload } = await reloading(view());

		await press(button(root, copy.MARK_FILED));
		expect(button(root, copy.MARK_FILED).getAttribute('aria-busy')).toBe('true');
		await press(button(root, copy.MARK_FILED));
		expect(posts).toEqual([{ intent: 'filed' }]);

		await act(async () => {
			reload();
			for (let at = 0; at < 20; at += 1) await Promise.resolve();
		});
		expect(button(root, copy.MARK_FILED).hasAttribute('aria-busy')).toBe(false);
	});

	it('posts once for two presses in one tick', async () => {
		const { root, posts } = await reloading(view());
		const filed = button(root, copy.MARK_FILED);

		await act(async () => {
			filed.form?.requestSubmit(filed);
			filed.form?.requestSubmit(filed);
			for (let at = 0; at < 20; at += 1) await Promise.resolve();
		});

		expect(posts).toEqual([{ intent: 'filed' }]);
	});

	it('posts the employer under its intent, and nothing else', async () => {
		const { root, posts } = await page(view());

		type(box(root), EMPLOYER);
		const save = button(root, copy.SAVE_EMPLOYER);
		expect(save.hasAttribute('aria-disabled')).toBe(false);
		await press(save);

		expect(posts).toEqual([{ intent: 'employer', employer: EMPLOYER }]);
	});

	it('posts the filed press as its intent alone', async () => {
		const { root, posts } = await page(view());

		await press(button(root, copy.MARK_FILED));

		expect(posts).toEqual([{ intent: 'filed' }]);
	});

	it('opens the box over a named employer on Change, holding the name, with the caret in it', async () => {
		const { root, posts } = await page(view(NAMED));
		expect(root.querySelector('.gift-employer')?.textContent).toContain(EMPLOYER);
		expect(root.textContent).toContain(copy.employerEmailed('November 12', 'November 15'));

		await press(button(root, copy.CHANGE_EMPLOYER));

		expect(box(root).value).toBe(EMPLOYER);
		expect(document.activeElement).toBe(box(root));
		type(box(root), 'Contoso');
		await press(button(root, copy.SAVE_EMPLOYER));
		expect(posts).toEqual([{ intent: 'employer', employer: 'Contoso' }]);
	});

	it.each([
		['Save employer', copy.SAVE_EMPLOYER, { done: 'employer' }],
		['I’ve filed it', copy.MARK_FILED, { done: 'filed' }]
	] as const)(
		'holds %s while its post is in flight, and sends one post for two presses',
		async (_, words, answer) => {
			const { root, posts, release } = await answering(view(), answer);
			if (words === copy.SAVE_EMPLOYER) type(box(root), EMPLOYER);
			const pressed = button(root, words);

			await press(pressed);
			expect(pressed.getAttribute('aria-busy')).toBe('true');
			expect(pressed.getAttribute('aria-disabled')).toBe('true');
			await press(pressed);
			expect(posts).toHaveLength(1);

			await act(async () => {
				release();
				for (let at = 0; at < 20; at += 1) await Promise.resolve();
			});
		}
	);

	it('closes the box on Cancel over the saved name, posting nothing, with the caret back on Change', async () => {
		const { root, posts } = await page(view(NAMED));

		await press(button(root, copy.CHANGE_EMPLOYER));
		type(box(root), 'Contoso');
		await press(button(root, copy.CANCEL_EMPLOYER));

		expect(root.querySelector('input[name="employer"]')).toBeNull();
		expect(root.querySelector('.gift-employer-name')?.textContent).toBe(EMPLOYER);
		expect(document.activeElement).toBe(button(root, copy.CHANGE_EMPLOYER));
		expect(posts).toEqual([]);
	});

	it('offers no Cancel where nobody is named yet', async () => {
		const { root } = await page(view());

		expect(() => button(root, copy.CANCEL_EMPLOYER)).toThrow();
	});

	it('closes the box on a save of the same name, says it saved, and puts the caret on the name', async () => {
		const { root, posts, release } = await answering(view(NAMED), { done: 'employer' });

		await press(button(root, copy.CHANGE_EMPLOYER));
		await press(button(root, copy.SAVE_EMPLOYER));
		await act(async () => {
			release();
			for (let at = 0; at < 20; at += 1) await Promise.resolve();
		});

		expect(posts).toEqual([{ intent: 'employer', employer: EMPLOYER }]);
		expect(root.querySelector('input[name="employer"]')).toBeNull();
		const shown = root.querySelector('.gift-employer');
		expect(document.activeElement).toBe(shown);
		expect(shown?.textContent).toContain(copy.EMPLOYER_SAVED);
	});

	it('puts the caret on the row a filed post landed on', async () => {
		const { root } = await page(view({ filedAt: new Date('2026-11-16T10:00:00Z') }), {
			done: 'filed'
		});

		expect(document.activeElement).toBe(root.querySelector('.gift-done'));
	});

	it('states a refused employer under the box, tied to it, with the caret in it', async () => {
		const error = 'Name your employer in 200 characters or fewer.';
		const { root } = await page(view(), { intent: 'employer', error });
		const refusal = root.querySelector('.ds-field-err');

		expect(refusal?.textContent).toBe(error);
		expect(box(root).getAttribute('aria-describedby')?.split(' ')).toContain(refusal?.id);
		expect(box(root).getAttribute('aria-invalid')).toBe('true');
		expect(document.activeElement).toBe(box(root));
	});

	it('states a refused filed press at the press', async () => {
		const error = 'That didn’t save. Try again.';
		const { root } = await page(view(), { intent: 'filed', error });
		const refusal = root.querySelector('.gift-refusal');

		expect(refusal?.textContent).toBe(error);
		expect(button(root, copy.MARK_FILED).getAttribute('aria-describedby')).toBe(refusal?.id);
	});
});
