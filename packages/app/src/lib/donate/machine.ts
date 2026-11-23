import { createCoinPicker, type CoinPicker } from '@better-giving/form/coin-picker';
import {
	checkoutMachine,
	cryptoIsOffered,
	fundIsOffered,
	openFund,
	pledgeIsOffered,
	venmoIsOffered
} from '@better-giving/form/machine';
import type { CheckoutEvent, CheckoutInput, Failure } from '@better-giving/form/machine';
import { toState, type CheckoutSnapshot, type State } from '@better-giving/form/connect';
import type { CheckoutPorts, FundReports } from '@better-giving/form/ports';
import { createPaymentSurface, type PaymentSeams } from '@better-giving/form/embed/surface';
import { EmbedFailure } from '@better-giving/form/embed/api';
import { createChallenge, type ChallengeSeams } from '@better-giving/form/embed/challenge';
import type { FormConfig, PaymentMethod } from '@better-giving/form/v1';
import { createActor, type Actor } from 'xstate';
import { deploymentPorts } from './ports';

// the actor's life, and the two imperative surfaces that live exactly as long as it does.
//
// the split from the views is where the seam already is: everything below this module reads a
// `connect` projection and nothing else, and everything the flow cannot do itself arrives here as a
// port. what is in this file rather than in a component is what react cannot own — a provider's
// element group registered inside a script we did not write, a challenge widget registered under an
// id nothing here ever sees, and an actor whose subscription is what tells either of them that the
// flow moved.
//
// the payment surface is created here rather than in ./payment.tsx because it is not a rendering
// concern at all: `confirm` and `resume` are ports, so the actor cannot be built without it. the
// challenge is here for the mirror reason — it is reset on the transition out of a busy flow, and
// the actor's own subscription is the only thing that sees a transition. what the two components
// own is the box each is mounted into: its markup, its part names, whether it is on screen, and
// what a refused press says about it.
//
// no react and no document global. the mount nodes arrive as arguments, which is what keeps
// this module testable with a plain object for each seam.

export type { CheckoutSnapshot };

/**
 * where a fresh card starts when the page hosting it asks: on monthly, or with the dedication open.
 *
 * the machine's own input, so what each flag means — monthly only where the form offers it, and
 * nothing at all on a resumed flow — is `openingDraft` in @better-giving/form/machine's alone.
 * `initialSnapshot` and `startCheckout` both take it, and a card hands both the same one: a flag
 * that reached one and not the other is the card changing under the donor on hydrate.
 */
export type Opening = NonNullable<CheckoutInput['opening']>;

/**
 * the snapshot a card renders from before anything has started.
 *
 * a pure function of the configuration and the page's opening, and it has to be: the loader has
 * both server-side, so the amounts, the cadences and the tiles are in the HTML, and the client's
 * first render has to produce the same tree or hydration mismatches on the screen that takes money.
 * `boot` reaches `amount` on an `always` transition that calls no port and arms no timer, so
 * starting an actor on inert ports and reading one snapshot off it is a value rather than an effect.
 *
 * the ports never settle rather than rejecting. nothing reaches them on the way to `amount`, and a
 * rejection would be an outcome this snapshot could be built holding.
 */
export function initialSnapshot(config: FormConfig, opening?: Opening): CheckoutSnapshot {
	const inert = (): Promise<never> => new Promise<never>(() => {});
	const ports: CheckoutPorts = {
		quote: inert,
		confirm: inert,
		resume: inert,
		status: inert,
		now: () => 0
	};
	const actor = createActor(checkoutMachine, {
		input: { config, ports, ...(opening === undefined ? {} : { opening }) }
	});
	actor.start();
	const snapshot = actor.getSnapshot();
	actor.stop();
	return snapshot;
}

