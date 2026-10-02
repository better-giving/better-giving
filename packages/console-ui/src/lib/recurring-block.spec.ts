import type { ReactElement, ReactNode } from 'react';
import { createElement, Fragment, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RecurringRead, RecurringSetup } from '../api/types';
import type { RecurringBlockInput } from './recurring-block';
import { RECURRING_INTENT, recurringBlock } from './recurring-block';

// the repeating-gifts press and the outcome under it, held as the elements the block returns and as
// their markup. ../../vite.config.ts pins `node` and there is no dom, so focus is held by what keeps
// it — a press that is never natively closed, and a click handler that turns a second press away —
// and the region's write a task after it mounts is read as what it is handed, never as a timer that
// ran: `SaveButton`'s own dom spec holds that clear-then-write
// (packages/operator/src/components/controls/SaveButton.dom.spec.tsx).

const ABSENT: RecurringRead = {
	kind: 'read',
	report: { processors: [{ processor: 'stripe', label: 'Stripe', reading: { state: 'absent' } }] }
};

/** a deployment reporting no account at all, so the block draws the outcome on its own. */
const NONE: RecurringRead = { kind: 'read', report: { processors: [] } };

const SET_UP: RecurringSetup = {
	kind: 'reported',
	report: {
		outcome: 'set_up',
		processors: [
			{ processor: 'stripe', label: 'Stripe', outcome: 'set_up', detail: null, reason: null }
		]
	}
};

const ALREADY: RecurringSetup = {
	kind: 'reported',
	report: {
		outcome: 'already_set_up',
		processors: [
			{
				processor: 'stripe',
				label: 'Stripe',
				outcome: 'already_set_up',
				detail: null,
				reason: null
			}
		]
	}
};

const block = (input: Partial<RecurringBlockInput>): ReactNode =>
	recurringBlock({
		processor: 'stripe',
		gifts: ABSENT,
		provision: null,
		busy: false,
		working: false,
		pending: null,
		...input
	});

/** every element in a returned tree, components left unrendered, in document order. */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!isValidElement<Record<string, unknown>>(node)) return [];
	return [node, ...elements(node.props.children as ReactNode)];
}

/** the press, as the element the block hands react. */
function press(node: ReactNode): ReactElement<Record<string, unknown>> {
	const found = elements(node).find((one) => one.props.value === RECURRING_INTENT);
	if (found === undefined) throw new Error('the block drew no repeating-gifts press');
	return found;
}

/** what pressing it does to the submission it would make. */
function pressed(node: ReactNode): { stopped: boolean } {
	const preventDefault = vi.fn();
	const onClick = press(node).props.onClick as ((event: unknown) => void) | undefined;
	onClick?.({ preventDefault });
	return { stopped: preventDefault.mock.calls.length > 0 };
}

/** a returned tree as markup. */
const drawn = (node: ReactNode): string =>
	renderToStaticMarkup(createElement(Fragment, null, node));

const PRESS_TAG = /<button[^>]*value="recurring"[^>]*>/;

describe('the repeating-gifts press while its write is in flight', () => {
	const inFlight = block({ busy: true, pending: RECURRING_INTENT });

	it('is held without `disabled`, so the focus standing on it stays there', () => {
		const tag = drawn(inFlight).match(PRESS_TAG)?.[0];
		expect(tag).toBeDefined();
		expect(tag).not.toMatch(/\sdisabled=/);
		expect(tag).toContain('aria-disabled="true"');
	});

	it('says it is busy', () => {
		expect(drawn(inFlight).match(PRESS_TAG)?.[0]).toContain('aria-busy="true"');
	});

	it('turns a second press away rather than submitting it', () => {
		expect(pressed(inFlight)).toEqual({ stopped: true });
	});

	it('is held as well while a run on the screen is going', () => {
		expect(pressed(block({ working: true }))).toEqual({ stopped: true });
	});

	it('submits when nothing is writing', () => {
		const resting = block({});
		expect(pressed(resting)).toEqual({ stopped: false });
		expect(drawn(resting).match(PRESS_TAG)?.[0]).not.toContain('aria-disabled');
	});
});

describe('the outcome of a repeating-gifts press that landed', () => {
	it('mounts its region empty, so the sentence written into it is a change a reader hears', () => {
		const page = drawn(block({ gifts: NONE, provision: SET_UP }));
		expect(page).toContain('role="status"');
		expect(page).not.toContain('can now collect gifts that repeat');
		expect(page).not.toContain('Set up');
	});

	it('mounts the already-set-up region empty as well', () => {
		const page = drawn(block({ gifts: NONE, provision: ALREADY }));
		expect(page).toContain('role="status"');
		expect(page).not.toContain('already had this');
	});

	it('hands the region the sentence it writes once mounted', () => {
		const said = (provision: RecurringSetup) =>
			elements(block({ gifts: NONE, provision }))
				.map((one) => one.props)
				.find((props) => typeof props.sentence === 'string');
		expect(said(SET_UP)).toMatchObject({
			word: 'Set up',
			sentence: 'Your Stripe account can now collect gifts that repeat.'
		});
		expect(said(ALREADY)).toMatchObject({
			word: 'Already set up',
			sentence: 'Your Stripe account already had this, so nothing was changed.'
		});
	});
});
