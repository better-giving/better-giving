// a saved pledge's own block on the full-card screen: what was pledged, where it is sent, the
// controls that copy each value a donor hands on, the benefits panel, and the notice the screen
// carries.
//
// built once and patched, for the reason ./views.ts is. the words are the card's (`takeoverFor` in
// ./views.ts, off the rows in ./pledge.ts); what is here is the order they are read in and the Copy
// controls, which are the address screen's controls in a list rather than in a sentence
// (`run` in ./deposit.ts).
//
// the order is the screen's: the info notice heads the thank-you, the error notice stands under the
// panel it follows on the pending screen, directly over the press it asks the donor to make again.

import { type GlyphName, glyph } from './glyph';
import type { PledgeRail } from './embed/rails';
import type { PledgeRow } from './pledge';
import { part } from './parts';

/** a notice the registry's notice card draws (../registry/styles/notice-card-css.usage.md). */
export type PledgeNotice = {
	readonly tone: 'info' | 'destructive';
	readonly title: string;
	readonly body: string;
};

/** the benefits panel's words. */
export type Benefits = { readonly title: string; readonly body: string; readonly fine: string };

const NOT_ADVICE =
	'This is general information, not tax advice. Talk to your tax adviser about your own situation.';

/**
 * each pledge rail's benefits panel, as the design package states it word for word. the claims await
 * legal review before the change carrying them merges, and no figure is stated in either.
 */
export const BENEFITS: Readonly<Record<PledgeRail, Benefits>> = {
	stock: {
		title: 'Benefits of donating appreciated stock',
		body: 'Give shares you have held for more than a year and you may deduct their full market value, without paying the capital gains tax you would owe if you sold them.',
		fine: NOT_ADVICE
	},
	ira_qcd: {
		title: 'Benefits of giving from an IRA',
		body: 'If you are 70½ or older, you can give up to the annual QCD limit straight from your IRA. It counts toward your required minimum distribution and isn’t added to your taxable income.',
		fine: NOT_ADVICE
	}
};

/** the block's words for one screen, as the card writes them. */
export type PledgeScreen = {
	readonly notice: PledgeNotice | null;
	readonly summary: readonly PledgeRow[];
	/** where the gift is sent, `null` on the thank-you, which lists what was pledged alone. */
	readonly details: readonly PledgeRow[] | null;
	readonly benefits: Benefits | null;
};

export type PledgeView = {
	readonly root: HTMLElement;
	/** the block patched to `screen`, or taken off the card where it is `null`. */
	update(screen: PledgeScreen | null): void;
};

/** what a Copy control last reported, as `data-outcome` on it, which picks the face it shows. */
type CopyOutcome = 'ready' | 'copied' | 'failed';

/**
 * the benefits panel: a title, the claim, and the fine print under it. a heading at `level`, so it
 * sits one rank under whatever heading the panel stands below.
 */
export function benefitsPanel(doc: Document, benefits: Benefits, level: 'h3' | 'h4'): HTMLElement {
	const title = doc.createElement(level);
	title.className = 'benefits-title';
	title.textContent = benefits.title;
	const body = doc.createElement('p');
	body.className = 'benefits-body';
	body.textContent = benefits.body;
	const fine = doc.createElement('p');
	fine.className = 'benefits-fine';
	fine.textContent = benefits.fine;
	const panel = doc.createElement('div');
	panel.className = 'benefits';
	panel.append(title, body, fine);
	return panel;
}

