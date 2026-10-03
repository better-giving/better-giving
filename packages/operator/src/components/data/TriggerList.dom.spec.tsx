import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { TriggerList } from './TriggerList.jsx';

// the list draws a count only where one was handed: a line nobody listens to ends at its name.

describe('the trigger list', () => {
	it('draws each name, with a count only where there is one', () => {
		const root = render(TriggerList, {
			items: [
				{ id: 'gift', mark: 'stamp', name: 'Settled gifts', count: '2 Zaps listening' },
				{ id: 'refund', mark: 'arrow-left', name: 'Refunds' }
			]
		});
		const lines = [...root.querySelectorAll('.adm-triggers > li')];

		expect(lines.map((li) => li.querySelector('.adm-triggers__name')?.textContent)).toEqual([
			'Settled gifts',
			'Refunds'
		]);
		expect(
			lines.map((li) => li.querySelector('.adm-triggers__count')?.textContent ?? null)
		).toEqual(['2 Zaps listening', null]);
		// the mark is out of the tree: the name beside it already says what the line is.
		expect(lines[0]?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
	});
});
