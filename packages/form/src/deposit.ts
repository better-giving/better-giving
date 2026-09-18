// the address screen's own block: what a donor is sending, where it goes, and the controls that copy
// it.
//
// built once and patched, for the reason ./views.ts is: the takeover it stands in is the same section
// for every full-card screen, and this is the part of that column no other screen has. the words are
// the card's (`takeoverFor` in ./views.ts) but for the labels; what is here is the order they are
// read in, the Copy controls, the QR, and the one line the card cannot write — the send-by, which
// counts down here because it goes on changing while nothing else on the screen does.
//
// two blocks in one column (`.deposit` in ./styles/layout.css). the summary states the account — the
// network, the gift, the fee where one was covered, and the total that has to arrive — and the send
// block is the one thing the donor is asked to do: the sentence naming the figure, the address and
// the memo, the code for that address, the send-by, and what the card is doing while it waits.
//
// nothing on this screen stands open at rest. the network's caution sits behind a mark on its own row
// and is laid over the rows below it when it is opened, so opening it moves nothing.

import { type GlyphName, glyph } from './glyph';
import { part } from './parts';

/** the coarsest unit the time left still has a whole figure of. */
export type ExpiryUnit = 'day' | 'hour' | 'minute';

/** one line of the account: a figure in coin, and what that figure is worth today. */
export type DepositEntry = {
	/** the coin figure, verbatim off the quote: shown, never computed with. */
	readonly figure: string;
	/** the same amount in the account the donor decided in. */
	readonly worth: string;
};

/** the block's words for one deposit, as the card writes them. */
export type DepositScreen = {
	/** the ticker shown after every figure in the block. */
	readonly ticker: string;
	readonly network: string;
	/** what is behind the mark on the network row: the whole of what a wrong send costs. */
	readonly networkWarning: string;
	/**
	 * the gift itself, or `null` where the quote stated no figure for it in coin — in which case the
	 * account is the total alone, because a gift no figure names is not one the block can state.
	 */
	readonly gift: DepositEntry | null;
	/** the fee the donor covered, `null` where they declined it or the gift is not stated in coin. */
	readonly fee: DepositEntry | null;
	/** what has to arrive: the figure the sentence names, the code encodes and the row totals to. */
	readonly total: DepositEntry;
	/**
	 * the one sentence the screen is for, as the runs of words between the values it names.
	 *
	 * the words are the card's and the order is the block's, the way every other line here is split:
	 * what the block holds is where the figure, the address and the memo are set into the sentence,
	 * each with the control that copies it inside the same highlighted run.
	 */
	readonly instruction: {
		/** before the figure. */
		readonly lead: string;
		/** between the figure and the address. */
		readonly toAddress: string;
		/** between the address and the memo, unread where the payment carries none. */
		readonly andMemo: string;
	};
	readonly address: string;
	/** `null` where the payment carries no memo, which sets no memo into the sentence. */
	readonly memo: string | null;
	/**
	 * the address as a module matrix, one string of `'0'` and `'1'` per row, or `null` where the quote's
	 * matrix cannot be drawn — in which case no QR stands and the rest of the block is unchanged.
	 */
	readonly qr: readonly string[] | null;
	/**
	 * the send-by, as the one line the block writes rather than the card.
	 *
	 * a duration rather than the moment itself, because an absolute time on a card a donor may be
	 * reading in any zone names an hour they have to convert before they can act on it. it ticks
	 * down here, so the card hands over how long was left when it wrote the screen and the block
	 * counts from there — the figure is the card's clock (`expiresIn` on `awaitingDeposit` in
	 * ./connect.ts), which is the clock that closes the address, and the counting is real time
	 * elapsed since.
	 */
	readonly expiry: {
		/** how long the address had left when the card wrote this screen, in milliseconds. */
		readonly left: number;
		/** the send-by spelled out, which the line carries as its `title`. */
		readonly moment: string;
		/** the card's words for the figure the block picked. */
		readonly words: (left: number, unit: ExpiryUnit) => string;
	};
	readonly status: string;
};