/** what a card hands over when it starts the live flow. */
export type CheckoutMounts = {
	/** the node the payment provider paints its own fields into. */
	readonly paymentMount: HTMLElement;
	/** the node the anti-abuse challenge is drawn in. */
	readonly challengeMount: HTMLElement;
	/**
	 * the review step's node for the same challenge, beside the press, which it is drawn afresh into
	 * only while a press is held on it and it is asking the donor to solve something.
	 */
	readonly heldChallengeMount: HTMLElement;
	/**
	 * the pledge screen's node for the same challenge, beside its press, which it is drawn afresh into
	 * only while a lost pledge's save made again waits on it and it is asking the donor to solve
	 * something (`awaitingToken` under `telling` in @better-giving/form/machine).
	 */
	readonly toldChallengeMount: HTMLElement;
	/** the payment this page was sent back to, where it was sent anywhere. */
	readonly resumeToken: string | null;
	/**
	 * what a spec replaces so no processor's script is reached.
	 *
	 * `payment` is one entry per processor rather than one seam, because the composer this page
	 * builds its surface through is in between the two adapters rather than in front of them.
	 */
	readonly seams?: { readonly payment?: PaymentSeams; readonly challenge?: ChallengeSeams };
};

export type Checkout = {
	readonly actor: Actor<typeof checkoutMachine>;
	/**
	 * the coin list a `crypto` gift is chosen in, which the crypto option stands in its row in the
	 * payment box. built here because the surface takes it before the actor exists; what it lists and
	 * says, and when the caret goes into it, are the card's.
	 */
	readonly coins: CoinPicker;
	/**
	 * the node the IRA (QCD) option stands in its row in the payment box, for the card to draw the
	 * custodian box and the benefits panel into. built here for `coins`' reason; a plain node, since
	 * this page's own sheets are the only ones in its document.
	 */
	readonly ira: HTMLElement;
	/**
	 * hands `listener` how many options the payment box lists, now and on every change.
	 *
	 * the surface's own `rows`, passed through: the count is the one this module's surface drew. one
	 * listener; a second call replaces the first, and `stop` below is what ends it.
	 */
	rows(listener: (count: number) => void): void;
	/**
	 * tells `listener` when a program page's quote is refused as an unknown form and the form itself
	 * still reads, which is how a program no longer active is told apart from a form that is gone: the
	 * endpoint answers both with the same refusal (`pageProgramId` in
	 * packages/app/src/lib/server/donations/quote.ts). the refusal waits on the form's config read,
	 * `REREAD_TIMEOUT_MS` at most, and is told here only where that read answers OK, so the failure
	 * screen's first draw already knows the program stopped — while the gift request and that wait
	 * together finish inside the flow's own `PORT_TIMEOUT_MS` (packages/form/src/checkout.machine.ts).
	 * a refusal landing later loses to that timeout: the generic failure draws first and this is told
	 * after it. never told on a card with no `pageProgramId`, nor after `stop`. one listener; a second
	 * call replaces the first.
	 */
	stopped(listener: () => void): void;
	/**
	 * everything this checkout started, let go of.
	 *
	 * safe in any order and any number of times, because every stop it reaches is. the provider's
	 * element group and the challenge widget are both registered inside scripts this project did not
	 * write, under handles nothing here sees, so removing the nodes they painted in collects the DOM
	 * and tells neither script anything — a card that stopped without this leaves one live group per
	 * gift, each still reporting into a flow that has ended.
	 */
	stop(): void;
};

/**
 * how long a program page's refused quote waits on the form's config read before the flow hears
 * the refusal with the API's own sentence.
 */
const REREAD_TIMEOUT_MS = 5_000;

/**
 * `quote`, awaiting `heard` on a refusal as an unknown form and then rethrowing it unchanged, so
 * whatever `heard` learns is in place before the flow draws the failure, unless the flow's own port
 * timeout ends the attempt first.
 *
 * the inner port is called before anything is awaited: `quoteThrough` in
 * @better-giving/form/embed/surface opens a provider's window inside the donor's press.
 */
function heardStopping(
	quote: CheckoutPorts['quote'],
	heard: () => Promise<void>
): CheckoutPorts['quote'] {
	return async (request) => {
		try {
			return await quote(request);
		} catch (error) {
			if (error instanceof EmbedFailure && error.code === 'form_not_found') await heard();
			throw error;
		}
	};
}

/**
 * whether the form's config read answers OK: the read the embed boots on (`configUrl` in
 * packages/form/src/embed/runtime.ts, which the package does not export), same-origin as in
 * ./ports.ts. a refusal, an unreachable endpoint and an abort are all `false`.
 */
