import { afterEach, describe, expect, it } from 'vitest';
import { PRE_UPGRADE_RESERVATION_CSS, RESERVED_MIN_HEIGHT } from './embed/reservation';
import { defineDonateForm, DONATE_FORM_TAG } from './element';
import type { CheckoutPorts } from './ports';
import type { FormConfig } from './v1';

// what a lightweight DOM cannot see about the element's stylesheets: which document a constructed
// sheet belongs to, and what a card renders as when the `@property` registrations its seeds derive
// from are not in the tree. both are engine behaviour, and both are the whole reason `sheetsFor`
// puts a second copy of the token sheet in the document at all.
//
// like every spec in this pool it runs from `pnpm test:browser` and not from `pnpm test`, so it does
// not gate `deploy`; see vitest.browser.config.ts.

const CONFIG: FormConfig = {
	formId: 'frm_a8x2k9',
	provider: { name: 'stripe', publishableKey: 'pk_live_x' },
	currency: 'usd',
	suggestedAmountsMinor: [2500, 10_000],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time', 'monthly'],
	paymentMethods: ['card'],
	feeCoverage: 'optional',
	feeRules: {
		card: { percent: 0.029, fixedMinor: 30 },
		ach: { percent: 0.008, fixedMinor: 0 },
		apple_pay: { percent: 0.029, fixedMinor: 30 },
		google_pay: { percent: 0.029, fixedMinor: 30 }
	},
	locale: 'en-US',
	orgLegalName: 'Acme Relief Fund',
	ein: '12-3456789',
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.'
};

const PORTS: CheckoutPorts = {
	quote: async () => ({ paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: 2606 }),
	confirm: async () => ({ kind: 'succeeded' }),
	resume: async () => ({ kind: 'succeeded' }),
	now: () => 1_700_000_000_000
};

let tags = 0;
const planted: HTMLElement[] = [];

/** lets the configuration read settle before the card is inspected. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** one element on the page, upgraded, carrying the sheets its own code adopted. */
async function mount(): Promise<HTMLElement> {
	const tag = `${DONATE_FORM_TAG}-${(tags += 1)}`;
	defineDonateForm(
		{
			loadConfig: async () => CONFIG,
			checkout: (config) => ({
				input: { config, ports: PORTS },
				cadence: () => {},
				stop: () => {}
			}),
			challenge: () => ({ reset: () => {}, stop: () => {} })
		},
		tag
	);
	const host = document.createElement(tag);
	host.setAttribute('form', CONFIG.formId);
	document.body.appendChild(host);
	planted.push(host);
	await settle();
	return host;
}

/** a second document on the page, which is the only kind an element can actually move into. */
function otherDocument(): Document {
	const frame = document.createElement('iframe');
	document.body.appendChild(frame);
	planted.push(frame);
	const doc = frame.contentDocument;
	if (doc === null) throw new Error('the frame has no document');
	return doc;
}

/** what the card paints as, which is the whole question a missing registration answers. */
function background(host: HTMLElement): string {
	const card = host.shadowRoot?.querySelector("[part~='card']");
	if (card === undefined || card === null) throw new Error('the element rendered no card');
	return getComputedStyle(card).backgroundColor;
}

afterEach(() => {
	for (const node of planted.splice(0)) node.remove();
	// the root a case below moved, back where every other case in this file assumes it.
	document.documentElement.style.fontSize = '';
});

describe('the element in a second document', () => {
	// the premise behind rebuilding all four sheets rather than re-assigning the ones the shadow root
	// is already holding: they belong to the document they were constructed in and no other will take
	// them (https://developer.mozilla.org/en-US/docs/Web/API/Document/adoptedStyleSheets).
	it('cannot hand a document a sheet constructed in another one', () => {
		const other = otherDocument();
		const sheet = new CSSStyleSheet();
		sheet.replaceSync('div { color: red }');

		expect(() => {
			other.adoptedStyleSheets = [sheet];
		}).toThrow(/not allowed/i);
	});

	// so the callback rebuilds, and what it is rebuilding for is the second adoption: `@property`
	// registrations are collected from the document tree, and a card whose seeds have no initial
	// value paints as nothing at all on a page whose host set none.
	it('paints in the document it was adopted into', async () => {
		const host = await mount();
		const painted = background(host);
		const other = otherDocument();
		other.body.appendChild(host);
		await settle();

		expect(host.ownerDocument).toBe(other);
		expect(host.shadowRoot?.adoptedStyleSheets).toHaveLength(4);
		expect(background(host)).toBe(painted);
	});
});

