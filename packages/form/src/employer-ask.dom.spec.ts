import { afterEach, expect, it, vi } from 'vitest';
import { createEmployerAsk, type EmployerAskScreen } from './employer-ask';

// the dom pool: the thank-you's employer ask as a block — what it draws in each phase, what it hands
// back on a press, and where it puts the caret. the words are the card's (`takeoverFor` in
// ./views.ts) and the ask on the mounted card is read in ./element.dom.spec.ts.

const SCREEN: EmployerAskScreen = {
	phase: 'asking',
	heading: 'Does your employer match gifts?',
	hint: 'Many do. Tell us where you work and we’ll email you what their form asks for.',
	label: 'Employer (if they match gifts)',
	send: 'Send me the details',
	skip: 'Skip',
	refusal: '',
	boxRefused: false,
	doneHeading: '',
	doneBody: '',
	link: 'Open your gift page',
	giftUrl: 'https://giving.example.org/gift/7Qk3-mVx9Lr2NpA4'
};

const CONTROLS = { value: '', busy: false, given: false };

const mounted: HTMLElement[] = [];

function mount() {
	const handlers = { input: vi.fn(), send: vi.fn(), skip: vi.fn(), refused: vi.fn() };
	const block = createEmployerAsk(document, handlers);
	document.body.appendChild(block.root);
	mounted.push(block.root);
	const find = <T extends Element = HTMLElement>(selector: string): T => {
		const node = block.root.querySelector<T>(selector);
		if (node === null) throw new Error(`no ${selector}`);
		return node;
	};
	return { block, handlers, find };
}

afterEach(() => {
	for (const root of mounted.splice(0)) root.remove();
});

it('asks in a group named by its own heading, with the box labelled over it', () => {
	const { block, find } = mount();
	block.update(SCREEN, CONTROLS);

	const group = find('[role="group"]');
	const heading = find(`#${group.getAttribute('aria-labelledby')}`);
	expect(heading.textContent).toBe('Does your employer match gifts?');
	expect(heading.getAttribute('part')).toBe('heading');
	expect(heading.getAttribute('tabindex')).toBe('-1');

	const field = find<HTMLInputElement>('input');
	const label = find(`label[for="${field.id}"]`);
	expect(label.textContent).toBe('Employer (if they match gifts)');
	expect(label.getAttribute('part')).toBe('label');
	expect(field.getAttribute('part')).toBe('field');
	expect(field.maxLength).toBe(200);
	expect(field.autocomplete).toBe('organization');
	expect(field.getAttribute('aria-describedby')).toBe(find('.employer-hint').id);
});

it('draws Send unavailable over a blank box yet still pressable, and Skip beside it', () => {
	const { block, handlers, find } = mount();
	block.update(SCREEN, CONTROLS);

	const send = find<HTMLButtonElement>('[part~="action"]');
	expect(send.textContent).toBe('Send me the details');
	expect(send.getAttribute('aria-disabled')).toBe('true');
	// never the attribute: it would take the button out of the tab order and swallow the press the
	// flow answers with a sentence.
	expect(send.disabled).toBe(false);
	// the default button of the card's form, so Enter in the box presses it and the flow decides.
	expect(send.type).toBe('submit');
	send.click();
	expect(handlers.send).toHaveBeenCalledTimes(1);
	expect(find('[part~="action-quiet"]').textContent).toBe('Skip');

	block.update(SCREEN, { ...CONTROLS, value: 'Northwind', given: true });
	expect(send.hasAttribute('aria-disabled')).toBe(false);
});

it('hands back what is typed and each press, and draws nothing of the closed ask', () => {
	const { block, handlers, find } = mount();
	block.update(SCREEN, CONTROLS);

	const field = find<HTMLInputElement>('input');
	field.value = 'Northwind Logistics';
	field.dispatchEvent(new Event('input'));
	expect(handlers.input).toHaveBeenCalledWith('Northwind Logistics');

	find('[part~="action"]').click();
	expect(handlers.send).toHaveBeenCalledTimes(1);
	find('[part~="action-quiet"]').click();
	expect(handlers.skip).toHaveBeenCalledTimes(1);

	expect(find('[role="status"]').hidden).toBe(true);
	expect(find('[part="link"]').hidden).toBe(true);
});

it('replaces the ask with the status row and the gift page link once sent, and puts the caret there', () => {
	const { block, find } = mount();
	block.update(SCREEN, { ...CONTROLS, value: 'Northwind', given: true });
	block.update({ ...SCREEN, phase: 'sending' }, { ...CONTROLS, busy: true });
	block.update(
		{ ...SCREEN, phase: 'sent', doneHeading: 'Details sent', doneBody: 'We’ve emailed you.' },
		CONTROLS
	);

	const status = find('[role="status"]');
	expect(status.hidden).toBe(false);
	expect(status.textContent).toBe('Details sentWe’ve emailed you.');
	expect(status.querySelector('svg')).not.toBeNull();
	expect(document.activeElement).toBe(status);
	expect(find('[role="group"]').hidden).toBe(true);

	const link = find<HTMLAnchorElement>('[part="link"]');
	expect(link.hidden).toBe(false);
	expect(link.textContent).toBe('Open your gift page');
	expect(link.getAttribute('href')).toBe(SCREEN.giftUrl);
	// no longer the default button: Enter elsewhere on the card is not this ask's.
	expect(find<HTMLButtonElement>('[part~="action"]').type).toBe('button');
});

