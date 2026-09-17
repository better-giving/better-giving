// the rows the payment box lists outside the provider's frame: one per PayPal rail, the fund's, and
// the crypto option's.
//
// the provider paints its own rails as rows inside its frame (`layout` in ./stripe.ts), and a donor
// reads the box as one list, so the options the other adapters draw are rows of the same shape: the
// rail's mark at the start, its name after it, no line between one row and the next, and the rail's
// own branded button behind a press on the name. the row reports nothing to the flow. opening one is
// looking rather than choosing — the button inside it is still the press that chooses, exactly as it
// was with no row around it.
//
// each row is a light-DOM node with a shadow root of its own. light DOM because what it holds is a
// processor's own element, which has to stay reachable by that processor's script (Chariot's finds
// its element by a document query, ./chariot.ts); a shadow root because a host page's stylesheet
// reaches light DOM, and a `button { … }` rule on their page would otherwise redraw the row's name.
// the branded button is slotted, so it stays in the document tree while the name, the mark and the
// panel it is drawn in stay out of a host's reach.
//
// which row is open across the whole box is ./surface.ts's to decide, because the provider's rows
// are in it too: a row here says it was opened and closes when told, and never closes its
// neighbours itself.

import rowStyles from '../styles/rows.css?inline';

/** which mark a row carries. */
export type RowMark = 'paypal' | 'venmo' | 'fund' | 'crypto';

/** one row, as the adapter that drew it and the composer that coordinates it hold it. */
export type Row = {
	readonly name: string;
	readonly expanded: boolean;
	/** opens the row and says so, as a press on its name does. */
	expand(): void;
	/** closes the row and says nothing, which is what a neighbour opening asks of it. */
	collapse(): void;
};

/** who hears a row list change: a row drawn or taken away, and a row a donor opened. */
export type RowWatcher = {
	readonly changed: () => void;
	readonly opened: (row: Row) => void;
};

/** the rows one adapter has drawn, in the order they stand. */
export type RowList = {
	current(): readonly Row[];
	/** one watcher at a time; a second call replaces the first. */
	watch(watcher: RowWatcher): void;
};

/** a row list plus the two things only the adapter drawing it does. */
export type RowDrawer = RowList & {
	/**
	 * a row holding `content`, appended to the mount closed.
	 *
	 * `toggled` hears the row open and close, whoever asked — the donor's press or ./surface.ts closing
	 * it for a neighbour — for a row whose opening is itself the choice.
	 */
	draw(name: string, mark: RowMark, content: HTMLElement, toggled?: (open: boolean) => void): Row;
	/** the row taken off the page along with what it holds. */
	erase(row: Row): void;
};

/**
 * the geometry the row's own node is pinned to, for the reason `PINNED` in ./surface.ts pins the
 * adapter's: a host page's stylesheet reaches this node, and an inline declaration outranks it.
 */
const PINNED =
	'display:block;box-sizing:border-box;margin:0;padding:0;border:0;background:none;' +
	'inline-size:100%;position:static;float:none;overflow:visible';

/** one path of a drawn glyph, as its source file states it. */
type GlyphPath = { readonly d: string; readonly fill: string };

/** a glyph as its source file draws it: the file's own viewBox and paths, in order, each with its fill. */
type Glyph = { readonly viewBox: string; readonly paths: readonly GlyphPath[] };

/**
 * each row's mark as the company behind the rail publishes it,
 * https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-mark-color.svg,
 * https://www.paypalobjects.com/paypal-ui/logos/svg/venmo-mark-color.svg and Chariot's icon glyph
 * from https://www.givechariot.com, paths and fills verbatim — including Chariot's third path, which
 * its file draws as a degenerate hairline: a glyph pruned is a trademark redrawn.
 *
 * PayPal's file wraps its paths in a clip-path whose rectangle trims under a thousandth of a unit off
 * the lighter blue's curve and nothing else, so it is left out: an id in a row's shadow root would be
 * one more name a second row, or a host page's own `#a`, could answer.
 *
 * the fund's is the single-colour icon rather than the blue logo, so every path is `currentColor`: it
 * takes the head's own ink and changes with the row's open state exactly as the name beside it does
 * (`.head` in ../styles/rows.css). the processors' are their brands' colours and change with
 * nothing.
 *
 * raw-colour-ok: PayPal's, Venmo's and NOWPayments' fills are a third party's trademark rather than a
 * colour of this card. the provider's own rows carry their brands' marks in their brands' colours inside its frame,
 * and these stand in that list.
 */
