import { afterEach, describe, expect, it } from 'vitest';
import type { Failure } from '../checkout.machine';
import type { FundAuthorization, FundReports, FundRequest } from '../ports';
import type { FormConfig } from '../v1';
import {
	CHARIOT_SCRIPT_URL,
	CHARIOT_TAG,
	createPaymentSurface,
	loadChariotScript,
	MOUNT_DEADLINE_MS
} from './chariot';

// the adapter, driven against a stand-in `<chariot-connect>` registered in this document. what is
// worth asserting is where the node goes, how many of them a page holds, where the listeners sit
// and that the press reaches the flow with nothing awaited — none of which needs Chariot's script.

const CONFIG: FormConfig = {
	formId: 'frm_a8x2k9',
	providers: [{ name: 'chariot', publishableKey: 'cid_live_x' }],
	currency: 'USD',
	suggestedAmountsMinor: [2500],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time', 'monthly'],
	paymentMethods: ['daf'],
	feeCoverage: 'optional',
	feeRules: {
		card: { percent: 0.029, fixedMinor: 30 },
		ach: { percent: 0.008, fixedMinor: 0 },
		apple_pay: { percent: 0.029, fixedMinor: 30 },
		google_pay: { percent: 0.029, fixedMinor: 30 },
		paypal: { percent: 0.0349, fixedMinor: 49 },
		venmo: { percent: 0.0349, fixedMinor: 49 },
		daf: { percent: 0.029, fixedMinor: 0, roundUpMinor: 100 },
		crypto: { percent: 0.01, fixedMinor: 0 }
	},
	locale: 'en-US',
	orgLegalName: 'Acme Relief Fund',
	ein: '12-3456789',
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.'
};

/** the stand-in: Chariot's element keeps the one callback it is handed and nothing else. */
class StubConnect extends HTMLElement {
	donationRequest: (() => unknown) | null = null;
	onDonationRequest(callback: () => unknown): void {
		this.donationRequest = callback;
	}
}
if (customElements.get(CHARIOT_TAG) === undefined) customElements.define(CHARIOT_TAG, StubConnect);

type Kit = {
	readonly mount: HTMLElement;
	readonly unavailable: Failure[];
	readonly approvals: FundAuthorization[];
	readonly closes: number[];
	readonly opens: number[];
	answer: FundRequest | null;
	readonly fund: FundReports;
};

function kit(): Kit {
	const mount = document.createElement('div');
	document.body.appendChild(mount);
	const k: Kit = {
		mount,
		unavailable: [],
		approvals: [],
		closes: [],
		opens: [],
		answer: { amountMinor: 2600, email: 'ada@example.org', firstName: 'Ada', lastName: 'Lovelace' },
		fund: {
			opened: () => {
				k.opens.push(1);
				return k.answer;
			},
			approved: (authorization) => k.approvals.push(authorization),
			closed: () => k.closes.push(1)
		}
	};
	return k;
}

type Loading = {
	readonly load?: () => Promise<boolean>;
	readonly deadlines?: { run: () => void; ms: number }[];
};

/** every surface a case built, stopped after it: the page's one element outlives any single card. */
const built: { stop(): void }[] = [];

async function surfaced(k: Kit, config: FormConfig = CONFIG, loading: Loading = {}) {
	const surface = createPaymentSurface(
		config,
		k.mount,
		(failure) => k.unavailable.push(failure),
		k.fund,
		{
			load: loading.load ?? (() => Promise.resolve(true)),
			delay: (run, ms) => {
				loading.deadlines?.push({ run, ms });
				return () => {};
			}
		}
	);
	built.push(surface);
	for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
	return surface;
}

function connectIn(k: Kit): StubConnect | null {
	return k.mount.querySelector(CHARIOT_TAG) as StubConnect | null;
}

