import { connect, type CheckoutSnapshot, type State } from '@better-giving/form/connect';
import { createDepositBlock, type DepositView } from '@better-giving/form/deposit';
import { takeResumeToken } from '@better-giving/form/embed/resume';
import { checkoutMachine, type CheckoutEvent } from '@better-giving/form/machine';
import { formatFigure, formatMinor, formatOffer, parseMinor } from '@better-giving/form/money';
import { CARD_THEME, part } from '@better-giving/form/parts';
import { coinRefusalSentence } from '@better-giving/form/unit';
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
import { createPortal } from 'react-dom';
import { getInitialSnapshot } from 'xstate';
import { DonateAnnouncer } from './announce';
import * as copy from './copy';
import {
	initialSnapshot,
	startCheckout,
	type Checkout,
	type CheckoutMounts,
	type Opening
} from './machine';
import { createReactPropTypes, type ReactApi } from './normalize';
import { useBrandScope } from './page-root';
import { IraPanel } from './pledge-block';
import { AmountStep, type AmountRefs } from './steps/amount';
import { DetailsStep, fieldProblem, type DetailsRefs } from './steps/details';
import { GiveStep, readReceipt, Receipt, type ReceiptReading } from './steps/give';
import {
	BLANK,
	EmployerAskBlock,
	programStoppedTakeover,
	takeoverFor,
	TakeoverScreen
} from './takeover';
import { useUnitPanel } from './unit-panel';

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
//   - the server render. `initialSnapshot` is a pure function of the configuration and the page's
//     opening, so the amounts, the cadences and the tiles are in the HTML and the client's first
//     render produces the same tree; a page the route says is a resume draws the resume's takeover
//     there instead (`servedSnapshot`). the live actor is created in an effect after that first
//     commit, on the same opening — the payment provider reads computed style off a mounted node,
//     and taking the resume token rewrites the URL, which is not a thing a render may do.
//   - which screen the card is on. a busy flow stays on the last screen shown, because the flow
//     collapses several machine states into one thing a donor is told and the projection cannot say
//     which screen asked.
//   - the caret. a screen change hides the control that held focus, so focus is put on the heading
//     of the screen that arrived — never on the flow's first paint, and never before the section it
//     lands in is out of `hidden`. the one first paint that takes it is a second gift's, and only
//     where the caret was inside the card when Back to start was pressed: that press remounts the
//     card under the caret, so the rebuilt card puts it on its first heading — and a caret the
//     donor had already taken elsewhere on the page is left there. a stamped return with no token
//     is no first paint but a screen change: the route drew the resume's takeover and the live flow
//     starts on the amount step, so the step's heading takes the caret unless the donor put it on
//     the host page, where the region says it instead. one takeover replacing another is no
//     screen change and can hide that control too, so it is taken back to the heading from inside
//     the takeover.
//   - what is said out loud, on one channel, decided in one place.
//
// the mount nodes are the card's and the checkout's between them: this file renders them and
// hands them over, and `startCheckout` in ./machine.ts is what mounts into each. the payment one
// takes a node per processor the served config offers, placed and ordered by the composer in
// @better-giving/form/embed/surface — so this file draws one box however many a deployment holds.
//
// two imperative blocks the form package builds are patched here from the projection, the way
// @better-giving/form's views.ts patches them for the element: the unit panel the first step's pill
// opens (./unit-panel.ts), and a crypto gift's address block, which stands in the takeover. neither
// is react's to render — one carries its own shadow root and the other its own Copy controls — so
// what is here is what each is handed and when the caret goes back to the pill.

/**
 * the snapshot the first paint draws, server and hydration alike.
 *
 * a resume boots into `resuming`, and what that state draws first names no rail and no figure, so
 * the stamp alone chooses it and the token is not needed: the token is claimed in the effect that
 * starts the live flow, and nothing reads it off this snapshot. `getInitialSnapshot` starts nothing
 * — the read `resuming` invokes is never run and its timeout never armed — so this stays a value
 * the way `initialSnapshot` is, on that snapshot's own inert ports.
 *
 * a resume and the page's opening are one input, and the resume wins the first paint: the machine
 * boots into `resuming` whatever the opening says, and the opening only seeds the draft a declined
 * return hands back (`openingDraft` in @better-giving/form/machine).
 */
function servedSnapshot(config: FormConfig, resuming: boolean, opening: Opening): CheckoutSnapshot {
	const booted = initialSnapshot(config, opening);
	if (!resuming) return booted;
	return getInitialSnapshot(checkoutMachine, {
		config,
		ports: booted.context.ports,
		resume: { paymentToken: 'unclaimed' },
		opening
	});
}

const SCREENS = ['amount', 'details', 'give', 'takeover'] as const;
type Screen = (typeof SCREENS)[number];

/**
 * what the card is showing.
 *
 * a busy flow stays where it happened: without that, the press on the review step drops the donor
 * onto a blank frame for the length of a request that spans two beats. the one exception is a busy
 * flow carrying no decided gift at all, which is a resume — a donor back from wherever they
 * authorized, on a page that must not show them an empty donation form while it finds out whether
 * they have already paid.
 */
function visibleStep(state: State, last: Screen): Screen {
	if (state.step === 'amount') return 'amount';
	if (state.step === 'details') return 'details';
	if (state.step === 'give') return 'give';
	if (state.step === 'working') return state.fv === undefined ? 'takeover' : last;
	return 'takeover';
}

/**
 * a sentence a moment said, rather than one the screen says while it stands.
 *
 * `restating` names what it states that a later snapshot on the same screen can make false — the
 * total it read out, the fields it asked for, or the employer ask's refusal — and it is said no
 * longer than that stands.
 */
type News = { readonly words: string; readonly restating?: 'total' | 'fields' | 'ask' };

