import { connect, type CheckoutSnapshot, type State } from '@better-giving/form/connect';
import { takeResumeToken } from '@better-giving/form/embed/resume';
import type { CheckoutEvent } from '@better-giving/form/machine';
import { formatFigure, formatMinor, formatOffer, parseMinor } from '@better-giving/form/money';
import { part } from '@better-giving/form/parts';
import type { AmountDecision, PayerField } from '@better-giving/form/value';
import type { FormConfig } from '@better-giving/form/v1';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type ReactNode,
	type RefObject
} from 'react';
import { DonateAnnouncer } from './announce';
import * as copy from './copy';
import { initialSnapshot, startCheckout, type Checkout, type CheckoutMounts } from './machine';
import { reactPropTypes, type ReactApi } from './normalize';
import { AmountStep, type AmountRefs } from './steps/amount';
import { DetailsStep, fieldProblem, type DetailsRefs } from './steps/details';
import { GiveStep, readReceipt, Receipt, type ReceiptReading } from './steps/give';
import { BLANK, takeoverFor, TakeoverScreen } from './takeover';

// the donation card, drawn in the document tree.
//
// the deployment's own donor page renders the same statechart the embedded element does, through
// the same projection: `connect` in @better-giving/form/connect is handed a snapshot and a send and
// answers with the whole surface a renderer needs. so no predicate the flow owns is answered here —
// which cadences exist, which amounts, whether the fee is covered, whether a press would be taken
// — and no control carries `disabled`, because double submission is prevented by the flow's shape
// and an attribute would invite a reader to believe the attribute is the guarantee.
//
// what this component owns is everything react has to own for that projection to be a screen:
//
//   - the two-node root. an outer `[data-donate-root]` carrying the token ladder the form's own
//     `:host` block declares in a shadow tree, and the card itself carrying `part="card"`, which is
//     the query container every breakpoint in the form's layout sheet resolves against.
//   - the server render. `initialSnapshot` is a pure function of the configuration, so the amounts,
//     the cadences and the tiles are in the HTML and the client's first render produces the same
//     tree. the live actor is created in an effect after that first commit — the payment provider
//     reads computed style off a mounted node, and taking the resume token rewrites the URL, which
//     is not a thing a render may do.
//   - which screen the card is on. a busy flow stays on the last screen shown, because the flow
//     collapses five machine states into one thing a donor is told and the projection cannot say
//     which screen asked.
//   - the caret. a screen change hides the control that held focus, so focus is put on the heading
//     of the screen that arrived — never on the first paint, and never before the section it lands
//     in is out of `hidden`.
//   - what is said out loud, on one channel, decided in one place.
//
// the two mount nodes are the card's and the checkout's between them: this file renders them and
// hands them over, and `startCheckout` in ./machine.ts is what mounts a provider into each.

const SCREENS = ['amount', 'details', 'give', 'takeover'] as const;
type Screen = (typeof SCREENS)[number];

/**
 * what the card is showing.
 *
 * a busy flow stays where it happened: without that, the press on the review step drops the donor
 * onto a blank frame for the length of a request that spans two beats. the one exception is a busy
 * flow carrying no decided gift at all, which is a resume — a donor back from their bank, on a page
 * that must not show them an empty donation form while it finds out whether they have already paid.
 */
function visibleStep(state: State, last: Screen): Screen {
	if (state.step === 'amount') return 'amount';
	if (state.step === 'details') return 'details';
	if (state.step === 'give') return 'give';
	if (state.step === 'working') return state.fv === undefined ? 'takeover' : last;
	return 'takeover';
}

/** what a busy flow says out loud, which is not one sentence: a mint and a charge are different news. */
function workingWords(state: State): string {
	return state.step === 'working' && state.phase === 'confirming' ? copy.CONFIRMING : copy.WORKING;
}

