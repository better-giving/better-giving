import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { Field } from './Field.jsx';
import { PairedFieldset } from './PairedFieldset.jsx';

// two boxes that are one decision. what a case here is about is the message: it belongs to the pair
// rather than to either box, so it is drawn once, after both, and both boxes have to be able to
// point at it.
//
// a component spec is `.tsx` and both pools collect either extension — ./Field.dom.spec.tsx says
// why.

/** the pair as a form draws it: two boxes marked from out here, pointing at the group's message. */
function NamePair({ id, error }: { id: string; error: string | undefined }) {
	const marked =
		error === undefined ? {} : { 'aria-describedby': `${id}-err`, 'aria-invalid': true };
	return (
		<PairedFieldset id={id} legend="Name" side error={error}>
			<Field id={`${id}-first`} label="First name" {...marked} />
			<Field id={`${id}-last`} label="Last name" {...marked} />
		</PairedFieldset>
	);
}

describe('a paired fieldset mounted into a document', () => {
	it('names its message, so both boxes reach a paragraph that exists', () => {
		// a rule about a pair belongs to neither box, so each is marked refused from out here and
		// described by the one sentence down there. unnamed, the two boxes draw a border and say
		// nothing, and the sentence they were refused by is unreachable from either.
		const root = render(NamePair, { id: 'donor-name', error: 'Give a first or a last name.' });

		expect(
			[...root.querySelectorAll('input')].map(
				(box) => root.querySelector(`#${box.getAttribute('aria-describedby')}`)?.textContent
			)
		).toEqual(['Give a first or a last name.', 'Give a first or a last name.']);
	});

	it('announces the refusal rather than only drawing it', () => {
		// for ./Field.jsx's reason: on the screens where the form layer moves focus into neither box
		// — either one fixes the pair, so there is no box to move to — a paragraph that is not a live
		// region is a refusal nobody using a reader is told about.
		const root = render(NamePair, { id: 'donor-name', error: 'Give a first or a last name.' });

		expect(root.querySelector('.adm-field__error')?.getAttribute('role')).toBe('alert');
	});

	it('draws no legend where the pair is named from where it sits', () => {
		// an empty legend is a name the browser reads as the group having none, and the two boxes it
		// holds are already inside a fieldset the screen named.
		const root = render(PairedFieldset, { id: 'reach', side: true, children: 'boxes' });

		expect(root.querySelector('legend')).toBeNull();
	});
});
