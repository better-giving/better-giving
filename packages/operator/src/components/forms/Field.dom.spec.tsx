import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { Field } from './Field.jsx';

// the first case over a part rendered rather than read, and it is here to prove the harness as much
// as the field: ../render.testing.tsx returning an element nothing was mounted into would satisfy
// every assertion written against what it hands back, so the claim below is about markup that only
// exists if the part really ran.
//
// a component spec is `.tsx` rather than `.ts`: a part's props are react nodes, and jsx is not
// legal in a `.ts` file. both pools collect either extension (../../../vitest.config.ts) so that a
// spec is never written into neither.

/** the ids a box's description names, in the order it names them. */
function describedBy(root: HTMLElement): string[] {
	const tokens = root.querySelector('input, textarea')?.getAttribute('aria-describedby');
	return tokens === null || tokens === undefined || tokens === '' ? [] : tokens.split(' ');
}

/** the classes the box carries, as a set a case can ask about one at a time. */
function boxClasses(root: HTMLElement): string[] {
	return (root.querySelector('input, textarea')?.getAttribute('class') ?? '').split(' ');
}

describe('a field mounted into a document', () => {
	it('names the box its label labels', () => {
		const root = render(Field, { id: 'org-name', label: 'Registered name' });

		expect(root.querySelector('label')?.getAttribute('for')).toBe('org-name');
		expect(root.querySelector('input')?.getAttribute('id')).toBe('org-name');
	});

	it('announces the refusal rather than only drawing it', () => {
		// what a press answers with. the message is drawn wherever the box is, and on the screens
		// where conform does not move focus into the box — the sign-in, the settings save — a
		// paragraph that is not a live region is a refusal nobody using a reader is told about.
		const root = render(Field, {
			id: 'org-name',
			label: 'Registered name',
			error: 'Give it a name.'
		});

		expect(root.querySelector('.adm-field__error')?.getAttribute('role')).toBe('alert');
	});

	it('draws a box refused from outside itself as refused', () => {
		// a rule about a pair of boxes belongs to neither of them, so the group draws the one
		// message and each box is marked from out here. it still has to look refused: either box
		// fixes the pair and neither one is the wrong one.
		const root = render(Field, {
			id: 'min-minor',
			label: 'Smallest gift',
			'aria-invalid': 'true'
		});

		expect(root.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
		expect(boxClasses(root)).toContain('adm-input--invalid');
	});

	it('draws a box refused by its own message as refused, with nothing said from outside', () => {
		const root = render(Field, {
			id: 'org-name',
			label: 'Registered name',
			error: 'Give it a name.'
		});

		expect(root.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
		expect(boxClasses(root)).toContain('adm-input--invalid');
	});

	it('adds a caller’s class to its own rather than standing in for them', () => {
		const root = render(Field, {
			id: 'tax-id',
			label: 'EIN',
			className: 'adm-num'
		});

		expect(boxClasses(root)).toContain('adm-num');
		expect(boxClasses(root)).toContain('adm-input');
	});

	it('keeps the standing sentence while the box is refused, and names both', () => {
		// the two are different things and are reachable together: a test send marks a blank box as
		// wanted, and a save refused afterwards leaves the field holding both.
		const root = render(Field, {
			id: 'notification-email',
			label: 'Notification email',
			error: 'Write an address.',
			needed: 'A receipt carries a placeholder until this is saved.'
		});

		expect(describedBy(root).map((id) => root.querySelector(`#${id}`)?.textContent)).toEqual([
			'Write an address.',
			'A receipt carries a placeholder until this is saved.'
		]);
	});

	it('renders no label where the box is named some other way', () => {
		// a row in a repeating editor: the group's legend is the name on the screen and each box
		// says which row it is to a reader. an empty label element is a labelling relationship the
		// browser reads as the box having no name at all.
		const root = render(Field, { id: 'suggested-0', 'aria-label': 'Suggested amount 1' });

		expect(root.querySelector('label')).toBeNull();
	});
});
