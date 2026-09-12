import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import RecurringGift from './_app.admin.recurring.$id';

// every sentence on this screen that names a processor, drawn.
//
// what it covers: the copy the page composes rather than the loader, which is invisible to
// ./_app.admin.recurring.$id.workers.spec.ts — that file reads the json a loader publishes, and the
// term over the subscription id, the landing banner and the confirmation's consequence are built
// in the component out of it. a screen that named Stripe over a gift PayPal collected would ship
// with every workers case green.
//
// the claim under all of them is one: a sentence names the processor this commitment's own row
// carries, or it names none. so each case asserts both processors rather than one — a hard-coded
// name passes half of a pair and fails the other.
//
// it is not the browser spec CLAUDE.md bans over a dashboard screen: nothing here reads a computed
// style or a class. what is asserted is which words are on the page.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

type Loaded = Parameters<typeof RecurringGift>[0]['loaderData'];

const PLAN_ID = '019fb700-0000-7000-8000-000000000002';

/** the commitment as the loader hands it over: collecting, on Stripe, with nothing just landed. */
function commitment(over: Partial<Loaded> = {}): Loaded {
	return {
		id: PLAN_ID,
		donorName: 'Ada Okafor',
		donorEmail: 'ada@example.org',
		amount: '$123.45',
		interval: 'monthly',
		status: 'active',
		startedOn: '2026-06-01',
		nextChargeOn: '2026-09-04',
		endedOn: null,
		formId: 'frm_recurringdetail1',
		formName: 'Spring appeal',
		processor: 'Stripe',
		subscriptionId: 'sub_detailtest1',
		stopLanded: null,
		confirmStop: false,
		...over
	};
}

/**
 * the screen, drawn over one commitment.
 *
 * inside a `createRoutesStub` because the page holds a `Form` and two `Link`s and reads
 * `useNavigation`, none of which exist outside a router. the action never settles, so a press that
 * reached it would leave the screen mid-flight rather than re-rendering over the evidence — no case
 * here presses, and it is the shape ./_app.admin.forms.new.dom.spec.tsx states.
 */
function screen(loaded: Loaded = commitment()): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/recurring/:id',
			Component: () =>
				createElement(RecurringGift as never, {
					loaderData: loaded,
					actionData: undefined,
					params: { id: PLAN_ID },
					matches: []
				}),
			action: () => new Promise<never>(() => {})
		}
	]);
	return mount(createElement(Stub, { initialEntries: [`/admin/recurring/${PLAN_ID}`] }));
}

/** every word on the page, which is what a sentence is asserted against. */
function words(root: HTMLElement): string {
	return root.textContent ?? '';
}

/** the terms of the record's definition list, which is where the subscription row is named. */
function terms(root: HTMLElement): string[] {
	return [...root.querySelectorAll('dt')].map((dt) => dt.textContent ?? '');
}

it('names the processor holding the subscription in the term over its id', () => {
	// both call the object a subscription, so the word stays and the account it lives in is what
	// changes — which is the whole of what this row is for.
	expect(terms(screen())).toContain('Stripe subscription');
	expect(terms(screen(commitment({ processor: 'PayPal' })))).toContain('PayPal subscription');
});

it('draws no subscription row for a commitment no processor answers for', () => {
	// an id in no account an operator can open sends them nowhere, so the row is not written rather
	// than headed by a word pointing at nothing.
	const root = screen(commitment({ processor: null }));
	expect(terms(root).some((term) => term.includes('subscription'))).toBe(false);
	expect(words(root)).not.toContain('sub_detailtest1');
});

it('says which processor held no subscription, on the landing that cancelled nothing', () => {
	// the landing an operator reaches by cancelling in the processor's own dashboard first. naming
	// the other processor tells them a story about an account they hold nothing on.
	const landed = { stopLanded: 'nothing-to-stop' as const, status: 'cancelled' as const };
	expect(words(screen(commitment(landed)))).toContain(
		'Stripe had no subscription with this id, so nothing was collecting'
	);
	const paypal = words(screen(commitment({ ...landed, processor: 'PayPal' })));
	expect(paypal).toContain('PayPal had no subscription with this id');
	expect(paypal).not.toContain('Stripe');
});

it('ends both landings on the donor not having been told', () => {
	// the one fact nothing else on the landing states, and it belongs to this product rather than
	// to any processor — so it is the same sentence whichever one collected.
	for (const stopLanded of ['stopped', 'nothing-to-stop'] as const) {
		const root = screen(commitment({ stopLanded, status: 'cancelled' }));
		expect(words(root)).toContain('Nothing here has told Ada Okafor');
	}
});

it('states what stopping costs in the words the commitment’s processor is named in', () => {
	// the consequence sentence inside the confirmation, which is where an operator is about to
	// press. a lapsed commitment is told apart because nothing is collecting it now and `revives`
	// can start it again — the reason to press at all.
	const asking = { confirmStop: true };
	expect(words(screen(commitment(asking)))).toContain('Stripe stops collecting it straight away.');

	const lapsed = words(
		screen(commitment({ ...asking, status: 'lapsed', processor: 'PayPal', nextChargeOn: null }))
	);
	expect(lapsed).toContain('PayPal is not collecting this now');
	expect(lapsed).not.toContain('Stripe');
});

it('states the cost with no processor in it where none stands behind the commitment', () => {
	// the clause is never dropped — a destructive confirmation that states no cost is one an
	// operator answers blind — so what goes is the processor and not the sentence.
	const root = screen(commitment({ confirmStop: true, processor: null }));
	expect(words(root)).toContain('Nothing further is collected.');
	expect(words(root)).toContain('nothing here tells Ada Okafor');
	expect(words(root)).not.toContain('Stripe');
	expect(words(root)).not.toContain('PayPal');
});

it('names the processor that gave up, in the note under a payment-failed heading', () => {
	// the note that stops a staff member reading "payment failed" as "already over" and leaving a
	// donor collected from after they asked to stop.
	const lapsed = { status: 'lapsed' as const, nextChargeOn: null };
	expect(words(screen(commitment(lapsed)))).toContain('Stripe stopped collecting');
	const paypal = words(screen(commitment({ ...lapsed, processor: 'PayPal' })));
	expect(paypal).toContain('PayPal stopped collecting');
	expect(paypal).not.toContain('Stripe');
});
