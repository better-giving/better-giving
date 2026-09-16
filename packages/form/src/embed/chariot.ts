// the third payment adapter: a donor-advised fund's own window, through Chariot Connect, beside
// ./stripe.ts and ./paypal.ts and presented to the flow by ./surface.ts.
//
// what it collects is `daf` (`CHARIOT_RAILS` in ./rails.ts), and it collects it in the other order
// from the two adapters beside it. there the flow mints a quote and then confirms it through the
// processor's own surface; here the donor authorizes in the fund's window first, and the approval is
// what the quote is minted on — the server creates the grant inside that same request, and nothing is
// confirmed after it. so `confirm` and `resume` below answer nothing, and the window reports into the
// flow through `FundReports` in ../ports.ts instead.
//
// four facts about Chariot's script shape everything here — the first three measured against the
// served script, the fourth stated in its integration guide
// (https://docs.givechariot.com/guides/dafpay/integrating-dafpay/integration):
//
//   - it finds `<chariot-connect>` with a document query. inside a shadow root its window opens and
//     completes and the result is silently dropped, so the element goes in the light-DOM node
//     ../element.ts hands out — the same one the other two adapters paint into.
//   - its events neither bubble nor cross a shadow boundary, so every listener is on the element.
//   - it keeps one callback store for the page, and the first matching element on the page is the
//     one it answers. two forms each holding one would open one form's window on the other's gift,
//     so one element is live per page: the first form to mount it keeps it, and a second form offers
//     no fund until the first lets go (`pages` below). the element is never moved between forms.
//   - it opens its window from its own button's click and asks for the gift synchronously on that
//     click. a window opened more than a moment after the press is a popup the browser blocks, so
//     nothing is awaited between the press and the answer (`opened` on `FundReports`).
//
// Chariot's own button is the fund's option on the card, standing in a row of the payment box
// (./rows.ts): opening the row only shows the button, and one press on the button chooses the rail
// and opens the window. it stands while the flow says a fund is offered (`fundIsOffered` in
// ../checkout.machine.ts, told through `offer` below), and the element Chariot's script builds adds
// one `@font-face` `<style>` to the document head each time it is created, which a donor returning
// to the review step adds again.
//
// no sandbox, no stage: the Connect id in the served config is the only thing that decides which
// organisation a grant goes to, for the reason CLAUDE.md gives under *Product surface*.
//
// `../../package.json` exports this module as `./embed/chariot`.

import type { Failure } from '../checkout.machine';
import type { CheckoutPorts, FundReports } from '../ports';
import type { FormConfig } from '../v1';
import { INJECTING_NONCE } from './nonce';
import { createRows, type Row, type RowList } from './rows';
import type { PaymentSurface } from './stripe';

/** what this adapter's own entry on `FormConfig.providers` calls itself, and whose key is the Connect id. */
const PROVIDER_NAME = 'chariot';

/**
 * what a donor reads on the fund's row, which names no processor for the reason `waitingOn` in
 * ../views.ts gives.
 */
const ROW_NAME = 'Donor-advised fund';

/** where Chariot serves the script that registers its element. */
export const CHARIOT_SCRIPT_URL = 'https://cdn.givechariot.com/chariot-connect.umd.js';

/** the tag that script registers globally. */
export const CHARIOT_TAG = 'chariot-connect';

/** the two endings of the window, dispatched on the element itself. */
const SUCCESS = 'CHARIOT_SUCCESS';
const EXIT = 'CHARIOT_EXIT';

/**
 * what Chariot's element takes a gift in, as its own documentation names the fields.
 *
 * `frequency` is stated rather than left to default: the rail is one-time only, and a default that
 * moved would make every grant a repeating one this deployment cannot match.
 */
export type ChariotDonation = {
	readonly amount: number;
	readonly firstName: string;
	readonly lastName: string;
	readonly email: string;
	readonly frequency: 'ONE_TIME';
};

/** as much of Chariot's element as this module uses; the stand-in in ./chariot.dom.spec.ts satisfies it. */
export type ChariotConnectLike = HTMLElement & {
	onDonationRequest(callback: () => ChariotDonation | false): void;
};

/**
 * how long Chariot's script is given to register its element.
 *
 * the same figure and argument as `MOUNT_DEADLINE_MS` in ./stripe.ts and ./paypal.ts, and a constant
 * of its own for their reason: importing either would carry that processor's SDK into this one's
 * consumers. a script tag that fires neither `load` nor `error` names itself in no other way.
 */
export const MOUNT_DEADLINE_MS = 30_000;

