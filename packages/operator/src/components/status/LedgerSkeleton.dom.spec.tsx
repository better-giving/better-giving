import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { LedgerSkeleton } from './LedgerSkeleton.jsx';

// what a reader who cannot see the placeholder is given: the wait, in words, and none of the bars
// standing in for lines that have not arrived.

describe('a ledger skeleton mounted into a document', () => {
	it('says what is being waited on in a status region', () => {
		const root = render(LedgerSkeleton, { label: 'Asking this deployment…', blocks: [2, 1] });
		const status = root.querySelector('[role="status"]');

		expect(status?.textContent).toBe('Asking this deployment…');
	});

	it('hides every bar it draws from the tree', () => {
		const root = render(LedgerSkeleton, { label: 'Asking this deployment…', blocks: [2, 1] });
		const bars = [...root.querySelectorAll('.adm-skeleton')];

		// a heading per block, and a mark, a label and a sentence per line: two blocks, three lines.
		expect(bars).toHaveLength(2 + 3 * 3);
		for (const bar of bars) expect(bar.closest('[aria-hidden="true"]')).not.toBeNull();
	});

	it('draws a block per entry, holding the lines that entry counts', () => {
		const root = render(LedgerSkeleton, { label: 'Asking this deployment…', blocks: [4, 1] });
		const counts = [...root.querySelectorAll('.adm-named')].map(
			(block) => block.querySelectorAll('.adm-ledger > li').length
		);

		expect(counts).toEqual([4, 1]);
	});
});
