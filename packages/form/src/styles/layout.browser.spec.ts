import { afterEach, describe, expect, it } from 'vitest';
import layoutStyles from './layout.css?inline';
import partStyles from './parts.css?inline';

// the browser pool. what is asserted here is what a lightweight DOM cannot see at all: how the
// amount tiles actually flowed — how many to a row, and whether any row came out short — which unit
// the lengths that decide it resolve against, and whether the attribute this element hides its
// screens with survives the cascade. happy-dom lays nothing out and reads `hidden` off the idl
// property, so the `dom` pool would agree just as readily with a `rem` that had moved every tile
// row, with an orphan on every odd count, and with a `hidden` that was rendering both steps stacked
// on top of each other.

/**
 * the tiles as the engine actually flowed them: one entry per row, in the order they were drawn.
 *
 * grouped by the top edge rather than by any declared column count, because the flow is intrinsic —
 * there is no `grid-template-columns` left to read, and a row that came out one tile short is a
 * fact about laid-out boxes.
 */
function rows(tiles: HTMLElement): { count: number; right: number }[] {
	const lines = new Map<number, { count: number; right: number }>();
	for (const child of Array.from(tiles.children)) {
		const box = child.getBoundingClientRect();
		const top = Math.round(box.top);
		const line = lines.get(top) ?? { count: 0, right: 0 };
		lines.set(top, { count: line.count + 1, right: Math.max(line.right, box.right) });
	}
	return Array.from(lines.values());
}

/** how many tiles the first row of the amount grid took. */
function perRow(tiles: HTMLElement): number {
	return rows(tiles)[0]?.count ?? 0;
}

/**
 * where a full row ends: the tray's content edge, inside the pad and the hairline ../styles/parts.css
 * draws around it. a row is measured against this rather than against the tray's own box, because
 * the boxes on it are laid out inside the inset and never reach the edge.
 */
function contentRight(tiles: HTMLElement): number {
	const drawn = getComputedStyle(tiles);
	return (
		tiles.getBoundingClientRect().right -
		Number.parseFloat(drawn.paddingRight) -
		Number.parseFloat(drawn.borderRightWidth)
	);
}

/** the width the boxes on the tray have to share, for the same reason. */
function contentWidth(tiles: HTMLElement): number {
	const drawn = getComputedStyle(tiles);
	return (
		tiles.clientWidth - Number.parseFloat(drawn.paddingLeft) - Number.parseFloat(drawn.paddingRight)
	);
}

/**
 * one tile per preset the deployment serves, plus the free entry last, as ../views.ts builds them.
 * the other tile is one more label on the tray and is not drawn here: a count is a count.
 *
 * the widest figure this component's own bounds allow is what each tile holds: the floor a tile
 * wraps against is the width that figure needs, so a narrower string would measure a flow no donor
 * is ever shown.
 */
function fill(tiles: HTMLElement, presets: number): void {
	for (let at = 0; at < presets; at += 1) {
		const tile = document.createElement('label');
		tile.setAttribute('part', 'amount-option');
		tile.textContent = '$1,000';
		tiles.appendChild(tile);
	}
	const entry = document.createElement('div');
	entry.className = 'tile entry';
	entry.setAttribute('part', 'amount-input');
	tiles.appendChild(entry);
}

type Card = {
	readonly host: HTMLElement;
	readonly body: HTMLElement;
	readonly tiles: HTMLElement;
	readonly give: HTMLElement;
	readonly takeover: HTMLElement;
};

/**
 * one card at a fixed width, under a document root of the caller's choosing.
 *
 * the card carries the same clamped font-size ../styles/tokens.css gives `:host`, because that is
 * the value the breakpoints are supposed to resolve against.
 *
 * the tokens the two sheets spend on width are set here rather than taken from ../styles/tokens.css,
 * whose `:host` block matches nothing in this document: a length written in a token that resolved to
 * nothing is a declaration the engine drops whole, and the padded interior and the tile gap are both
 * inside what is measured. each is the expression that file states, so a step moved there is a step
 * this fixture follows rather than a number copied off it.
 *
 * the tiles sit inside the padded interior the card draws them in, so a width named below is the
 * card's own and the grid is measured at what is left after the inset — which is what makes 375px
 * here the 375px viewport the form is laid out against.
 *
 * both stylesheets are adopted, in the order ../element.ts adopts them, because half of what is
 * asserted here is a question about the cascade between them.
 */