const BRAND_MARKS: Readonly<Record<RowMark, Glyph>> = {
	paypal: {
		viewBox: '0 0 48 48',
		paths: [
			{
				fill: '#002991',
				d: 'M38.914 13.35c0 5.574-5.144 12.15-12.927 12.15H18.49l-.368 2.322L16.373 39H7.056l5.605-36h15.095c5.083 0 9.082 2.833 10.555 6.77a9.687 9.687 0 0 1 .603 3.58z'
			},
			{
				fill: '#60CDFF',
				d: 'M44.284 23.7A12.894 12.894 0 0 1 31.53 34.5h-5.206L24.157 48H14.89l1.483-9 1.75-11.178.367-2.322h7.497c7.773 0 12.927-6.576 12.927-12.15 3.825 1.974 6.055 5.963 5.37 10.35z'
			},
			{
				fill: '#008CFF',
				d: 'M38.914 13.35C37.31 12.511 35.365 12 33.248 12h-12.64L18.49 25.5h7.497c7.773 0 12.927-6.576 12.927-12.15z'
			}
		]
	},
	venmo: {
		viewBox: '0 0 48 48',
		paths: [
			{
				fill: '#008CFF',
				d: 'M42.3 2L28.5 4.8c.8 1.9 1.4 4.1 1.4 7.4 0 6-4.2 14.8-7.7 20.4L18.5 3 3.3 4.5l7 41.5h17.4c7.7-10 17-24.3 17-35.2 0-3.4-.8-6.1-2.4-8.8z'
			}
		]
	},
	// NOWPayments' favicon, https://nowpayments.io/images/favicon.ico: a 64px raster of two squares,
	// written as the two paths its pixels draw, fills verbatim.
	crypto: {
		viewBox: '0 0 64 64',
		paths: [
			{ fill: '#68AAFF', d: 'M0 0h64v64H0z' },
			{ fill: '#000000', d: 'M15 15h34v34H15z' }
		]
	},
	fund: {
		viewBox: '0 0 33 33',
		paths: [
			{
				fill: 'currentColor',
				d: 'M21.3593 19.2541C24.1229 19.2541 26.6921 20.1373 28.8365 21.6544C29.0278 21.7892 29.1009 22.0521 29.0091 22.2766C26.9207 27.4102 22.1357 31 16.5648 31C13.8011 31 11.2319 30.1167 9.0876 28.5996C8.89619 28.4649 8.823 28.202 8.91481 27.9774C11.0031 22.8438 15.7883 19.2541 21.3593 19.2541Z'
			},
			{
				fill: 'currentColor',
				d: 'M6.41421 6.88072C6.60095 6.65622 6.92927 6.65618 7.11599 6.88072C9.24011 9.44086 10.5301 12.8079 10.5301 16.4992C10.5301 20.1905 9.24011 23.5575 7.11599 26.1177C6.92927 26.3422 6.60096 26.3422 6.41421 26.1177V26.1193C4.2901 23.5591 3 20.1921 3 16.5008C3.00001 12.8095 4.29011 9.44251 6.41421 6.88072Z'
			},
			{
				fill: 'currentColor',
				d: 'M22.8516 16.995H22.8501L22.8505 16.9948C22.8509 16.9948 22.8512 16.995 22.8516 16.995Z'
			},
			{
				fill: 'currentColor',
				d: 'M16.5648 2C23.4117 2 29.073 7.42316 29.9958 14.4715C30.0207 14.6677 29.9335 14.8624 29.7748 14.9639C27.7473 16.253 25.3806 16.9947 22.8505 16.9948C16.0025 16.9943 10.3418 11.5715 9.41903 4.52353C9.39416 4.32726 9.48129 4.13261 9.63999 4.03114C11.6676 2.74193 14.0345 2.00001 16.5648 2Z'
			}
		]
	}
};