export type DepositView = {
	readonly root: HTMLElement;
	/** the block patched to `screen`, or taken off the card where it is `null`. */
	update(screen: DepositScreen | null): void;
	/**
	 * the countdown's timer, let go of.
	 *
	 * the seam `stop` on `CardView` (./views.ts) is, and for its reason: the timer outlives the
	 * subtree being removed, and it closes over this block, so a card taken off the page would go on
	 * being patched. safe in any order and any number of times.
	 */
	stop(): void;
};

const SVG = 'http://www.w3.org/2000/svg';

/** what a Copy control last reported, as `data-outcome` on it, which picks the face it shows. */
type CopyOutcome = 'ready' | 'copied' | 'failed';

/**
 * the characters a cut value keeps after its ellipsis: enough of its end to check against the
 * shortened address a wallet shows.
 */
const TAIL_CHARACTERS = 6;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * what the send-by line says of `left`, and when it will say something else.
 *
 * one whole figure in the coarsest unit that has one, floored: a line reading "1 day" with sixteen
 * hours behind it is the safe way round, where a rounded-up "2 days" would offer time that is not
 * there. the granularity follows the figure rather than a cadence, so a week out the line is redrawn
 * once a day and the last hour of it once a minute.
 *
 * `next` is the wait until the figure itself changes — the remainder, and a millisecond past it —
 * rather than a poll, so nothing is redrawn between two readings that would say the same thing.
 */
function expiryLine(left: number): {
	readonly figure: number;
	readonly unit: ExpiryUnit;
	readonly next: number;
} {
	if (left >= DAY) return { figure: Math.floor(left / DAY), unit: 'day', next: (left % DAY) + 1 };
	if (left >= HOUR) {
		return { figure: Math.floor(left / HOUR), unit: 'hour', next: (left % HOUR) + 1 };
	}
	if (left >= MINUTE) {
		return { figure: Math.floor(left / MINUTE), unit: 'minute', next: (left % MINUTE) + 1 };
	}
	// the last minute, where a floored figure would read zero. it holds at one, and the next thing
	// to happen to the line is the address closing under it.
	return { figure: 1, unit: 'minute', next: left };
}

/**
 * the matrix as one path of unit squares, one run of dark modules at a time, or `null` where it is
 * not a square of `'0'` and `'1'`.
 *
 * one path rather than a rect per module, so a matrix of a few thousand modules is one node.
 */
export function qrPath(rows: readonly string[]): string | null {
	const size = rows.length;
	if (size === 0 || rows.some((row) => row.length !== size || !/^[01]+$/.test(row))) return null;
	let d = '';
	rows.forEach((row, y) => {
		for (const run of row.matchAll(/1+/g)) {
			d += `M${run.index} ${y}h${run[0].length}v1h-${run[0].length}z`;
		}
	});
	return d;
}

/** a positive decimal figure, which is the whole of what a coin amount may be (`Deposit` in ./v1.ts). */
const FIGURE = /^(0|[1-9]\d*)(\.\d+)?$/;

/**
 * whether a figure off the wire is one a screen can state.
 *
 * the quote is untrusted json and this one is optional (`Deposit.giftCoinAmount` in ./v1.ts), so a
 * figure that is not a decimal is an entry the screen leaves out rather than a gift refused: what a
 * donor must send is `coinAmount`, which `depositIsUsable` in ./fee.ts has already refused the quote
 * over.
 */
export function isFigure(value: string): boolean {
	return FIGURE.test(value);
}