function card(width: string, rootFontSize: string, cardFontSize = '16px'): Card {
	document.documentElement.style.fontSize = rootFontSize;

	const host = document.createElement('div');
	host.style.cssText =
		`container-type: inline-size; container-name: donate; inline-size: ${width};` +
		` font-size: ${cardFontSize}; --_root-size: ${cardFontSize}; --_sp1: 0.25em;` +
		' --_sp2: 0.5em; --_sp3: 0.75em; --_sp4: 1em; --_sp5: 1.25em; --_border: 1px;' +
		' --_t-sm: 0.875em; --_t-md: 1em;' +
		' --_inset: calc(var(--_root-size) * 1.25); --_inset-wide: calc(var(--_root-size) * 1.75);' +
		' --_row-min: 44px;';

	const body = document.createElement('div');
	body.className = 'card-body';
	const tiles = document.createElement('div');
	tiles.className = 'tiles';
	const give = document.createElement('section');
	give.className = 'step step-give';
	const takeover = document.createElement('section');
	takeover.className = 'step takeover';
	// `appendChild`, not `append`: `worker-configuration.d.ts` declares a global `Element.append`
	// for HTMLRewriter, and TypeScript merges it with the DOM's — the same reason `put` exists in
	// ../views.ts.
	body.appendChild(tiles);
	body.appendChild(give);
	body.appendChild(takeover);
	host.appendChild(body);

	const paint = new CSSStyleSheet();
	paint.replaceSync(partStyles);
	const sheet = new CSSStyleSheet();
	sheet.replaceSync(layoutStyles);
	document.adoptedStyleSheets = [paint, sheet];
	document.body.appendChild(host);

	return { host, body, tiles, give, takeover };
}

afterEach(() => {
	document.documentElement.style.fontSize = '';
	document.adoptedStyleSheets = [];
	document.body.replaceChildren();
});

describe('how many tiles a row takes', () => {
	// the amount grid states no breakpoint of its own: it holds three tiles where three of them are
	// wide enough to hold a four-figure amount and two where they are not, which is a question about
	// the tiles rather than about the card. what still has to be true is the thing a breakpoint was
	// carrying — that the floor is read against the card's own clamped text and never against the
	// host document's root — and that is now the `em` in ../styles/layout.css's tile minimum.
	it('resolves the tile minimum against the card, not against the host document root', () => {
		// the claim the `em` is there for. a host running `html { font-size: 62.5% }` — the 10px root
		// a whole generation of CSS was written against — would make a `rem` floor 60px, and three
		// tiles of 88px would fit the 280px this card leaves. read against the card's own 16px the
		// floor is 96px, three of them do not fit, and the row stays at two.
		const { tiles } = card('320px', '62.5%');
		fill(tiles, 6);

		expect(perRow(tiles)).toBe(2);
	});

	it('goes three-up once the card itself is genuinely wide enough', () => {
		// the other half: the flow still opens up. a 400px card leaves 360px, and three tiles of 114px
		// each are past the floor.
		const { tiles } = card('400px', '62.5%');
		fill(tiles, 6);

		expect(perRow(tiles)).toBe(3);
	});

	it('is unmoved by a host root that grew instead of shrank', () => {
		// a `rem` floor moves in both directions. at a 24px root it would be 144px, which would hold
		// this card at two and waste the width the third tile fits in.
		const { tiles } = card('400px', '24px');
		fill(tiles, 6);

		expect(perRow(tiles)).toBe(3);
	});

	it('follows the card’s own font-size, which is what the clamp then bounds', () => {
		// the same card twice, at the two ends of the clamp band in ../styles/tokens.css. the floor
		// tracks the card's text, so the card whose text is a fifth larger legitimately holds one
		// tile fewer — and the clamp is what keeps that tracking inside a known range rather than
		// following a host anywhere it likes.
		const wide = card('370px', '16px');
		fill(wide.tiles, 6);

		expect(perRow(wide.tiles)).toBe(3);

		document.body.replaceChildren();
		const large = card('370px', '16px', '18px');
		fill(large.tiles, 6);

		expect(perRow(large.tiles)).toBe(2);
	});

	// never four, however wide the card gets. the tiles are shortcuts past the free entry and a row
	// of them is read at a glance; the width a wide card has spare goes into the tiles rather than
	// into more of them.
	it('never puts a fourth tile on a row, at any width', () => {
		const { tiles } = card('900px', '16px');
		fill(tiles, 12);

		expect(rows(tiles).map((line) => line.count)).toEqual([3, 3, 3, 3, 1]);
	});
});

