import { describe, expect, it, vi } from 'vitest';
import { render } from '../render.testing';
import { CodeSlab } from './CodeSlab.jsx';

// a slab is a box a page draws once per record, so what a case here is about is what twenty of them
// do to a reader: twenty landmarks all called `snippet` is a landmark list made useless by a
// component, and twenty controls all called Copy is twenty buttons nobody can tell apart. the third
// case is the one the box exists for — the text on the screen is the text that gets copied.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

const SNIPPET = '<script src="https://give.riverbank.org/embed.js"></script>';

// the one-line form's own value: one unbroken literal nobody reads, which is what that form is for.
const ADDRESS = 'https://dash.cloudflare.com/oauth2/auth?response_type=code&state=Xn7Kq2Rt9vLm';

/** two slabs on one page, which is what a list of forms draws. */
function TwoRecords() {
	return (
		<>
			<CodeSlab label="snippet" record="General fund" content={SNIPPET} copyable />
			<CodeSlab label="snippet" record="Building appeal" content={SNIPPET} copyable />
		</>
	);
}

function names(root: HTMLElement): (string | null)[] {
	return [...root.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
}

describe('a code slab mounted into a document', () => {
	it('is a region when a page draws one of it, named by its own caption', () => {
		const root = render(CodeSlab, { label: 'snippet', content: SNIPPET });
		const slab = root.querySelector('[role="region"]');

		expect(slab).not.toBeNull();
		expect(root.querySelector(`#${slab?.getAttribute('aria-labelledby')}`)?.textContent).toBe(
			'snippet'
		);
	});

	it('is a group and not a landmark when it stands in a record', () => {
		// a landmark is a section of the page, and one record's snippet is not one.
		const root = render(CodeSlab, { label: 'snippet', record: 'General fund', content: SNIPPET });

		expect(root.querySelector('.adm-slab')?.getAttribute('role')).toBe('group');
	});

	it('puts no repeated region name on a page drawing one per record', () => {
		const root = render(TwoRecords, {});

		expect(root.querySelectorAll('[role="region"]')).toHaveLength(0);
	});

	it('names each copy control for the record it takes', () => {
		const root = render(TwoRecords, {});

		expect(names(root)).toEqual([
			'Copy the snippet for General fund',
			'Copy the snippet for Building appeal'
		]);
	});

	it('hands the control the text it is showing', () => {
		const writeText = vi.fn(() => Promise.resolve());
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const root = render(CodeSlab, { label: 'snippet', content: SNIPPET, copyable: true });

		root.querySelector('button')?.click();

		expect(writeText).toHaveBeenCalledWith(SNIPPET);
		expect(root.querySelector('pre')?.textContent).toBe(SNIPPET);
	});

	it('says when its head holds a control and no caption', () => {
		// the head is laid out with `space-between`, which puts a lone child at the leading edge —
		// exactly where every other slab on the page puts its caption, so a column of slabs stops
		// lining up down the edge a reader scans it by. the head states the case and
		// ../../styles/adm.css draws it; the caption slot is not held open by an empty element,
		// which would be an unnamed node in the accessibility tree.
		const captioned = render(CodeSlab, { label: 'snippet', content: SNIPPET, copyable: true });
		const lone = render(CodeSlab, { record: 'General fund', content: SNIPPET, copyable: true });

		expect(captioned.querySelector('.adm-slabhead')?.className).toBe('adm-slabhead');
		expect(lone.querySelector('.adm-slabhead')?.className).toBe(
			'adm-slabhead adm-slabhead--uncaptioned'
		);
		expect(lone.querySelector('.adm-slabhead__label')).toBeNull();
	});

	it('puts the keyboard on the block that scrolls and not on the box around it', () => {
		// the block is what scrolls sideways, so the block is what a keyboard has to be able to
		// reach the end of (WCAG 2.1.1). the pair is one decision and neither half stands alone: a
		// box that took focus and no longer scrolled would ring a thing the keyboard cannot move,
		// and a block that scrolled without taking focus would put the end of a long snippet out of
		// a keyboard's reach. ../../styles/adm.css holds the other half.
		const root = render(CodeSlab, { label: 'snippet', content: SNIPPET, copyable: true });

		expect(root.querySelector('pre')?.getAttribute('tabindex')).toBe('0');
		expect(root.querySelector('.adm-slab')?.hasAttribute('tabindex')).toBe(false);
	});

	it('draws the one-line form as one band, with the control after the block', () => {
		// the head is not drawn at all in this form: there is no caption to hold and the control
		// stands over the trailing end of the line instead, which ../../styles/adm.css lays in the
		// block's own cell. the order is the whole of what puts it over the code rather than under
		// it, so it is what a case here can hold — the fade beside it is the sheet's.
		const root = render(CodeSlab, { oneline: true, content: ADDRESS, copyable: true });
		const slab = root.querySelector('.adm-slab');

		expect(slab?.className).toBe('adm-slab adm-slab--oneline');
		expect(root.querySelector('.adm-slabhead')).toBeNull();
		expect([...(slab?.children ?? [])].map((el) => el.tagName)).toEqual(['PRE', 'BUTTON', 'SPAN']);
	});

	it('keeps the keyboard on the block in the one-line form', () => {
		// the fade over the trailing end is decoration and changes nothing about the reach: the block
		// still scrolls and still takes focus, and the padding the sheet puts on its end is what lets
		// the last glyph be scrolled clear of the fade. a form that took the focus off the block
		// would put the end of a long value out of a keyboard's reach (WCAG 2.1.1).
		const root = render(CodeSlab, { oneline: true, content: ADDRESS, copyable: true });

		expect(root.querySelector('pre')?.getAttribute('tabindex')).toBe('0');
		expect(root.querySelector('.adm-slab')?.hasAttribute('tabindex')).toBe(false);
	});

	it('names nothing in the one-line form, which carries no caption', () => {
		// no head means no caption, so the box is a `group` with no name and the control keeps the
		// bare Copy. the wiring is untouched — it is the label that cannot be there.
		const root = render(CodeSlab, { oneline: true, content: ADDRESS, copyable: true });
		const slab = root.querySelector('.adm-slab');

		expect(slab?.getAttribute('role')).toBe('group');
		expect(slab?.hasAttribute('aria-labelledby')).toBe(false);
		expect(names(root)).toEqual(['Copy']);
	});

	it('offers no control on a slab that is only being read', () => {
		const root = render(CodeSlab, { label: 'snippet', content: SNIPPET });

		expect(root.querySelector('button')).toBeNull();
	});
});