const SVG = 'http://www.w3.org/2000/svg';

/** `glyph` as the row's decorative mark; the name beside it is what a reader hears. */
function drawGlyph(doc: Document, glyph: Glyph): SVGElement {
	const svg = doc.createElementNS(SVG, 'svg');
	svg.setAttribute('class', 'mark');
	svg.setAttribute('viewBox', glyph.viewBox);
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	for (const { d, fill } of glyph.paths) {
		const path = doc.createElementNS(SVG, 'path');
		path.setAttribute('d', d);
		path.setAttribute('fill', fill);
		svg.appendChild(path);
	}
	return svg;
}

/**
 * the row sheet, built once per document for the reason `sheetsFor` in ../element.ts builds its own.
 */
const sheets = new WeakMap<Document, CSSStyleSheet>();

function sheetFor(doc: Document): readonly CSSStyleSheet[] {
	const held = sheets.get(doc);
	if (held !== undefined) return [held];
	const view = doc.defaultView;
	if (view === null) return [];
	const sheet = new view.CSSStyleSheet();
	sheet.replaceSync(rowStyles);
	sheets.set(doc, sheet);
	return [sheet];
}

/** the rows an adapter draws into `mount`, in the order it draws them. */
export function createRows(mount: HTMLElement): RowDrawer {
	const doc = mount.ownerDocument;
	const drawn: { readonly row: Row; readonly host: HTMLElement }[] = [];
	let watcher: RowWatcher | null = null;

	return {
		current: () => drawn.map((entry) => entry.row),
		watch(next) {
			watcher = next;
		},
		draw(name, mark, content, toggled) {
			const host = doc.createElement('div');
			host.style.cssText = PINNED;
			const root = host.attachShadow({ mode: 'open' });
			root.adoptedStyleSheets = [...sheetFor(doc)];

			const head = doc.createElement('button');
			head.type = 'button';
			head.className = 'head';
			head.id = 'head';
			head.setAttribute('aria-expanded', 'false');
			head.setAttribute('aria-controls', 'panel');
			const label = doc.createElement('span');
			label.className = 'name';
			label.textContent = name;
			head.appendChild(drawGlyph(doc, BRAND_MARKS[mark]));
			head.appendChild(label);

			const panel = doc.createElement('div');
			panel.className = 'panel';
			panel.id = 'panel';
			panel.setAttribute('role', 'region');
			panel.setAttribute('aria-labelledby', 'head');
			panel.hidden = true;
			panel.appendChild(doc.createElement('slot'));

			const band = doc.createElement('div');
			band.className = 'band';
			band.appendChild(head);
			band.appendChild(panel);
			root.appendChild(band);
			host.appendChild(content);

			const show = (open: boolean): void => {
				const was = !panel.hidden;
				head.setAttribute('aria-expanded', String(open));
				panel.hidden = !open;
				band.classList.toggle('open', open);
				if (was !== open) toggled?.(open);
			};

			const row: Row = {
				name,
				get expanded() {
					return !panel.hidden;
				},
				expand() {
					if (!panel.hidden) return;
					show(true);
					watcher?.opened(row);
				},
				collapse: () => show(false)
			};
			head.addEventListener('click', () => (row.expanded ? row.collapse() : row.expand()));

			mount.appendChild(host);
			drawn.push({ row, host });
			watcher?.changed();
			return row;
		},
		erase(row) {
			const at = drawn.findIndex((entry) => entry.row === row);
			if (at === -1) return;
			const [entry] = drawn.splice(at, 1);
			// closed on the way out, so a row whose opening was a choice takes the choice with it.
			entry?.row.collapse();
			entry?.host.remove();
			watcher?.changed();
		}
	};
}