/** the seam a spec reaches through, and nothing production passes. */
export type ChariotSeam = {
	/** Chariot's element, registered on this document — `true` once it is, `false` where it never will be. */
	readonly load?: (doc: Document) => Promise<boolean>;
	/** the timer the mount deadline is armed on, returning the cancel for it. */
	readonly delay?: (run: () => void, ms: number) => () => void;
};

/**
 * what a donor is told when the fund's button never came up.
 *
 * said at most once, while the donor is still filling the form in, so nothing can have been granted.
 */
const NO_BUTTON =
	'The donor-advised fund option on this form did not load, and nothing was granted. Reload the page to try again.';

function noButtonFix(reason: string): string {
	return (
		`The donor-advised fund option did not finish loading: ${reason}. Check that the Connect id in this form’s ` +
		'configuration is this organisation’s, that cdn.givechariot.com and secure.dafpay.com are reachable from this ' +
		'page, and that no Content-Security-Policy on it blocks the origins in custom-elements.json.'
	);
}

/**
 * who holds the fund's element on each document, and the forms waiting for it to be let go.
 *
 * one holder per document for the reason this file's header gives: Chariot answers the first element
 * on the page, so a second one live beside it is a window opened on the wrong form's gift. a waiter
 * is asked again when the holder lets go, and the first to still want it takes it.
 */
type Page = { held: boolean; readonly waiting: Set<() => void> };
const pages = new WeakMap<Document, Page>();

function pageOf(doc: Document): Page {
	const known = pages.get(doc);
	if (known !== undefined) return known;
	const page: Page = { held: false, waiting: new Set() };
	pages.set(doc, page);
	return page;
}

/** Chariot's element, loaded at most once per document. */
const loads = new WeakMap<Document, Promise<boolean>>();

/**
 * the script on the page, carrying `nonce`, and its element registered.
 *
 * a script already on the page — the host's own, or another form's — is waited on rather than planted
 * twice: the element is registered unguarded, and a second registration throws. one that errs is
 * taken back off and forgotten, so the next call plants it again.
 */
export function loadChariotScript(doc: Document, nonce: string): Promise<boolean> {
	const held = loads.get(doc);
	if (held !== undefined) return held;
	const registry = doc.defaultView?.customElements;
	if (registry === undefined) return Promise.resolve(false);
	const loading = new Promise<boolean>((resolve) => {
		if (registry.get(CHARIOT_TAG) !== undefined) {
			resolve(true);
			return;
		}
		void registry.whenDefined(CHARIOT_TAG).then(() => resolve(true));
		if (doc.querySelector(`script[src="${CHARIOT_SCRIPT_URL}"]`) !== null) return;
		const script = doc.createElement('script');
		script.src = CHARIOT_SCRIPT_URL;
		// assigned rather than set as an attribute — see `scriptNonce` in ./loader.ts.
		if (nonce !== '') script.nonce = nonce;
		script.addEventListener('error', () => {
			script.remove();
			loads.delete(doc);
			resolve(false);
		});
		(doc.head ?? doc.documentElement).appendChild(script);
	});
	loads.set(doc, loading);
	return loading;
}

/** Chariot's script on the page, carrying the nonce this runtime's own tag was injected with. */
function defaultLoad(doc: Document): Promise<boolean> {
	return loadChariotScript(doc, INJECTING_NONCE);
}

/** the window's approval, read off an event nothing in this project wrote. */
function approvalOf(detail: unknown): { authorizationId: string; authorizedMinor: number } | null {
	if (typeof detail !== 'object' || detail === null) return null;
	const { workflowSessionId, grantIntent } = detail as {
		workflowSessionId?: unknown;
		grantIntent?: { amount?: unknown };
	};
	const amount =
		typeof grantIntent === 'object' && grantIntent !== null ? grantIntent.amount : null;
	if (typeof workflowSessionId !== 'string' || workflowSessionId.length === 0) return null;
	if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) return null;
	return { authorizationId: workflowSessionId, authorizedMinor: amount };
}

/** the payment surface this adapter presents, plus the one thing ./surface.ts tells it. */
export type ChariotPaymentSurface = PaymentSurface & {
	/** whether the flow offers a fund right now — told on every reading, so a repeat changes nothing. */
	offer(offered: boolean): void;
	/** the one row the element stands in while it stands, which ./surface.ts opens and closes. */
	readonly rows: RowList;
};

/**
 * the fund's own button, standing in the node it was handed while a fund is offered.
 *
 * `onUnavailable` is called at most once, where the element will never be registered — the script
 * erred, or answered neither way inside `MOUNT_DEADLINE_MS` — or the config names no Connect id to
 * open it on.
 */