// the columns: every row of tiles has the ones the first row has, and a row that came out short
// leaves a cell empty rather than stretching a tile into it. the count is the org's and every
// count between none and the dozen `MAX_SUGGESTED_AMOUNTS` allows
// (../../../app/src/lib/forms/amounts.ts) has to lay out that way, at the narrow card and at the
// wide one — 7 and 11 are the counts no choice of two or three columns fills.
//
// the free entry is inside the grid rather than under it, and it is the one box allowed the whole
// row, so it is left out of the tiles measured here and measured on its own below.
describe('the amount grid at every count an org can serve', () => {
	// none is a bare tray with no tile on it (`tiled` in ../views.ts) and has no columns to keep.
	const COUNTS = [2, 5, 7, 12];
	const WIDTHS = ['320px', '375px', '480px'];

	/** every tile's box, the entry left out. */
	function presets(tiles: HTMLElement): DOMRect[] {
		return Array.from(tiles.children)
			.filter((child) => !child.classList.contains('entry'))
			.map((child) => child.getBoundingClientRect());
	}

	it.each(COUNTS)('draws every tile at one width, at %i presets', (count) => {
		for (const width of WIDTHS) {
			const { tiles } = card(width, '16px');
			fill(tiles, count);
			const boxes = presets(tiles);
			const first = boxes[0]?.width;

			for (const box of boxes) expect(box.width, width).toBeCloseTo(first ?? 0, 0);
		}
	});

	it.each(COUNTS)('starts every tile on a column the first row has, at %i presets', (count) => {
		for (const width of WIDTHS) {
			const { tiles } = card(width, '16px');
			fill(tiles, count);
			const boxes = presets(tiles);
			const columns = boxes
				.filter((box) => Math.round(box.top) === Math.round(boxes[0]?.top ?? 0))
				.map((box) => Math.round(box.left));

			for (const box of boxes) expect(columns, width).toContain(Math.round(box.left));
		}
	});

	// a short row keeps its cell: five tiles three-up is a second row of two at the first row's
	// width, and the space where a third would stand is left empty.
	it('leaves the cell a missing tile would have taken empty', () => {
		const { tiles } = card('480px', '16px');
		fill(tiles, 5);
		const boxes = presets(tiles);
		const edge = contentRight(tiles);

		expect(rows(tiles).map((line) => line.count)).toEqual([3, 2, 1]);
		expect(boxes[4]?.right).toBeLessThan(edge - (boxes[0]?.width ?? 0));
	});

	// and the free entry is the last box in the grid rather than a box under it — on its own row,
	// because a tile's cell cannot hold a figure with a mark at each end of it.
	it('gives the free entry the whole of the last row', () => {
		const { tiles } = card('375px', '16px');
		fill(tiles, 5);
		const drawn = rows(tiles);

		expect(drawn[drawn.length - 1]?.count).toBe(1);
		expect((tiles.lastElementChild as HTMLElement).getBoundingClientRect().width).toBeCloseTo(
			contentWidth(tiles),
			0
		);
	});
});

// `createSkeleton`'s own claim (../views.ts): the layout a donor is looking at while the read is in
// flight is the layout they end up with. it is a claim about laid-out boxes, so this is the pool
// that can hold it — happy-dom counts the blocks and agrees with any height at all.
describe('the widths the card gives its screens', () => {
	// a takeover is prose and is held to a reading measure; a numbered step carries form controls
	// and takes the card's whole width, because a control stopping short of the card's right edge
	// reads as a defect rather than as a measure. a lightweight DOM resolves no `ch` at all, so this
	// is the pool that can see either one.
	it('fills a numbered step to the card and holds a takeover to a measure', () => {
		const { body, give, takeover } = card('900px', '16px');

		// the card's own interior, which is what a step that stops short of would be stopping short
		// of: the inset is the card's and belongs to every screen equally.
		const inset = getComputedStyle(body);
		const full =
			body.clientWidth -
			Number.parseFloat(inset.paddingLeft) -
			Number.parseFloat(inset.paddingRight);
		expect(give.getBoundingClientRect().width).toBe(full);
		expect(takeover.getBoundingClientRect().width).toBeLessThan(full);
	});

	// the amount grid is deliberately outside it: its tiles are a row of shortcuts rather than
	// prose, and capping them would spend the width the third tile is drawn in.
	it('leaves the amount grid the whole width of the card', () => {
		const { give, tiles } = card('900px', '16px');

		expect(tiles.getBoundingClientRect().width).toBe(give.getBoundingClientRect().width);
	});

	// the step is one column at every width, on a card wide enough that a grid would have split it.
	// a total and the control that authorizes it in different halves of a card is a receipt the
	// donor has to assemble for themselves.
	it('never splits a step into columns, however wide the card gets', () => {
		const { give } = card('900px', '16px');

		expect(getComputedStyle(give).display).toBe('flex');
	});
});

