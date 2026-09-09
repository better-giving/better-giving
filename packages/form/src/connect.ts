// the seam between the flow and whatever renders it: a snapshot in, a state projection and a
// set of prop getters out.
//
// what the seam buys, in order of when it pays off:
//
//   1. a layout may render two steps at once, or one, or fold the three into a scroll. that is a
//      second projection of the same states, not a second machine — same transitions, same
//      guards, only the projection differs. this function is where that difference is allowed to
//      live.
//   2. a framework adapter is then `normalize` plus types, rather than a second copy of the
//      flow. one payment integration, one machine, N thin adapters is the whole argument for
//      this directory existing.
//   3. `connect` is where the flat machine context becomes the value-carrying `State` union —
//      so the promise that an unreachable step cannot hold stale data is kept at the boundary
//      a renderer actually sees, not only inside ./value.ts.
//
// every choice the machine owns is resolved here, never re-derived by a layout. which
// frequencies exist, which amounts, which payment methods are offered — each is a predicate over
// `config`, and a layout that reaches into `context` to re-answer one of them is a second copy of
// that predicate on a page we cannot reach and cannot fix. that is why the step-mark getter is
// plural: a singular one would have forced every renderer to work out the list for itself.
//
// two things this file must never grow:
//
//   - a `disabled` prop on any control. double-submit is prevented by the machine's shape (see
//     the missing `SUBMIT` handler on `quoting` in ./checkout.machine.ts); a `disabled` here
//     would invite a consumer to believe the attribute is the guarantee, and any second entry
//     point — a keyboard Enter, the host page's own script, a re-render that dropped the prop
//     — walks straight past an attribute. ./connect.spec.ts asserts its absence across every
//     getter rather than trusting this paragraph.
//   - a DOM import. the getters are plain records until `normalize` is applied, which is what
//     keeps this module in the node pool. reaching for `document` here means the seam is in
//     the wrong place.
//
// `../package.json` exports this module as `./connect`, which is point 2 above made concrete: the
// deployment's own donation page (`src/lib/donate/` in packages/app) is a react adapter of exactly
// this projection. both bans hold for that consumer as they do for the element — it takes the
// getters through `normalize` and adds no predicate of its own.

import type { SnapshotFrom } from 'xstate';
import type { AdjustedReconciliation } from './fee';
import {
	declinedFee,
	NUMBERED_STEPS,
	shownTotalMinor,
	stepIsReachable,
	type checkoutMachine,
	type CheckoutEvent,
	type Failure,
	type NumberedStep
} from './checkout.machine';
import {
	completePayer,
	methodIsChargeable,
	missingAmountDecisions,
	missingPayerFields,
	MAX_TRIBUTE_EMAIL,
	MAX_TRIBUTE_NAME,
	NAME_PATTERN,
	OPENED_TRIBUTE,
	payerCoversFee,
	type AmountDecision,
	type FormValue,
	type PayerField
} from './value';
import {
	FREQUENCIES,
	FREQUENCY_LABELS,
	NO_PROGRAM_LABEL,
	TRIBUTE_KIND_LABELS,
	TRIBUTE_KINDS,
	type Frequency,
	type PaymentMethod,
	type Quote,
	type TributeKind
} from './v1';

export type CheckoutSnapshot = SnapshotFrom<typeof checkoutMachine>;

/**
 * the generic prop records a framework adapter turns into its own props.
 *
 * `onClick` is a key in a plain object here, not a React convention leaking in — `normalize`
 * is where a Svelte adapter renames it and a headless consumer ignores it. keeping the record
 * generic is the entire reason a framework never has to be named in this directory.
 */
export type GenericProps = Record<string, unknown>;

/**
 * the beat a busy flow is on, for the one surface that says it out loud.
 *
 * three, because the three say different things to a donor who is not looking at the card: an
 * intent is being minted, a card is being charged, or a page that remembers nothing is finding out
 * what already happened. `boot` rides with the minting, being a frame nobody observes.
 */
export type WorkingPhase = 'quoting' | 'confirming' | 'resuming';

