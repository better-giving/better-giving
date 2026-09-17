// the address screen's own block: where and how much a donor sends a `crypto` gift, and the controls
// that copy it.
//
// built once and patched, for the reason ./views.ts is: the takeover it stands in is the same section
// for every full-card screen, and this is the part of that column no other screen has. the words are
// the card's (`takeoverFor` in ./views.ts); what is here is the order they are read in, the Copy
// controls, and the QR.
//
// the reading order is fixed at every width — amount, network, address, memo, QR, send-by, the
// wallet-fee line, the email line, the status — and the layout never reorders it (`.deposit` in
// ./styles/layout.css).

import { part } from './parts';

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
	readonly sendBy: string;
	readonly walletFee: string;
	readonly email: string;
	readonly status: string;
};

export type DepositView = {
	readonly root: HTMLElement;
	/** the block patched to `screen`, or taken off the card where it is `null`. */
	update(screen: DepositScreen | null): void;
};

const SVG = 'http://www.w3.org/2000/svg';

/** the words a Copy control reads in each of its three states. */
const COPY = 'Copy';
const COPIED = 'Copied';
const COPY_FAILED = 'Copy failed';

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

	/**
	 * a Copy control reads `words`. every label it can read stands in the control at once, the others
	 * drawn invisible, so the control is as wide as its widest label whichever it reads
	 * (`.held-line [part~='action-quiet']` in ./styles/layout.css).
	 */
	const reads = (button: HTMLButtonElement, words: string): void => {
		for (const node of button.children) node.classList.toggle('said', node.textContent === words);
	};

	/** every Copy control, so a new screen puts each back to reading Copy. */
	const copies: HTMLButtonElement[] = [];

	/**
	 * a Copy control for `value`, named for what it copies.
	 *
	 * the control reports its own outcome in place — `Copied`, or `Copy failed` with the value selected
	 * so it can be copied by hand — and reads `Copy` again once the caret leaves it. the accessible name
	 * stays `Copy {noun}` throughout, and the outcome is said once on the card's live region.
	 */
	const copyControl = (value: HTMLElement, noun: string, read: () => string): HTMLButtonElement => {
		const button = make(
			'button',
			'',
			[COPY, COPIED, COPY_FAILED].map((words) => make('span', '', [words]))
		);
		reads(button, COPY);
		button.type = 'button';
		button.setAttribute('part', part('action-quiet'));
		button.setAttribute('aria-label', `Copy ${noun}`);
		const failed = (): void => {
			reads(button, COPY_FAILED);
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
				reads(button, COPIED);
				say(`${noun.charAt(0).toUpperCase()}${noun.slice(1)} copied.`);
			}, failed);
		});
		button.addEventListener('blur', () => reads(button, COPY));
		copies.push(button);
		return button;
	};

	let screen: DepositScreen | null = null;
	const now = (): DepositScreen => {
		if (screen === null) throw new Error('unreachable: a Copy is pressed only on a drawn deposit');
		return screen;
	};

	const amountValue = make('p', 'value amount');
	const about = make('p', 'aside');
	const amount = make('div', 'held', [
		label('Amount to send'),
		make('div', 'held-line', [
			amountValue,
			copyControl(amountValue, 'amount', () => now().coinAmount)
		]),
		about
	]);

	const networkValue = make('p', 'value name');
	const networkWarning = make('p', '');
	const network = make('div', 'held', [label('Network'), networkValue, networkWarning]);

	const addressValue = make('p', 'value');
	const address = make('div', 'held', [
		label('Address'),
		make('div', 'held-line', [
			addressValue,
			copyControl(addressValue, 'address', () => now().address)
		])
	]);

	const memoValue = make('p', 'value');
	const memoWarning = make('p', 'attention');
	const memo = make('div', 'held', [
		label('Memo or tag'),
		make('div', 'held-line', [memoValue, copyControl(memoValue, 'memo', () => now().memo ?? '')]),
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

	const sendBy = make('p', 'aside');
	const walletFee = make('p', 'aside');
	const email = make('p', 'aside');
	const spinner = make('span', 'spinner');
	spinner.setAttribute('aria-hidden', 'true');
	const statusWords = make('span', '');
	const status = make('p', 'status', [spinner, statusWords]);

	const root = make('div', 'deposit', [
		amount,
		network,
		address,
		memo,
		qr,
		sendBy,
		walletFee,
		email,
		status
	]);
	root.hidden = true;

	return {
		root,
		update(next) {
			// a new address is a new screen; the same one patched again leaves a Copy's outcome standing.
			const fresh = next?.address !== screen?.address;
			screen = next;
			root.hidden = next === null;
			if (next === null) return;
			if (fresh) for (const button of copies) reads(button, COPY);

			text(amountValue, `${next.coinAmount} ${next.ticker}`);
			text(about, next.about);
			text(networkValue, next.network);
			text(networkWarning, next.networkWarning);
			// one attention box on the screen: the memo's warning where the coin needs its memo, and the
			// network's everywhere else. the other stands as plain subtext under its own row.
			const memoIsLoud = next.memo !== null && next.memoWarning !== '';
			networkWarning.className = memoIsLoud ? 'aside' : 'attention';
			text(addressValue, next.address);
			memo.hidden = next.memo === null;
			text(memoValue, next.memo ?? '');
			text(memoWarning, next.memoWarning);
			memoWarning.hidden = !memoIsLoud;

			const drawn = next.qr === null ? null : qrPath(next.qr);
			qr.hidden = drawn === null;
			if (drawn !== null && next.qr !== null) {
				qrSvg.setAttribute('viewBox', `0 0 ${next.qr.length} ${next.qr.length}`);
				qrPathNode.setAttribute('d', drawn);
			}

			text(sendBy, next.sendBy);
			text(walletFee, next.walletFee);
			text(email, next.email);
			text(statusWords, next.status);
		}
	};
}