// the review step is where the card holds the most text it never chose the width of: the line under
// the receipt carries the address the donor typed, and an email is one unbreakable token. the
// interior is a grid, so that token is its column's automatic minimum unless the column and the line
// are both told otherwise — and a column wider than the card takes the total, the security code, the
// button and the card's own right edge off a 375px screen, with nothing to scroll after them.
describe('the review step at the narrowest card', () => {
	/**
	 * the step that takes the money, as ../views.ts assembles it: the receipt block, the line saying
	 * where the receipt goes, the box the provider paints in, and the button under them.
	 */
	function review(email: string): { body: HTMLElement; give: HTMLElement; receipt: HTMLElement } {
		const built = card('375px', '16px');

		const summary = document.createElement('div');
		summary.setAttribute('part', 'summary');
		const row = document.createElement('div');
		row.className = 'row total';
		const label = document.createElement('span');
		label.className = 'row-label';
		label.textContent = 'Total';
		const figure = document.createElement('span');
		figure.className = 'figure';
		figure.textContent = '$50.00';
		row.appendChild(label);
		row.appendChild(figure);
		summary.appendChild(row);

		const receipt = document.createElement('p');
		receipt.className = 'aside';
		receipt.textContent = `Receipt to ${email}`;

		const payment = document.createElement('div');
		payment.setAttribute('part', 'payment');

		const submit = document.createElement('button');
		submit.type = 'submit';
		submit.setAttribute('part', 'action');
		submit.textContent = 'Donate $50.00';

		built.give.appendChild(summary);
		built.give.appendChild(receipt);
		built.give.appendChild(payment);
		built.give.appendChild(submit);
		return { body: built.body, give: built.give, receipt };
	}

	// an address a donor types rather than a contrived one, and the card is at the floor this file is
	// written to. an email carries no break opportunity at all — not at the dot and not at the at —
	// so the line is one token as wide as the address is long.
	it('holds the interior inside the card when the receipt line is a long address', () => {
		const { body, give, receipt } = review(
			'christopher.wainwright@northumberlandcountycouncil.org.uk'
		);

		// the card's own interior, measured the way the step above measures it.
		const inset = getComputedStyle(body);
		const full =
			body.clientWidth -
			Number.parseFloat(inset.paddingLeft) -
			Number.parseFloat(inset.paddingRight);
		expect(give.getBoundingClientRect().width).toBeLessThanOrEqual(full);

		// and the address is genuinely wider than the column it stands in. the face this pool draws in
		// is the runner's own rather than the one the card ships with, so a case whose address happened
		// to fit would keep passing with both rules taken back out.
		receipt.style.whiteSpace = 'nowrap';
		expect(receipt.scrollWidth).toBeGreaterThan(receipt.clientWidth);
	});
});

describe('the hidden attribute', () => {
	it('hides what it marks hidden', () => {
		// the attribute is a user-agent declaration, and every author `display` in ../styles is a
		// higher-priority origin than the user agent's. without the rule at the end of
		// ../styles/layout.css, `.step[hidden]` still computes `display: flex` from `.step` and
		// both steps render stacked on top of one another — with the note textarea permanently
		// open and the fee line on a screen where the donor declined it. the `dom` pool reads the
		// `hidden` property and cannot see any of it.
		const { give } = card('320px', '16px');
		give.hidden = true;

		expect(getComputedStyle(give).display).toBe('none');
	});

	it('hides every element the card hides, whatever it is painted as', () => {
		const { host } = card('320px', '16px');
		const painted = ['disclosure-body', 'row fee', 'takeover', 'receipt-slot'];
		const hidden = painted.map((className) => {
			const node = document.createElement('div');
			node.className = className;
			node.hidden = true;
			host.appendChild(node);
			return getComputedStyle(node).display;
		});

		expect(hidden).toEqual(painted.map(() => 'none'));
	});
});

describe('the seam a payment provider paints in', () => {
	/**
	 * the seam with a provider surface in it, beside the surface's own box.
	 *
	 * the tokens are set on the wrapper rather than taken from ../styles/tokens.css, whose `:host`
	 * block matches nothing here: an inset written in a token that resolved to nothing is an inset
	 * this pool cannot see, and every one of them is what is under test.
	 */
	function seam(surfaceHeight: string): { box: HTMLElement; surface: HTMLElement } {
		const wrapper = document.createElement('div');
		wrapper.style.cssText =
			'inline-size: 400px; --_sp1: 4px; --_sp3: 12px; --_border: 1px; --_edge-control: #888;' +
			' --_n1: #fff; --_r-in: 12px; --_row-min: 44px; --_inset: 20px;';

		const box = document.createElement('div');
		box.setAttribute('part', 'payment');
		const surface = document.createElement('div');
		surface.style.cssText = `block-size: ${surfaceHeight}`;
		box.appendChild(surface);
		wrapper.appendChild(box);

		const sheet = new CSSStyleSheet();
		sheet.replaceSync(partStyles);
		document.adoptedStyleSheets = [sheet];
		document.body.appendChild(wrapper);
		return { box, surface };
	}

	// the provider draws its own bordered container around what it paints, so anything this box
	// spends on a frame of its own is a second ring around the first one — and an inset that only
	// pushes the provider's edge in off the seam every other control on the card is aligned to.
	it('adds no box of its own around what the provider paints', () => {
		const { box, surface } = seam('200px');
		const outer = box.getBoundingClientRect();
		const inner = surface.getBoundingClientRect();

		expect([inner.width, inner.height]).toEqual([outer.width, outer.height]);
	});

	// and the one length the box does spend, which is the other half of the same decision: the box
	// reaches out to the card's own edges by the body's inset so each rail's band is full bleed, and
	// ../styles/appearance.ts pads every rail by that same length so the fields land back on the
	// seam. the pad is also the room the provider needs — it paints one block inside the card rail
	// wider than the rail's own content, and a rail with none has that block's left and right edges
	// clipped away inside the provider's frame.
	it('reaches past the step by the inset the fields are put back on the seam by', () => {
		const { box } = seam('200px');
		const outer = box.getBoundingClientRect();
		const step = (box.parentElement as HTMLElement).getBoundingClientRect();

		expect([outer.left - step.left, outer.right - step.right]).toEqual([-20, 20]);
	});

	// the other half, and the reason the seam is still a box: the step holds the height open before
	// the provider has painted anything, so the card does not jump under the donor when it does.
	it('holds a height open before the provider has painted anything', () => {
		const { box } = seam('0px');

		expect(box.getBoundingClientRect().height).toBe(88);
	});
});