/** what a busy flow says out loud, which is not one sentence: a mint and a charge are different news. */
function workingWords(state: State): string {
	return state.step === 'working' && state.phase === 'confirming'
		? copy.confirming(state.method)
		: copy.WORKING;
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
	 * what a spec reaches each provider's own script through, and nothing production passes.
	 *
	 * the same seams the form package already declares, carried up to the one component a route
	 * mounts: `payment` is one entry per processor, the composer's own `PaymentSeams`, and
	 * `challenge` is the widget's. those scripts are what cannot be driven from a spec, and a card
	 * the specs could not reach would be a money screen tested only through the states it happens to
	 * boot into.
	 */
	readonly seams?: CheckoutMounts['seams'];
	/**
	 * the program a page's own chooser picked, where the page draws one: an id from the served
	 * config's list, or null for where it's needed most.
	 *
	 * absent, the card draws its own program select. present, it draws none and the gift carries
	 * this pick, sent through the same door the select's own pick goes through and followed while
	 * mounted — a remount would drop what the donor typed. an id the served config does not offer
	 * is not the page's to send: the card draws its own select again and the donor picks there.
	 */
	readonly pageProgram?: string | null;
	/**
	 * the program a program page was drawn for, handed to the flow at its start and sent on every
	 * quote as `pageProgramId` (`CheckoutInput` in @better-giving/form/machine); absent on every
	 * other page. it is the page's and not a pick: the card draws nothing for it, and the server
	 * credits it whatever the form's program setting says.
	 */
	readonly pageProgramId?: string;
	/**
	 * the program the flow holds (null for where it's needed most), and whether it takes a pick at
	 * all — `locked` from the press on Donate until a donor is back on a step they edit. told on
	 * arrival and on every change of either, so a page's chooser can draw the gift's own answer.
	 */
	readonly onProgramChange?: (programId: string | null, locked: boolean) => void;
	/**
	 * where the card starts when the page asks: on monthly, or with the dedication open and empty.
	 *
	 * a starting point and nothing more — the donor changes either the way they would have chosen it,
	 * and a card back from the donor's bank starts where the flow sends it instead. absent, the card
	 * starts as the served config alone says. a change of either flag while mounted starts the card
	 * over, as a new config does.
	 */
	readonly opening?: Opening;
	/**
	 * the words a campaign's page draws under each suggested amount, by the amount in minor units.
	 * the card's own config carries no labels; a tile with none draws its figure alone.
	 */
	readonly amountLabels?: Readonly<Record<string, string>> | undefined;
	/**
	 * whether the page's url carries this form's resume stamp (`RESUME_FORM_PARAM` in
	 * @better-giving/form/embed/resume), which is what the route can see of a return from a payment
	 * provider.
	 *
	 * true draws the resume's takeover from the first paint, server and hydration alike, and the live
	 * flow carries on from it once it has claimed the token. it says nothing about the token itself:
	 * a stamp that arrived without one hands the donor the amount step as soon as the flow starts,
	 * which the card treats as a move off the takeover rather than a first paint.
	 */
	readonly resuming?: boolean;
};

export function DonateCard({
	config,
	seams,
	resuming = false,
	pageProgram,
	pageProgramId,
	onProgramChange,
	opening,
	amountLabels
}: DonateCardProps) {
	// a second gift is a fresh boot rather than a state on the flow: what the last gift left behind is
	// not the flow's to clear — the provider's own fields still hold the card the donor entered and a
	// challenge token is spent once. remounting is what builds both again, and it starts empty, which
	// is what keeps one donor's name off the next donor's screen on a shared machine.
	//
	// whether the card held the caret is carried across the remount, because the press that asked for
	// it is unmounted with the old card and a caret left on it falls to the page body.
	const [boot, setBoot] = useState({ at: 0, focused: false });
	return (
		<CheckoutCard
			key={boot.at}
			config={config}
			takeFocus={boot.focused}
			// a second gift is never a resume: the first card already claimed the return.
			resuming={resuming && boot.at === 0}
			restart={(focused) => setBoot((last) => ({ at: last.at + 1, focused }))}
			{...(seams === undefined ? {} : { seams })}
			{...(pageProgram === undefined ? {} : { pageProgram })}
			{...(pageProgramId === undefined ? {} : { pageProgramId })}
			{...(amountLabels === undefined ? {} : { amountLabels })}
			{...(onProgramChange === undefined ? {} : { onProgramChange })}
			monthly={opening?.monthly === true}
			dedication={opening?.dedication === true}
		/>
	);
}