it('draws the skipped row with no mark, and moves the caret to it from the open ask', () => {
	const { block, find } = mount();
	block.update(SCREEN, CONTROLS);
	block.update(
		{
			...SCREEN,
			phase: 'skipped',
			doneHeading: 'Employer matching',
			doneBody: 'It is on your gift page.'
		},
		CONTROLS
	);

	const status = find('[role="status"]');
	expect(status.textContent).toBe('Employer matchingIt is on your gift page.');
	expect(status.querySelector('svg')).toBeNull();
	expect(document.activeElement).toBe(status);
});

it('takes no caret on a first paint that is already closed', () => {
	const { block } = mount();
	block.update({ ...SCREEN, phase: 'sent', doneHeading: 'Details sent' }, CONTROLS);
	expect(document.activeElement).toBe(document.body);
});

it('marks the send busy while its write is in flight', () => {
	const { block, find } = mount();
	block.update({ ...SCREEN, phase: 'sending' }, { value: 'Northwind', busy: true, given: true });
	const send = find('[part~="action"]');
	expect(send.getAttribute('aria-busy')).toBe('true');
	expect(send.getAttribute('part')).toBe('action busy');
});

it('states a refused write under the box, tied to it, and reports each refusal as it lands', () => {
	// the card's region says it (`announce` in ./views.ts); a second refusal is the same words, so the
	// block reports each one and the card says it again.
	const { block, handlers, find } = mount();
	const refused = { ...SCREEN, refusal: 'Your employer was not saved.' };
	block.update(refused, { value: 'Northwind', busy: false, given: true });
	block.update(refused, { value: 'Northwind Logistics', busy: false, given: true });

	const message = find('.message');
	expect(message.hidden).toBe(false);
	expect(message.textContent).toBe('Your employer was not saved.');
	expect(find('input').getAttribute('aria-describedby')).toBe(`employer-hint ${message.id}`);
	expect(find('input').hasAttribute('aria-invalid')).toBe(false);
	expect(message.hasAttribute('role')).toBe(false);
	expect(handlers.refused).toHaveBeenCalledTimes(1);

	block.update({ ...SCREEN, phase: 'sending' }, { value: 'Northwind', busy: true, given: true });
	expect(message.hidden).toBe(true);
	block.update(refused, { value: 'Northwind', busy: false, given: true });
	expect(handlers.refused).toHaveBeenCalledTimes(2);
});

it('marks the box over a blank press, puts the caret in it, and lets it go once answered', () => {
	const { block, handlers, find } = mount();
	block.update(SCREEN, CONTROLS);
	const field = find<HTMLInputElement>('input');
	const send = find<HTMLButtonElement>('[part~="action"]');
	const blank = { ...SCREEN, refusal: 'Enter your employer’s name.', boxRefused: true };
	send.focus();
	send.click();
	block.update(blank, CONTROLS);

	expect(find('.message').textContent).toBe('Enter your employer’s name.');
	expect(field.getAttribute('aria-invalid')).toBe('true');
	expect(field.getAttribute('aria-describedby')).toBe(`employer-hint ${find('.message').id}`);
	expect(document.activeElement).toBe(field);
	// the caret moved, so the box it landed on says the refusal and the card's region is not asked to.
	expect(handlers.send).toHaveBeenLastCalledWith(false);
	expect(handlers.refused).not.toHaveBeenCalled();

	// a second press from the box itself, where moving the caret says nothing: the region's to say.
	send.click();
	expect(document.activeElement).toBe(field);
	expect(handlers.send).toHaveBeenLastCalledWith(true);

	block.update(SCREEN, { ...CONTROLS, value: 'N', given: true });
	expect(field.hasAttribute('aria-invalid')).toBe(false);
	expect(find('.message').hidden).toBe(true);
});

it('reads a press off the box the donor left, not off the last paint', () => {
	// typed into a box still drawn refused, then Send before the card is patched again: the press is
	// a write, and the caret stays on the button that made it.
	const { block, handlers, find } = mount();
	const blank = { ...SCREEN, refusal: 'Enter your employer’s name.', boxRefused: true };
	block.update(blank, CONTROLS);
	const field = find<HTMLInputElement>('input');
	const send = find<HTMLButtonElement>('[part~="action"]');
	field.value = 'Northwind';
	send.focus();
	send.click();
	expect(document.activeElement).toBe(send);
	expect(handlers.send).toHaveBeenLastCalledWith(false);
});

it('draws nothing on a thank-you with no ask, and leaves Enter to the screen', () => {
	const { block, find } = mount();
	block.update(SCREEN, CONTROLS);
	block.update(null, CONTROLS);
	expect(block.root.hidden).toBe(true);
	expect(find<HTMLButtonElement>('[part~="action"]').type).toBe('button');
});