/**
 * the normalizer a consumer supplies, one function per shape of node the flow describes.
 *
 * four kinds, one per native element the flow needs, and the smallness is the rule: a kind
 * exists because the platform has an element for it, never because a widget needs building.
 * `group` is a native `<fieldset>` of radios — roving focus, arrow-key traversal and form
 * semantics come free; `field` is a native text input; `select` is a native `<select>`; `button`
 * is a button. the genuinely hard accessible widget in this form is the payment provider's
 * iframe, which we do not control. a fifth kind would mean something was being re-implemented
 * that the platform already does.
 *
 * `select` and `group` are both closed choices and are separate because the platform draws them
 * differently, not because the flow does: a `group` spends a row per option and says every option
 * out loud, and a `select` spends one control. the tribute's kind is the second — it sits beside
 * the name it qualifies and reads as the start of the sentence that name finishes.
 */
export type PropTypes<
	T extends { button: unknown; group: unknown; field: unknown; select: unknown } = {
		button: GenericProps;
		group: GenericProps;
		field: GenericProps;
		select: GenericProps;
	}
> = {
	button(props: GenericProps): T['button'];
	group(props: GenericProps): T['group'];
	field(props: GenericProps): T['field'];
	select(props: GenericProps): T['select'];
};

/**
 * the flow as a renderer sees it: one variant per step, each carrying what that step may show.
 *
 * the value is non-optional from `details` onward, by construction. that is the whole point of
 * projecting rather than exposing the machine's flat context — a consumer narrowed to `give`
 * has a `FormValue`, not a `FormValue | undefined`, so there is no branch in which a payment
 * screen renders an absent amount and no `?? 0` for anyone to write.
 *
 * `confirm` is the correction screen and carries an `adjusted` reconciliation rather than the
 * union. it is reached only where the authoritative total is not the figure the donor was last
 * shown (`quoted` in ./checkout.machine.ts), so narrowing the type here is what stops a layout
 * rendering the correction copy over a figure that never moved — the silent overwrite this
 * screen exists to prevent, wearing the other face.
 *
 * `indeterminate` is its own step and never collapses into `working` or `failed`. it is the
 * flow saying it does not know whether the donor's money moved, which is neither a spinner nor
 * a refusal, and the copy a donor reads there must not offer to try again.
 *
 * `failed` carries `fix` alongside the message. CLAUDE.md: a 4xx body names the offending value
 * and where to change it, because the integrator is an agent with no console — so the field has
 * to survive the last hop out to whatever renders it.
 *
 * the two steps a donor can be refused on carry what is missing, because both refusals are
 * silent otherwise: the flow simply stays where it is and a renderer comparing snapshots sees
 * nothing move. each carries the set rather than the first entry, so one press names everything
 * it was refused for.
 */