describe('the anti-abuse challenge', () => {
	/**
	 * the details step, with the challenge box last where the card puts it.
	 *
	 * the spacing token is set on the wrapper rather than taken from ../styles/tokens.css, whose
	 * `:host` block matches nothing here. What is under test is the cancellation, not the number.
	 */
	function step(challengeContent: string): { step: HTMLElement; control: HTMLElement } {
		const wrapper = document.createElement('div');
		wrapper.style.cssText = 'inline-size: 400px; --_sp5: 1.25rem;';

		const build = (withChallenge: boolean): HTMLElement => {
			const node = document.createElement('div');
			node.className = 'step';
			for (const height of ['40px', '24px', '48px']) {
				const child = document.createElement('div');
				child.style.cssText = `block-size: ${height}`;
				node.appendChild(child);
			}
			if (withChallenge) {
				const challenge = document.createElement('div');
				challenge.className = 'challenge';
				challenge.innerHTML = challengeContent;
				node.appendChild(challenge);
			}
			wrapper.appendChild(node);
			return node;
		};

		const sheet = new CSSStyleSheet();
		sheet.replaceSync(layoutStyles);
		document.adoptedStyleSheets = [sheet];
		const withIt = build(true);
		const control = build(false);
		document.body.appendChild(wrapper);
		return { step: withIt, control };
	}

	// the property the whole placement rests on, and one a lightweight DOM cannot see: a flex `gap`
	// is spent between item boxes whatever their size, so a zero-height box at the end of the
	// step still holds a full gap open under the last control. Nearly every donor is never
	// asked to interact and so is shown nothing here, which is why the empty case is the one that
	// has to cost nothing.
	it('costs nothing at all while the widget is drawing nothing', () => {
		const { step: withIt, control } = step('');

		expect(withIt.getBoundingClientRect().height).toBe(control.getBoundingClientRect().height);
	});

	// the other half: a widget that does draw is on the card at its full height rather than
	// clipped or overlapped by the cancelled gap.
	it('gives the widget its whole height once one is drawn', () => {
		const { step: withIt, control } = step('<div style="block-size: 65px"></div>');
		const grew = withIt.getBoundingClientRect().height - control.getBoundingClientRect().height;

		expect(grew).toBe(65);
	});
});