async function formStillReads(formId: string, signal: AbortSignal): Promise<boolean> {
	try {
		const response = await fetch(`/api/v1/forms/${encodeURIComponent(formId)}/config`, {
			signal,
			headers: { accept: 'application/json' }
		});
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * the flow, running, with every provider wired into it.
 *
 * the payment surface is built before the actor because two of the actor's five ports are its own
 * and a third is wrapped around it (./ports.ts).
 * it is the composer in @better-giving/form/embed/surface rather than either processor's adapter,
 * so a deployment holding two of them still hands the flow one surface and nothing below this line
 * learns there was more than one.
 * the challenge is built on arrival at the details step instead, which is the last moment it can be
 * drawn without a donor waiting on it: from there it has that step's typing and the review step to
 * finish in.
 *
 * the token is spent by the press that leaves a busy flow, and spent is spent — it is valid once
 * whether the endpoint honoured it or refused it. so the widget is reset on the way out of
 * `working` rather than on the donor's Try again, which gives the reset the whole of the failure
 * screen to finish in.
 *
 * every report either provider makes becomes an event rather than a call: the rail the donor picked,
 * the fields never coming up, a repeating gift none of them can take any longer, a fund's window
 * approving or closing, a token minted, a challenge that could not be shown. the one report that is
 * answered is a fund's press — its script asks for the gift and opens its window in the same call —
 * so `openFund` in @better-giving/form/machine sends
 * the press and reads the answer back with nothing awaited between. the token is sent at the
 * actor as `SET_TURNSTILE_TOKEN`, the event the projection's own `setTurnstileToken` sends
 * (@better-giving/form's connect.ts), so the one this page collects and the one a headless
 * integrator would hand in travel one path.
 */
export function startCheckout(
	config: FormConfig,
	mounts: CheckoutMounts,
	opening?: Opening,
	/** the program a program page was drawn for: the machine's own `pageProgramId` input. */
	pageProgramId?: string
): Checkout {
	const {
		paymentMount,
		challengeMount,
		heldChallengeMount,
		toldChallengeMount,
		resumeToken,
		seams
	} = mounts;

	// through holders rather than straight at the actor: both surfaces are handed their callbacks
	// while the actor is still being constructed, and every real report arrives with a provider's
	// script, which is later than both.
	let rail: (method: PaymentMethod | null) => void = () => {};
	let unavailable: (failure: Failure) => void = () => {};
	let fundSays: (event: CheckoutEvent) => void = () => {};
	let opened: FundReports['opened'] = () => null;
	let stopped: () => void = () => {};

	const coins = createCoinPicker(paymentMount.ownerDocument);
	const ira = paymentMount.ownerDocument.createElement('div');

	const surface = createPaymentSurface(
		config,
		paymentMount,
		(method) => rail(method),
		(failure) => unavailable(failure),
		{
			opened: () => opened(),
			approved: (authorization) => fundSays({ type: 'FUND_APPROVED', ...authorization }),
			closed: () => fundSays({ type: 'FUND_CLOSED' })
		},
		coins.host,
		seams?.payment,
		ira
	);

	const ports = deploymentPorts(surface);
	const rereads = new AbortController();
	// a controller per read, aborted by its own timeout or by a `stop` that lands while it runs: a
	// timeout aborting `rereads` itself would refuse every later attempt's read before it is sent. a
	// refusal arriving after `stop` still sends its read, bounded by the timeout alone, and tells
	// nobody.
	const reread = async (): Promise<void> => {
		const read = new AbortController();
		const abort = (): void => read.abort();
		const timer = setTimeout(abort, REREAD_TIMEOUT_MS);
		rereads.signal.addEventListener('abort', abort, { once: true });
		try {
			if ((await formStillReads(config.formId, read.signal)) && !rereads.signal.aborted) stopped();
		} finally {
			clearTimeout(timer);
			rereads.signal.removeEventListener('abort', abort);
		}
	};
	const actor = createActor(checkoutMachine, {
		input: {
			config,
			ports:
				pageProgramId === undefined
					? ports
					: { ...ports, quote: heardStopping(ports.quote, reread) },
			...(resumeToken === null ? {} : { resume: { paymentToken: resumeToken } }),
			...(opening === undefined ? {} : { opening }),
			...(pageProgramId === undefined ? {} : { pageProgramId })
		}
	});

	rail = (method) => actor.send({ type: 'SET_METHOD', method });
	unavailable = (failure) => actor.send({ type: 'PAYMENT_UNAVAILABLE', failure });
	fundSays = (event) => actor.send(event);
	opened = () => openFund(actor);
	// at the actor rather than through a holder: the surface replays a report made before this.
	surface.repeatingUnavailable(() => actor.send({ type: 'REPEATING_UNAVAILABLE' }));

	let challenge: ReturnType<typeof createChallenge> | null = null;
	/** the step the last reading was on, which is what makes a reading a transition. */
	let previous: State['step'] | null = null;
	/** whether the last reading was a pledge's second save, which spends a token too. */
	let resaving = false;
	/** whether the last reading waited to send a pledge again under a fresh id. */
	let retaking = false;

	const read = (): void => {
		const snapshot = actor.getSnapshot();
		const state = toState(snapshot);
		// told on every reading rather than on a change: nothing here holds a memory of what it last
		// said, and the surface is where a reading that changes nothing stops.
		surface.cadence('fv' in state ? state.fv?.frequency : undefined);
		surface.offerFund(fundIsOffered(snapshot));
		surface.offerCrypto(cryptoIsOffered(snapshot));
		surface.offerVenmo(venmoIsOffered(snapshot));
		surface.offerIra(pledgeIsOffered(snapshot, 'ira_qcd'));

		if (state.step === 'details' && challenge === null) {
			challenge = createChallenge(
				config,
				challengeMount,
				(token) => actor.send({ type: 'SET_TURNSTILE_TOKEN', token }),
				(failure) => actor.send({ type: 'CHALLENGE_UNAVAILABLE', failure }),
				{
					// the config arrived with this page, so its address is the page's own.
					configUrl: challengeMount.ownerDocument.URL,
					onInteractive: (needed) =>
						actor.send({ type: 'SET_CHALLENGE_INTERACTIVE', interactive: needed }),
					...(seams?.challenge === undefined ? {} : { seam: seams.challenge })
				}
			);
		}

		// the details step's node is hidden by the time a press is held, and a widget asking for the
		// donor inside a node with no box is one they cannot answer. a redraw into the node it is
		// already in does nothing, so this is said on every reading of that state.
		if (snapshot.value === 'holding' && snapshot.context.challengeInteractive) {
			challenge?.redraw?.(heldChallengeMount);
		}
		// and the same for a lost pledge's save made again, which waits on the pledge screen.
		if (
			snapshot.matches({ pledged: { telling: 'awaitingToken' } }) &&
			snapshot.context.challengeInteractive
		) {
			challenge?.redraw?.(toldChallengeMount);
		}

		if (previous === 'working' && state.step !== 'working') challenge?.reset();
		previous = state.step;
		// the same for the save a told press makes again on the pending screen, which spends one
		// without leaving `pledged` (`telling` in @better-giving/form/machine).
		const saving = snapshot.matches({ pledged: { telling: 'saving' } });
		if (resaving && !saving) challenge?.reset();
		resaving = saving;
		// and on the way into the wait to send a save refused `pledge_id_taken` under a fresh id, which
		// stays in `working`: the refused send spent the token, and the retry waits for a fresh one
		// (`retaking` in @better-giving/form/machine).
		const waitingToRetake = snapshot.matches('retaking');
		if (waitingToRetake && !retaking) challenge?.reset();
		retaking = waitingToRetake;
	};

	const subscription = actor.subscribe(read);
	actor.start();
	read();

	return {
		actor,
		coins,
		ira,
		rows: (listener) => surface.rows(listener),
		stopped: (listener) => {
			stopped = listener;
		},
		stop() {
			rereads.abort();
			subscription.unsubscribe();
			// the IRA (QCD) row reports its rail closing as `surface.stop` below takes it off the page,
			// and the actor it would report to is stopped by then.
			rail = () => {};
			actor.stop();
			const widget = challenge;
			challenge = null;
			widget?.stop();
			surface.stop();
		}
	};
}