// the reflow every host page took, measured. the snippet loads the runtime `async`, so the parser
// builds `<bg-donate-form>` as an unknown inline element with no intrinsic size, lays the page out
// around it, and moves everything below the card down by the card's whole height when the
// definition lands. the reservation is the host page's own rule because nothing this script does can
// come early enough — it has to run to inject anything, and running is the upgrade.
//
// this is the browser pool's question and no other pool's: what is compared is a used box against a
// declared minimum, in the one state the element does not exist in yet.
describe('the box a host page holds before the element upgrades', () => {
	// the real tag rather than a per-case one: `:not(:defined)` is a claim about this document's
	// registry, and every case above registers under a suffixed tag precisely so this one is never
	// defined here. the assertion below states that outright rather than trusting it.
	function waiting(children: readonly HTMLElement[] = []): HTMLElement {
		const style = document.createElement('style');
		style.textContent = PRE_UPGRADE_RESERVATION_CSS;
		document.head.appendChild(style);
		planted.push(style);

		const host = document.createElement(DONATE_FORM_TAG);
		host.setAttribute('form', CONFIG.formId);
		for (const child of children) host.appendChild(child);
		document.body.appendChild(host);
		planted.push(host);
		return host;
	}

	/** the number both ends of the reservation are written from, as the engine resolves a length. */
	const RESERVE = parseFloat(RESERVED_MIN_HEIGHT);

	/**
	 * an element mid-boot: upgraded, with the configuration read still in flight.
	 *
	 * the one state the element's own floor is spent in, and it cannot be reached through `mount`
	 * above — that helper waits for the card.
	 */
	async function loading(children: readonly HTMLElement[] = []): Promise<HTMLElement> {
		const tag = `${DONATE_FORM_TAG}-${(tags += 1)}`;
		defineDonateForm(
			{
				loadConfig: () => new Promise(() => {}),
				checkout: (config) => ({
					input: { config, ports: PORTS },
					cadence: () => {},
					stop: () => {}
				}),
				challenge: () => ({ reset: () => {}, stop: () => {} })
			},
			tag
		);
		const host = document.createElement(tag);
		host.setAttribute('form', CONFIG.formId);
		for (const child of children) host.appendChild(child);
		document.body.appendChild(host);
		planted.push(host);
		await settle();
		return host;
	}

	// the common case, and the one the README calls optional for a reason: nearly every host pastes
	// the snippet and fills no slot, so the reservation has to hold a box with nothing in it.
	//
	// the box is measured against the element mid-boot rather than against the finished card. the
	// two rules are one continuous floor — the host's stops applying the moment the element is
	// defined and the element's own loading card takes over the same number — and it is the join
	// that has to be seamless, not the card that lands after it.
	it('holds the same box with no loading content in it at all', async () => {
		const empty = waiting();
		const upgraded = await loading();

		expect(customElements.get(DONATE_FORM_TAG)).toBeUndefined();
		expect(getComputedStyle(empty).display).toBe(getComputedStyle(upgraded).display);
		expect(empty.getBoundingClientRect().height).toBe(RESERVE);
		expect(upgraded.getBoundingClientRect().height).toBe(RESERVE);
	});

	// and the documented `loading` slot, which renders before the upgrade as ordinary light DOM: a
	// placeholder shorter than the card must not shrink the box back below the reserve.
	it('holds it against loading content shorter than the card', async () => {
		const line = document.createElement('p');
		line.textContent = 'Loading the donation form…';
		line.setAttribute('slot', 'loading');
		const filled = waiting([line]);
		const short = document.createElement('p');
		short.textContent = 'Loading the donation form…';
		short.setAttribute('slot', 'loading');
		const upgraded = await loading([short]);

		expect(filled.getBoundingClientRect().height).toBe(RESERVE);
		expect(upgraded.getBoundingClientRect().height).toBe(RESERVE);
	});

	// and the release, which is the other half of the same rule. the reserve is a guess at the
	// tallest common card and it is the host page's to keep until the element has something real to
	// draw; held past that it is a floor under every short step, and the amount step is the first
	// thing a donor sees.
	it('lets the card size to its own content once there is a card', async () => {
		const upgraded = await mount();

		expect(getComputedStyle(upgraded).minHeight).toBe('0px');
		expect(upgraded.getBoundingClientRect().height).toBeLessThan(RESERVE);
	});

	// the two cases above compare the reservation against the element's own declared floor, and they
	// hold whatever unit both are written in — which is the whole reason this one exists: what a host
	// page is owed is the reservation against the card that actually renders in it. a host running
	// `html { font-size: 62.5% }` is where the two part company, because the card's scale is clamped
	// (./styles/tokens.css) and stops following the root long before a font-relative reserve does.
	for (const root of ['10px', '16px', '20px']) {
		it(`holds the card that renders on a host whose root is ${root}`, async () => {
			document.documentElement.style.fontSize = root;
			const empty = waiting();
			const upgraded = await mount();

			expect(empty.getBoundingClientRect().height).toBeGreaterThanOrEqual(
				upgraded.getBoundingClientRect().height
			);
		});
	}
});