describe('a disclosure', () => {
	/**
	 * the tick and the field it reveals, as ../views.ts builds them, with the step's own rhythm
	 * around them.
	 *
	 * the tokens are set on the wrapper rather than taken from ../styles/tokens.css, whose `:host`
	 * block matches nothing here. what is under test is which gap falls between the two boxes, not
	 * the number either of them is.
	 */
	function step(): { row: HTMLElement; body: HTMLElement; before: HTMLElement } {
		const wrapper = document.createElement('div');
		wrapper.style.cssText =
			'inline-size: 400px; --_sp2: 0.5rem; --_sp3: 0.75rem; --_sp5: 1.25rem; --_row-min: 44px;';

		const node = document.createElement('div');
		node.className = 'step';
		const before = document.createElement('div');
		before.style.cssText = 'block-size: 40px';
		const note = document.createElement('div');
		note.className = 'disclosure note';
		const row = document.createElement('label');
		row.className = 'check-row';
		const tick = document.createElement('input');
		tick.type = 'checkbox';
		const words = document.createElement('span');
		words.textContent = 'Add a note';
		row.appendChild(tick);
		row.appendChild(words);
		const body = document.createElement('div');
		body.className = 'disclosure-body';
		const inner = document.createElement('div');
		inner.className = 'disclosure-inner';
		const field = document.createElement('textarea');
		field.rows = 3;
		inner.appendChild(field);
		body.appendChild(inner);
		note.appendChild(row);
		note.appendChild(body);
		node.appendChild(before);
		node.appendChild(note);
		wrapper.appendChild(node);

		const sheet = new CSSStyleSheet();
		sheet.replaceSync(layoutStyles);
		document.adoptedStyleSheets = [sheet];
		document.body.appendChild(wrapper);
		return { row, body, before };
	}

	// the revealed field belongs to the tick that revealed it, and a step's worth of rhythm between
	// the two reads as a second thing rather than as the disclosure opening. the two are one item in
	// the step for exactly that reason: the step's gap falls above the pair and never inside it.
	it('opens the field closer to its tick than the step keeps its own groups', () => {
		const { row, body, before } = step();

		const inside = body.getBoundingClientRect().top - row.getBoundingClientRect().bottom;
		const between = row.getBoundingClientRect().top - before.getBoundingClientRect().bottom;

		expect(between).toBeGreaterThan(0);
		expect(inside).toBeLessThan(between);
	});
});

describe('the two ticks a step ends on', () => {
	type Tick = {
		readonly words: HTMLElement;
		readonly field: HTMLElement;
	};

	/** one disclosure, as ../views.ts builds it: the tick, and the body it reveals. */
	function disclosure(kind: string, says: string, open: boolean): Tick & { node: HTMLElement } {
		const node = document.createElement('div');
		node.className = `disclosure ${kind}`;
		const row = document.createElement('label');
		row.className = 'check-row';
		const tick = document.createElement('input');
		tick.type = 'checkbox';
		const words = document.createElement('span');
		words.textContent = says;
		row.appendChild(tick);
		row.appendChild(words);
		const body = document.createElement('div');
		body.className = 'disclosure-body';
		body.hidden = !open;
		const inner = document.createElement('div');
		inner.className = 'disclosure-inner';
		const field = document.createElement('textarea');
		field.rows = 3;
		inner.appendChild(field);
		body.appendChild(inner);
		node.appendChild(row);
		node.appendChild(body);
		return { node, words, field };
	}

	/**
	 * the tail of the amount step as ../views.ts assembles it: the amount block, the two disclosures
	 * as siblings of it, and the button under them.
	 *
	 * the tokens are set on the wrapper rather than taken from ../styles/tokens.css, whose `:host`
	 * block matches nothing here. what is under test is which gaps the step spends where, not the
	 * number any of them is.
	 *
	 * both sheets are adopted, in the order ../element.ts adopts them: the box a disclosure reveals
	 * is a grid row drawn in ./parts.css and the field inside it is what this measures from, so a
	 * card holding only ./layout.css would be measured down a stray line-box of its own.
	 */
	function tail(opened: 'none' | 'note'): {
		before: HTMLElement;
		after: HTMLElement;
		note: Tick;
		tribute: Tick;
	} {
		const wrapper = document.createElement('div');
		wrapper.style.cssText =
			'inline-size: 400px; --_sp2: 0.5rem; --_sp3: 0.75rem; --_sp5: 1.25rem; --_row-min: 44px;';

		const node = document.createElement('div');
		node.className = 'step';
		const before = document.createElement('div');
		before.style.cssText = 'block-size: 40px';
		const after = document.createElement('div');
		after.style.cssText = 'block-size: 44px';
		const note = disclosure('note', 'Add a note', opened === 'note');
		const tribute = disclosure('tribute', 'Dedicate this gift', false);
		node.appendChild(before);
		node.appendChild(note.node);
		node.appendChild(tribute.node);
		node.appendChild(after);
		wrapper.appendChild(node);

		const paint = new CSSStyleSheet();
		paint.replaceSync(partStyles);
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(layoutStyles);
		document.adoptedStyleSheets = [paint, sheet];
		document.body.appendChild(wrapper);
		return { before, after, note, tribute };
	}

	/**
	 * what an eye reads as the space between two things: the ink, not the boxes.
	 *
	 * a check row is `--_row-min` tall with its words centred in it (`.check-row` in
	 * ./layout.css), so the slack a target leaves is inside the row's own box and a measure taken
	 * between two row boxes is blind to exactly the space this is about.
	 */
	function gap(above: Element, below: Element): number {
		return below.getBoundingClientRect().top - above.getBoundingClientRect().bottom;
	}

	// the two ticks are a pair, and a step that spends the same gap everywhere does not read as
	// one: each row's own slack stacks on top of the step's gap between them, so the two optional
	// asks sit further apart from each other than either sits from the step's own controls.
	it('sets the pair closer to each other than to the step around them', () => {
		const { before, after, note, tribute } = tail('none');

		const inside = gap(note.words, tribute.words);

		expect(inside).toBeLessThan(gap(before, note.words));
		expect(inside).toBeLessThan(gap(tribute.words, after));
	});

	// and the case the pair costs: with the step's gap gone from between them, a disclosure the
	// donor opened would leave the next tick one slack under the field it revealed, reading as
	// part of the block that was just opened rather than as the next ask.
	it('puts the step’s own rhythm back under a disclosure the donor opened', () => {
		const { before, note, tribute } = tail('note');

		expect(gap(note.field, tribute.words)).toBeCloseTo(gap(before, note.words), 0);
	});
});

