import { afterEach, expect, it, vi } from 'vitest';
import {
	coinDifference,
	createDepositBlock,
	type DepositScreen,
	type DepositView
} from './deposit';

// the dom pool: the address block's own behaviour — the one line it writes itself. everything else
// on the block is words the card hands it and is read whole on the card in ./element.dom.spec.ts;
// how the block is laid out is ./styles/parts.browser.spec.ts.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * a card's words for the figure the block picked, spelled bare.
 *
 * what the two surfaces write is a sentence (`expiresIn` in ./views.ts and in
 * packages/app/src/lib/donate/copy.ts) and each is read on its own screen; what is asserted here is
 * the pair the block chose, which a sentence would only hide.
 */
const words = (left: number, unit: string): string => `${left} ${unit}`;

const SCREEN: DepositScreen = {
	ticker: 'XRP',
	network: 'Ripple',
	networkWarning: 'Send on this network only.',
	gift: { figure: '19.36', worth: '$25.00' },
	fee: { figure: '0.70', worth: '$0.90' },
	total: { figure: '20.06', worth: '$25.90' },
	instruction: { lead: 'Send ', toAddress: ' to this address ', andMemo: ' and include memo ' },
	address: 'rLJsrwVTayaqCnQZnxLLLvcz6kS3LwqhkX',
	memo: null,
	qr: null,
	expiry: { left: 6 * DAY, moment: 'September 25, 2026 at 7:07 AM', words },
	status: 'Waiting for your gift'
};

const blocks: DepositView[] = [];

function mounted(left: number = SCREEN.expiry.left) {
	const block = createDepositBlock(document, () => {});
	blocks.push(block);
	document.body.appendChild(block.root);
	block.update({ ...SCREEN, expiry: { ...SCREEN.expiry, left } });
	const line = block.root.querySelector('.expiry') as HTMLElement;
	return { block, line, reads: () => (line.hidden ? null : line.textContent) };
}

afterEach(() => {
	for (const block of blocks.splice(0)) {
		block.stop();
		block.root.remove();
	}
	vi.useRealTimers();
});

it('states the fee as what the two figures beside it differ by, on the digits', () => {
	expect([
		// the fee row is exactly the remainder of the two figures either side of it, so the three
		// agree however each was rounded on the way here.
		coinDifference('20.06', '19.36'),
		// the places are the wider of the two, so nothing is cut off a figure that carries more.
		coinDifference('20.06', '19.3'),
		coinDifference('74', '71.42857143'),
		// a fee that rounds away at the places the figures are shown to, and a gift the fee was
		// declined on: no difference to state, and no row for it.
		coinDifference('25', '25'),
		// a total under its own gift is a quote that cannot be read, not a negative fee.
		coinDifference('19.36', '20.06'),
		coinDifference('20.06', '1e3'),
		coinDifference('20.06', '')
	]).toEqual(['0.70', '0.76', '2.57142857', null, null, null, null]);
});

it('keeps the network’s caution behind its mark, and closes it again on the next address', () => {
	const { block } = mounted();
	const mark = block.root.querySelector('.caution') as HTMLButtonElement;
	const caution = block.root.querySelector('.attention') as HTMLElement;
	const reads = () => ({
		named: mark.getAttribute('aria-label'),
		open: mark.getAttribute('aria-expanded'),
		standing: !caution.hidden
	});

	const readings = [reads()];
	mark.click();
	readings.push(reads());
	mark.click();
	readings.push(reads());
	mark.click();
	block.update({ ...SCREEN, address: 'rSECONDxADDRESSxFORxTHExSAMExGIFT' });
	readings.push(reads());

	// one name in both states: `aria-expanded` is what says which way it is.
	expect(readings).toEqual([
		{ named: 'About sending on the Ripple network', open: 'false', standing: false },
		{ named: 'About sending on the Ripple network', open: 'true', standing: true },
		{ named: 'About sending on the Ripple network', open: 'false', standing: false },
		{ named: 'About sending on the Ripple network', open: 'false', standing: false }
	]);
	expect(caution.textContent).toBe('Send on this network only.');
});

