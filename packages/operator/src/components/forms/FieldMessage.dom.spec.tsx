import { describe, expect, it } from 'vitest';
import { InlineCode } from '../data/CodeSlab.jsx';
import { render } from '../render.testing';
import { FieldMessage } from './FieldMessage.jsx';

// the defect this part was promoted out of thirty-odd hand-drawn copies to settle. the row is a
// flex line and its gap is what stands between the mark and the words, so every inline element in
// the message becomes a flex item of its own and the gap is spent between the parts of one
// sentence — a marked value ending up a paragraph away from the clause introducing it, and three
// lines away at the 375px floor.
//
// the case below is written against the shape rather than against a width, because the width is
// what a browser measures and the shape is what causes it: the row carries its mark, where the tone
// draws one, and one wrapping child, and the whole sentence is inside that child. a row that holds
// the sentence directly fails it whether or not a viewport is narrow enough to show the damage.

/** the row itself, in whichever tone was drawn. */
function row(root: HTMLElement): HTMLElement {
	const found = root.querySelector<HTMLElement>('.adm-field__error, .adm-field__needed');
	if (found === null) throw new Error('no message row was rendered');
	return found;
}

describe('a field message mounted into a document', () => {
	it('keeps a sentence carrying an inline element inside one child of the row', () => {
		const root = render(FieldMessage, {
			children: (
				<>
					This deployment answers on no address at all. Turn its{' '}
					<InlineCode>workers.dev</InlineCode> address back on, then press again.
				</>
			)
		});
		const line = row(root);

		// the wrapper and nothing else: an unwrapped sentence puts the code span in the row itself,
		// where the gap is spent on it.
		expect(line.children).toHaveLength(1);
		expect(line.querySelector('.adm-code')?.parentElement).not.toBe(line);
		// and the wrapper holds the whole sentence rather than a fragment of it.
		expect(line.children[0]?.textContent).toBe(
			'This deployment answers on no address at all. Turn its workers.dev address back on, then press again.'
		);
	});

	it('wraps a plain sentence too', () => {
		// a caller handing over a string cannot see that the wrapper matters, which is why the row
		// draws one whatever it is given rather than only where it can tell it is needed.
		const root = render(FieldMessage, { children: 'Give it a name.' });
		const line = row(root);

		expect(line.children).toHaveLength(1);
		expect(line.children[0]?.textContent).toBe('Give it a name.');
	});

	it('announces the refusal, and draws no mark beside it', () => {
		// what a press answered with. on the screens where nothing moves focus into a box, a
		// paragraph that is not a live region is a refusal nobody using a reader is told about.
		const root = render(FieldMessage, { children: 'Give it a name.' });

		expect(root.querySelector('.adm-field__error')?.getAttribute('role')).toBe('alert');
		expect(root.querySelector('.adm-field__error .adm-mark')).toBeNull();
	});

	it('draws the standing sentence as a plain paragraph', () => {
		// a standing condition is not an event, and two regions speaking at once leave a reader
		// unable to tell which of them answered the press.
		const root = render(FieldMessage, {
			tone: 'needed',
			children: 'A test send is waiting on this.'
		});

		expect(root.querySelector('.adm-field__needed')?.getAttribute('role')).toBeNull();
		expect(root.querySelector('.adm-field__needed .adm-mark')).not.toBeNull();
		expect(root.querySelector('.adm-field__error')).toBeNull();
	});

	it('carries an id only where a box points at it', () => {
		// the library sites name the row from the field's own id; a row a press draws at a control
		// has nothing pointing at it and carries none.
		const named = render(FieldMessage, { id: 'org-name-err', children: 'Give it a name.' });
		expect(row(named).getAttribute('id')).toBe('org-name-err');

		const bare = render(FieldMessage, { children: 'Give it a name.' });
		expect(row(bare).getAttribute('id')).toBeNull();
	});
});
