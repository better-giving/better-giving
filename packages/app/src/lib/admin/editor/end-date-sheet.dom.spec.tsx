import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { endDayOf, endOfDay } from '$lib/page/end-date';
import { EndDateSheet } from './end-date-sheet';

// a campaign's end date as its sheet takes and hands back a day: seeded from the day a stored end
// closes on, a day picked on the calendar handed back as `YYYY-MM-DD`, no day for an emptied box or
// Clear end date, and a refused day said at its box with the caret moved there. the day's chunks
// are packages/operator/src/components/forms/DateField.dom.spec.tsx's; the instant a day ends at is
// $lib/page/end-date.spec.ts's.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ZONE = 'America/Los_Angeles';

function mountable(tree: ReactNode): { root: HTMLElement; redraw: (next: ReactNode) => void } {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return { root, redraw: (next) => act(() => mounted.render(next)) };
}

function sheet(
	endDate: string | null,
	onDone: (endDate: string | null) => void,
	error?: string
): ReactNode {
	return (
		<EndDateSheet
			endDate={endDate}
			onDone={onDone}
			applying={false}
			error={error}
			onDismiss={() => {}}
		/>
	);
}

function button(root: Element, name: string): HTMLButtonElement {
	const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
		(one) => one.textContent?.trim() === name
	);
	if (found === undefined) throw new Error(`no button named ${name}`);
	return found;
}

/** what the sheet's form would post for the day. */
const posted = (root: HTMLElement) =>
	root.querySelector<HTMLInputElement>('input[name="end_date"]')?.value;

/** the machines settle a tick after a press. */
const flushed = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

describe('the end date', () => {
	it('opens on the day a stored end closes on, in the zone it was chosen in', () => {
		const ends = endOfDay({ day: '2026-12-31', timeZone: ZONE, now: 0 });
		if (!ends.ok) throw new Error(ends.reason);
		// the last instant of Dec 31 in Los Angeles is already Jan 1 in UTC.
		expect(new Date(ends.endsAt).toISOString().slice(0, 10)).toBe('2027-01-01');

		const { root } = mountable(sheet(endDayOf({ endsAt: ends.endsAt, endsZone: ZONE }), () => {}));

		expect(posted(root)).toBe('2026-12-31');
	});

	it('hands back a day picked on the calendar as YYYY-MM-DD at Done', async () => {
		const onDone = vi.fn();
		const { root } = mountable(sheet('2026-12-31', onDone));
		const opener = root.querySelector<HTMLButtonElement>('[data-part="trigger"]');
		if (opener === null) throw new Error('no calendar press');
		act(() => opener.click());
		await flushed();
		const day = root.querySelector<HTMLElement>(
			'[data-part="table-cell-trigger"][data-value="2026-12-24"]'
		);
		if (day === null) throw new Error('the calendar drew no 24th of December');
		act(() => day.click());
		await flushed();

		act(() => button(root, 'Done').click());

		expect(onDone.mock.calls).toEqual([['2026-12-24']]);
	});

	it('hands back no end date for a box left empty', () => {
		const onDone = vi.fn();
		const { root } = mountable(sheet(null, onDone));
		act(() => button(root, 'Done').click());
		expect(onDone.mock.calls).toEqual([[null]]);
	});

	it('offers Clear end date only while there is one, and hands back none from it', () => {
		const onDone = vi.fn();
		const { root: none } = mountable(sheet(null, onDone));
		const names = [...none.querySelectorAll('button')].map((one) => one.textContent?.trim());
		expect(names).toContain('Done');
		expect(names).not.toContain('Clear end date');

		const { root } = mountable(sheet('2026-12-31', onDone));
		act(() => button(root, 'Clear end date').click());
		expect(onDone.mock.calls).toEqual([[null]]);
	});

	it('says a refused day at its box and moves the caret there', () => {
		const said = '2026-01-01 is already over';
		const { root, redraw } = mountable(sheet('2026-01-01', () => {}));
		const chunks = root.querySelector<HTMLElement>('[data-part="segment-group"]');
		if (chunks === null) throw new Error('no day box');
		act(() => button(root, 'Done').focus());

		redraw(sheet('2026-01-01', () => {}, said));

		expect(chunks.getAttribute('aria-invalid')).toBe('true');
		const described = (chunks.getAttribute('aria-describedby') ?? '').split(' ');
		expect(described.map((id) => document.getElementById(id)?.textContent)).toContain(said);
		expect(chunks.contains(document.activeElement)).toBe(true);
	});
});