export type DonateCardProps = {
	/**
	 * the served configuration, exactly as the config endpoint answers with it.
	 *
	 * read server-side by the route, so the amounts are in the HTML. a refusal is the no-form notice
	 * and never a card, which is why nothing here has an absent arm.
	 */
	readonly config: FormConfig;
	/**
	 * what a spec reaches the two providers through, and nothing production passes.
	 *
	 * the same seam `createPaymentSurface` and `createChallenge` already declare in the form package,
	 * carried up to the one component a route mounts: a payment SDK and a challenge widget are the
	 * two things on this page that cannot be driven from a spec, and a card the specs could not reach
	 * would be a money screen tested only through the states it happens to boot into.
	 */
	readonly seams?: CheckoutMounts['seams'];
};

export function DonateCard({ config, seams }: DonateCardProps) {
	// a second gift is a fresh boot rather than a state on the flow: what the last gift left behind is
	// not the flow's to clear — the provider's own fields still hold the card the donor entered and a
	// challenge token is spent once. remounting is what builds both again, and it starts empty, which
	// is what keeps one donor's name off the next donor's screen on a shared machine.
	const [boot, setBoot] = useState(0);
	return (
		<CheckoutCard
			key={boot}
			config={config}
			restart={() => setBoot((at) => at + 1)}
			{...(seams === undefined ? {} : { seams })}
		/>
	);
}