describe('the tribute’s first line', () => {
	/** the interior a 375px page leaves this card, which is the width the row is decided at. */
	const PHONE = '335px';
	/** past `24em`, where the card states it can hold two boxes on a line. */
	const PAIRED = '400px';

	/**
	 * the kind, the name and the sentence under them, as ../views.ts builds them: three children of
	 * one grid, with the hidden labels out of flow beside them.
	 *
	 * the wrapper is the card's own container rather than a plain box, because where the name is
	 * drawn is a `@container donate` question and a wrapper that names no container answers it the
	 * same way at every width.
	 */
	function dedication(width: string): {
		row: HTMLElement;
		select: HTMLElement;
		name: HTMLElement;
		message: HTMLElement;
	} {
		const wrapper = document.createElement('div');
		wrapper.style.cssText =
			`container-type: inline-size; container-name: donate; inline-size: ${width};` +
			' font-size: 16px; --_sp2: 0.5rem; --_sp3: 0.75rem; --_row-min: 44px;';

		const node = document.createElement('div');
		node.className = 'dedication';
		const select = document.createElement('select');
		for (const words of ['In honor of', 'In memory of']) {
			const option = document.createElement('option');
			option.textContent = words;
			select.appendChild(option);
		}
		const name = document.createElement('input');
		name.placeholder = 'Their name';
		const message = document.createElement('p');
		message.className = 'message';
		message.textContent = 'required, or untick to skip';
		node.appendChild(select);
		node.appendChild(name);
		node.appendChild(message);
		wrapper.appendChild(node);

		const sheet = new CSSStyleSheet();
		sheet.replaceSync(layoutStyles);
		document.adoptedStyleSheets = [sheet];
		document.body.appendChild(wrapper);
		return { row: node, select, name, message };
	}

	/** the same container, holding the pair of equals the recipient row is. */
	function names(width: string): { first: HTMLElement } {
		const wrapper = document.createElement('div');
		wrapper.style.cssText =
			`container-type: inline-size; container-name: donate; inline-size: ${width};` +
			' font-size: 16px; --_sp2: 0.5rem; --_sp3: 0.75rem;';
		const node = document.createElement('div');
		node.className = 'names';
		const first = document.createElement('input');
		node.appendChild(first);
		node.appendChild(document.createElement('input'));
		wrapper.appendChild(node);

		const sheet = new CSSStyleSheet();
		sheet.replaceSync(layoutStyles);
		document.adoptedStyleSheets = [sheet];
		document.body.appendChild(wrapper);
		return { first };
	}

	// the remainder is what the name is left holding, and on a phone it is not worth a line: the
	// select takes the better part of half the row and the name gets what is under 150px of it, for
	// text a donor typed and an `<input>` will not wrap. so it drops to a row of its own and takes
	// the width the sentence under it already takes.
	it('gives the honoree the whole row at the narrowest card', () => {
		const { row, select, name } = dedication(PHONE);
		const kind = select.getBoundingClientRect();
		const honoree = name.getBoundingClientRect();

		expect(honoree.width).toBeCloseTo(row.getBoundingClientRect().width, 0);
		expect(honoree.top).toBeGreaterThanOrEqual(kind.bottom);
	});

	// and the select is not what gave: it keeps the intrinsic track above the name rather than
	// stretching into a second question, and it is the same track that keeps `In memory of` whole.
	// a truncated option would be the fix that traded one unreadable string for another.
	it('leaves the kind at its own measure, undertruncated, on that same card', () => {
		const { row, select } = dedication(PHONE);

		expect(select.scrollWidth).toBe(select.clientWidth);
		expect(select.getBoundingClientRect().width).toBeLessThan(row.getBoundingClientRect().width);
	});

	// the two are one sentence — `In honor of` starts it and the name finishes it — so where the
	// card can hold both they share a line. `24em` is the width this file already states about that
	// and `.names` above is what states it, which a lightweight DOM lays out as neither.
	it('puts the two back on one line once the card can hold them', () => {
		const { select, name } = dedication(PAIRED);
		const kind = select.getBoundingClientRect();
		const honoree = name.getBoundingClientRect();

		expect(honoree.top).toBe(kind.top);
		expect(honoree.left).toBeGreaterThan(kind.right);
	});

	// the pair is unequal where `.names`' is not, so reusing its breakpoint is only sound if the
	// name is never drawn narrower here than a `.names` field is at the same width. measured rather
	// than reasoned about: the select's measure is the browser's and no arithmetic here predicts it.
	it('never pairs the name narrower than the recipient row does at the same width', () => {
		const { name } = dedication(PAIRED);
		const honoree = name.getBoundingClientRect().width;
		document.body.replaceChildren();
		const { first } = names(PAIRED);

		expect(honoree).toBeGreaterThanOrEqual(first.getBoundingClientRect().width);
	});

	// the sentence spans the pair rather than stacking into the name's own third of the card, where
	// it would run several lines deep under a box one line tall and read as the block breaking.
	it('spans the refusal across both columns rather than into the name’s', () => {
		const { select, name, message } = dedication(PAIRED);
		const words = message.getBoundingClientRect();

		expect(words.left).toBe(select.getBoundingClientRect().left);
		expect(words.right).toBe(name.getBoundingClientRect().right);
		expect(words.top).toBeGreaterThanOrEqual(name.getBoundingClientRect().bottom);
	});
});