export type State =
	| {
			readonly step: 'amount';
			readonly fv?: FormValue;
			/** the decisions a press would still be refused for, in the order they are asked. */
			readonly missing: readonly AmountDecision[];
	  }
	| {
			readonly step: 'details';
			readonly fv: FormValue;
			/**
			 * the typed fields a press would still be refused for, in the order they are asked.
			 *
			 * projected rather than left to the control's own `validity`, because the two rules
			 * are not the same rule: `looksLikeAnAddress` (./value.ts) accepts an address an
			 * `<input type="email">` refuses, so a renderer marking from the engine would mark a
			 * field the flow accepted and take the caret off whatever actually blocked the press.
			 * the engine's answer is still worth reading for which sentence to show, and for
			 * nothing else.
			 */
			readonly missing: readonly PayerField[];
	  }
	| {
			readonly step: 'give';
			readonly fv: FormValue;
			/**
			 * whether the payment surface has reported a rail the Donate control may charge.
			 *
			 * the whole of what a press can be refused for on this step, and the half of a refusal
			 * no control on the card carries: the provider paints its fields in a frame on its own
			 * origin, so nothing a renderer can reach knows whether they are filled in, and an
			 * unfinished card arrives here as a method that is absent or that this control may not
			 * spend. the typed fields were settled on the step before, which `payerFieldsAreGiven`
			 * (./checkout.machine.ts) is what holds.
			 */
			readonly payable: boolean;
			/**
			 * whether the flow will take a press on this step at all.
			 *
			 * the same answer `payerIsComplete` gives (./checkout.machine.ts), which is `payable`
			 * above and every typed field the payer needs. the two are separate because they answer
			 * different questions and a renderer needs the second one: a refusal explained off
			 * `payable` alone says nothing wherever a press is refused for anything but the rail.
			 */
			readonly payerComplete: boolean;
	  }
	| {
			readonly step: 'confirm';
			readonly fv: FormValue;
			readonly quote: Quote;
			readonly reconciliation: AdjustedReconciliation;
			/**
			 * the rail this gift is about to go down, echoed back before it is authorized.
			 *
			 * off the committed payer rather than off a control, because this form draws no rail
			 * control — the payment provider's own fields are the picker, and they report through
			 * `SET_METHOD` (./checkout.machine.ts). taken at the point the intent was minted for it,
			 * so the word on this screen names the rail the quote was actually minted on.
			 */
			readonly method: PaymentMethod;
	  }
	| { readonly step: 'mandate'; readonly fv: FormValue; readonly quote: Quote }
	| {
			readonly step: 'working';
			readonly fv?: FormValue;
			/**
			 * which beat of the press this is, and the only thing it is read for.
			 *
			 * one press spans the mint and the charge, and the collapse of four machine states into
			 * one screen would otherwise leave a donor who cannot see the spinner hearing the same
			 * four words for the whole of it.
			 * it names the beat and nothing gates on it — the screen a busy flow stays on is still
			 * the last one shown (./views.ts).
			 */
			readonly phase: WorkingPhase;
	  }
	| { readonly step: 'redirecting' }
	| { readonly step: 'processing' }
	| { readonly step: 'indeterminate' }
	| { readonly step: 'awaitingVerification'; readonly deadline: number | null }
	| { readonly step: 'verificationExpired' }
	| { readonly step: 'success' }
	| {
			readonly step: 'failed';
			readonly message: string;
			readonly fix?: string;
			/**
			 * whether the rail itself refused, which is the whole of what a screen may carry back.
			 *
			 * present only where an issuer said no (`rememberDecline` in ./checkout.machine.ts).
			 * every other route to this step — a quote that could not be minted, a payment surface
			 * that never drew, a challenge that could not be shown, a port that did not answer —
			 * says nothing about the card the donor entered, and a renderer that put those words
			 * beside the payment fields would be saying it did.
			 */
			readonly refusedByRail?: true;
	  };

/** the whole surface a host renders from. */
export type CheckoutApi<
	T extends { button: unknown; group: unknown; field: unknown; select: unknown }