function CheckoutCard({
	config,
	takeFocus,
	restart,
	seams,
	resuming,
	pageProgram,
	pageProgramId,
	onProgramChange,
	monthly,
	dedication,
	amountLabels
}: {
	config: FormConfig;
	amountLabels?: DonateCardProps['amountLabels'];
	/** whether this card's first paint puts the caret on its heading, which only a restart asks. */
	takeFocus: boolean;
	/** a fresh card, told whether this one held the caret when it was asked for. */
	restart: (focused: boolean) => void;
	seams?: CheckoutMounts['seams'];
	resuming: boolean;
	pageProgram?: string | null;
	pageProgramId?: string;
	onProgramChange?: DonateCardProps['onProgramChange'];
	// the opening as its two flags, so a page handing a fresh object each render starts nothing anew.
	monthly: boolean;
	dedication: boolean;
}) {
	const brandScope = useBrandScope();
	const { locale, currency } = config;
	const money = (minor: number) => formatMinor(minor, locale, currency);
	const offer = (minor: number) => formatOffer(minor, locale, currency);

	const initial = useMemo(
		() => servedSnapshot(config, resuming, { monthly, dedication }),
		[config, resuming, monthly, dedication]
	);
	const [live, setLive] = useState<Checkout | null>(null);
	const [deposit, setDeposit] = useState<DepositView | null>(null);
	const [paymentRows, setPaymentRows] = useState(0);
	/** whether this program page's quote was refused because the program stopped taking gifts. */
	const [programStopped, setProgramStopped] = useState(false);

	const paymentMount = useRef<HTMLDivElement | null>(null);
	const challengeMount = useRef<HTMLDivElement | null>(null);
	const heldChallengeMount = useRef<HTMLDivElement | null>(null);
	const toldChallengeMount = useRef<HTMLDivElement | null>(null);
	/**
	 * the return this card claimed, by the form it was claimed for. the claim scrubs the token off
	 * the url, and strict mode runs the effect below twice on one mount, so a second run reuses the
	 * claim rather than finding nothing.
	 */
	const claimed = useRef<{ readonly formId: string; readonly token: string | null } | null>(null);

	useEffect(() => {
		const payment = paymentMount.current;
		const challenge = challengeMount.current;
		const heldChallenge = heldChallengeMount.current;
		const toldChallenge = toldChallengeMount.current;
		if (
			payment === null ||
			challenge === null ||
			heldChallenge === null ||
			toldChallenge === null
		) {
			return () => {};
		}
		// the token rewrites the URL and is claimed once, so it is taken here rather than in a render:
		// a page holding two cards for one form would otherwise both claim it.
		if (claimed.current?.formId !== config.formId) {
			claimed.current = { formId: config.formId, token: takeResumeToken(document, config.formId) };
		}
		const started = startCheckout(
			config,
			{
				paymentMount: payment,
				challengeMount: challenge,
				heldChallengeMount: heldChallenge,
				toldChallengeMount: toldChallenge,
				resumeToken: claimed.current.token,
				...(seams === undefined ? {} : { seams })
			},
			{ monthly, dedication },
			pageProgramId
		);
		started.rows(setPaymentRows);
		started.stopped(() => setProgramStopped(true));
		setLive(started);
		// a Copy's outcome is said on the card's one region, again on every press: the words do not
		// change between two presses of one control. it is tied to the heading the press was made
		// under, because the reading loop moves the snapshot under it every few seconds.
		const block = createDepositBlock(document, (words) => {
			setShot({
				at: started.actor.getSnapshot(),
				kind: 'copy',
				words,
				on: screen.current.heading
			});
			setNonce((at) => at + 1);
		});
		setDeposit(block);
		return () => {
			started.stop();
			// stood in the takeover by hand, so it is taken out by hand: a second checkout builds its own.
			block.stop();
			block.root.remove();
		};
	}, [config, seams, monthly, dedication, pageProgramId]);

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
	const [propTypes] = useState(createReactPropTypes);
	const api = connect(snapshot, send, propTypes);
	/** the projection as it stands after a press, which is how a refusal is told from a move. */
	const now = (): ReactApi =>
		live === null ? api : connect(live.actor.getSnapshot(), send, propTypes);

	// ── the view's own state ─────────────────────────────────────────────────────────────────────

	/** whether a press has already asked the amount step for a decision it did not have. */
	const [asked, setAsked] = useState(false);
	/**
	 * whether the last such press found the caret already on the box it would send it to, which is
	 * the one press the region says the amount's refusal for.
	 */
	const [askedInPlace, setAskedInPlace] = useState(false);
	/** the same for the details step, kept apart because the two are refused on different presses. */
	const [attempted, setAttempted] = useState(false);
	/** and the same for the one thing the review step can refuse a press for. */
	const [pressed, setPressed] = useState(false);
	/** the free entry's own text: the tiles and the box are two views of one number. */
	const [entry, setEntry] = useState(() => {
		const sole = connect(initial, () => {}, propTypes).amountGroup.options;
		const only = sole.length === 1 ? sole[0] : undefined;
		return only === undefined ? '' : formatFigure(Number(only.value), locale, currency);
	});
	/** whether the way past the presets is the one the donor is using. */
	const [otherChosen, setOtherChosen] = useState(false);
	/** whether the donor asked to tell someone about the gift, which changes nothing the flow checks. */
	const [notifyAsked, setNotifyAsked] = useState(false);
	/** the press that asked for a sentence to be said again, which is the only thing a repeat has. */
	const [nonce, setNonce] = useState(0);
	/**
	 * a sentence one press asked for. a refusal or a one-time switch arrives on the snapshot it was
	 * asked on and is kept from there as a `News`; a Copy's is kept by the heading it was pressed
	 * under, in `on`, and a pledge's Copy by the notice it was pressed under too, in `over`.
	 */
	const [shot, setShot] = useState<{
		at: CheckoutSnapshot;
		kind: 'details' | 'copy' | 'one-time' | 'ask' | 'custodian';
		words?: string;
		on?: string;
		over?: string;
	} | null>(null);
	/** a commit, so a press that changed nothing else still gets its caret moved. */
	const [, setTick] = useState(0);

	const wanted = useRef<{ focus(): void } | null>(null);
	const focusOn = (node: { focus(): void } | null): void => {
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
	// an IRA (QCD) gift's press is refused for its custodian rather than its rail, and that is said
	// under the custodian's box. and an offer of a one-time gift hides the box, so a refusal naming it
	// is about nothing on screen: the offer is what the step is asking.
	const onIra = api.state.step === 'give' && api.state.method === 'ira_qcd';
	const refusedPayment =
		pressed &&
		api.state.step === 'give' &&
		!api.state.payerComplete &&
		!onIra &&
		!api.state.oneTimeInstead;

	/**
	 * what the last commit left the card holding, which is the only render a donor heard.
	 *
	 * every sentence that is kept past the snapshot it arrived on is kept here, and every reading one
	 * is told from — the decline, the offer and the total as that commit drew them. only the effect
	 * after a commit writes it: a render react throws away — strict mode's second pass, a suspended
	 * render, one a newer snapshot overtook — neither keeps a sentence, spends one nor moves a reading
	 * the next render is compared against.
	 */
	const kept = useRef<{
		/** the Copy the region has moved on from, which is not said again. */
		outsaid: typeof shot;
		retitle: { on: string | null; words: string };
		handed: { on: Screen | null; words: string };
		decline: { words: string; on: boolean | null };
		offer: string;
		total: { step: State['step'] | null; figure: string };
		/** a `News` the region is holding for the screen it was said on, or nothing. */
		news: (News & { on: Screen }) | null;
		/** the last press a commit answered, as `nonce` counts them. */
		again: number;
		/** the employer ask's refusal as the last commit drew it under the box, or `''`. */
		ask: string;
	}>({
		outsaid: null,
		retitle: { on: null, words: '' },
		handed: { on: null, words: '' },
		decline: { words: '', on: null },
		offer: '',
		total: { step: null, figure: '' },
		news: null,
		again: 0,
		ask: ''
	});

	/**
	 * the reason a rail refused, taken off the takeover and kept for the step a retry lands on.
	 *
	 * the flow does not keep it: entering the step a `RETRY` targets clears the failure it was retried
	 * from, which is right for a flow about to mint a second intent and wrong for a donor who has just
	 * pressed Try again. only a rail's refusal is taken — every other way into `failed` says nothing
	 * about the card the donor entered, and all of them read as if they did beside the payment fields.
	 *
	 * it is a reduction over transitions rather than a value, so it is read against the decline the
	 * last commit drew (`kept`): a re-render that is not a transition reads the same answer back.
	 */
	const drawnDecline = kept.current.decline;
	const decline =
		api.state.step === 'failed'
			? { words: api.state.refusedByRail === true ? api.state.message : '', on: null }
			: api.state.step !== 'give'
				? { words: '', on: null }
				: {
						// `payable` is the whole of what this layer can read the rail off, so a picker
						// emptied or refilled clears the sentence and a donor moving between two rails it
						// can charge keeps it until they press.
						words:
							drawnDecline.on !== null && api.state.payable !== drawnDecline.on
								? ''
								: drawnDecline.words,
						on: drawnDecline.on ?? api.state.payable
					};

	// the refusal outranks the decline where both stand: the refusal names something the donor can do
	// next, and the decline names what happened last.
	const paymentWords =
		api.state.step !== 'give' ? '' : refusedPayment ? copy.PAYMENT_PROBLEM : decline.words;

	// ── the program the page picked ──────────────────────────────────────────────────────────────

	// in the select's own encoding, `''` being where it's needed most. undefined is no pick of the
	// page's to send: none handed in, or one the served config does not offer.
	const held = api.programSelect.value;
	const pagePick =
		pageProgram === null
			? ''
			: api.programSelect.options.some((option) => option.value === pageProgram)
				? pageProgram
				: undefined;
	const editing = step === 'amount' || step === 'details' || step === 'give';
	// sent where the flow holds something else and takes a pick: on the page's pick moving, and on
	// the flow arriving back on a step a donor edits — a pick made while a press was in flight was
	// dropped there, and a retry lands on the review step.
	useEffect(() => {
		if (pagePick === undefined || pagePick === held || !editing) return;
		send({ type: 'SET_PROGRAM', programId: pagePick === '' ? null : pagePick });
	}, [pagePick, held, editing, send]);
	useEffect(() => {
		onProgramChange?.(held === '' ? null : held, !editing);
	}, [held, editing, onProgramChange]);

	// ── a repeating gift no processor still up can take ─────────────────────────────────────────

	const oneTimeOffer =
		api.state.step === 'give' && api.state.oneTimeInstead
			? copy.oneTimeOffer(api.state.fv.frequency === 'yearly' ? 'yearly' : 'monthly')
			: '';
	/**
	 * the offer appearing, said out loud: it arrives whenever the processors fail, which is as likely
	 * to be while the donor is reading the step as on the way into it, and nothing moves the caret to
	 * it. read against the offer the last commit drew, as `decline` is.
	 */
	const offerArrived = oneTimeOffer !== '' && kept.current.offer === '';

	// ── the custodian an IRA (QCD) gift is sent by ───────────────────────────────────────────────

	const custodianBox = useRef<HTMLInputElement | null>(null);
	/**
	 * what the custodian box says under itself: nothing until a press on the IRA (QCD) rail was
	 * refused for it, or until the endpoint refused the custodian a save named. it clears on the
	 * keystroke that names one.
	 */
	const custodianWords =
		api.state.step === 'give' &&
		api.state.method === 'ira_qcd' &&
		((pressed && api.state.custodianMissing) || api.state.custodianRefused)
			? copy.CUSTODIAN_PROBLEM
			: '';

	// a coin gift's refusal, stated under `How much` where the gift is fixed: of its amount, which marks
	// the box it was typed in, or of the coin itself, which marks none.
	const coinRefusal = api.state.step === 'amount' ? api.state.coinRefusal : undefined;
	const refusalWords = coinRefusal === undefined ? '' : coinRefusalSentence(coinRefusal, config);
	const refusedAmount = api.state.step === 'amount' && api.state.refusal !== undefined;

	// ── which screen, and where the caret goes ───────────────────────────────────────────────────

	const screen = useRef<{
		shown: Screen;
		moved: boolean;
		painted: boolean;
		/** the projected step the last commit drew, which tells a coin refusal landing from a press. */
		step: State['step'] | null;
		/**
		 * the takeover's heading and primary label as the last commit drew them, which is what tells
		 * one takeover replacing another.
		 */
		heading: string;
		primary: string | null;
	}>({
		// the screen the first paint draws, so a resume's takeover is not counted as a move onto it.
		shown: visibleStep(api.state, 'amount'),
		moved: false,
		painted: false,
		step: null,
		heading: '',
		primary: null
	});
	const shown = visibleStep(api.state, screen.current.shown);
	const moved = screen.current.moved || shown !== screen.current.shown;
	const takeover =
		shown !== 'takeover'
			? BLANK
			: programStopped && api.state.step === 'failed'
				? programStoppedTakeover()
				: takeoverFor(api.state, config, money);

	const headings = {
		amount: useRef<HTMLHeadingElement | null>(null),
		details: useRef<HTMLHeadingElement | null>(null),
		give: useRef<HTMLHeadingElement | null>(null),
		takeover: useRef<HTMLHeadingElement | null>(null)
	};
	const takeoverSection = useRef<HTMLElement | null>(null);
	const cardNode = useRef<HTMLDivElement | null>(null);

	// a fresh boot's first screen is the amount step, so that is the heading a restart lands on.
	const firstHeading = headings.amount;
	useEffect(() => {
		if (takeFocus) firstHeading.current?.focus();
	}, [takeFocus, firstHeading]);

	useEffect(() => {
		deposit?.update(takeover.deposit);
	});

	// read in the render rather than in the effect below: the commit between them hides whatever this
	// screen stops drawing, and a hidden node gives the caret up.
	const caret = typeof document === 'undefined' ? null : document.activeElement;
	const caretInTakeover = caret !== null && takeoverSection.current?.contains(caret) === true;
	const withinTakeover = shown === 'takeover' && screen.current.shown === 'takeover';
	/** a caret the donor put on the host page, which no move of the card's takes from them. */
	const caretOnPage =
		caret !== null && caret !== document.body && cardNode.current?.contains(caret) !== true;
	/**
	 * the live flow's first snapshot leaving the resume's takeover the first paint drew: the route saw
	 * the stamp and the flow had no token behind it to claim, so it starts where a fresh card does.
	 * the donor was shown and told `copy.RESUMING_HEADING`, so this is a screen change and not a first
	 * paint, whatever `painted` says.
	 */
	const unresumed =
		live !== null &&
		!screen.current.painted &&
		screen.current.shown === 'takeover' &&
		shown === 'amount';
	/**
	 * a press asking for its sentence to be said again, until a commit answers it. a repeat re-says only
	 * what that press chose, so a sentence kept from before it — the handed step, a `News` — is spent
	 * here: said again beside the refusal the press put somewhere else, it is old news read as the
	 * press's answer.
	 */
	const repeating = nonce !== kept.current.again;
	/**
	 * that move said out loud to a caret on the host page, which the move leaves where it is. kept
	 * while the amount step stands, the way `retitle` is kept by its heading, because the commit that
	 * draws the step is what makes `unresumed` false on the next render.
	 */
	const handed = unresumed
		? { on: shown, words: caretOnPage ? `${copy.STEP_HEADINGS[0]}.` : '' }
		: !repeating && kept.current.handed.on === shown
			? kept.current.handed
			: { on: null, words: '' };

	/**
	 * a takeover's heading replaced, said out loud wherever no caret move reads it.
	 *
	 * a caret elsewhere inside the takeover is moved onto the heading, and arriving there reads it.
	 * that leaves a caret already on the heading, where focusing the node that holds focus says
	 * nothing, and a caret outside the takeover, which is never taken — a resume's outcome and the
	 * address closing both arrive with the donor anywhere on the page. cached against the heading it
	 * was read for rather than the snapshot: the commit that draws the new heading is what makes the
	 * next render's comparison come out equal, and the address screen's reading loop is a new
	 * snapshot every few seconds with nothing to say — one landing in the same instant the address
	 * closes would otherwise empty the sentence as it is written. decided afresh by every render
	 * until a commit keeps it, so the caret it is decided by is the one the committed render read; a
	 * sentence the region moved on from is emptied by the commit after `words` is chosen below.
	 */
	const heard = withinTakeover ? takeover.heading : null;
	const retitle =
		kept.current.retitle.on === heard
			? kept.current.retitle
			: {
					on: heard,
					// never on the flow's first paint, which drew the heading rather than replaced one.
					words:
						live !== null &&
						withinTakeover &&
						takeover.heading !== screen.current.heading &&
						(caret === headings.takeover.current || !caretInTakeover)
							? `${takeover.heading}.`
							: ''
				};

	useEffect(() => {
		const before = screen.current;
		const state = api.state;
		const primary = takeover.primary?.label ?? null;
		screen.current = {
			shown,
			moved: before.moved || shown !== before.shown,
			// the server's render and the live flow's first snapshot are one paint: the actor is built
			// after the first commit, so a resume the route did not see arrives on the second.
			painted: before.painted || live !== null,
			step: state.step,
			heading: takeover.heading,
			primary
		};
		// never on the flow's first paint: a donor returning from their bank boots straight onto a
		// takeover, and a card that took focus as it rendered would move the caret on a page nobody
		// asked it to. a takeover that first paint drew and the live flow left (`unresumed`) is a
		// screen change the donor was told about, and moves a caret that is not on the host page.
		const advanced = (before.painted && shown !== before.shown) || (unresumed && !caretOnPage);
		// one takeover replacing another can take the control holding the caret with it: Give and
		// Authorize go to a wait that paints no primary, and the address block leaves with whatever
		// Copy held it. taken back only from inside the takeover — a resume's outcome replaces the
		// takeover it booted onto with the caret still on the page. a saved pledge's press relabelled
		// to Try again under the same heading is the same control, and its refusal is the region's to say.
		const relabelledInPlace = state.step === 'pledged';
		const replaced =
			withinTakeover &&
			caretInTakeover &&
			(takeover.heading !== before.heading || (!relabelledInPlace && primary !== before.primary));
		// four arrivals put the caret on the control that fixes what the donor arrived about rather
		// than on the heading: a coin's refusal of the amount on the control holding the figure, a coin
		// the account no longer takes — or a way back from the address screen — on the unit pill, and a
		// custodian the endpoint refused on its box. the pill takes it once per arrival: `returned`
		// stands until the donor picks or leaves the step, and only the arrival is a move.
		const backToPill =
			advanced &&
			state.step === 'amount' &&
			(api.unit.returned || state.coinRefusal?.code === 'coin_not_accepted');
		// the custodian a save named, refused by the endpoint: the donor is back on this step from the
		// wait, and the box that fixes it is where the caret goes.
		const backToCustodian =
			state.step === 'give' && state.custodianRefused && before.step === 'working';
		if (backToPill) amountRefs.pill.current?.focus();
		else if (backToCustodian) custodianBox.current?.focus();
		// a coin's refusal is a coin gift's, whose figure is the one box its amount was typed in.
		else if (advanced && state.step === 'amount' && state.refusal !== undefined) {
			amountRefs.quantity.current?.focus();
		} else if (advanced || replaced) headings[shown].current?.focus();
	});

	// ── the receipt ──────────────────────────────────────────────────────────────────────────────

	const lastReading = useRef<ReceiptReading | null>(null);
	const reading = readReceipt(api, config, takeover, lastReading.current);
	useEffect(() => {
		if (reading !== null) lastReading.current = reading;
	});

	/**
	 * whether the total moved on the review step, between the snapshot before this one and this one.
	 *
	 * a fee decision and a rail pick both rewrite the figure without changing the screen or moving the
	 * caret, and the figure's own `<output>` is silent, so this is the one place either is heard from.
	 * read off the figure rather than off the press, because a rail is picked inside the provider's own
	 * fields and no handler of ours sees it. a move that left the figure where it was is not news: the
	 * fee box reports its own new setting either way. read against the figure the last commit drew,
	 * as `decline` is.
	 */
	const figure = reading?.totalFigure ?? '';
	const totalMoved =
		kept.current.total.step === 'give' &&
		api.state.step === 'give' &&
		reading?.totalShown !== false &&
		figure !== kept.current.total.figure;

	const feeBox = useRef<HTMLInputElement | null>(null);
	const amountRefs: AmountRefs = {
		entry: useRef<HTMLInputElement | null>(null),
		quantity: useRef<HTMLInputElement | null>(null),
		pill: useRef<HTMLButtonElement | null>(null),
		line: useRef<HTMLDivElement | null>(null),
		group: useRef<HTMLFieldSetElement | null>(null),
		note: useRef<HTMLTextAreaElement | null>(null),
		honoree: useRef<HTMLInputElement | null>(null),
		notifyName: useRef<HTMLInputElement | null>(null),
		notifyEmail: useRef<HTMLInputElement | null>(null)
	};
	// mounted once the flow is live, so a pick has an actor to go to: the pill the server drew is
	// pressed into nothing before then.
	const unitPanel = useUnitPanel({
		mounted: live !== null && api.unit.pill.state !== 'text',
		formId: config.formId,
		line: amountRefs.line,
		pill: amountRefs.pill,
		field: amountRefs.group,
		choice: api.unitSelect
	});
	const detailsRefs: DetailsRefs = {
		email: useRef<HTMLInputElement | null>(null),
		firstName: useRef<HTMLInputElement | null>(null),
		lastName: useRef<HTMLInputElement | null>(null)
	};

	// the receipt is one block wherever it stands. rendered into the takeover only while a takeover
	// states one and only once it has figures — an empty ledger block under "Thank you" states
	// nothing, and two copies would be two nodes carrying one id.
	const inTakeover = shown === 'takeover' && takeover.receipt !== 'none' && reading !== null;

	// ── the presses ──────────────────────────────────────────────────────────────────────────────

	function firstAmountProblem(missing: readonly AmountDecision[]): HTMLElement | null {
		const first = missing[0];
		if (first === 'note') return amountRefs.note.current;
		if (first === 'tribute-honoree') return amountRefs.honoree.current;
		if (first === 'tribute-notify-name') return amountRefs.notifyName.current;
		if (first === 'tribute-notify-email') return amountRefs.notifyEmail.current;
		// a missing amount is always a box and never a tile: a coin amount or a share count has the one
		// box, and on a tray with tiles the amount can only go missing through the other tile, which
		// opens the box in the tiles' place, and on a bare tray the box is the whole amount block.
		return amountRefs.quantity.current ?? amountRefs.entry.current;
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
	 *
	 * which channel the amount's refusal has is asked before the caret moves, as the details step's
	 * Continue asks it: the entry is described by the sentence while it stands, so a caret arriving
	 * there reads it, and only a caret already on it — Enter in the box — leaves the region to say it.
	 */
	function onAmountContinue(): void {
		const before = api.state.step;
		api.continueButton.onClick();
		const state = now().state;
		if (before !== 'amount' || state.step !== 'amount') return;
		const target = firstAmountProblem(state.missing);
		setAsked(true);
		setAskedInPlace(target !== null && document.activeElement === target);
		setNonce((at) => at + 1);
		focusOn(target);
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
		// on IRA (QCD) the rail is chosen and the custodian is what is missing, and its box is ours to
		// send the caret to. a caret already in that box — Enter in it — moves nowhere and reads
		// nothing, so the region says the refusal instead.
		if (state.method === 'ira_qcd') {
			if (document.activeElement === custodianBox.current) {
				setShot({ at: read(), kind: 'custodian' });
			}
			focusOn(custodianBox.current);
			return;
		}
		focusOn(paymentMount.current);
	}

	/**
	 * the offer of a one-time gift taken. the press hides itself and un-hides the box, which is where
	 * the next choice is, so the caret goes there and the change is said on the region.
	 */
	function onMakeOneTime(): void {
		api.oneTimeButton.onClick();
		setShot({ at: read(), kind: 'one-time' });
		focusOn(paymentMount.current);
	}

	/**
	 * the thank-you's employer Send. a blank press is said by the box the caret is put in
	 * (`EmployerAskBlock` in ./takeover.tsx), so the region says it only for a press made with the
	 * caret already there, and again on every such press: the words do not change between two.
	 */
	function onEmployerSend(caretInBox: boolean): void {
		api.sendEmployerButton.onClick();
		const after = now().state;
		if (!caretInBox || after.step !== 'success' || after.employer?.refusal !== 'blank') return;
		setShot({ at: read(), kind: 'ask' });
		setNonce((at) => at + 1);
	}

	/**
	 * a pledge's Copy reporting, said on the card's one region again on every press and kept by the
	 * heading it was pressed under, as the address block's are — and by the notice standing as it was
	 * pressed, which the region has already said and which it outranks until that notice changes.
	 */
	function onPledgeCopied(words: string): void {
		setShot({
			at: read(),
			kind: 'copy',
			words,
			on: screen.current.heading,
			over: takeover.announce
		});
		setNonce((at) => at + 1);
	}

	/** the fee decision; what it does to the total is said with every other move of it (`total`). */
	function onFee(): void {
		api.feeToggle.onClick();
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

	function onOther(via: 'pointer' | 'keyboard'): void {
		setOtherChosen(true);
		// whatever a preset wrote into the box is not what the donor is about to type, and a figure
		// left standing there is a gift the next press would charge.
		setEntry('');
		api.amountGroup.onTyped?.(null);
		// arrow keys check a radio as they move, so taking the caret on a keyboard selection would pull
		// a donor out of the group mid-move (WCAG 3.2.2).
		if (via === 'pointer') focusOn(amountRefs.entry.current);
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
		else if (next.state.step === 'pledged') next.toldButton.onClick();
		else next.retryButton.onClick();
	}

	function holdsCaret(): boolean {
		return cardNode.current?.contains(document.activeElement) === true;
	}

	function onSecondary(): void {
		const next = now();
		if (next.state.step === 'mandate') next.declineMandateButton.onClick();
		// `success` is terminal and is given no way out, so a second gift is a new card. a told
		// pledge's Done is the same door.
		else if (next.state.step === 'success' || next.state.step === 'pledged') restart(holdsCaret());
		else next.backButton.onClick();
	}

	// ── what is said out loud ────────────────────────────────────────────────────────────────────

	const spent = shot !== null && shot.at === snapshot ? shot.kind : null;
	const copied =
		shot?.kind === 'copy' &&
		shot !== kept.current.outsaid &&
		shot.on === takeover.heading &&
		(takeover.deposit !== null || takeover.pledge !== null)
			? (shot.words ?? '')
			: '';
	// a pledge's Copy pressed while its screen's notice stood, which the region said before the press:
	// it outranks that notice as the element's does (views.ts in @better-giving/form says the outcome
	// `createPledgeBlock` hands it straight onto the region), and a notice that changes since spends it.
	const copiedOverNotice =
		takeover.announce !== '' && shot?.over === takeover.announce ? copied : '';
	// in the order the fields are asked in, which is the order they are laid out in and the order the
	// caret walks them. what the step is refusing as it stands, which the press's sentence is spoken
	// from and a kept one is checked against.
	const detailsRefusal = [
		missingFields.includes('email') ? fieldProblem('email', api.emailField.box.value) : '',
		missingFields.includes('firstName') ? fieldProblem('firstName', '') : '',
		missingFields.includes('lastName') ? fieldProblem('lastName', '') : ''
	]
		.filter((sentence) => sentence !== '')
		.join('; ');
	const detailsSaid = spent === 'details' ? detailsRefusal : '';
	// the employer ask's refusal is news as a write's refusal lands under the box, which moves no
	// caret, and for a blank press that moved none (`onEmployerSend`); a blank refusal clearing back
	// to the write's refusal it stood over is neither.
	const askRefusal = takeover.employer?.refusal ?? '';
	const askSaid =
		spent === 'ask'
			? askRefusal
			: askRefusal !== '' && takeover.employer?.boxRefused !== true && kept.current.ask === ''
				? askRefusal
				: '';
	// the thank-you's sentence, said as its screen arrives rather than while it stands (`arrival` in
	// ./takeover.tsx).
	const arrival =
		takeover.arrival !== '' &&
		(screen.current.shown !== 'takeover' || takeover.heading !== screen.current.heading)
			? takeover.arrival
			: '';
	const bounds = copy.amountProblem(offer, config.minAmountMinor, config.maxAmountMinor);
	// what a numbered step was refused for, said out loud, and one sentence however many steps there
	// are: the three are mutually exclusive, because a press is refused on the step it was made on. each
	// is here only for the press that moved no caret and had no other channel (`askedInPlace`,
	// `detailsSaid`, and a Continue refused with the caret already in the custodian box).
	const askedFor = [
		askedInPlace && missingDecisions.includes('amount') ? bounds : '',
		detailsSaid,
		spent === 'custodian' ? custodianWords : ''
	]
		.filter((sentence) => sentence !== '')
		.join(', ');

	const busy = api.continueButton['aria-busy'];
	// a press held on a challenge that is asking the donor to solve something: the puzzle is in the
	// box of the step the press is held on (`read` in ./machine.ts), and `aria-busy` over it would have
	// assistive technology hold it back.
	const asking = snapshot.value === 'holding' && snapshot.context.challengeInteractive;
	// and the same wait for a lost pledge's save made again, whose puzzle is drawn under the told
	// press: no write is out while it asks.
	const tellAsking =
		snapshot.matches({ pledged: { telling: 'awaitingToken' } }) &&
		snapshot.context.challengeInteractive;
	// the takeover's own words first: a screen that has taken the whole card is not one a numbered step
	// is still asking anything on. the review step's refusal stands ahead of every `News`, a moved
	// total included, as `standing` in @better-giving/form's views.ts ranks it: it is a thing the donor
	// was asked for and has not done, and a sentence written over it would have the next render write
	// it back and say it again with nobody having pressed anything. a heading said in place of a caret
	// move last — the step a tokenless return was handed, or a retitled takeover: a screen's own
	// sentence and the wait's both say more than its heading does. the wait is never said on the flow's
	// first paint (`live === null`), for the reason the caret is never moved on it: a resume's served
	// wait is the route's drawing, and the flow that would be waiting has not started.
	//
	// the Copy's sentence, the retitled heading's, the handed step's and every `News` keep one rule: a
	// live-region sentence stays until the heading it announces changes or another sentence replaces
	// it — and a `News`, until what it `restating` names moves. a press asking for a repeat spends the
	// handed step and a `News` too (`repeating`). a new snapshot alone never clears any of them:
	// the provider's fields and the challenge widget report whenever they finish, and the address
	// screen's reading loop every few seconds, each with nothing to say. each is spent by the commit
	// that said something else. a sentence said while something stands — the amount step's refusal,
	// the payment box's, the wait — is said again by every render and needs no keeping.
	const arrived: News | null =
		detailsSaid !== ''
			? { words: detailsSaid, restating: 'fields' }
			: askSaid !== ''
				? { words: askSaid, restating: 'ask' }
				: arrival !== ''
					? { words: arrival }
					: totalMoved
						? { words: reading?.words ?? '', restating: 'total' }
						: offerArrived
							? { words: oneTimeOffer }
							: spent === 'one-time'
								? { words: copy.MADE_ONE_TIME }
								: null;
	const restated = { total: reading?.words ?? '', fields: detailsRefusal, ask: askRefusal };
	const prior = repeating ? null : kept.current.news;
	const news =
		prior !== null &&
		prior.on === shown &&
		(prior.restating === undefined || restated[prior.restating] === prior.words)
			? prior
			: null;
	const words =
		copiedOverNotice !== ''
			? copiedOverNotice
			: takeover.announce !== ''
				? takeover.announce
				: askedFor !== ''
					? askedFor
					: refusedPayment
						? copy.PAYMENT_PROBLEM
						: arrived !== null
							? arrived.words
							: copied !== ''
								? copied
								: busy && live !== null
									? workingWords(api.state)
									: news !== null
										? news.words
										: handed.words !== ''
											? handed.words
											: retitle.words;
	useEffect(() => {
		const replaced = (by: string) => words !== '' && words !== by;
		kept.current = {
			// a Copy is kept by the heading it was pressed under, so a commit drawing another one spends
			// it as surely as a sentence replacing it does: the screen it comes back to is a new one. a
			// pledge's is kept by the notice it was pressed under as well, so a told press taking that
			// notice away spends it, and a refusal worded as the last one is still said.
			outsaid:
				shot?.kind === 'copy' &&
				(copied === '' ||
					replaced(copied) ||
					(shot.over !== undefined && shot.over !== takeover.announce))
					? shot
					: kept.current.outsaid,
			retitle: replaced(retitle.words) ? { on: retitle.on, words: '' } : retitle,
			handed: replaced(handed.words) ? { on: handed.on, words: '' } : handed,
			decline,
			offer: oneTimeOffer,
			// a moved total another sentence outranked is deferred rather than spent: the figure kept
			// stays the one before the move, so the move still reads as one once that sentence clears.
			total:
				arrived?.restating === 'total' && words !== arrived.words
					? kept.current.total
					: { step: api.state.step, figure },
			news:
				arrived !== null && words === arrived.words
					? { ...arrived, on: shown }
					: news === null || replaced(news.words)
						? null
						: news,
			again: nonce,
			ask: askRefusal
		};
	});

	const receipt =
		reading === null ? null : <Receipt reading={reading} onFee={() => onFee()} feeRef={feeBox} />;

	// ── the card ─────────────────────────────────────────────────────────────────────────────────

	// a coin gift's review step is headed in the projection's words, as the rest of it is worded.
	const coinHeading = api.state.step === 'give' ? api.state.coinReview?.heading : undefined;
	const head = (at: 1 | 2 | 3, into: Screen): ReactNode => (
		<StepHead
			at={at}
			api={api}
			headingRef={headings[into]}
			{...(at === 3 && coinHeading !== undefined ? { heading: coinHeading } : {})}
		/>
	);

	return (
		// the outer node carries the ladder the element's `:host` block declares in a shadow tree, and
		// the card carries the container query every breakpoint resolves against. `@property
		// --donate-primary` registers from the document tree, which is where this sheet now is. the
		// brand scope is the page root's (./page-root.tsx), so the scale it writes is declared on this
		// node as well. `data-theme` is what makes this node re-resolve the registry's roles
		// (`--primary`, `--ring`) against that scale: they are declared on `:root` and on every
		// `[data-theme]` (packages/form/src/registry/styles/colors.css), and read on `:root` they hold
		// the default accent. the scale's selector outranks the theme's, so the brand's steps win here.
		<div data-donate-root="" data-brand-scope={brandScope} data-theme={CARD_THEME}>
			<div
				ref={cardNode}
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
					aria-busy={busy && !asking ? true : undefined}
					onSubmit={(event) => event.preventDefault()}
				>
					<AmountStep
						api={api}
						config={config}
						head={head(1, 'amount')}
						hidden={shown !== 'amount'}
						missing={missingDecisions}
						amountProblem={bounds}
						refusal={refusalWords}
						refusedAmount={refusedAmount}
						unitOpen={unitPanel.open}
						onPill={unitPanel.toggle}
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
						drawsProgram={pagePick === undefined}
						amountLabels={amountLabels}
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
						heldChallengeMount={heldChallengeMount}
						paymentPrepared={live !== null}
						paymentRows={paymentRows}
						paymentWords={paymentWords}
						oneTimeOffer={oneTimeOffer}
						onMakeOneTime={onMakeOneTime}
						onSubmit={onSubmit}
						submits={shown === 'give'}
					/>
					<TakeoverScreen
						screen={takeover}
						hidden={shown !== 'takeover'}
						// the told press is busy on its own write, which the flow's working states do not cover.
						busy={busy || (api.toldButton['aria-busy'] && !tellAsking)}
						receipt={inTakeover ? receipt : null}
						headingRef={headings.takeover}
						sectionRef={takeoverSection}
						deposit={deposit?.root ?? null}
						employer={
							<EmployerAskBlock
								screen={takeover.employer}
								box={api.employerField.box}
								busy={api.sendEmployerButton['aria-busy']}
								given={api.sendEmployerButton.given === true}
								onSend={onEmployerSend}
								onSkip={() => api.skipEmployerButton.onClick()}
							/>
						}
						onPrimary={onPrimary}
						onSecondary={onSecondary}
						onCopied={onPledgeCopied}
						challengeMount={toldChallengeMount}
					/>
					{/* into the node the IRA (QCD) option stands in its row, which the payment box holds and
					    react does not render (./payment.tsx). */}
					{live === null
						? null
						: createPortal(
								<IraPanel
									field={api.custodianField}
									problem={custodianWords}
									inputRef={custodianBox}
								/>,
								live.ira
							)}
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
	headingRef,
	heading
}: {
	readonly at: 1 | 2 | 3;
	readonly api: ReactApi;
	readonly headingRef: RefObject<HTMLHeadingElement | null>;
	/** the heading's words where the projection words the step, the step's own otherwise. */
	readonly heading?: string;
}) {
	const countId = `step-${at}-count`;
	return (
		<header className="step-head">
			<span className="step-count" id={countId} hidden>
				{copy.stepCount(at)}
			</span>
			<h2 part={part('heading')} tabIndex={-1} aria-describedby={countId} ref={headingRef}>
				{heading ?? copy.STEP_HEADINGS[at - 1]}
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