function CheckoutCard({
	config,
	restart,
	seams
}: {
	config: FormConfig;
	restart: () => void;
	seams?: CheckoutMounts['seams'];
}) {
	const { locale, currency } = config;
	const money = (minor: number) => formatMinor(minor, locale, currency);
	const offer = (minor: number) => formatOffer(minor, locale, currency);

	const initial = useMemo(() => initialSnapshot(config), [config]);
	const [live, setLive] = useState<Checkout | null>(null);

	const paymentMount = useRef<HTMLDivElement | null>(null);
	const challengeMount = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const payment = paymentMount.current;
		const challenge = challengeMount.current;
		if (payment === null || challenge === null) return () => {};
		// the token rewrites the URL and is claimed once, so it is taken here rather than in a render:
		// a page holding two cards for one form would otherwise both claim it.
		const started = startCheckout(config, {
			paymentMount: payment,
			challengeMount: challenge,
			resumeToken: takeResumeToken(document, config.formId),
			...(seams === undefined ? {} : { seams })
		});
		setLive(started);
		return () => started.stop();
	}, [config, seams]);

	const subscribe = useCallback(
		(onChange: () => void) => {
			if (live === null) return () => {};
			const held = live.actor.subscribe(onChange);
			return () => held.unsubscribe();
		},
		[live]
	);
	const read = useCallback(
		() => (live === null ? initial : live.actor.getSnapshot()),
		[live, initial]
	);
	const served = useCallback(() => initial, [initial]);
	const snapshot = useSyncExternalStore(subscribe, read, served);

	const send = useCallback(
		(event: CheckoutEvent) => {
			live?.actor.send(event);
		},
		[live]
	);
	const api = connect(snapshot, send, reactPropTypes);
	/** the projection as it stands after a press, which is how a refusal is told from a move. */
	const now = (): ReactApi =>
		live === null ? api : connect(live.actor.getSnapshot(), send, reactPropTypes);

	// ── the view's own state ─────────────────────────────────────────────────────────────────────

	/** whether a press has already asked the amount step for a decision it did not have. */
	const [asked, setAsked] = useState(false);
	/** the same for the details step, kept apart because the two are refused on different presses. */
	const [attempted, setAttempted] = useState(false);
	/** and the same for the one thing the review step can refuse a press for. */
	const [pressed, setPressed] = useState(false);
	/** the free entry's own text: the tiles and the box are two views of one number. */
	const [entry, setEntry] = useState(() => {
		const sole = connect(initial, () => {}, reactPropTypes).amountGroup.options;
		const only = sole.length === 1 ? sole[0] : undefined;
		return only === undefined ? '' : formatFigure(Number(only.value), locale, currency);
	});
	/** whether the way past the presets is the one the donor is using. */
	const [otherChosen, setOtherChosen] = useState(false);
	/** whether the donor asked to tell someone about the gift, which changes nothing the flow checks. */
	const [notifyAsked, setNotifyAsked] = useState(false);
	/** the press that asked for a sentence to be said again, which is the only thing a repeat has. */
	const [nonce, setNonce] = useState(0);
	/** a sentence one press asked for, spent by the snapshot it was asked on. */
	const [shot, setShot] = useState<{ at: CheckoutSnapshot; kind: 'details' | 'fee' } | null>(null);
	/** a commit, so a press that changed nothing else still gets its caret moved. */
	const [, setTick] = useState(0);

	const wanted = useRef<HTMLElement | null>(null);
	const focusOn = (node: HTMLElement | null): void => {
		wanted.current = node;
		setTick((at) => at + 1);
	};
	useEffect(() => {
		const node = wanted.current;
		wanted.current = null;
		node?.focus();
	});

	// the press is forgotten on the way off the step it was made on: asking is a thing a press does,
	// and returning to a step is not a press. without it a donor refused once carries the mark for the
	// life of the card.
	const step = api.state.step;
	useEffect(() => {
		if (step !== 'amount') setAsked(false);
		if (step !== 'details') setAttempted(false);
		if (step !== 'give') setPressed(false);
	}, [step]);

	// ── what the flow is refusing ────────────────────────────────────────────────────────────────

	const missingDecisions: readonly AmountDecision[] =
		asked && api.state.step === 'amount' ? api.state.missing : [];
	const missingFields: readonly PayerField[] =
		attempted && api.state.step === 'details' ? api.state.missing : [];
	// read off the flow's own guard rather than off `payable`, which is the rail alone: the two
	// disagree wherever a press is refused for anything but the rail, and there the caret would land
	// on a group with nothing said about why.
	const refusedPayment = pressed && api.state.step === 'give' && !api.state.payerComplete;

	/**
	 * the reason a rail refused, taken off the takeover and kept for the step a retry lands on.
	 *
	 * the flow does not keep it: entering the step a `RETRY` targets clears the failure it was retried
	 * from, which is right for a flow about to mint a second intent and wrong for a donor who has just
	 * pressed Try again. only a rail's refusal is taken — every other way into `failed` says nothing
	 * about the card the donor entered, and all of them read as if they did beside the payment fields.
	 *
	 * it is a reduction over transitions rather than a value, so it is cached against the snapshot it
	 * was computed for: a re-render that is not a transition reads the same answer back.
	 */
	const decline = useRef<{ at: CheckoutSnapshot | null; words: string; on: boolean | null }>({
		at: null,
		words: '',
		on: null
	});
	if (decline.current.at !== snapshot) {
		const held = decline.current;
		const state = api.state;
		decline.current =
			state.step === 'failed'
				? { at: snapshot, words: state.refusedByRail === true ? state.message : '', on: null }
				: state.step !== 'give'
					? { at: snapshot, words: '', on: null }
					: {
							at: snapshot,
							// `payable` is the whole of what this layer can read the rail off, so a picker
							// emptied or refilled clears the sentence and a donor moving between two rails it
							// can charge keeps it until they press.
							words: held.on !== null && state.payable !== held.on ? '' : held.words,
							on: held.on === null ? state.payable : held.on
						};
	}

	// the refusal outranks the decline where both stand: the refusal names something the donor can do
	// next, and the decline names what happened last.
	const paymentWords =
		api.state.step !== 'give' ? '' : refusedPayment ? copy.PAYMENT_PROBLEM : decline.current.words;

	// ── which screen, and where the caret goes ───────────────────────────────────────────────────

	const screen = useRef<{ shown: Screen; moved: boolean; painted: boolean }>({
		shown: 'amount',
		moved: false,
		painted: false
	});
	const shown = visibleStep(api.state, screen.current.shown);
	const moved = screen.current.moved || shown !== screen.current.shown;
	const takeover = shown === 'takeover' ? takeoverFor(api.state, config, money) : BLANK;

	const headings = {
		amount: useRef<HTMLHeadingElement | null>(null),
		details: useRef<HTMLHeadingElement | null>(null),
		give: useRef<HTMLHeadingElement | null>(null),
		takeover: useRef<HTMLHeadingElement | null>(null)
	};

	useEffect(() => {
		const before = screen.current;
		screen.current = {
			shown,
			moved: before.moved || shown !== before.shown,
			painted: true
		};
		// never on the first paint: a donor returning from their bank boots straight onto a takeover,
		// and a card that took focus as it rendered would move the caret on a page nobody asked it to.
		if (before.painted && shown !== before.shown) headings[shown].current?.focus();
	});

	// ── the receipt ──────────────────────────────────────────────────────────────────────────────

	const lastReading = useRef<ReceiptReading | null>(null);
	const reading = readReceipt(api, config, takeover, lastReading.current);
	useEffect(() => {
		if (reading !== null) lastReading.current = reading;
	});

	const feeBox = useRef<HTMLInputElement | null>(null);
	const amountRefs: AmountRefs = {
		entry: useRef<HTMLInputElement | null>(null),
		note: useRef<HTMLTextAreaElement | null>(null),
		honoree: useRef<HTMLInputElement | null>(null),
		notifyName: useRef<HTMLInputElement | null>(null),
		notifyEmail: useRef<HTMLInputElement | null>(null)
	};
	const detailsRefs: DetailsRefs = {
		email: useRef<HTMLInputElement | null>(null),
		firstName: useRef<HTMLInputElement | null>(null),
		lastName: useRef<HTMLInputElement | null>(null)
	};

	// the receipt is one block wherever it stands. rendered into the takeover only while a takeover
	// states one and only once it has figures — an empty ledger block under "Thank you" states
	// nothing, and two copies would be two nodes carrying one id.
	const inTakeover = shown === 'takeover' && takeover.receipt !== 'none' && reading !== null;
	const receipt =
		reading === null ? null : <Receipt reading={reading} onFee={() => onFee()} feeRef={feeBox} />;

	// ── the presses ──────────────────────────────────────────────────────────────────────────────

	function firstAmountProblem(missing: readonly AmountDecision[]): HTMLElement | null {
		const first = missing[0];
		if (first === 'note') return amountRefs.note.current;
		if (first === 'tribute-honoree') return amountRefs.honoree.current;
		if (first === 'tribute-notify-name') return amountRefs.notifyName.current;
		if (first === 'tribute-notify-email') return amountRefs.notifyEmail.current;
		// a missing amount is always the entry and never a tile: on a tray with tiles the amount can
		// only go missing through the other tile, which opens the box in the tiles' place, and on a
		// bare tray the box is the whole amount block.
		return amountRefs.entry.current;
	}

	function firstDetailsProblem(missing: readonly PayerField[]): HTMLElement | null {
		if (missing.includes('email')) return detailsRefs.email.current;
		if (missing.includes('firstName')) return detailsRefs.firstName.current;
		if (missing.includes('lastName')) return detailsRefs.lastName.current;
		return detailsRefs.email.current;
	}

	/**
	 * the amount step's Continue.
	 *
	 * the flow refuses a press it has no decision for, and refusing silently is a button that does
	 * nothing. a refusal is a press that started on this step and left the flow on it, which is the
	 * same test the two below make. what is missing is named on every press rather than on a press
	 * that changed the words: the sentences do not move between two presses refused for the same
	 * decisions, and neither does the caret.
	 */
	function onAmountContinue(): void {
		const before = api.state.step;
		api.continueButton.onClick();
		const state = now().state;
		if (before !== 'amount' || state.step !== 'amount') return;
		setAsked(true);
		setNonce((at) => at + 1);
		focusOn(firstAmountProblem(state.missing));
	}

	function onDetailsContinue(): void {
		const before = api.state.step;
		api.continueButton.onClick();
		const state = now().state;
		if (before !== 'details' || state.step !== 'details') return;
		setAttempted(true);
		const target = firstDetailsProblem(state.missing);
		// which channel this refusal has, asked before the caret is moved rather than after. where the
		// caret is already on the field the press would send it to, `focus()` announces nothing and the
		// region is all that is left; where it moves, the field it lands on carries the sentence and
		// the region saying it too is the same refusal twice. it is a real question rather than a guess
		// at one: a keyboard donor's caret is on the button they pressed, and Safari on macOS focuses
		// no button on a click at all.
		if (target !== null && document.activeElement === target) {
			setShot({ at: read(), kind: 'details' });
			setNonce((at) => at + 1);
		}
		focusOn(target);
	}

	function onSubmit(): void {
		const before = api.state.step;
		api.submitButton.onClick();
		const state = now().state;
		// "the step did not change" is not the same test: a second press while the charge is in flight
		// projects as `working` on both sides, and reading that as a refusal would mark a card
		// mid-transaction. that press is dropped by the flow's shape and needs no message.
		if (before !== 'give' || state.step !== 'give') return;
		setPressed(true);
		// said on every press rather than on one that moved the caret: a host page cannot take this box
		// off the screen here, but Safari on macOS still focuses no button on a click, so a mouse
		// donor's second press re-focuses a box the caret is already on.
		setNonce((at) => at + 1);
		focusOn(paymentMount.current);
	}

	/**
	 * the fee decision, and the one press on this card that changes the money without moving the caret
	 * or the screen.
	 *
	 * what is said is the figure that moved, so a decision that moved none is not news: the box reports
	 * its own new setting either way, and the total beside it is the half nothing else would tell them.
	 */
	function onFee(): void {
		const before = api.state.step;
		const total = api.submitButton.totalMinor;
		api.feeToggle.onClick();
		const next = now();
		if (before !== 'give' || next.state.step !== 'give') return;
		if (next.submitButton.totalMinor === total) return;
		setShot({ at: read(), kind: 'fee' });
	}

	function onEntry(text: string): void {
		// typing is choosing the other way, on the step the box is on. an event reaching it from behind
		// that step is one the flow drops, and a choice recorded off it would show as a box opened on a
		// step nobody is standing on.
		if (api.state.step === 'amount') setOtherChosen(true);
		setEntry(text);
		// the donor taking their amount back. leaving the last figure live behind an empty box is a
		// gift the next press would charge, so the withdrawal goes to the flow as one.
		if (text.trim() === '') {
			api.amountGroup.onTyped?.(null);
			return;
		}
		// and this is the other thing: a value with no figure in it, which every figure a donor types
		// passes through on its way in. the amount they last gave stands until they give another.
		const amountMinor = parseMinor(text, locale, currency);
		if (amountMinor === null) return;
		api.amountGroup.onTyped?.(amountMinor);
	}

	function onPreset(amountMinor: number): void {
		setOtherChosen(false);
		setEntry(formatFigure(amountMinor, locale, currency));
	}

	function onOther(): void {
		setOtherChosen(true);
		// whatever a preset wrote into the box is not what the donor is about to type, and a figure
		// left standing there is a gift the next press would charge.
		setEntry('');
		api.amountGroup.onTyped?.(null);
		focusOn(amountRefs.entry.current);
	}

	function onNoteToggle(): void {
		api.noteToggle.onClick();
		if (now().noteToggle.pressed === true) focusOn(amountRefs.note.current);
	}

	/**
	 * the notify pair taken away and the gift emptied of a recipient, which is the whole of what
	 * shutting it is.
	 *
	 * both boxes emptied through the flow rather than here: blank on both is what says nobody is told,
	 * and a value left in the draft behind a hidden box is a recipient the endpoint would still be
	 * handed. two controls shut this and they have to shut it identically — the press, and the tick
	 * that takes the block the pair stands inside away.
	 */
	function shutNotify(): void {
		setNotifyAsked(false);
		api.tributeNotifyNameField.set('');
		api.tributeNotifyEmailField.set('');
	}

	function onTributeToggle(): void {
		api.tributeToggle.onClick();
		// the caret lands on the name rather than on the select: the select already holds an answer,
		// and the name is the box the block is refused for.
		if (now().tributeToggle.pressed === true) {
			focusOn(amountRefs.honoree.current);
			return;
		}
		shutNotify();
	}

	const notifyOpen =
		notifyAsked ||
		api.tributeNotifyNameField.box.value.trim() !== '' ||
		api.tributeNotifyEmailField.box.value.trim() !== '';

	function onNotify(): void {
		if (notifyOpen) {
			shutNotify();
			return;
		}
		setNotifyAsked(true);
		focusOn(amountRefs.notifyName.current);
	}

	/** the two takeover controls carry a different event on every screen, so it is read at press time. */
	function onPrimary(): void {
		const next = now();
		if (next.state.step === 'confirm') next.confirmButton.onClick();
		else if (next.state.step === 'mandate') next.acceptMandateButton.onClick();
		else next.retryButton.onClick();
	}

	function onSecondary(): void {
		const next = now();
		if (next.state.step === 'mandate') next.declineMandateButton.onClick();
		// `success` is terminal and is given no way out, so a second gift is a new card.
		else if (next.state.step === 'success') restart();
		else next.backButton.onClick();
	}

	// ── what is said out loud ────────────────────────────────────────────────────────────────────

	const spent = shot !== null && shot.at === snapshot ? shot.kind : null;
	// in the order the fields are asked in, which is the order they are laid out in and the order the
	// caret walks them.
	const detailsSaid =
		spent === 'details'
			? [
					missingFields.includes('email') ? fieldProblem('email', api.emailField.box.value) : '',
					missingFields.includes('firstName') ? copy.NAME_PROBLEM : '',
					missingFields.includes('lastName') ? copy.NAME_PROBLEM : ''
				]
					.filter((sentence) => sentence !== '')
					.join(', ')
			: '';
	const bounds = copy.amountProblem(offer, config.minAmountMinor, config.maxAmountMinor);
	// what a numbered step was refused for, said out loud, and one sentence however many steps there
	// are: the three are mutually exclusive, because a press is refused on the step it was made on.
	//
	// the amount step's sentence hangs off a `<fieldset>` and the refused press puts the caret on a
	// control inside one, where a group's description is not reliably announced from a descendant — so
	// it is on this channel however the press was made. the details step's is here only for the press
	// that moved no caret and had no other channel.
	const askedFor = [missingDecisions.includes('amount') ? bounds : '', detailsSaid]
		.filter((sentence) => sentence !== '')
		.join(', ');

	const busy = api.continueButton['aria-busy'];
	// the takeover's own words first: a screen that has taken the whole card is not one a numbered step
	// is still asking anything on. the review step's refusal stands ahead of the fee decision because
	// it is a thing the donor has been asked for and has not done.
	const words =
		takeover.announce !== ''
			? takeover.announce
			: askedFor !== ''
				? askedFor
				: refusedPayment
					? copy.PAYMENT_PROBLEM
					: spent === 'fee'
						? (reading?.words ?? '')
						: busy
							? workingWords(api.state)
							: '';

	// ── the card ─────────────────────────────────────────────────────────────────────────────────

	const head = (at: 1 | 2 | 3, into: Screen): ReactNode => (
		<StepHead at={at} api={api} headingRef={headings[into]} />
	);

	return (
		// the outer node carries the ladder the element's `:host` block declares in a shadow tree, and
		// the card carries the container query every breakpoint resolves against. `@property
		// --donate-primary` registers from the document tree, which is where this sheet now is.
		<div data-donate-root="">
			<div
				part={part('card')}
				lang="en"
				data-direction={
					SCREENS.indexOf(shown) < SCREENS.indexOf(screen.current.shown) ? 'back' : undefined
				}
				data-moved={moved ? '' : undefined}
			>
				{/*
				 * a `<form>`, so Enter finishes a text field here the way it does in every other form a
				 * donor has ever filled in: the platform presses the form's default button, which is the
				 * first submit button in it in tree order. exactly one control is a submit at a time and
				 * it is the primary of the screen being shown.
				 *
				 * it is given no accessible name, which keeps it off the accessibility tree as a `form`
				 * landmark. `novalidate`, so no field of ours is ever answered by the engine's own bubble,
				 * drawn in the browser's language over a card that says what is wrong in the
				 * organisation's. nothing is ever posted from here — the flow is what takes the gift.
				 */}
				<form
					className="card-body"
					noValidate
					aria-busy={busy ? true : undefined}
					onSubmit={(event) => event.preventDefault()}
				>
					<AmountStep
						api={api}
						config={config}
						head={head(1, 'amount')}
						hidden={shown !== 'amount'}
						missing={missingDecisions}
						amountProblem={bounds}
						entry={entry}
						onEntry={onEntry}
						onPreset={onPreset}
						onOther={onOther}
						otherChosen={otherChosen}
						onNoteToggle={onNoteToggle}
						onTributeToggle={onTributeToggle}
						notifyOpen={notifyOpen}
						onNotify={onNotify}
						onContinue={onAmountContinue}
						submits={shown === 'amount'}
						refs={amountRefs}
					/>
					<DetailsStep
						api={api}
						config={config}
						head={head(2, 'details')}
						hidden={shown !== 'details'}
						missing={missingFields}
						onConsent={() => api.consentToggle.onClick()}
						onContinue={onDetailsContinue}
						submits={shown === 'details'}
						refs={detailsRefs}
						challengeMount={challengeMount}
					/>
					<GiveStep
						api={api}
						head={head(3, 'give')}
						hidden={shown !== 'give'}
						receipt={inTakeover ? null : receipt}
						receiptTo={reading?.receiptTo ?? ''}
						submitLabel={reading?.submitLabel ?? ''}
						paymentMount={paymentMount}
						paymentPrepared={live !== null}
						paymentWords={paymentWords}
						onSubmit={onSubmit}
						submits={shown === 'give'}
					/>
					<TakeoverScreen
						screen={takeover}
						hidden={shown !== 'takeover'}
						busy={busy}
						receipt={inTakeover ? receipt : null}
						headingRef={headings.takeover}
						onPrimary={onPrimary}
						onSecondary={onSecondary}
					/>
				</form>
			</div>
			<DonateAnnouncer words={words} again={nonce} />
		</div>
	);
}