describe('a donor-advised fund’s window, behind the payment surface', () => {
	afterEach(() => {
		for (const surface of built.splice(0)) surface.stop();
		document.body.replaceChildren();
	});

	// Chariot's script finds its element by a document query, so a node inside a shadow root drops
	// the result; the node the card hands out is light DOM, and that is where the element goes. its
	// own button is the fund's option on the card, so nothing else is drawn beside it.
	it('mounts one `<chariot-connect>` in the node it was handed while the fund is offered', async () => {
		const k = kit();
		const surface = await surfaced(k);
		expect(k.mount.children).toHaveLength(0);

		surface.offer(true);

		const connects = document.querySelectorAll(CHARIOT_TAG);
		expect(connects).toHaveLength(1);
		expect(k.mount.children).toHaveLength(1);
		expect(k.mount.contains(connects[0] ?? null)).toBe(true);
		expect(connects[0]?.getAttribute('cid')).toBe('cid_live_x');

		surface.offer(true);
		expect(document.querySelectorAll(CHARIOT_TAG)).toHaveLength(1);

		surface.offer(false);
		expect(k.mount.children).toHaveLength(0);
	});

	// the fund's option is a row like the rails beside it, drawn closed, and its button is behind a
	// press on the row's name; the row stands exactly while the element does.
	it('stands the element in a closed row of its own, and takes the row with it', async () => {
		const k = kit();
		const surface = await surfaced(k);
		const changes: number[] = [];
		surface.rows.watch({
			changed: () => changes.push(surface.rows.current().length),
			opened: () => {}
		});

		surface.offer(true);
		expect(surface.rows.current().map((row) => row.name)).toEqual(['Donor-advised fund']);
		const head = k.mount.children[0]?.shadowRoot?.querySelector('button');
		expect(head?.getAttribute('aria-expanded')).toBe('false');
		expect(k.mount.children[0]?.firstElementChild?.tagName.toLowerCase()).toBe(CHARIOT_TAG);

		head?.click();
		expect(surface.rows.current()[0]?.expanded).toBe(true);
		expect(k.opens).toEqual([]);

		surface.offer(false);
		expect(surface.rows.current()).toEqual([]);
		expect(changes).toEqual([1, 0]);
	});

	// Chariot answers the first element on the page, so a second form holding one would open the
	// wrong form's gift. the first form to mount keeps it, and the second offers no fund until the
	// first lets it go.
	it('keeps one element live on a page holding two forms, held by the first to mount it', async () => {
		const hero = kit();
		const footer = kit();
		const first = await surfaced(hero);
		const second = await surfaced(footer);

		first.offer(true);
		second.offer(true);

		expect(document.querySelectorAll(CHARIOT_TAG)).toHaveLength(1);
		expect(connectIn(hero)).not.toBeNull();
		expect(connectIn(footer)).toBeNull();

		first.offer(false);

		expect(document.querySelectorAll(CHARIOT_TAG)).toHaveLength(1);
		expect(connectIn(footer)).not.toBeNull();
	});

	// the events neither bubble nor cross a shadow boundary, so a listener anywhere but the element
	// hears nothing.
	it('hears the window’s endings on the element itself', async () => {
		const k = kit();
		(await surfaced(k)).offer(true);
		const connect = connectIn(k);

		connect?.dispatchEvent(
			new CustomEvent('CHARIOT_SUCCESS', {
				detail: { workflowSessionId: 'wfs_1', grantIntent: { amount: 5200, fundId: 'f_1' } }
			})
		);
		connect?.dispatchEvent(new CustomEvent('CHARIOT_EXIT', { detail: { reason: 'USER_EXIT' } }));

		expect(k.approvals).toEqual([{ authorizationId: 'wfs_1', authorizedMinor: 5200 }]);
		expect(k.closes).toHaveLength(1);
	});

	it('puts the donor back in front of the button on an approval it cannot read', async () => {
		const k = kit();
		(await surfaced(k)).offer(true);
		const original = console.error;
		console.error = () => {};
		try {
			connectIn(k)?.dispatchEvent(
				new CustomEvent('CHARIOT_SUCCESS', { detail: { grantIntent: {} } })
			);
		} finally {
			console.error = original;
		}
		expect(k.approvals).toHaveLength(0);
		expect(k.closes).toHaveLength(1);
	});

	// the window opens on the press, and the browser blocks one opened after anything is awaited —
	// so the press reaches the flow and the gift is answered in the same call, as a value.
	it('answers the press with the gift synchronously, and keeps the window shut when refused', async () => {
		const k = kit();
		(await surfaced(k)).offer(true);
		const connect = connectIn(k);

		expect(connect?.donationRequest?.()).toEqual({
			amount: 2600,
			firstName: 'Ada',
			lastName: 'Lovelace',
			email: 'ada@example.org',
			frequency: 'ONE_TIME'
		});
		expect(k.opens).toHaveLength(1);

		k.answer = null;
		expect(connect?.donationRequest?.()).toBe(false);
	});

	it('waits for its script before mounting a fund that was offered ahead of it', async () => {
		const k = kit();
		let arrive: (loaded: boolean) => void = () => {};
		const surface = await surfaced(k, CONFIG, {
			load: () => new Promise((resolve) => (arrive = resolve))
		});
		surface.offer(true);
		expect(connectIn(k)).toBeNull();

		arrive(true);
		for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
		expect(connectIn(k)).not.toBeNull();
	});

	// a script that fires neither `load` nor `error` names itself in no other way, and a donor would
	// be left on a card whose fund never appears.
	it('says the fund is unavailable when its script never answers', async () => {
		const k = kit();
		const deadlines: { run: () => void; ms: number }[] = [];
		const surface = await surfaced(k, CONFIG, { load: () => new Promise(() => {}), deadlines });
		surface.offer(true);

		expect(deadlines.map((deadline) => deadline.ms)).toEqual([MOUNT_DEADLINE_MS]);
		deadlines[0]?.run();

		expect(k.unavailable).toHaveLength(1);
		expect(k.unavailable[0]?.message).toContain('nothing was granted');
		expect(connectIn(k)).toBeNull();
	});

	it('says once that the fund cannot be offered where the config names no Connect id', async () => {
		const k = kit();
		const surface = await surfaced(k, { ...CONFIG, providers: [] });
		surface.offer(true);
		expect(connectIn(k)).toBeNull();
		expect(k.unavailable).toHaveLength(1);
	});

	it('lets go of everything it put on the page, and raises nothing on a second stop', async () => {
		const k = kit();
		const surface = await surfaced(k);
		surface.offer(true);
		expect(() => {
			surface.stop();
			surface.stop();
		}).not.toThrow();
		expect(k.mount.children).toHaveLength(0);
	});
});