it('states the entries the quote gave it, and no row for one it did not', () => {
	const { block } = mounted();
	const entries = () =>
		[...block.root.querySelectorAll<HTMLElement>('.entry')]
			.filter((row) => !row.hidden)
			.map((row) => row.textContent);

	const whole = entries();
	// no gift figure in coin is no fee either: a fee beside a gift no figure names is a deduction
	// from nothing.
	block.update({ ...SCREEN, gift: null, fee: null });

	expect(whole).toEqual([
		'NetworkRippleSend on this network only.',
		'Amount19.36 XRP$25.00',
		'Processing fee0.70 XRP$0.90',
		'Total20.06 XRP$25.90'
	]);
	expect(entries()).toEqual(['NetworkRippleSend on this network only.', 'Total20.06 XRP$25.90']);
});

it('sets the memo into the sentence only where the payment carries one', () => {
	const { block } = mounted();
	const sentence = block.root.querySelector('.instruction') as HTMLElement;
	const withoutMemo = sentence.textContent;

	block.update({ ...SCREEN, memo: '3198472051' });

	expect(withoutMemo).toBe('Send 20.06 XRP to this address rLJsrwVTayaqCnQZnxLLLvcz6kS3LwqhkX');
	expect(sentence.textContent).toBe(
		'Send 20.06 XRP to this address rLJsrwVTayaqCnQZnxLLLvcz6kS3LwqhkX and include memo 3198472051'
	);
});

it('states how long is left as one whole figure, in the coarsest unit that has one', () => {
	const at = (left: number) => mounted(left).reads();

	expect([
		at(6 * DAY + 13 * HOUR),
		at(DAY),
		at(DAY - 1),
		at(2 * HOUR + 59 * MINUTE),
		at(HOUR),
		at(HOUR - 1),
		at(14 * MINUTE + 59_000),
		at(MINUTE),
		// under a minute the floor would read zero, so the line holds at one until the address closes.
		at(1),
		at(0)
	]).toEqual([
		'6 day',
		'1 day',
		'23 hour',
		'2 hour',
		'1 hour',
		'59 minute',
		'14 minute',
		'1 minute',
		'1 minute',
		null
	]);
});

it('carries the send-by itself, for a donor planning against a date', () => {
	expect(mounted().line.title).toBe('September 25, 2026 at 7:07 AM');
});

it('holds a coarse figure for as long as it is true, and states the next one as it turns', async () => {
	vi.useFakeTimers();
	const { reads } = mounted(DAY + HOUR);

	const readings = [reads()];
	// a whole day still to go, so the figure has not moved and nothing has been redrawn.
	await vi.advanceTimersByTimeAsync(HOUR);
	readings.push(reads());
	await vi.advanceTimersByTimeAsync(1);
	readings.push(reads());

	expect(readings).toEqual(['1 day', '1 day', '23 hour']);
});

it('counts the last of it down by the minute, and withdraws the line at the end', async () => {
	vi.useFakeTimers();
	const { reads } = mounted(2 * MINUTE + 30_000);

	const readings = [reads()];
	await vi.advanceTimersByTimeAsync(30_001);
	readings.push(reads());
	await vi.advanceTimersByTimeAsync(60_000);
	readings.push(reads());
	await vi.advanceTimersByTimeAsync(59_999);
	readings.push(reads());

	expect(readings).toEqual(['2 minute', '1 minute', '1 minute', null]);
});

it('holds one wait at a time, and none once the screen or the card is let go', () => {
	vi.useFakeTimers();
	const { block } = mounted(2 * MINUTE);
	const waits = [vi.getTimerCount()];

	block.update({ ...SCREEN, expiry: { ...SCREEN.expiry, left: MINUTE } });
	waits.push(vi.getTimerCount());

	// the screen left behind: the flow moved off the address and the block came off the card.
	block.update(null);
	waits.push(vi.getTimerCount());

	// and the card let go of whole, with the address still on it.
	block.update({ ...SCREEN, expiry: { ...SCREEN.expiry, left: MINUTE } });
	block.stop();
	waits.push(vi.getTimerCount());

	expect(waits).toEqual([1, 1, 0, 0]);
});
