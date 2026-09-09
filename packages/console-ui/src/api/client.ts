import type {
	Connection,
	ConsoleVersion,
	HomeReading,
	HomeShape,
	OrgWrite,
	PaymentsRead,
	RecurringRead,
	RecurringSetup,
	SignInStatus,
	SitesWrite,
	Started,
	StripeRunRead,
	StripeStarted,
	TestSend,
	VarsWritten,
	WalletsLevel,
	WidgetLevel
} from './types';

// the console's own process, reached from the page it serves.
//
// **every path is relative, and that is the whole of the arrangement.** the binary serves this page
// and answers `/api` on the same origin, and under `pnpm run console` vite proxies `/api` to it
// (../../vite.config.ts) — so a call from here is same-origin either way, carries no cors question,
// and reaches nothing but the process on this machine. an absolute address here would be the one way
// to point the page at something else.
//
// **a call that cannot be made at all is thrown and never returned.** the local process is the whole
// of this console's authority: a fetch that does not land means the binary has stopped, which is a
// state the route's own error boundary draws in those words (../routes/_index.tsx) rather than a
// value each screen would have to carry. a refusal it did answer is thrown for the same reason,
// carrying whatever the handler named — every one of them is a state the page's own reading rules
// out, so there is nothing here for an operator to act on. `consoleVersion` below is the one
// exception and states its own reason.

/** one call to the local process, answered as json or thrown. */
async function ask<T>(path: string, method: 'GET' | 'POST'): Promise<T> {
	const answer = await fetch(`/api${path}`, {
		method,
		headers: { accept: 'application/json' }
	});
	const read = await parsed(answer);
	if (!answer.ok) throw new Error(refusal(read, answer.status));
	return read as T;
}