// the script itself, on a page of its own: the stand-in above is registered on this spec's document,
// so each case here takes a frame whose registry has never seen Chariot's element.
describe('Chariot’s script, loaded onto a page', () => {
	function page(): Document {
		const frame = document.createElement('iframe');
		document.body.appendChild(frame);
		const doc = frame.contentDocument;
		if (doc === null) throw new Error('the iframe has no document');
		return doc;
	}

	function register(doc: Document): void {
		const view = doc.defaultView as unknown as {
			customElements: CustomElementRegistry;
			HTMLElement: typeof HTMLElement;
		};
		view.customElements.define(CHARIOT_TAG, class extends view.HTMLElement {});
	}

	const scripts = (doc: Document) => doc.querySelectorAll(`script[src="${CHARIOT_SCRIPT_URL}"]`);

	afterEach(() => {
		document.body.replaceChildren();
	});

	// a host page whose policy allows scripts by nonce refuses an injected tag that does not carry it.
	it('plants the script once, carrying the nonce, and answers when its element is registered', async () => {
		const doc = page();
		const first = loadChariotScript(doc, 'n0nce');
		const second = loadChariotScript(doc, 'n0nce');

		expect(second).toBe(first);
		expect(scripts(doc)).toHaveLength(1);
		expect((scripts(doc)[0] as HTMLScriptElement).nonce).toBe('n0nce');

		register(doc);
		await expect(first).resolves.toBe(true);
		expect(scripts(doc)).toHaveLength(1);
	});

	// a script that failed is taken back off and forgotten, so a form mounted after it tries again
	// with a nonced tag of its own rather than waiting on the dead one.
	it('answers false on a load error, and a later call plants the script again', async () => {
		const doc = page();
		const failed = loadChariotScript(doc, 'n0nce');
		scripts(doc)[0]?.dispatchEvent(new Event('error'));

		await expect(failed).resolves.toBe(false);
		expect(scripts(doc)).toHaveLength(0);

		const again = loadChariotScript(doc, 'n0nce');
		expect(again).not.toBe(failed);
		expect(scripts(doc)).toHaveLength(1);
		register(doc);
		await expect(again).resolves.toBe(true);
	});

	// the element is registered unguarded, so a second copy of the script on one page throws.
	it('waits on a script the page already carries rather than planting a second', async () => {
		const doc = page();
		const theirs = doc.createElement('script');
		theirs.src = CHARIOT_SCRIPT_URL;
		doc.head.appendChild(theirs);

		const loading = loadChariotScript(doc, 'n0nce');
		expect(scripts(doc)).toHaveLength(1);
		register(doc);
		await expect(loading).resolves.toBe(true);
	});

	it('plants nothing where the element is already registered', async () => {
		const doc = page();
		register(doc);

		await expect(loadChariotScript(doc, 'n0nce')).resolves.toBe(true);
		expect(scripts(doc)).toHaveLength(0);
	});
});
