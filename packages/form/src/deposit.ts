// the address screen's own block: where and how much a donor sends a `crypto` gift, and the controls
// that copy it.
//
// built once and patched, for the reason ./views.ts is: the takeover it stands in is the same section
// for every full-card screen, and this is the part of that column no other screen has. the words are
// the card's (`takeoverFor` in ./views.ts) but for the labels; what is here is the order they are
// read in, the Copy controls, the QR, and the one line the card cannot write — the send-by, which
// counts down here because it goes on changing while nothing else on the screen does.
//
// one centred column in one reading order at every width — amount, network, the send-by, QR,
// address, memo, then the email and the status (`.deposit` in ./styles/layout.css).

import { type GlyphName, glyph } from './glyph';
import { part } from './parts';

/** the coarsest unit the time left still has a whole figure of. */
export type ExpiryUnit = 'day' | 'hour' | 'minute';

/** the block's words for one deposit, as the card writes them. */
export type DepositScreen = {
	/** the bare figure, verbatim off the quote: what Copy puts on the clipboard. */
	readonly coinAmount: string;
	/** the ticker shown after the figure. */
	readonly ticker: string;
	readonly about: string;
	readonly network: string;
	readonly networkWarning: string;
	readonly address: string;
	/** `null` where the payment carries no memo, which draws no memo row at all. */
	readonly memo: string | null;
	/** the memo's warning, `''` where the coin does not require one. */
	readonly memoWarning: string;
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
	readonly email: string;
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

/**
 * the drawing's box for a code `size` modules square, with the quiet zone iso/iec 18004 sets around
 * it — four modules on every side — so the margin a scanner needs is drawn in modules and scales
 * with them.
 */
function qrViewBox(size: number): string {
	const QUIET_MODULES = 4;
	const side = size + 2 * QUIET_MODULES;
	return `${-QUIET_MODULES} ${-QUIET_MODULES} ${side} ${side}`;
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
	 * a value set on one line, cut in the middle where the column is too narrow for it.
	 *
	 * a donor checks an address by its first and last characters against what their wallet shows, so
	 * the cut goes between them: a head that shrinks and ends in an ellipsis, and a tail of
	 * `TAIL_CHARACTERS` that never shrinks. `text-overflow` is the whole of the cut, so the two spans
	 * still hold every character — the value's text, and what assistive technology reads, is the
	 * whole value, and nothing is measured or re-sliced when the column changes width.
	 *
	 * `whole` sets it wrapped instead, for a copy the clipboard refused: a selection over a cut value
	 * would carry the hidden characters the donor cannot see they are copying.
	 */
	const oneLine = (): { readonly node: HTMLElement; set(value: string): void } => {
		const head = make('span', 'head');
		const tail = make('span', 'tail');
		const node = make('p', 'value line', [head, tail]);
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
	 * a Copy control for `value`, named for what it copies.
	 *
	 * the control reports its own outcome in place — a tick, or the danger mark with the value shown
	 * whole and selected so it can be copied by hand — and is ready again once the caret leaves it.
	 * the accessible name stays `Copy {noun}` throughout, and the outcome is said once on the card's
	 * live region.
	 *
	 * the marks are the whole of what the control shows, so that live region is the only report a
	 * donor who is not looking at the card gets: both outcomes say their sentence, and a silent arm
	 * here is a press that told such a donor nothing at all.
	 */
	const copyControl = (value: HTMLElement, noun: string, read: () => string): HTMLButtonElement => {
		const button = make('button', 'copy', [
			face('ready', 'copy'),
			face('copied', 'tick'),
			face('failed', 'alert')
		]);
		reports(button, 'ready');
		button.type = 'button';
		button.setAttribute('part', part('action-quiet'));
		button.setAttribute('aria-label', `Copy ${noun}`);
		const named = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`;
		const failed = (): void => {
			reports(button, 'failed');
			value.classList.add('whole');
			say(`${named} not copied. It is selected so you can copy it.`);
			const selection = doc.getSelection();
			if (selection === null) return;
			const range = doc.createRange();
			range.selectNodeContents(value);
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
		copies.push({ button, value });
		return button;
	};

	let screen: DepositScreen | null = null;
	const now = (): DepositScreen => {
		if (screen === null) throw new Error('unreachable: a Copy is pressed only on a drawn deposit');
		return screen;
	};

	// two spans and the space between them rather than one string, so the ticker can be ranked under
	// the figure (`.value.amount` in ./styles/parts.css) while the line stays one value to anything
	// reading the card rather than looking at it.
	const amountFigure = make('span', 'figure');
	const amountTicker = make('span', 'ticker');
	const amountValue = make('p', 'value amount', [amountFigure, ' ', amountTicker]);
	const about = make('p', 'aside');
	// the figure is what has to land, not what the donor's wallet is asked to send: a wallet or an
	// exchange takes its own fee out of a send, so a send of exactly this much arrives short. the
	// label is where that is said, because the fee is the sending wallet's and no figure on this
	// card can name it.
	const amount = make('div', 'held', [label('Amount that must arrive'), amountValue, about]);

	const networkValue = make('p', 'value name');
	const networkWarning = make('p', '');
	const network = make('div', 'held', [networkValue, networkWarning]);

	// one row each: the label, the value between them, and the Copy at the end (`.held.row` in
	// ./styles/layout.css). the value is the only one of the three that gives up width, so the two
	// rows read down the screen as the same shape whatever the address is.
	const addressValue = oneLine();
	const address = make('div', 'held row', [
		label('Address'),
		addressValue.node,
		copyControl(addressValue.node, 'address', () => now().address)
	]);

	const memoValue = oneLine();
	const memoWarning = make('p', 'attention');
	const memo = make('div', 'held row', [
		label('Memo or tag'),
		memoValue.node,
		copyControl(memoValue.node, 'memo', () => now().memo ?? ''),
		memoWarning
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

	// the send-by stands on the QR rather than among the notes: what closes is the address and the
	// code for it, and a line sitting under the fine print at the foot of the screen names neither.
	const expiry = make('p', 'expiry');
	const email = make('p', 'aside');
	const spinner = make('span', 'spinner');
	spinner.setAttribute('aria-hidden', 'true');
	const statusWords = make('span', '');
	const status = make('p', 'status', [spinner, statusWords]);

	// the send-by and the code are one group, so the line stands on the QR at the group's own step
	// rather than a screen's width away from what it is about.
	const code = make('div', 'held', [expiry, qr]);

	const root = make('div', 'deposit', [amount, network, code, address, memo, email, status]);
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
		total: number,
		since: number,
		words: DepositScreen['expiry']['words']
	): void => {
		stopTicking();
		const left = total - (Date.now() - since);
		expiry.hidden = left <= 0;
		if (left <= 0) return;
		const line = expiryLine(left);
		text(expiry, words(line.figure, line.unit));
		ticking = doc.defaultView?.setTimeout(() => countDown(total, since, words), line.next);
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
			}

			text(amountFigure, next.coinAmount);
			text(amountTicker, next.ticker);
			text(about, next.about);
			text(networkValue, `${next.network} network`);
			text(networkWarning, next.networkWarning);
			// one attention box on the screen: the memo's warning where the coin needs its memo, and the
			// network's everywhere else. the other stands as plain subtext under its own row.
			const memoIsLoud = next.memo !== null && next.memoWarning !== '';
			networkWarning.className = memoIsLoud ? 'aside' : 'attention';
			addressValue.set(next.address);
			memo.hidden = next.memo === null;
			memoValue.set(next.memo ?? '');
			text(memoWarning, next.memoWarning);
			memoWarning.hidden = !memoIsLoud;

			const drawn = next.qr === null ? null : qrPath(next.qr);
			qr.hidden = drawn === null;
			if (drawn !== null && next.qr !== null) {
				qrSvg.setAttribute('viewBox', qrViewBox(next.qr.length));
				qrPathNode.setAttribute('d', drawn);
			}

			// the moment itself is kept, one hover away, for the donor who wants to plan against a date
			// rather than a duration.
			expiry.title = next.expiry.moment;
			countDown(next.expiry.left, Date.now(), next.expiry.words);
			text(email, next.email);
			text(statusWords, next.status);
		}
	};
}