export function createPaymentSurface(
	config: FormConfig,
	mount: HTMLElement,
	onUnavailable: (failure: Failure) => void,
	fund: FundReports,
	seam?: ChariotSeam
): ChariotPaymentSurface {
	const doc = mount.ownerDocument;
	const page = pageOf(doc);
	const cid =
		config.providers.find((entry) => entry.name === PROVIDER_NAME)?.publishableKey ?? null;
	const load = seam?.load ?? defaultLoad;
	const delay = seam?.delay ?? defaultDelay(mount);

	// the row the element stands in pads itself, for the reason `rowList` in ./paypal.ts gives.
	const rowList = createRows(mount);

	let stopped = false;
	let loaded = false;
	let offered = false;
	let announced = false;
	/** cancels the mount deadline, where one is standing. */
	let disarm: (() => void) | null = null;
	/** the fund's element while this form holds the page's one, and the listeners on it. */
	let held: {
		readonly connect: ChariotConnectLike;
		readonly row: Row;
		readonly letGo: AbortController;
	} | null = null;

	const unavailable = (reason: string): void => {
		if (announced) return;
		announced = true;
		onUnavailable({ message: NO_BUTTON, fix: noButtonFix(reason) });
	};

	function mountConnect(id: string): void {
		const connect = doc.createElement(CHARIOT_TAG) as ChariotConnectLike;
		connect.setAttribute('cid', id);
		connect.onDonationRequest(() => {
			const request = fund.opened();
			return request === null
				? false
				: {
						amount: request.amountMinor,
						firstName: request.firstName,
						lastName: request.lastName,
						email: request.email,
						frequency: 'ONE_TIME'
					};
		});
		const letGo = new AbortController();
		connect.addEventListener(
			SUCCESS,
			(event) => {
				const approval = approvalOf((event as CustomEvent).detail);
				if (approval !== null) {
					fund.approved(approval);
					return;
				}
				// an approval this end cannot read is a grant nothing can create, so the donor is put
				// back in front of the button rather than told a gift was made.
				console.error(
					'a donation form could not read the approval from the fund’s window, so no grant was created'
				);
				fund.closed();
			},
			{ signal: letGo.signal }
		);
		connect.addEventListener(EXIT, () => fund.closed(), { signal: letGo.signal });
		page.held = true;
		held = { connect, row: rowList.draw(ROW_NAME, 'fund', connect), letGo };
	}

	/** the element brought into line with what is wanted, and the page's one handed on when let go. */
	function settle(): void {
		const wanted = !stopped && loaded && offered && cid !== null;
		if (wanted && held === null) {
			if (page.held) {
				page.waiting.add(settle);
				return;
			}
			page.waiting.delete(settle);
			mountConnect(cid);
			return;
		}
		if (wanted) return;
		page.waiting.delete(settle);
		if (held === null) return;
		held.letGo.abort();
		rowList.erase(held.row);
		held = null;
		page.held = false;
		for (const waiter of [...page.waiting]) waiter();
	}

	if (cid === null) {
		unavailable(`the served config names no ${PROVIDER_NAME} processor to open it on`);
	} else {
		disarm = delay(() => {
			disarm = null;
			unavailable(
				`${CHARIOT_SCRIPT_URL} did not register <${CHARIOT_TAG}> on this page, either way`
			);
		}, MOUNT_DEADLINE_MS);
		void load(doc).then((answered) => {
			disarm?.();
			disarm = null;
			if (!answered) {
				unavailable(`${CHARIOT_SCRIPT_URL} did not register <${CHARIOT_TAG}> on this page`);
				return;
			}
			// an answer after the deadline still draws the button: the donor has been told once, and a
			// fund that turns up late is still a fund they can give from.
			loaded = true;
			settle();
		});
	}

	// the fund's window reports into the flow rather than through a confirmation, so neither of these
	// is ever asked on this rail. each answers as the answer nobody has, which is the direction that
	// costs a re-read rather than a second grant.
	const unanswerable: CheckoutPorts['confirm'] = () => Promise.resolve({ kind: 'indeterminate' });

	return {
		confirm: unanswerable,
		resume: () => Promise.resolve({ kind: 'indeterminate' }),
		rows: rowList,
		quoted() {},
		// which cadence is offered a fund is the flow's answer, carried by `offer` below.
		cadence() {},
		offer(next) {
			offered = next;
			settle();
		},
		stop() {
			if (stopped) return;
			stopped = true;
			disarm?.();
			disarm = null;
			settle();
		}
	};
}

/**
 * the mount deadline's timer, off the window the card is actually in — `defaultDelay` in ./paypal.ts
 * reads its own the same way.
 */
function defaultDelay(mount: HTMLElement): (run: () => void, ms: number) => () => void {
	return (run, ms) => {
		const view = mount.ownerDocument.defaultView;
		if (view === null) return () => {};
		const timer = view.setTimeout(run, ms);
		return () => view.clearTimeout(timer);
	};
}