> = {
	readonly state: State;
	readonly frequencyGroup: T['group'];
	readonly amountGroup: T['group'];
	readonly noteToggle: T['button'];
	readonly noteField: T['field'];
	/**
	 * the causes the form offers, under the option that picks none.
	 *
	 * projected on every config and drawn on one, which is the division the header draws: which
	 * shapes get a control is a predicate over the configuration, and a renderer computing it from
	 * `config.program` itself would be the second copy of an answer this seam already holds. the
	 * list is empty of causes wherever the org did not leave the choice to the donor.
	 */
	readonly programSelect: T['select'];
	/**
	 * the tribute block: whether the donor asked for one, and the four boxes inside it.
	 *
	 * five getters rather than one nested record, because a getter is what a renderer mounts on a
	 * control — a record would make a layout destructure a shape this seam invented, which is the
	 * one thing the file's header says a layout must never be handed.
	 */
	readonly tributeToggle: T['button'];
	readonly tributeKindSelect: T['select'];
	readonly tributeHonoreeField: T['field'];
	readonly tributeNotifyNameField: T['field'];
	readonly tributeNotifyEmailField: T['field'];
	readonly continueButton: T['button'];
	readonly emailField: T['field'];
	readonly firstNameField: T['field'];
	readonly lastNameField: T['field'];
	readonly consentToggle: T['button'];
	readonly feeToggle: T['button'];
	readonly submitButton: T['button'];
	readonly confirmButton: T['button'];
	readonly acceptMandateButton: T['button'];
	readonly declineMandateButton: T['button'];
	readonly backButton: T['button'];
	readonly retryButton: T['button'];
	/**
	 * the marks on the step head, one per numbered step and in the order a donor is asked.
	 *
	 * plural and derived here for the reason the header gives: which step a mark may reach is a
	 * predicate over the flow, and a singular getter would have every layout compute the set
	 * itself on sites we cannot reach. each carries `step` (the ordinal a donor is told), `current`
	 * — where they are standing, which is a position rather than a control — and `available`, the
	 * flow's own answer to whether it would take the press.
	 *
	 * `available` is `stepIsReachable` (./checkout.machine.ts) and not a second reading of it. a
	 * mark drawn available over a guard that refuses is a control that does nothing; a mark drawn
	 * unavailable over a guard that would have allowed it is a way back a donor cannot find.
	 *
	 * it carries no label. the words are the step's own heading, which the layout already holds —
	 * `STEP_HEADINGS` in ./views.ts — and a second copy here is a heading and a mark that can come
	 * to say different things about the same screen.
	 */
	readonly stepButtons: readonly T['button'][];
	/**
	 * the bot-check token, handed in by whatever mounts the widget.
	 *
	 * not a prop getter, because there is no element here to normalize — the provider's script
	 * renders its own and hands back a string. `/api/v1` is public, unauthenticated and
	 * payment-initiating, so this is the path by which the token the endpoint requires reaches
	 * the request; a layout that never calls it produces quotes the server is entitled to
	 * refuse.
	 */
	readonly setTurnstileToken: (token: string) => void;
};

/**
 * every top-level state the machine has, which is what makes the projection below total.
 *
 * ./connect.spec.ts checks this list against the machine's own `states` keys, so adding a state
 * without projecting it fails a test rather than rendering an empty card on somebody's website
 * months later. the list plus that test is the guarantee; neither half is one alone.
 */
export const TOP_LEVEL_STATES = [
	'boot',
	'amount',
	'details',
	'give',
	'quoting',
	'quoted',
	'confirm',
	'mandate',
	'confirming',
	'resuming',
	'indeterminate',
	'redirecting',
	'processing',
	'awaitingVerification',
	'verificationExpired',
	'success',
	'failed'
] as const;

type TopLevelState = (typeof TOP_LEVEL_STATES)[number];

/** the outermost state name, whether or not the machine is inside a nested one. */
function topLevelStateOf(snapshot: CheckoutSnapshot): TopLevelState {
	const { value } = snapshot;
	return (typeof value === 'string' ? value : Object.keys(value)[0]) as TopLevelState;
}

/**
 * the machine's flat snapshot as the value-carrying union above.
 *
 * total, with no arm that invents a step. a projection that fell through to something plausible
 * is how a state added to the machine renders as an empty card on a page we cannot reach — so
 * this switches over `TOP_LEVEL_STATES` and the unreachable arm is typed `never`, which turns
 * an unprojected state into a `pnpm check` failure.
 *
 * the `working` collapses are deliberate rather than incidental: `boot`, `quoting`, `quoted`,
 * `confirming` and `resuming` are one screen to a donor — something is happening — and giving each
 * its own step would be five identical spinners a layout has to keep in sync. what survives the
 * collapse is `phase`, because the words said out loud over a mint and over a charge are not the
 * same words. `indeterminate` is pointedly not among them; it is a different thing to say.
 */