export function createPledgeBlock(
	doc: Document,
	/** the card's live region, for the one sentence a Copy says (`say` in ./views.ts). */
	say: (words: string) => void
): PledgeView {
	const make = <K extends keyof HTMLElementTagNameMap>(
		tag: K,
		className: string,
		children: readonly (Node | string)[] = []
	): HTMLElementTagNameMap[K] => {
		const element = doc.createElement(tag);
		if (className !== '') element.className = className;
		element.append(...children);
		return element;
	};

	/**
	 * one notice, in its tone. the role is the tone's (the usage file's Accessibility): an error is
	 * `alert` and the thank-you's news is `status`, each set as the notice is written so the words
	 * arrive into a region that is already there.
	 */
	const notice = (id: string) => {
		const icon = make('span', 'ds-notice-card-icon');
		icon.setAttribute('aria-hidden', 'true');
		const title = make('p', 'ds-notice-card-title');
		title.id = id;
		const body = make('div', 'ds-notice-card-body');
		const node = make('section', 'ds-notice-card', [
			icon,
			make('div', 'ds-notice-card-content', [make('div', 'ds-notice-card-text', [title, body])])
		]);
		node.setAttribute('aria-labelledby', id);
		node.hidden = true;
		return {
			node,
			set(next: PledgeNotice | null) {
				node.hidden = next === null;
				if (next === null) {
					node.removeAttribute('role');
					return;
				}
				const mark: GlyphName = next.tone === 'info' ? 'info' : 'alert';
				node.className = `ds-notice-card ds-notice-card-${next.tone}`;
				node.setAttribute('role', next.tone === 'info' ? 'status' : 'alert');
				icon.replaceChildren(glyph(doc, mark, 'notice-glyph'));
				if (title.textContent !== next.title) title.textContent = next.title;
				if (body.textContent !== next.body) body.textContent = next.body;
			}
		};
	};

	/**
	 * the control that copies one value: the copy mark alone, named `Copy {noun}` and described by the
	 * value, so what it copies is said after its name.
	 *
	 * it reports its own outcome in place — a tick, or the danger mark with the value selected so it
	 * can be copied by hand — and says it on the card's region, which is the only report a donor not
	 * looking at it gets. ready again once the caret leaves it. the same control and the same two
	 * sentences as the address screen's (`run` in ./deposit.ts).
	 */
	const copyControl = (row: PledgeRow & { readonly copy: string }, value: HTMLElement) => {
		const face = (outcome: CopyOutcome, mark: GlyphName) =>
			make('span', `copy-face ${outcome}`, [glyph(doc, mark, 'copy-glyph')]);
		const button = make('button', 'copy', [
			face('ready', 'copy'),
			face('copied', 'tick'),
			face('failed', 'alert')
		]);
		button.type = 'button';
		button.dataset.outcome = 'ready';
		button.setAttribute('part', part('action-quiet'));
		button.setAttribute('aria-label', `Copy ${row.copy}`);
		button.setAttribute('aria-describedby', value.id);
		const named = `${row.copy.charAt(0).toUpperCase()}${row.copy.slice(1)}`;
		const failed = (): void => {
			button.dataset.outcome = 'failed';
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
			clipboard.writeText(row.value).then(() => {
				button.dataset.outcome = 'copied';
				say(`${named} copied.`);
			}, failed);
		});
		button.addEventListener('blur', () => {
			button.dataset.outcome = 'ready';
		});
		return button;
	};

	/** a list of rows, as `<dt>` and `<dd>` pairs in one `<div>` each, rebuilt when its rows change. */
	const list = (className: string, prefix: string) => {
		const node = make('dl', `pledge-list ${className}`);
		let drawn = '';
		return {
			node,
			set(rows: readonly PledgeRow[] | null) {
				node.hidden = rows === null;
				const key = JSON.stringify(rows);
				if (rows === null || key === drawn) return;
				drawn = key;
				node.replaceChildren(
					...rows.map((row, at) => {
						const value = make('dd', row.mono === true ? 'pledge-value mono' : 'pledge-value', [
							row.value
						]);
						value.id = `${prefix}-${at}`;
						const entry = make('div', 'pledge-row', [
							make('dt', 'pledge-label', [row.label]),
							value
						]);
						const { copy } = row;
						if (copy !== undefined) entry.append(copyControl({ ...row, copy }, value));
						return entry;
					})
				);
			}
		};
	};

	const topNotice = notice('pledge-notice-top');
	const footNotice = notice('pledge-notice-foot');
	const summary = list('pledge-summary', 'pledge-summary');
	const details = list('pledge-details', 'pledge-detail');
	const benefits = make('div', 'pledge-benefits');
	let benefitsDrawn = '';

	const root = make('div', 'pledge', [
		topNotice.node,
		summary.node,
		details.node,
		benefits,
		footNotice.node
	]);
	root.hidden = true;

	return {
		root,
		update(screen) {
			root.hidden = screen === null;
			if (screen === null) return;
			topNotice.set(screen.notice?.tone === 'info' ? screen.notice : null);
			footNotice.set(screen.notice?.tone === 'destructive' ? screen.notice : null);
			summary.set(screen.summary);
			details.set(screen.details);
			benefits.hidden = screen.benefits === null;
			const key = JSON.stringify(screen.benefits);
			if (screen.benefits !== null && key !== benefitsDrawn) {
				benefitsDrawn = key;
				benefits.replaceChildren(benefitsPanel(doc, screen.benefits, 'h3'));
			}
		}
	};
}