/**
 * one step head: the heading focus lands on, the count it is described by, and the three marks.
 *
 * the heading takes `tabindex="-1"` because hiding a step hides the control that held focus, and
 * over three steps that would happen twice per gift. the count is described rather than read after:
 * a caret arriving on the heading would otherwise be told which screen they are on and not how far
 * through. the node itself is `hidden`, which is what keeps one head from saying the ordinal twice —
 * a description resolves a hidden node.
 *
 * nothing here carries a part name, and the absence is load-bearing: these are the only way back
 * through the form, so a host rule that hid them would leave a donor on the screen that spends the
 * money with no way to change what it spends.
 */
function StepHead({
	at,
	api,
	headingRef
}: {
	readonly at: 1 | 2 | 3;
	readonly api: ReactApi;
	readonly headingRef: RefObject<HTMLHeadingElement | null>;
}) {
	const countId = `step-${at}-count`;
	return (
		<header className="step-head">
			<span className="step-count" id={countId} hidden>
				{copy.stepCount(at)}
			</span>
			<h2 part={part('heading')} tabIndex={-1} aria-describedby={countId} ref={headingRef}>
				{copy.STEP_HEADINGS[at - 1]}
			</h2>
			<div className="step-dots">
				{copy.STEP_HEADINGS.map((heading, index) =>
					index + 1 === at ? (
						// the mark for the step the donor is standing on is not somewhere to go, and
						// `aria-current` already says it is where they are. `role="img"` so a screen reader
						// walking the card by control finds three marks on a head that draws three.
						<span
							key={heading}
							className="step-dot current"
							role="img"
							aria-current="step"
							aria-label={heading}
						>
							<span className="step-mark" />
						</span>
					) : (
						// `type="button"` and it is not optional inside a form: a `<button>` defaults to
						// submitting, and on the review step the form's default button is Donate.
						//
						// a mark drawn unavailable is left able to send its press: the guard on the
						// transition is what refuses, and a control that stopped its own press would be a
						// second gate able to disagree with the first.
						<button
							key={heading}
							className="step-dot"
							type="button"
							aria-disabled={api.stepButtons[index]?.available === true ? undefined : true}
							onClick={() => api.stepButtons[index]?.onClick()}
						>
							<span className="step-mark" />
							<span className="vh">{copy.stepMark(heading, index + 1)}</span>
						</button>
					)
				)}
			</div>
		</header>
	);
}