export function toState(snapshot: CheckoutSnapshot): State {
	const { context } = snapshot;
	const fv = context.fv;
	const step = topLevelStateOf(snapshot);
	/** the shape every collapsed arm below returns, so the phase cannot be forgotten on one of them. */
	const working = (phase: WorkingPhase): State =>
		fv === null ? { step: 'working', phase } : { step: 'working', fv, phase };

	switch (step) {
		case 'amount': {
			const missing = missingAmountDecisions(context.draft, context.config);
			return fv === null ? { step: 'amount', missing } : { step: 'amount', fv, missing };
		}
		case 'success':
			return { step: 'success' };
		case 'redirecting':
			return { step: 'redirecting' };
		case 'processing':
			return { step: 'processing' };
		case 'indeterminate':
			return { step: 'indeterminate' };
		case 'verificationExpired':
			return { step: 'verificationExpired' };
		case 'awaitingVerification':
			return { step: 'awaitingVerification', deadline: context.verificationDeadline };
		case 'failed':
			return failedState(context.failure);
		case 'details':
			return fv === null
				? working('quoting')
				: { step: 'details', fv, missing: missingPayerFields(context.payerDraft) };
		case 'give':
			return fv === null
				? working('quoting')
				: {
						step: 'give',
						fv,
						payable: methodIsChargeable(context.payerDraft, context.config),
						payerComplete: completePayer(context.payerDraft, context.config) !== null
					};
		case 'mandate':
			return fv === null || context.quote === null
				? working('confirming')
				: { step: 'mandate', fv, quote: context.quote };
		case 'confirm':
			// the reconciliation is narrowed rather than carried: this screen is reached only where
			// the total moved, so anything else here is a state that cannot be rendered as itself.
			return fv === null ||
				context.quote === null ||
				context.reconciliation?.kind !== 'adjusted' ||
				context.payer === null
				? working('confirming')
				: {
						step: 'confirm',
						fv,
						quote: context.quote,
						reconciliation: context.reconciliation,
						method: context.payer.method
					};
		case 'boot':
		case 'quoting':
		case 'quoted':
			return working('quoting');
		case 'confirming':
			return working('confirming');
		case 'resuming':
			return working('resuming');
		default: {
			const unprojected: never = step;
			return unprojected;
		}
	}
}

/**
 * which of the three numbered steps the flow is on, or `null` where it is on none of them.
 *
 * the narrowing is a lookup in `NUMBERED_STEPS` rather than a list of its own, so the three names
 * this asks about are the three the machine moves between.
 */
function numberedStepOf(snapshot: CheckoutSnapshot): NumberedStep | null {
	const step = topLevelStateOf(snapshot);
	return (NUMBERED_STEPS as readonly string[]).includes(step) ? (step as NumberedStep) : null;
}

/**
 * the failure whole — its `fix` and its mark intact — or the generic sentence when the machine has
 * neither.
 */
function failedState(failure: Failure | null): State {
	if (failure === null) return { step: 'failed', message: 'The donation could not be completed.' };
	// each optional is spread in or left out rather than written as a key holding `undefined`:
	// `exactOptionalPropertyTypes` is on, and absent and present-but-nothing are not the same.
	return {
		step: 'failed',
		message: failure.message,
		...(failure.fix === undefined ? {} : { fix: failure.fix }),
		...(failure.refusedByRail === undefined ? {} : { refusedByRail: failure.refusedByRail })
	};
}

/**
 * whether the flow is mid-flight, which is a thing to announce and never a thing to gate on.
 *
 * feeds `aria-busy` so a screen reader says something is happening. it stops nothing — the
 * stopping is the machine's shape — which is exactly the division of labour that keeps a
 * rendering detail from being mistaken for the guarantee.
 */
function isWorking(snapshot: CheckoutSnapshot): boolean {
	const step = topLevelStateOf(snapshot);
	return (
		step === 'boot' ||
		step === 'quoting' ||
		step === 'quoted' ||
		step === 'confirming' ||
		step === 'resuming' ||
		step === 'indeterminate'
	);
}

/**
 * what the option choosing no cause carries as its value.
 *
 * `''` because it is what a `<select>` reports for an option with nothing of its own, so this seam
 * is where it becomes the flow's `null` and back again (`SET_PROGRAM` in ./checkout.machine.ts). a
 * control's encoding rather than a wire one: no request ever carries it.
 */
