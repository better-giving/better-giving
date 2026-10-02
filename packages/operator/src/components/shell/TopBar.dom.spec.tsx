import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { TopBar } from './TopBar.jsx';

// the bar states the facts a surface hands it and none of its own: a bar that filled in a run
// when it was handed none would put a fictional organisation over a real deployment.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

describe('the facts a bar states', () => {
	it('states the run it was handed, in order', () => {
		const root = render(TopBar, {
			facts: [
				{ what: 'Worker', name: 'riverside-shelter' },
				{ what: 'Database', name: 'riverside-shelter-db' }
			],
			end: null
		});

		expect([...root.querySelectorAll('.adm-topbar__name')].map((n) => n.textContent)).toEqual([
			'riverside-shelter',
			'riverside-shelter-db'
		]);
		expect(root.textContent).not.toContain('Riverbank Trust');
	});

	it('draws nothing at all rather than a run of its own where it was handed none', () => {
		// @ts-expect-error `facts` is required: dropping it is what the type check exists to catch.
		expect(() => render(TopBar, { end: null })).toThrow();
	});
});