/**
 * what the donor covered, as one shown figure less another, or `null` where there is nothing to
 * state.
 *
 * fixed-point arithmetic on the digits at the wider of the two figures' places, never on numbers: a
 * coin carries more precision than a double keeps, and both operands are figures a wallet is given.
 * so the fee stated here is exactly the remainder of the two figures either side of it, and the
 * three rows agree whatever rounding each figure arrived with.
 *
 * `null` covers all three of the cases the block has no row for: a fee the donor declined, one that
 * rounds away at the places the figures are shown to, and a quote whose figures cannot be read at
 * all — including a gift above its own total, which is not a negative fee.
 */
export function coinDifference(total: string, gift: string): string | null {
	if (!isFigure(total) || !isFigure(gift)) return null;
	const decimals = (figure: string): number =>
		figure.includes('.') ? figure.length - figure.indexOf('.') - 1 : 0;
	const places = Math.max(decimals(total), decimals(gift));
	const scaled = (figure: string): bigint => {
		const [whole, fraction = ''] = figure.split('.');
		return BigInt(`${whole}${fraction.padEnd(places, '0')}`);
	};
	const left = scaled(total) - scaled(gift);
	if (left <= 0n) return null;
	const digits = left.toString().padStart(places + 1, '0');
	return places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

/**
 * the quiet zone drawn inside the code, in modules, so the margin a scanner needs scales with them.
 *
 * iso/iec 18004 sets four modules on every side and that is what three of these are. the underside
 * is two, and the asymmetry is the rule rather than a value to tidy: the code is sized so that four
 * of its modules come to one line height, which is the white the sentence above it needs; under it
 * stands the send-by, a line that belongs to the code, and a second full line height of margin there
 * would read as the gap between two blocks. two modules is the floor a Micro QR is read at, and the
 * margin is never cut below it on any side.
 */
const QUIET_SIDE = 4;
const QUIET_TOP = 4;
const QUIET_BOTTOM = 2;

/** the drawing's box for a code `size` modules square, with that quiet zone around it. */
function qrViewBox(size: number): string {
	return `${-QUIET_SIDE} ${-QUIET_TOP} ${size + 2 * QUIET_SIDE} ${size + QUIET_TOP + QUIET_BOTTOM}`;
}

export function createDepositBlock(
	doc: Document,
	/** the card's live region, for the one sentence a Copy says (`say` in ./views.ts). */
	say: (words: string) => void
): DepositView {
	const make = <K extends keyof HTMLElementTagNameMap>(
		tag: K,
		className: string,
		children: readonly (Node | string)[] = []
	): HTMLElementTagNameMap[K] => {
		const element = doc.createElement(tag);
		if (className !== '') element.className = className;
		for (const child of children) {
			element.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
		}
		return element;
	};
	const label = (words: string): HTMLElement => {
		const node = make('span', '', [words]);
		node.setAttribute('part', part('label'));
		return node;
	};
	const text = (node: Node, words: string): void => {
		if (node.textContent !== words) node.textContent = words;
	};

	const reports = (button: HTMLButtonElement, outcome: CopyOutcome): void => {
		button.dataset.outcome = outcome;
	};

	/**
	 * a value set on one line, cut in the middle where the sentence is too narrow for it.
	 *
	 * a donor checks an address by its first and last characters against what their wallet shows, so
	 * the cut goes between them: a head that shrinks and ends in an ellipsis, and a tail of
	 * `TAIL_CHARACTERS` that never shrinks. `text-overflow` is the whole of the cut, so the two spans
	 * still hold every character — the value's text, and what assistive technology reads, is the
	 * whole value, and nothing is measured or re-sliced when the card changes width.
	 *
	 * `whole` sets it wrapped instead, for a copy the clipboard refused: a selection over a cut value
	 * would carry the hidden characters the donor cannot see they are copying.
	 */
	const oneLine = (): { readonly node: HTMLElement; set(value: string): void } => {
		const head = make('span', 'head');
		const tail = make('span', 'tail');
		const node = make('span', 'value line', [head, tail]);
		return {
			node,
			set(value) {
				const cut = Math.max(0, value.length - TAIL_CHARACTERS);
				text(head, value.slice(0, cut));
				text(tail, value.slice(cut));
			}
		};
	};

	/** every Copy control with the value it copies, so a new screen puts each back to ready. */
	const copies: { readonly button: HTMLButtonElement; readonly value: HTMLElement }[] = [];

	/** one outcome's mark, stacked with the others in the control (`.copy-face` in ./styles/parts.css). */
	const face = (outcome: CopyOutcome, mark: GlyphName): HTMLElement =>
		make('span', `copy-face ${outcome}`, [glyph(doc, mark, 'copy-glyph')]);

	/**
	 * a value the donor copies, as the highlighted run it is set into: the run is the control, and
	 * the mark inside it is the affordance rather than the target.
	 *
	 * one control per value and no control inside another. two marks with a target laid around each
	 * are two boxes that overlap whenever the sentence wraps between them — the mark's column is
	 * wherever the words put it — and the one on top takes a press meant for the other. a run is its
	 * own inline box, so two of them cannot cover the same pixel at any width or value length.
	 *
	 * what that costs is the target's height: the run is one line box of the sentence it stands in,
	 * about 21px, under both 24 and 44. wcag 2.5.8 and 2.5.5 each except a target "in a sentence" —
	 * and this one is in the sentence and sized by the leading of the prose around it, which is the
	 * whole reason the run may not be padded taller: doing so would bend the text the exception is
	 * written about.
	 *
	 * the name is `Copy {noun}` and the value is the description, so what it copies is said after it
	 * — a name taken from the run's own contents would be the address read out as the control's name,
	 * and an `aria-label` alone would take the value off the screen for a reader who cannot see it.
	 *
	 * the control reports its own outcome in place — a tick, or the danger mark with the value shown
	 * whole and selected so it can be copied by hand — and is ready again once the caret leaves it.
	 * the marks are the whole of what it shows, so the card's live region is the only report a donor
	 * who is not looking at it gets: both outcomes say their sentence, and a silent arm here is a
	 * press that told such a donor nothing at all.
	 */
	const run = (
		noun: string,
		read: () => string
	): { readonly node: HTMLElement; set(value: string): void } => {
		const value = oneLine();
		value.node.id = `deposit-${noun}`;
		const mark = make('span', 'mark', [
			face('ready', 'copy'),
			face('copied', 'tick'),
			face('failed', 'alert')
		]);
		mark.setAttribute('aria-hidden', 'true');
		const button = make('button', 'run', [value.node, mark]);
		reports(button, 'ready');
		button.type = 'button';
		button.setAttribute('part', part('action-quiet'));
		button.setAttribute('aria-label', `Copy ${noun}`);
		button.setAttribute('aria-describedby', value.node.id);
		const named = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`;
		const failed = (): void => {
			reports(button, 'failed');
			value.node.classList.add('whole');
			say(`${named} not copied. It is selected so you can copy it.`);
			const selection = doc.getSelection();
			if (selection === null) return;
			const range = doc.createRange();
			range.selectNodeContents(value.node);
			selection.removeAllRanges();
			selection.addRange(range);
		};
		button.addEventListener('click', () => {
			const clipboard = doc.defaultView?.navigator.clipboard;
			if (clipboard === undefined) {
				failed();
				return;
			}
			clipboard.writeText(read()).then(() => {
				reports(button, 'copied');
				say(`${named} copied.`);
			}, failed);
		});
		button.addEventListener('blur', () => reports(button, 'ready'));
		copies.push({ button, value: value.node });
		return { node: button, set: value.set };
	};

	let screen: DepositScreen | null = null;
	const now = (): DepositScreen => {
		if (screen === null) throw new Error('unreachable: a Copy is pressed only on a drawn deposit');
		return screen;
	};

	// ── the account ────────────────────────────────────────────────────────────────────────────

	// the caution is the row's own, laid over the rows under it rather than taking a place among them
	// (`.entry > .attention` in ./styles/layout.css), so opening it moves nothing on the screen. it
	// carries `aria-expanded` and one name in both states: a name that said Show or Hide would say
	// which way it is a second time, and disagree with it the moment the state changed.
	const cautionMark = make('button', 'caution', [glyph(doc, 'help', 'caution-glyph')]);
	cautionMark.type = 'button';
	cautionMark.setAttribute('part', part('action-quiet'));
	const caution = make('p', 'attention');
	let cautionOpen = false;
	const showCaution = (open: boolean): void => {
		cautionOpen = open;
		caution.hidden = !open;
		cautionMark.setAttribute('aria-expanded', String(open));
	};
	showCaution(false);
	cautionMark.addEventListener('click', () => showCaution(!cautionOpen));

	const networkName = make('span', '');
	const networkValue = make('p', 'value name', [networkName, cautionMark]);
	const network = make('div', 'entry network', [label('Network'), networkValue, caution]);

	/**
	 * one entry of the account: what it is, what it comes to in coin, and what that is worth.
	 *
	 * two figures on one row and neither is the other's gloss twice: the coin figure is what a wallet
	 * is given and the money is the account the donor decided in, so the row is read across in that
	 * order. `total` is the one entry the block rules off.
	 */
	const entry = (
		words: string,
		total: boolean
	): { readonly node: HTMLElement; set(line: DepositEntry, ticker: string): void } => {
		const figure = make('span', 'figure');
		const ticker = make('span', 'ticker');
		const value = make('p', 'value amount', [figure, ' ', ticker]);
		const worth = make('p', 'worth');
		const node = make('div', `entry${total ? ' total' : ''}`, [label(words), value, worth]);
		return {
			node,
			set(line, unit) {
				text(figure, line.figure);
				text(ticker, unit);
				text(worth, line.worth);
			}
		};
	};

	const gift = entry('Amount', false);
	const fee = entry('Processing fee', false);
	const total = entry('Total', true);
	// unnamed, like every other container here: `summary` is the receipt's name and a host reaching
	// two blocks through one selector is a rule written for the block they were looking at
	// (./parts.ts states why a container is not named).
	const summary = make('div', 'summary', [network, gift.node, fee.node, total.node]);

	// ── the one thing to do ────────────────────────────────────────────────────────────────────

	// the sentence's own words, between the three values set into it. a text node each, so the
	// sentence is one paragraph to a reader and one line of layout to the line breaker.
	const lead = doc.createTextNode('');
	const toAddress = doc.createTextNode('');
	const andMemo = doc.createTextNode('');
	// no Copy on the figure: it is cut to the place whose last digit is worth about a cent, so it is
	// short enough to read off the screen and type into a wallet. the address and the memo keep
	// theirs — those are the two values nobody can type.
	const sent = make('span', 'value sent');
	const addressRun = run('address', () => now().address);
	const memoRun = run('memo', () => now().memo ?? '');
	const instruction = make('p', 'instruction', [
		lead,
		sent,
		toAddress,
		addressRun.node,
		andMemo,
		memoRun.node
	]);

	const qrPathNode = doc.createElementNS(SVG, 'path');
	qrPathNode.setAttribute('fill', 'currentColor');
	const qrSvg = doc.createElementNS(SVG, 'svg');
	qrSvg.setAttribute('aria-hidden', 'true');
	qrSvg.setAttribute('focusable', 'false');
	qrSvg.appendChild(qrPathNode);
	const qr = make('div', 'qr');
	qr.setAttribute('role', 'img');
	qr.setAttribute('aria-label', 'QR code for the address');
	qr.appendChild(qrSvg);

	// the send-by stands under the code rather than among the notes: what closes is the address and
	// the code for it, and a line sitting at the foot of the screen names neither.
	const expiry = make('p', 'expiry');
	const spinner = make('span', 'spinner');
	spinner.setAttribute('aria-hidden', 'true');
	const statusWords = make('span', '');
	// the last beat of the instruction rather than a third thing stacked under it: send, and then
	// this is what the card is doing about it.
	const status = make('p', 'status', [spinner, statusWords]);

	const send = make('div', 'send', [instruction, qr, expiry, status]);

	const root = make('div', 'deposit', [summary, send]);
	root.hidden = true;

	/** the wait the send-by line's next reading is on, where one is outstanding. */
	let ticking: number | undefined;

	const stopTicking = (): void => {
		if (ticking === undefined) return;
		doc.defaultView?.clearTimeout(ticking);
		ticking = undefined;
	};

	/**
	 * the send-by line written for what is left of `total` now, and put on the wait until it reads
	 * something else.
	 *
	 * what is left is measured off the clock rather than counted down in steps, so a wait a
	 * backgrounded tab delivered late corrects itself on the next reading instead of holding a figure
	 * that has already run out. past the send-by the line has nothing to say and is withdrawn: the
	 * card is on its way to the screen that says the address closed (`awaitingDeposit` in ./views.ts).
	 */
	const countDown = (
		left: number,
		since: number,
		words: DepositScreen['expiry']['words']
	): void => {
		stopTicking();
		const remaining = left - (Date.now() - since);
		expiry.hidden = remaining <= 0;
		if (remaining <= 0) return;
		const line = expiryLine(remaining);
		text(expiry, words(line.figure, line.unit));
		ticking = doc.defaultView?.setTimeout(() => countDown(left, since, words), line.next);
	};

	return {
		root,
		stop: stopTicking,
		update(next) {
			stopTicking();
			// a new address is a new screen; the same one patched again leaves a Copy's outcome standing.
			const fresh = next?.address !== screen?.address;
			screen = next;
			root.hidden = next === null;
			if (next === null) return;
			if (fresh) {
				for (const copy of copies) {
					reports(copy.button, 'ready');
					copy.value.classList.remove('whole');
				}
				showCaution(false);
			}

			text(networkName, next.network);
			cautionMark.setAttribute('aria-label', `About sending on the ${next.network} network`);
			text(caution, next.networkWarning);
			// the gift and the fee are one decision: a fee stated beside a gift no figure names would
			// be a deduction from nothing. both are left out and the account is the total alone.
			gift.node.hidden = next.gift === null;
			if (next.gift !== null) gift.set(next.gift, next.ticker);
			fee.node.hidden = next.fee === null;
			if (next.fee !== null) fee.set(next.fee, next.ticker);
			total.set(next.total, next.ticker);

			text(lead, next.instruction.lead);
			text(sent, `${next.total.figure} ${next.ticker}`);
			text(toAddress, next.instruction.toAddress);
			addressRun.set(next.address);
			text(andMemo, next.memo === null ? '' : next.instruction.andMemo);
			memoRun.node.hidden = next.memo === null;
			memoRun.set(next.memo ?? '');

			const drawn = next.qr === null ? null : qrPath(next.qr);
			qr.hidden = drawn === null;
			if (drawn !== null && next.qr !== null) {
				qrSvg.setAttribute('viewBox', qrViewBox(next.qr.length));
				qrPathNode.setAttribute('d', drawn);
				// the module count, which is the one thing about the code's size the sheet cannot know:
				// the code is drawn at one line height per four modules (`.qr svg` in ./styles/parts.css),
				// so the width follows the matrix the address encoded to.
				qrSvg.style.setProperty('--_qr-columns', String(next.qr.length + 2 * QUIET_SIDE));
			}

			// the moment itself is kept, one hover away, for the donor who wants to plan against a date
			// rather than a duration.
			expiry.title = next.expiry.moment;
			countDown(next.expiry.left, Date.now(), next.expiry.words);
			text(statusWords, next.status);
		}
	};
}