/** one press carrying a json body, answered as json or thrown. */
async function post<T>(path: string, body: unknown): Promise<T> {
	const answer = await fetch(`/api${path}`, {
		method: 'POST',
		headers: { accept: 'application/json', 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const read = await parsed(answer);
	if (!answer.ok) throw new Error(refusal(read, answer.status));
	return read as T;
}

/** the json a handler wrote, or `null` where what came back was not json. */
async function parsed(answer: Response): Promise<unknown> {
	try {
		return (await answer.json()) as unknown;
	} catch {
		// a body that is not json says nothing the status does not.
		return null;
	}
}

/** what a handler said about turning a call down, in its own words where it wrote any. */
function refusal(body: unknown, status: number): string {
	if (typeof body === 'object' && body !== null && 'error' in body) {
		const said = (body as { error: unknown }).error;
		if (typeof said === 'string' && said !== '') return said;
	}
	return `the console answered ${status}`;
}

/** how this machine is signed in, and what a sign-in opened in a browser is doing. */
export const signInStatus = (): Promise<SignInStatus> => ask('/sign-in', 'GET');

/**
 * opens cloudflare's own allow page in the operator's browser.
 *
 * `started` is false where one is already open: the binary answers the press rather than opening a
 * second browser, and the panel reports it at the control that was pressed.
 */
export async function startSignIn(): Promise<{ started: boolean }> {
	const answer = await fetch('/api/sign-in', {
		method: 'POST',
		headers: { accept: 'application/json' }
	});
	if (answer.status === 409) return { started: false };
	if (!answer.ok) throw new Error(refusal(await parsed(answer), answer.status));
	return { started: true };
}

/** ends a sign-in the operator no longer wants to finish. */
export const stopSignIn = (): Promise<Started> => ask('/sign-in/stop', 'POST');

/** gives up the sign-in this machine holds, at cloudflare and on disk. */
export const signOut = (): Promise<Started> => ask('/sign-out', 'POST');

/**
 * ends the run this console is inside.
 *
 * **it is answered before the process stops** (`packages/console/internal/server/close.go`), which
 * is why it is asked for like anything else here rather than sent and forgotten. it is answered
 * whatever else is going on, too: the binary waits for the press it is holding to finish before it
 * shuts anything down, so this cuts no write short.
 *
 * the recorded cloudflare account is untouched. which account this deployment is in is recorded at
 * the terminal, and no press on this page makes or unmakes that record.
 */
export const closeConsole = (): Promise<{ closing: boolean }> => ask('/console/close', 'POST');

/**
 * whether a shell is drawn at all, and the two names every screen under it is about.
 *
 * the immediate half of the home screen: everything in it is the binary's own memory and the
 * release it was baked from, so it answers within a loopback round trip and the bar goes up before
 * anything has been asked of cloudflare.
 */
export const homeShape = (): Promise<HomeShape> => ask('/home', 'GET');

/**
 * the whole slower reading under that shell, as one answer.
 *
 * every cloudflare round trip and the deployment's own answer, in one call: the face is a function
 * of all of them, so nothing about it can be drawn before the slowest lands — and one call is one
 * checking state rather than a page that resolves three times under the reader.
 */
export const homeReading = (): Promise<HomeReading> => ask('/home/reading', 'GET');

/**
 * sets and clears the values a fold's boxes carry, in one request to cloudflare.
 *
 * every one of the thirteen is a plain var, so this is the one door every press on the page writes
 * through — a read of the worker's bindings and one patch back. seconds and no deploy: the binary
 * replaces the named bindings and sends every other one back up as inherited, so the deployment's
 * database and its rate limiters are untouched.
 *
 * **what crosses is the act and never the boxes.** which names a press is setting and which it is
 * removing is read in the browser, against what the form was drawn holding (../lib/secret-edits.ts);
 * a name mapped to `null` is deleted, and a name this does not carry is left exactly as it was.
 *
 * **every way it did not happen comes back as a value rather than thrown**, because each is a state
 * the fold draws at the control that was pressed. the binary refuses a name that is not one of the
 * thirteen before cloudflare is asked, and that refusal is thrown: no control on this page can make
 * one.
 */
export const setVars = (values: Record<string, string | null>): Promise<VarsWritten> =>
	post('/values/vars', { values });

/**
 * takes every value this deployment is holding in a form nothing can read back off it.
 *
 * it carries no name at all: which ones are freed is read off cloudflare inside the binary, because
 * a name that travelled through a page is a credential deleted wherever that page said.
 */
export const freeWithheldVars = (): Promise<VarsWritten> => ask('/values/vars/free', 'POST');

/**
 * mints this console's session, writes it onto the deployment and records it on this machine.
 *
 * **the address it is written at is read inside the binary and never posted**, for the reason the
 * account is: a host that travelled through a page is a credential written wherever that page said.
 * the account and the worker are the binary's own too — the recorded choice and the baked release.
 *
 * **one press at a time.** a second while one is in flight joins the first's outcome rather than
 * minting a second session: two writes would leave this console holding whichever token it recorded
 * last while the deployment holds whichever was written last.
 *
 * every way it did not happen comes back as a value, because each is a state the panel draws at the
 * control that was pressed.
 */
export const connect = (): Promise<Connection> => ask('/session', 'POST');

/**
 * stores the organisation's profile, whole, from whichever of the two folds pressed.
 *
 * every box goes with every press, empty ones included, because that is what the endpoint reads: a
 * field left out of the body is stored as cleared. what a value may be is the deployment's rule and
 * is not read here — a refusal comes back keyed by field, and each sentence is drawn under the box
 * it is about.
 */
export const saveOrgProfile = (values: Record<string, string>): Promise<OrgWrite> =>
	post('/deployment/org', { values });

/**
 * asks the deployment to send a test message to the address typed beside the button.
 *
 * the deployment sends it and this console cannot: the message goes over its own mail transport
 * with its own SMTP credentials, and this arrangement exists so that no console has to hold one.
 */
export const sendTestEmail = (to: string): Promise<TestSend> =>
	post('/deployment/test-email', { to });

/** what the deployment says about the account it charges on. */
export const readPayments = (): Promise<PaymentsRead> => ask('/deployment/payments', 'GET');

/**
 * where the deployment stands on gifts that repeat.
 *
 * the read changes nothing: the press below is the find-or-create arm, and a screen drawn from that
 * one would provision an operator's processor account as a side effect of them opening a page.
 */
export const readRecurring = (): Promise<RecurringRead> => ask('/deployment/recurring', 'GET');

/** asks the deployment to put what a repeating gift is charged against on that account. */
export const setUpRecurring = (): Promise<RecurringSetup> => ask('/deployment/recurring', 'POST');

/**
 * asks the deployment to register the hostnames a donor is drawn wallet buttons on.
 *
 * **it carries no hostname and none may ever be added.** the account is the operator's and a
 * registration is a public claim on a domain, so the list is the deployment's own address and its
 * own site rows, settled inside the worker — a hostname that travelled through this page would be a
 * registration made against whatever the page said.
 *
 * **three presses reach it and the order is the same at all three.** the Stripe keys run levels them
 * as its last step, the sites press below levels them after {@link levelWidget} and only where the
 * list was stored, and the payments fold's own press is the repair for a custom domain attached
 * afterwards. every hostname is levelled to the same finished state whatever it started in, so
 * pressing twice costs a round trip and nothing else.
 */
export const levelWallets = (): Promise<WalletsLevel> => ask('/deployment/wallet-domains', 'POST');

/**
 * stores the site list on the deployment, whole.
 *
 * the whole list goes with every press, never one row: the endpoint stores a list and deletes what
 * is not in it inside the same batch, so a row left out of the body is a site removed. the rule the
 * list is read against is applied to the boxes before this is called (../lib/sites.ts), and the
 * deployment applies it again over what it stores.
 */
export const saveSites = (sites: readonly string[]): Promise<SitesWrite> =>
	post('/deployment/sites', { sites });

/**
 * sets the payment processor up from the two keys, and answers as soon as the chain is under way.
 *
 * **it never answers with what the chain did.** the chain is several round trips against three
 * hosts, so a request held open for it is a page that cannot say which part is running: how far it
 * has got is {@link stripeRun}, asked over and over while it goes.
 *
 * **a press already going is a value rather than a throw**, the way a sign-in already open is: the
 * binary answers with the run it is holding rather than starting a second, and the fold draws that
 * run either way.
 *
 * **the two keys leave this page in this one body and reach nothing else.** neither is in what
 * comes back, neither is in the address, and the account and the worker they are spent on are read
 * inside the binary — a name that travelled through a page is an endpoint registered, and a
 * credential written, wherever that page said. an empty `secret` is the press that leaves the
 * stored one alone, which can make no call to the processor at all and is the var by itself.
 */
export async function startStripeSetup(keys: {
	secret: string;
	publishable: string;
}): Promise<StripeStarted> {
	const answer = await fetch('/api/stripe/setup', {
		method: 'POST',
		headers: { accept: 'application/json', 'content-type': 'application/json' },
		body: JSON.stringify(keys)
	});
	const body = await parsed(answer);
	if (answer.status === 409) {
		return { started: false, run: (body as { run: StripeRunRead }).run };
	}
	/* the door turning the pair down is a value rather than a throw, for the reason a press already
	   going is one: it is an answer about the boxes, and thrown it reaches the page's error boundary
	   — which draws a console that has stopped over a console that is answering. */
	if (answer.status === 400) return { started: false, turnedDown: true };
	if (!answer.ok) throw new Error(refusal(body, answer.status));
	return { started: true, run: (body as { run: StripeRunRead }).run };
}

/**
 * how far that press has got, or `null` where there is nothing to report.
 *
 * **a run that landed is consumed by the reading that observed it.** the whole of what says a press
 * worked is the reading the fold is holding when it stops, so the answer is handed over and then
 * dropped: a reload afterwards is a clean face rather than the last press reported again. a run
 * that stopped is left where it is — a failure has to survive a reload — and the next press clears
 * it.
 */
export const stripeRun = async (): Promise<StripeRunRead | null> =>
	(await ask<{ run: StripeRunRead | null }>('/stripe/run', 'GET')).run;

/**
 * the release this binary was built as, out of what it was baked with.
 *
 * **empty is an answer here and never a throw**, which is this module's one departure from the rule
 * above: it is read for the strip over the page before there is a page, and nothing on that page
 * depends on it — so a reading nobody could take is that end of the strip standing empty rather
 * than a route that will not draw (../lib/connect-panel.tsx). a binary built from a checkout rather
 * than a tagged release names none and lands in the same place.
 */
export async function consoleVersion(): Promise<ConsoleVersion> {
	try {
		const read = await ask<unknown>('/version', 'GET');
		return { version: named(read, 'version'), commit: named(read, 'commit') };
	} catch {
		return { version: '', commit: '' };
	}
}

/** a string the answer put under that name, and empty where it put anything else. */
function named(body: unknown, name: string): string {
	if (typeof body !== 'object' || body === null || !(name in body)) return '';
	const said = (body as Record<string, unknown>)[name];
	return typeof said === 'string' ? said : '';
}

/**
 * brings cloudflare's copy of the site list level behind what the deployment stored.
 *
 * **the deployment is written first and this is called only where that landed**, which is the order
 * whose failure costs least: a removal in this order leaves cloudflare covering a host nothing is
 * served on, where the reverse would leave a host still served and no longer challengeable, and
 * every gift from it would fail.
 *
 * the list posted is the one the deployment stored rather than the boxes, and the hosts inside it
 * are read in the binary — a host that travelled through a page is a widget somebody else's account
 * is levelled against.
 */
export const levelWidget = (sites: readonly string[]): Promise<WidgetLevel> =>
	post('/widget/level', { sites: [...sites] });