describe('the notify press under the honoree', () => {
	/**
	 * the tribute opened, as ../views.ts assembles it: the dedication block, and under it, in the
	 * block's own gap, the press that opens the notify pair.
	 *
	 * both sheets are adopted, in the order ../element.ts adopts them, because the two halves of
	 * what is measured sit in different files — the press's own size and its target floor are drawn
	 * in ./parts.css and the take-back that lifts it under the honoree is here, so a card holding
	 * one of them measures a press no donor is ever shown.
	 *
	 * the card's own font-size is the parameter: the press's size is floored under it (./parts.css)
	 * while the block's gap keeps following it, so what the take-back is spent out of and what it is
	 * measured off part company at the bottom of the clamp band ../styles/tokens.css holds the card
	 * in.
	 */
	function opened(cardFontSize: string): { honoree: HTMLElement; press: HTMLElement } {
		const wrapper = document.createElement('div');
		wrapper.style.cssText =
			'container-type: inline-size; container-name: donate; inline-size: 400px;' +
			` font-size: ${cardFontSize}; --_root-size: ${cardFontSize};` +
			' line-height: var(--_lh-body); --_lh-body: 1.5;' +
			' --_sp1: 0.25em; --_sp2: 0.5em; --_sp3: 0.75em; --_t-xs: 0.75em; --_row-min: 44px;';

		const node = document.createElement('div');
		node.className = 'disclosure tribute';
		const body = document.createElement('div');
		body.className = 'disclosure-body';
		const inner = document.createElement('div');
		inner.className = 'disclosure-inner';

		const honoree = document.createElement('div');
		honoree.className = 'dedication';
		const kind = document.createElement('select');
		const option = document.createElement('option');
		option.textContent = 'In honor of';
		kind.appendChild(option);
		const name = document.createElement('input');
		name.placeholder = 'Their name';
		const message = document.createElement('p');
		message.className = 'message';
		message.textContent = 'required, or untick to skip';
		honoree.appendChild(kind);
		honoree.appendChild(name);
		honoree.appendChild(message);

		const row = document.createElement('div');
		row.className = 'field-row';
		const press = document.createElement('button');
		press.type = 'button';
		press.setAttribute('part', 'action-quiet');
		press.textContent = '+ Notify recipient';
		row.appendChild(press);

		inner.appendChild(honoree);
		inner.appendChild(row);
		body.appendChild(inner);
		node.appendChild(body);
		wrapper.appendChild(node);

		const paint = new CSSStyleSheet();
		paint.replaceSync(partStyles);
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(layoutStyles);
		document.adoptedStyleSheets = [paint, sheet];
		document.body.appendChild(wrapper);
		return { honoree, press };
	}

	// the press stands at `--_row-min` with its words centred in that box, and takes the slack over
	// them back off the block's gap so the words read the block's own step. what the take-back may
	// never do is outrun the gap it is spent out of: the press is set smaller than the card's text
	// and the gap is not, so its slack outgrows the gap at the bottom of the band and the target box
	// comes to stand over the box above it — where a finger reaching the press lands in the honoree
	// field instead.
	it('never lifts the press’s target box into the honoree’s', () => {
		const cards = ['15px', '16px', '18px'].map((size) => {
			document.body.replaceChildren();
			const { honoree, press } = opened(size);
			return {
				size,
				into: honoree.getBoundingClientRect().bottom - press.getBoundingClientRect().top
			};
		});

		expect(cards.filter((card) => card.into > 0)).toEqual([]);
	});
});