const NO_PROGRAM = '';

/**
 * derives the render surface from a snapshot.
 *
 * takes a snapshot and a `send`, not the actor. the api is recomputed per snapshot, so a
 * consumer's reactivity primitive — a Svelte rune, a React `useSyncExternalStore`, a plain
 * subscription — decides when that happens. holding the actor here would put a subscription
 * model inside the core and pick one of those for everybody.
 */
export function connect<
	T extends { button: unknown; group: unknown; field: unknown; select: unknown }
>(
	snapshot: CheckoutSnapshot,
	send: (event: CheckoutEvent) => void,
	normalize: PropTypes<T>
): CheckoutApi<T> {
	const { context } = snapshot;
	const { config, draft, payerDraft } = context;
	const busy = isWorking(snapshot);
	const selectedFrequency: Frequency | undefined = draft.frequency;
	/** which numbered step the donor is standing on, or `null` on a screen that is not one. */
	const standingOn = numberedStepOf(snapshot);

	/** every control reports busy and none of them reports disabled. */
	const button = (props: GenericProps): T['button'] =>
		normalize.button({ 'aria-busy': busy, ...props });

	return {
		state: toState(snapshot),

		// the org's enabled frequencies in the contract's own order, each with the word a donor
		// reads. the `name` is what makes them one native radio family, which is where the
		// keyboard behaviour comes from.
		frequencyGroup: normalize.group({
			name: 'frequency',
			options: FREQUENCIES.filter((frequency) => config.frequencies.includes(frequency)).map(
				(frequency) => ({
					value: frequency,
					label: FREQUENCY_LABELS[frequency],
					checked: frequency === selectedFrequency,
					onChange: () => send({ type: 'SET_FREQUENCY', frequency })
				})
			)
		}),

		// one name, one selection, one value. the entry is the last card in the same family rather
		// than an escape hatch below the grid, so "a preset is selected and the box has something
		// else in it" is never a state anybody has to resolve — and `checked` below is what makes
		// the traffic run both ways: a figure typed into the box lights the preset that offers it,
		// because a preset is lit by matching the one `amountMinor` the draft carries and never by a
		// record of which control was pressed.
		amountGroup: normalize.group({
			name: 'amount',
			options: config.suggestedAmountsMinor.map((amountMinor) => ({
				value: amountMinor,
				checked: amountMinor === draft.amountMinor,
				onChange: () => send({ type: 'SET_AMOUNT', amountMinor })
			})),
			// `null` is the entry emptied, and it is a decision rather than the absence of one:
			// a donor who deletes what they typed has taken the amount back, and a renderer with no
			// way to say so leaves the last figure live under an empty box.
			onTyped: (amountMinor: number | null) =>
				send(amountMinor === null ? { type: 'CLEAR_AMOUNT' } : { type: 'SET_AMOUNT', amountMinor })
		}),

		// whether the donor has asked to write a note, projected for the same reason `state.missing`
		// is: a renderer that opened its disclosure off its own checkbox would hold the one decision
		// on this step the flow could not see, and a press refused for a blank note would have
		// nothing to name. `pressed` is the ask, not the note — what was typed is the field below.
		noteToggle: button({
			pressed: draft.note !== undefined,
			onClick: () => send({ type: 'TOGGLE_NOTE' })
		}),

		noteField: normalize.field({
			name: 'note',
			value: draft.note ?? '',
			onChange: (note: string) => send({ type: 'SET_NOTE', note })
		}),

		// the causes, in the org's own order, under the option a card rests on. that first option is an
		// answer rather than a placeholder — the gift going where it is needed most — which is why it
		// is here rather than being an empty select a renderer marks as unanswered.
		//
		// `''` is the DOM's own word for a selection carrying nothing, and it is the whole of why the
		// value is a string on both sides of this seam while the flow's own is `string | null`: a
		// `<select>` reports the empty option as `''` and cannot report a null.
		programSelect: normalize.select({
			name: 'programId',
			value: draft.programId ?? NO_PROGRAM,
			options: [
				{ value: NO_PROGRAM, label: NO_PROGRAM_LABEL },
				...(config.program?.mode === 'choice'
					? config.program.options.map((option) => ({ value: option.id, label: option.name }))
					: [])
			],
			onChange: (value: string) =>
				send({ type: 'SET_PROGRAM', programId: value === NO_PROGRAM ? null : value })
		}),

		// whether the donor asked to dedicate the gift, projected for the reason `noteToggle` above
		// is: the disclosure is the flow's answer, so a refused press can name what is inside it.
		tributeToggle: button({
			pressed: draft.tribute !== undefined,
			onClick: () => send({ type: 'TOGGLE_TRIBUTE' })
		}),

		// the whole vocabulary, in ./v1.ts's order, each with the words a donor reads. no filter over
		// the config: a kind is a fact about the gift rather than a capability of the deployment, so
		// unlike the frequencies above there is no per-deployment list to intersect with.
		//
		// `value` falls back to the kind an opened tribute is seeded with, which is the same constant
		// `TOGGLE_TRIBUTE` assigns — so a closed disclosure projects the control's own resting state
		// rather than an empty string no option carries.
		tributeKindSelect: normalize.select({
			name: 'tributeKind',
			value: draft.tribute?.kind ?? OPENED_TRIBUTE.kind,
			options: TRIBUTE_KINDS.map((kind) => ({ value: kind, label: TRIBUTE_KIND_LABELS[kind] })),
			onChange: (value: string) => send({ type: 'SET_TRIBUTE', kind: value as TributeKind })
		}),

		// `maxlength` is the rule the endpoint holds these to, set as the attribute so a paste is
		// truncated where it happens rather than refused after the donor has left the field. which
		// box a press was refused for is `state.missing` above and never the engine's answer, which
		// is the division ./value.ts writes down for the payer's three fields.
		tributeHonoreeField: normalize.field({
			name: 'tributeHonoree',
			maxLength: MAX_TRIBUTE_NAME,
			value: draft.tribute?.honoree ?? '',
			onChange: (honoree: string) => send({ type: 'SET_TRIBUTE', honoree })
		}),
		tributeNotifyNameField: normalize.field({
			name: 'tributeNotifyName',
			maxLength: MAX_TRIBUTE_NAME,
			value: draft.tribute?.notifyName ?? '',
			onChange: (notifyName: string) => send({ type: 'SET_TRIBUTE', notifyName })
		}),
		// `type` and nothing else: the pair is optional, so `required` here would refuse the donor
		// who asked for nobody to be told — which is the case the pairing rule exists for.
		tributeNotifyEmailField: normalize.field({
			name: 'tributeNotifyEmail',
			type: 'email',
			maxLength: MAX_TRIBUTE_EMAIL,
			value: draft.tribute?.notifyEmail ?? '',
			onChange: (notifyEmail: string) => send({ type: 'SET_TRIBUTE', notifyEmail })
		}),

		continueButton: button({ onClick: () => send({ type: 'CONTINUE' }) }),

		// no rail control, and its absence is the decision. the payment provider's own fields draw
		// a picker over the rails the deployment offers, and a second one here would be a choice a
		// donor could set two ways — the provider's fields collect for whichever one they hold, so
		// ours would be the copy that is wrong. the flow learns the rail from the provider instead,
		// through `SET_METHOD` (./checkout.machine.ts).

		// the receipt needs a name and somewhere to send itself; nothing here is a marketing
		// field. each carries its own value so a layout never reads `payerDraft` directly.
		//
		// `required`, `type` and `pattern` are the rule, not the verdict, and that is the whole of
		// what this seam projects about these three. constraint validation applies to a bare input
		// with no form owner, so a renderer that sets them gets `validity.valueMissing`,
		// `validity.typeMismatch` and `validity.patternMismatch` back from the engine and picks its
		// sentence off those. which field was refused is `state.missing` above and never the
		// engine's answer — the two rules differ, and ./value.ts is where the pair is written down.
		emailField: normalize.field({
			name: 'email',
			type: 'email',
			required: true,
			value: payerDraft.email ?? '',
			onChange: (email: string) => send({ type: 'SET_CONTACT', email })
		}),
		firstNameField: normalize.field({
			name: 'firstName',
			required: true,
			pattern: NAME_PATTERN,
			value: payerDraft.firstName ?? '',
			onChange: (firstName: string) => send({ type: 'SET_CONTACT', firstName })
		}),
		lastNameField: normalize.field({
			name: 'lastName',
			required: true,
			pattern: NAME_PATTERN,
			value: payerDraft.lastName ?? '',
			onChange: (lastName: string) => send({ type: 'SET_CONTACT', lastName })
		}),

		// unticked until the donor ticks it. pre-ticked consent is not consent under GDPR/UK
		// GDPR, and the liability lands on the deploying org — see ./value.ts, where the same
		// rule is kept at the point the payer is assembled.
		consentToggle: button({
			pressed: payerDraft.consentedToContact ?? false,
			onClick: () =>
				send({ type: 'SET_CONSENT', consented: !(payerDraft.consentedToContact ?? false) })
		}),

		// the pressed state comes from ./value.ts rather than a `?? true` here: the control and the
		// figure it changes read one decision, and a bare default at either site is a control whose
		// state can disagree with the money beside it.
		//
		// `declinedFee` is what the other setting costs, and it is the one figure this surface carries
		// that no total is measured against: the processor takes it at Stripe after the gift settles
		// and nothing in this repo ever reads it back. off `declinedFee` (./checkout.machine.ts) so it
		// prices against the same rail the estimate does — and it is never `context.estimate`, which
		// is the record of what the donor was shown and what `reconcile` reads.
		feeToggle: button({
			pressed: payerCoversFee(payerDraft),
			declinedFee: declinedFee(context),
			onClick: () => send({ type: 'TOGGLE_FEE_COVERAGE' })
		}),

		// the submit control restates the money it will spend — the fee-inclusive total, on the
		// control that spends it, rather than a bare "Submit".
		//
		// off `shownTotalMinor` (./checkout.machine.ts) rather than assembled here, and that is the
		// whole of how the correction screen knows what a donor saw: the figure on this label and
		// the figure the server's answer is measured against are one expression, evaluated in one
		// place. re-deriving it here would let the two agree today and part on the next edit, and
		// what parts with them is the promise that nobody is charged a figure they were not shown.
		submitButton: button({
			totalMinor: shownTotalMinor(context),
			onClick: () => send({ type: 'SUBMIT' })
		}),

		// the authoritative total, never the estimate: this is the control that authorizes it.
		confirmButton: button({
			totalMinor: context.quote?.totalMinor ?? null,
			onClick: () => send({ type: 'CONFIRM' })
		}),

		acceptMandateButton: button({
			text: context.quote?.mandate?.text ?? null,
			onClick: () => send({ type: 'ACCEPT_MANDATE' })
		}),
		declineMandateButton: button({ onClick: () => send({ type: 'DECLINE_MANDATE' }) }),

		backButton: button({ onClick: () => send({ type: 'BACK' }) }),
		retryButton: button({ onClick: () => send({ type: 'RETRY' }) }),

		// off the top-level state rather than off the projected `State` above, because the two do
		// not answer the same question: `working` collapses five machine states into one screen, and
		// the marks are drawn on the step underneath whichever of them the flow is passing through.
		// a state that is not a numbered step at all — a takeover — leaves every mark unavailable,
		// which is what no step being on screen looks like.
		stepButtons: NUMBERED_STEPS.map((step, at) =>
			button({
				step: at + 1,
				current: step === standingOn,
				available: standingOn !== null && stepIsReachable(context, standingOn, step),
				onClick: () => send({ type: 'GO_TO_STEP', step })
			})
		),

		setTurnstileToken: (token: string) => send({ type: 'SET_TURNSTILE_TOKEN', token })
	};
}
