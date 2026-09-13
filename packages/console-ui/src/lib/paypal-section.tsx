import { AnchoredNote } from '@better-giving/operator/behaviour/AnchoredCard';
import { Modal } from '@better-giving/operator/behaviour/Dialog';
import type { Tone } from '@better-giving/operator/components/closed-sets';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { CheckboxGroup } from '@better-giving/operator/components/forms/CheckboxGroup';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { Section } from '@better-giving/operator/components/shell/Layout';
import { StatusLedger, StatusLine } from '@better-giving/operator/components/status/StatusLine';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { useSavedFormState } from '@better-giving/operator/saved-form-state.react';
import type { ReactNode } from 'react';
import { Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Await, Form, useRevalidator } from 'react-router';
import { paypalRun } from '../api/client';
import type {
	AddressRead,
	DeployedValues,
	PaymentsRead,
	PaypalFailure,
	PaypalRunRead,
	PaypalSetup,
	ProcessorPayments,
	RecurringRead,
	RecurringReading,
	RecurringSetup,
	ValuesRefusal,
	VarsWritten
} from '../api/types';
import type { HeldValues } from './held-values';
import { heldValues, withheldAmong } from './held-values';
import {
	CHARITY_APPROVED,
	CHARITY_FIELD,
	CHARITY_INTENT,
	CHARITY_RATE,
	charityApproved
} from './paypal-charity';
import type { PaypalPairBoxes, PaypalPairName } from './paypal-setup';
import {
	LINES,
	PAIR_FIELD,
	PAYPAL_FORM,
	PAYPAL_PAIR_NAMES,
	PAYPAL_SETUP_INTENT,
	lineAt,
	pairStanding,
	pairTurnedDown,
	reportStands
} from './paypal-setup';
import { REACHED_PAYPAL, pressStopped } from './press-stopped';
import type { ConfiguredPayments } from './processor-payments';
import { EVIDENCE_SAYS, STANDING, configuredStanding } from './processor-payments';
import { keysTrouble, noAnswer, valuesGuard } from './processor-screen';
import { recurringBlock } from './recurring-block';
import { recurringReading } from './recurring-rows';
import { useReseeded } from './reseed';
import { Said } from './said';
import { refusalIn } from './secret-trouble';
import { PAYPAL_GROUP, SECRET_GROUPS, isMasked } from './secret-groups';
import type { PressAnswer, PressPhase, PressRefusal } from './stripe-press';
import {
	answerLanded,
	answeredRefusal,
	keysClosed,
	runUnderway,
	standingRefusal,
	writingElsewhere
} from './stripe-press';
import { useConsoleForm } from './use-console-form';
import { FREE_INTENT, WithheldValues } from './withheld-values';

// the whole of PayPal on this deployment — what its account answered, the two keys that set it up,
// and the one answer about the organisation that prices a gift.
//
// **each processor has a screen, and this is PayPal's.** the two processors are alternatives and a
// deployment set up on either is set up (`CHARGE_PAIRS` in
// packages/app/src/lib/server/config/readiness.ts), so they answer to one row on the home page
// (./home-sections.ts), whose panel lists them (./processor-rows.tsx) and links here and to
// Stripe's (./stripe-section.tsx).
//
// **a processor nobody has configured draws no reading at all, and that is not a failure.** the
// deployment answers `unconfigured` carrying the names it is short of and no reading whatever
// (`ProcessorPayments` in ../api/types.ts), so what stands here for such a deployment is the boxes
// that configure it and nothing else. that is every deployment on Stripe alone, and every fresh fork.
//
// **one press sets PayPal up, and the webhook is nothing an operator types or visits.** the press
// starts a run in the binary (`packages/console/internal/paypal/setup.go`): it checks the pair,
// finds or registers the listener at this deployment's address, and writes the pair and that
// listener's id onto the deployment in one write. so `PAYPAL_WEBHOOK_ID` has no box, and the pair is
// never saved through the values door — a pair written with no listener behind it is a deployment
// whose approved orders are never captured.
//
// **the run reports itself where it was pressed**, which is the Stripe screen's arrangement
// (./stripe-section.tsx) cut to what this press is: a card goes up on the press, draws one line per
// stage, and stands while the run goes. no confirm puts itself in front of it, because nothing is
// deleted — a listener already here is kept. a run that lands is said by the button's own tick; a
// pair PayPal turned down is said at the press and puts the operator back in the boxes; every other
// stop keeps its line and the sentence naming what to do, in the card or, once no card is up, under
// the boxes.
//
// **and nothing here draws the signing-secret reading.** a PayPal delivery is verified by the
// listener's id rather than a secret (`WEBHOOK_SECRET_STANDINGS` in
// `packages/operator/src/console/payments.ts`), so a row for it would never change.
//
// **two presses and not one.** the charity rate is an answer about the organisation, given months
// after the keys are, and folding it into the set-up would make changing it a re-run of the whole
// set-up (./paypal-charity.ts).
//
// **it is the screen's body and not its route.** every read it draws was taken by the route that
// mounts it and the presses it makes are answered there. what it reaches for itself is the run while
// it goes, which is the one reading that changes while it is on screen.

/** where PayPal's own credentials are made, one press off the heading. */
const DASHBOARD = 'https://developer.paypal.com/dashboard/applications/live';

/**
 * the group this section's press writes: the two boxes, and the listener id the run stores beside
 * them. taken out of the enumeration rather than named again.
 */
const PAYPAL_WRITES = SECRET_GROUPS.filter((group) => group.id === PAYPAL_GROUP).flatMap(
	(group) => group.names
);

/**
 * what each box is called.
 *
 * PayPal's own words, with one departure: `Client secret` rather than the `Secret key` its dashboard
 * prints, because the Stripe screen draws a box called `Secret key`, and two boxes sharing an
 * accessible name across the two processors are controls a reader cannot tell apart by name.
 */
const LABEL: Record<PaypalPairName, string> = {
	PAYPAL_CLIENT_ID: 'Client ID',
	PAYPAL_CLIENT_SECRET: 'Client secret'
};

/** how often the screen asks how far the run has got. the Stripe screen's interval. */
const POLL_MS = 2500;

/** the press, named so the card can put the reader back on it when it goes. */
const SET_UP_PRESS = 'paypal-set-up-press';

/**
 * what the last press of the set-up said, as the route reads it off the action.
 *
 * the run itself is read off the loader, and what this carries is the three ways a press started
 * none: boxes refused before anything left this machine, the binary's door turning the pair down,
 * and a write the binary could not make at all.
 */
export type PaypalPress = {
	/** the setup run the binary is holding, as the page load read it. */
	run: PaypalRunRead | null;
	/** the boxes the last press came back naming, by the value's own name, or `null`. */
	refused: Record<string, string> | null;
	/** the binary's own door turned the pair down, so no run began. */
	turnedDownPair: boolean;
	/** the binary could not write anywhere, so no run began. */
	unwritten: ValuesRefusal | null;
};

export type PaypalSectionProps = {
	/** the seventeen as cloudflare answered for them, which is what the boxes are drawn with. */
	values: DeployedValues;
	/**
	 * where every processor account stands, on the promise the loader handed down.
	 *
	 * the same promise the Stripe screen awaits: one read answers for both processors, so a second
	 * request here would be two views of one deployment able to disagree.
	 */
	payments: Promise<PaymentsRead | null>;
	/** where every account stands on gifts that repeat, on the loader's other promise. */
	recurring: Promise<RecurringRead | null>;
	workerName: string;
	/** the cloudflare account every read is scoped to, named in every sentence about a refusal. */
	accountName: string;
	/** the set-up press and its run. */
	paypal: PaypalPress;
	/** how the last press of the charity-rate switch went, or `null`. */
	charity: VarsWritten | null;
	/** how the last press that frees a value held in a form nothing can read back went, or `null`. */
	freed: VarsWritten | null;
	/** how the last repeating-gifts press went, or `null` (./recurring-block.tsx). */
	provision: RecurringSetup | null;
	/** the router is re-reading the page over an answer it has already committed. */
	revalidating: boolean;
	/** something else on the page is writing, which holds every control on it closed. */
	busy: boolean;
	/** which intent is in flight, or `null` where none is. */
	pending: string | null;
};

/** what the keys form and the charity switch read, derived once from the props above. */
type Derived = {
	/** what the deployment is holding, which is what the boxes are drawn with (./held-values.ts). */
	values: HeldValues;
	/**
	 * the read `values` was taken from, as the loader handed it down.
	 *
	 * its identity is what says the page has been read again since a press (./reseed.ts): `values`
	 * is derived afresh at every render, so it cannot say that.
	 */
	reading: DeployedValues['vars'];
	/** what a failed write says (./processor-screen.tsx). */
	trouble: (written: ValuesRefusal) => ReactNode;
};

export function PaypalSection({
	values,
	payments,
	recurring,
	workerName,
	accountName,
	paypal,
	charity,
	freed,
	provision,
	revalidating,
	busy,
	pending
}: PaypalSectionProps): ReactNode {
	const guard = valuesGuard(values.vars, { workerName, accountName });
	if (guard !== null || values.vars.kind !== 'read') return guard;
	const held = heldValues(values.vars.vars);
	const trouble = keysTrouble({ workerName, accountName });
	/* the same sentence over both boundaries: what an operator is waiting on is one account's
	   readings, and two waits worded apart would be two subjects where there is one. */
	const asking = <p className="adm-hint">Asking this deployment…</p>;
	return (
		<Section>
			{/* what the account answered, drawn above the boxes that change it for the reason the Stripe
			    screen states: the reading is what an operator came to find out, and the press that
			    would rewrite it comes last. */}
			<Suspense fallback={asking}>
				<Await resolve={payments}>
					{(read) => (
						<Suspense fallback={asking}>
							<Await resolve={recurring}>
								{(gifts) => (
									<PaypalReadings
										read={read}
										gifts={gifts}
										provision={provision}
										busy={busy}
										pending={pending}
									/>
								)}
							</Await>
						</Suspense>
					)}
				</Await>
			</Suspense>

			<PaypalKeysForm
				values={held}
				reading={values.vars}
				press={paypal}
				freed={freed}
				trouble={trouble}
				workerName={workerName}
				accountName={accountName}
				busy={busy}
				pending={pending}
				revalidating={revalidating}
			/>

			<CharityRate
				values={held}
				written={charity}
				freed={freed}
				trouble={trouble}
				busy={busy}
				pending={pending}
			/>
		</Section>
	);
}

/**
 * what PayPal's own account answered, or nothing at all where it was never asked.
 *
 * **a deployment holding no PayPal credentials draws nothing up here**, exactly as the Stripe screen
 * draws nothing over a deployment holding no key: nothing was asked, so there is no row, no band and
 * no waiting sentence — and the boxes underneath are the whole truth of that state.
 *
 * **the repeating-gift block stands after the rails in a form of its own**: its one press posts an
 * intent and nothing else, so standing it in the keys form would carry two credentials through a
 * request that reads neither (./recurring-block.tsx).
 */
function PaypalReadings({
	read,
	gifts,
	provision,
	busy,
	pending
}: {
	read: PaymentsRead | null;
	gifts: RecurringRead | null;
	provision: RecurringSetup | null;
	busy: boolean;
	pending: string | null;
}): ReactNode {
	const repeats = recurringBlock({
		processor: 'paypal',
		gifts,
		provision,
		busy,
		working: false,
		pending
	});
	return (
		<>
			<PaypalAccount read={read} gifts={gifts} />
			{repeats === null ? null : (
				<Form method="post" preventScrollReset>
					{repeats}
				</Form>
			)}
		</>
	);
}

/** the account's own readings: what could not be read, and the rails. */
function PaypalAccount({
	read,
	gifts
}: {
	read: PaymentsRead | null;
	gifts: RecurringRead | null;
}): ReactNode {
	if (read === null) return null;
	if (read.kind === 'unread') {
		return noAnswer(read.read, "it can't say where this PayPal account stands");
	}
	const entry: ProcessorPayments | undefined = read.report.processors.find(
		(one) => one.processor === 'paypal'
	);
	const standing = configuredStanding(entry ?? null);
	if (standing === null) return null;
	return (
		<>
			<Unreadable standing={standing} repeats={recurringReading(gifts, 'paypal')} />
			<Rails standing={standing} />
		</>
	);
}

/**
 * the one thing to say about a read this deployment tried to make against PayPal and could not.
 *
 * **said once and never once per reading**, the same rule the Stripe screen keeps: all three go
 * through one port with one set of credentials, so several failing is one fact — drawn as a row in
 * each, an operator is told the same thing twice and has two places to look for the one sentence
 * that names what to do.
 *
 * **and nothing at all where nothing was asked**: a processor holding no credentials carries no
 * reading whatever, and this is only reached under one that does. so what stands here is a
 * deployment whose PayPal keys were rejected or whose PayPal did not answer, which is exactly the
 * state nothing else on the screen can say — a reading that did not land draws no block under this
 * and no line in the repeating-gift block after it (`recurringRows` in ./recurring-rows.ts),
 * and an operator reading that as nothing to do would leave a deployment taking no gift at all.
 *
 * the deployment's own detail goes underneath and is drawn rather than printed: it names the value
 * to fix and marks it (`@better-giving/operator/code-spans`). the account-level read's where more
 * than one failed, since that is the one whose cause the others inherit.
 */
function Unreadable({
	standing,
	repeats
}: {
	standing: ConfiguredPayments;
	/**
	 * where this account stands on gifts that repeat, and `null` where the report carries nothing for
	 * it — including the read that did not land at all, which the repeating-gift block says once.
	 */
	repeats: RecurringReading | null;
}): ReactNode {
	const unread: { says: string; detail: string }[] = [];
	if (standing.rails.state === 'unreadable') {
		unread.push({ says: 'which ways of paying it can take', detail: standing.rails.detail });
	}
	if (standing.subscription.state === 'unreadable') {
		unread.push({
			says: 'where PayPal has to report settlements',
			detail: standing.subscription.detail
		});
	}
	if (repeats?.state === 'unreadable') {
		unread.push({ says: 'whether repeating gifts are set up', detail: repeats.detail });
	}
	const first = unread[0];
	if (first === undefined) return null;
	return (
		<div className="adm-stack">
			<FieldMessage>
				This deployment couldn’t read your PayPal account, so it can’t say{' '}
				{unread.map((one) => one.says).join(' or ')}.
			</FieldMessage>
			<p className="adm-prose">
				<MarkedText text={first.detail} />
			</p>
		</div>
	);
}

/**
 * which ways of paying this PayPal account may take, and what the answer is worth.
 *
 * **a green row here says the credentials work and says nothing about the rail beside it.** PayPal
 * publishes no per-rail approval to a merchant holding only its own credentials, so every rail comes
 * back `approved` on the strength of the pair authenticating — and the deployment writes that in
 * words as each row's own note, which is why nothing is said over the ledger
 * (`EVIDENCE_SAYS` in ./processor-payments.ts).
 *
 * **so it reads the evidence the deployment sent and never the processor it is drawing.** the two
 * are the same answer today and the evidence is on the wire because they need not stay so: a
 * processor that starts publishing approvals is a ledger that gains its sentence here rather than
 * one that keeps drawing a green row with nothing over it.
 *
 * the ledger is drawn as columns for the reason the Stripe screen's is: every row is the same two
 * things, so an operator reads down a column rather than across a line.
 */
function Rails({ standing }: { standing: ConfiguredPayments }): ReactNode {
	if (standing.rails.state !== 'read') return null;
	const says = EVIDENCE_SAYS[standing.rails.evidence];
	return (
		<div className="adm-named">
			<h3>PayPal donation methods</h3>
			{says === null ? null : <p className="adm-prose">{says}</p>}
			<StatusLedger aligned>
				{standing.rails.rails.map((line) => (
					<StatusLine
						key={line.rail}
						labelAs="span"
						label={line.label}
						word={STANDING[line.standing].word}
						/* an approved rail says so with the tick and nothing else, and the word goes on to
						   the mark as its name so a reader who cannot see the shape is told what the tick
						   says — the Stripe ledger's own rule over the same shape. */
						wordOnMark={STANDING[line.standing].tone === 'done'}
						tone={STANDING[line.standing].tone}
						note={line.note === null ? undefined : <MarkedText text={line.note} />}
					/>
				))}
			</StatusLedger>
		</div>
	);
}

/**
 * the two boxes, the one press, and the run it starts.
 *
 * its own component because it holds the run's state and the form's, and the readings and the
 * charity switch beside it hold neither.
 */
function PaypalKeysForm({
	values,
	reading,
	press,
	freed,
	trouble,
	workerName,
	accountName,
	busy,
	pending,
	revalidating
}: Derived & { press: PaypalPress } & Pick<
		PaypalSectionProps,
		'freed' | 'workerName' | 'accountName' | 'busy' | 'pending' | 'revalidating'
	>): ReactNode {
	/* how far the press has got, asked of the binary rather than of the page, for the Stripe screen's
	   reason: reading the page again is every round trip on it. */
	const [polled, setPolled] = useState<PaypalRunRead | null | undefined>(undefined);
	const answered = polled === undefined ? press.run : polled;
	/* the last thing either reading said: a run that landed is consumed by the reading that observed
	   it, so the answer after that is `null` and the report would go off the screen under it. */
	const [remembered, setRemembered] = useState<PaypalRunRead | null>(null);
	useEffect(() => {
		if (answered === null) return;
		setRemembered(answered);
	}, [answered]);
	const live = answered ?? remembered;
	const working = live?.kind === 'running';
	const landed = live?.kind === 'ended' && live.outcome.kind === 'done';

	const phase = useMemo<PressPhase>(
		() => ({ pending: pending === PAYPAL_SETUP_INTENT, revalidating }),
		[pending, revalidating]
	);
	/* the binary not writing at all is the same fact about this press as the door turning the pair
	   down — no run began — so it is one of the answers that keeps the button off `Setting up`. */
	const turnedDownPair = press.turnedDownPair || press.unwritten !== null;
	const pressAnswer = useMemo<PressAnswer>(
		() => ({ turnedDownPair, refused: press.refused }),
		[turnedDownPair, press.refused]
	);
	const underway = runUnderway(phase, pressAnswer, working);
	const elsewhere = writingElsewhere(phase, busy);

	useEffect(() => {
		if (!working) return;
		let gone = false;
		const timer = setTimeout(() => {
			// a read that did not land is a console that has stopped, which the page's error boundary draws.
			void paypalRun().then((read) => {
				if (!gone) setPolled(read);
			});
		}, POLL_MS);
		return () => {
			gone = true;
			clearTimeout(timer);
		};
		// `polled` schedules the next ask: each answer is a new value, so the poll goes on with the run.
	}, [working, polled]);

	/* the page read again once, when the run stops, so the readings above are of the account this
	   press just set up. a ref rather than a dependency: the revalidator is a fresh object each render. */
	const { revalidate } = useRevalidator();
	const settled = live?.kind === 'ended';
	const asked = useRef(false);
	useEffect(() => {
		if (!settled) {
			asked.current = false;
			return;
		}
		if (asked.current) return;
		asked.current = true;
		void revalidate();
	}, [settled, revalidate]);

	/* the pair as it stood at the submit, kept once the press is in flight: that is what the deployment
	   holds the moment the run says it stored it (`pairStanding` in ./paypal-setup.ts). */
	const typed = useRef<PaypalPairBoxes | null>(null);
	const [sent, setSent] = useState<PaypalPairBoxes | null>(null);
	/** whether a press was made from this page, which is what a box-level report of a run is about. */
	const [pressedHere, setPressedHere] = useState(false);
	/* and the poll's answer dropped with the next press, or the last press's stopped run would mask
	   the one this press starts and nothing would ask after it again. */
	useEffect(() => {
		if (pending !== PAYPAL_SETUP_INTENT) return;
		setPolled(undefined);
		setPressedHere(true);
		setSent(typed.current);
	}, [pending]);

	/* what the press was turned down for, kept past the revalidations this section sets off itself —
	   the router drops the answer on each, and the boxes still hold exactly what was turned down. */
	const [rememberedRefusal, setRememberedRefusal] = useState<PressRefusal | null>(null);
	useEffect(() => {
		if (!answerLanded(phase)) return;
		const refusal = answeredRefusal(pressAnswer);
		setRememberedRefusal(refusal);
		if (refusal !== null) setSent(null);
	}, [phase, pressAnswer]);
	const pressRefusal = standingRefusal(phase, pressAnswer, rememberedRefusal);
	const namedBoxes = pressRefusal?.kind === 'boxes' ? pressRefusal.errors : null;

	/* PayPal turning the pair down, on a press made here and not while the next one is going: a run
	   survives a reload, and a reloaded page's boxes hold nothing that was sent. */
	const pairRefused = pairTurnedDown(live) && pressedHere && !underway;
	/* the door's refusal and PayPal's are one sentence about the pair; the unwritten press is its own. */
	const doorTurnedDown = pressRefusal?.kind === 'pair' && press.unwritten === null;
	const refusedPair = pairRefused || doorTurnedDown;

	const reportedId = values.seeds.PAYPAL_CLIENT_ID ?? '';
	const reportedSecret = values.seeds.PAYPAL_CLIENT_SECRET ?? '';
	const reported: PaypalPairBoxes = useMemo(
		() => ({ PAYPAL_CLIENT_ID: reportedId, PAYPAL_CLIENT_SECRET: reportedSecret }),
		[reportedId, reportedSecret]
	);
	const reread = useReseeded({ landed, pending: underway, reading });
	const { seeded, spent } = useMemo(
		() => pairStanding({ reported, sent, run: live, reread }),
		[reported, sent, live, reread]
	);
	const closed = keysClosed(phase, pressAnswer, busy, working, { landed, spent });

	/** an answer keyed by value name, carried onto the boxes by what they post. */
	const carried = (said: Record<string, string> | null): Record<string, string> | null => {
		if (said === null) return null;
		const named = PAYPAL_PAIR_NAMES.filter((name) => said[name] !== undefined);
		if (named.length === 0) return null;
		return Object.fromEntries(named.map((name) => [PAIR_FIELD(name), said[name] as string]));
	};
	/* the pair turned down handed to the seam as the far end's answer about the first box, which puts
	   the operator back in it and holds the next press until something changes. the sentence itself
	   stands at the press, since it is about both halves. */
	const pairSentence = 'Invalid client ID or secret.';

	const keys = useConsoleForm(PAYPAL_FORM, {
		report: live,
		landed,
		spent,
		refused: carried(namedBoxes ?? (refusedPair ? { PAYPAL_CLIENT_ID: pairSentence } : null)),
		defaultValue: {
			[PAIR_FIELD('PAYPAL_CLIENT_ID')]: seeded.PAYPAL_CLIENT_ID,
			[PAIR_FIELD('PAYPAL_CLIENT_SECRET')]: seeded.PAYPAL_CLIENT_SECRET
		},
		busy: elsewhere,
		pending: underway
	});
	const form = keys.mount.ref;

	/** one box bound, with a refusal about the whole pair drawn at neither box. */
	const pairBox = (name: PaypalPairName) => {
		const field = keys.fields[PAIR_FIELD(name)];
		const bound = keys.box(field);
		const said = namedBoxes === null ? field.errors?.[0] : bound.error;
		return { ...bound, message: said === undefined ? undefined : <MarkedText text={said} /> };
	};
	const clientId = pairBox('PAYPAL_CLIENT_ID');
	const secret = pairBox('PAYPAL_CLIENT_SECRET');

	/**
	 * the card the press puts up, or `null` where none is up.
	 *
	 * `pressed` is a card over a press whose run has not been read yet, and `reading` one drawing it:
	 * a stopped run stays in the binary until the next press clears it, so a card drawing whatever run
	 * was there as it went up would report the last press under this one's heading.
	 */
	const [reporting, setReporting] = useState<'pressed' | 'reading' | null>(null);
	const answering = useRef(false);
	useEffect(() => {
		if (reporting === null) {
			answering.current = false;
			return;
		}
		if (pending === PAYPAL_SETUP_INTENT) {
			answering.current = true;
			return;
		}
		if (working || answering.current) setReporting('reading');
	}, [reporting, pending, working]);

	/* the reader put back on the press when the card goes, unless the card went over an answer about
	   a box — the seam has already put them in that box. */
	const held = useRef(false);
	useEffect(() => {
		if (reporting !== null) {
			held.current = true;
			return;
		}
		if (!held.current) return;
		held.current = false;
		form.current?.querySelector<HTMLButtonElement>(`#${SET_UP_PRESS}`)?.focus();
	}, [reporting, form]);

	/* the card goes when nothing is left to read in it: a refusal that started no run, a pair PayPal
	   turned down, and a run that landed. a run that stopped anywhere else keeps it. `live` is a
	   dependency so a landed run answered twice with no running one between still closes it. */
	const unwritten = press.unwritten;
	useEffect(() => {
		if (pressRefusal === null && !landed && !pairTurnedDown(live)) return;
		if (!landed) held.current = false;
		setReporting(null);
	}, [pressRefusal, landed, live]);

	/**
	 * why there was nowhere to register or write to, in the address read's own terms.
	 *
	 * `deployed` is reached only from the registering stage — a write's refusal carries no such arm
	 * (`NoWhere` in ../api/types.ts) — so its sentence names the set-up rather than `what`.
	 */
	const nowhere = (read: AddressRead, what: string): ReactNode =>
		read.kind === 'not-deployed' ? (
			<FieldMessage>
				No Worker called {workerName} is in {accountName} any more, so {what}. Reload this page.
			</FieldMessage>
		) : read.kind === 'deployed' ? (
			<FieldMessage>
				This deployment answers on no address at all, so PayPal would have nowhere to send payments.
				Turn its <InlineCode>workers.dev</InlineCode> address back on, or attach a domain, then
				press Save again. Nothing was set up.
			</FieldMessage>
		) : (
			<>
				<FieldMessage>
					The console couldn't work out where this deployment answers, so {what}.
				</FieldMessage>
				<Said answer={read} />
			</>
		);

	/** what a PayPal call that did not answer said, with PayPal's own words underneath. */
	const paypalTrouble = (failure: PaypalFailure, what: ReactNode): ReactNode => (
		<>
			<FieldMessage>
				{failure.kind === 'refused' ? (
					<>
						PayPal wouldn’t let these keys do this, so {what}. Check the app’s permissions, then
						press Save again.
					</>
				) : failure.kind === 'unreachable' ? (
					<>
						The console couldn’t get an answer out of PayPal, so {what}. Check this machine’s
						internet connection, then press Save again.
					</>
				) : (
					<>PayPal would not do this, so {what}.</>
				)}
			</FieldMessage>
			<Said answer={failure} />
		</>
	);

	/** what stopped the run, drawn under the line whose stage it stopped at. */
	const stopped = (outcome: PaypalSetup): ReactNode => {
		switch (outcome.kind) {
			case 'done':
				return null;
			case 'console-stopped':
				return <FieldMessage>{pressStopped(REACHED_PAYPAL)}</FieldMessage>;
			case 'unauthorized':
				// a refused pair is said at the press, so what is left here is PayPal's own words.
				return outcome.failure.kind === 'refused' ? (
					<Said answer={outcome.failure} />
				) : (
					paypalTrouble(outcome.failure, 'nothing was set up')
				);
			case 'nowhere':
				return nowhere(outcome.address, 'nothing was set up');
			case 'insecure':
				return (
					<FieldMessage>
						This deployment answers on <InlineCode>{outcome.origin}</InlineCode>, and PayPal only
						sends payments to an <InlineCode>https://</InlineCode> address. Attach a domain served
						over HTTPS, then press Save again. Nothing was set up.
					</FieldMessage>
				);
			case 'unlisted':
				return paypalTrouble(
					outcome.failure,
					'the console couldn’t see which webhooks your PayPal app already has, and nothing was set up'
				);
			case 'full':
				return (
					<>
						<FieldMessage>
							Your PayPal app already has 10 webhooks, which is as many as PayPal allows, and none
							of them is for this deployment. Delete one you no longer use in your PayPal developer
							dashboard, or use another app’s keys, then press Save again. Nothing was set up.
						</FieldMessage>
						<ul className="adm-list">
							{outcome.listeners.map((listener) => (
								<li key={listener.id}>
									<InlineCode>{listener.url}</InlineCode>
								</li>
							))}
						</ul>
					</>
				);
			case 'uncreated':
				return paypalTrouble(outcome.failure, 'no webhook was added and nothing was set up');
			case 'unresubscribed':
				return paypalTrouble(
					outcome.failure,
					<>
						the webhook <InlineCode>{outcome.listenerId}</InlineCode> still listens for what it did
						before, and nothing was set up
					</>
				);
			case 'unstored':
				return (
					<>
						<FieldMessage>
							The webhook is set up on PayPal, but your keys weren’t saved, so this deployment takes
							no gift through PayPal yet. Pressing Save again keeps that webhook.
						</FieldMessage>
						{outcome.written.kind === 'withheld' ? (
							<WithheldValues
								names={outcome.written.names}
								all={values.withheld}
								consequence="Until the keys above are saved again, this deployment takes no gift through PayPal."
								written={freed}
								trouble={trouble}
								busy={busy || working}
								freeing={pending === FREE_INTENT}
							/>
						) : outcome.written.kind === 'nowhere' ? (
							nowhere(outcome.written.address, 'nothing was saved')
						) : (
							trouble(outcome.written)
						)}
					</>
				);
		}
	};

	/**
	 * the run, one line per stage.
	 *
	 * `null` is a press whose run has not been read yet, drawn at the stage the chain opens on: the
	 * card goes up on the press and the first reading arrives a revalidation later.
	 */
	const ledger = (read: PaypalRunRead | null): ReactNode => {
		const reached = lineAt(read?.stage ?? 'authorizing');
		const failed = read?.kind === 'ended';
		const tone = (at: number): Tone | 'running' | 'done' =>
			at < reached ? 'done' : at > reached ? 'note' : failed ? 'blocker' : 'running';
		const word = (at: number): string =>
			at < reached ? 'Done' : at > reached ? 'Waiting' : failed ? 'Stopped' : 'Working';
		return (
			// polite: the lines change on their own and nothing is asked of the reader.
			<div role="status">
				<StatusLedger>
					{LINES.map((line, at) => (
						<StatusLine
							key={line.stage}
							labelAs="h4"
							label={line.label}
							note={line.note}
							tone={tone(at)}
							dim={at > reached}
							mark={at > reached ? 'circle-dashed' : undefined}
							word={word(at)}
						>
							{at === reached && read?.kind === 'ended' ? (
								<div className="adm-status__attach">{stopped(read.outcome)}</div>
							) : null}
						</StatusLine>
					))}
				</StatusLedger>
			</div>
		);
	};

	/** what the two boxes hold right now. */
	const boxes = (element: HTMLFormElement): PaypalPairBoxes => {
		const value = (name: PaypalPairName) => {
			const control = element.elements.namedItem(PAIR_FIELD(name));
			return control instanceof HTMLInputElement ? control.value : '';
		};
		return {
			PAYPAL_CLIENT_ID: value('PAYPAL_CLIENT_ID'),
			PAYPAL_CLIENT_SECRET: value('PAYPAL_CLIENT_SECRET')
		};
	};

	return (
		<div className="adm-named">
			<h3>
				Your PayPal keys{' '}
				<AnchoredNote mark="info" label="Where to get your PayPal keys">
					<PaypalKeys />
				</AnchoredNote>
			</h3>

			<Form
				{...keys.mount}
				className="adm-stack"
				method="post"
				preventScrollReset
				/* the seam goes first and answers both ways a press starts nothing — the rules over the
				   boxes, and an answer still standing over one. a press past it runs on the press itself
				   and puts up the card that reports it. */
				onSubmit={(event) => {
					keys.mount.onSubmit(event);
					if (event.defaultPrevented) return;
					typed.current = form.current === null ? null : boxes(form.current);
					setReporting('pressed');
				}}
			>
				<div className="adm-stack">
					{PAYPAL_PAIR_NAMES.map((name) => {
						const box = name === 'PAYPAL_CLIENT_ID' ? clientId : secret;
						return (
							<Field
								key={name}
								id={box.id}
								name={box.name}
								label={LABEL[name]}
								code
								masked={isMasked(name)}
								autoComplete="off"
								spellCheck={false}
								defaultValue={box.defaultValue}
								disabled={closed}
								onInput={box.onInput}
								error={box.message}
							/>
						);
					})}
					<WithheldValues
						names={withheldAmong(values, PAYPAL_WRITES)}
						all={values.withheld}
						consequence="Until these are saved again, this deployment takes no gift through PayPal."
						written={freed}
						trouble={trouble}
						busy={busy || working}
						freeing={pending === FREE_INTENT}
					/>
				</div>

				{/* the pair turned down, at the press that asked and gone the moment either box is edited:
				    `standing` is the answer cut down to the boxes nobody has typed in since. */}
				{refusedPair && keys.standing?.[PAIR_FIELD('PAYPAL_CLIENT_ID')] !== undefined ? (
					<FieldMessage>{pairSentence}</FieldMessage>
				) : null}

				<div className="adm-actions">
					<SaveButton
						id={SET_UP_PRESS}
						type="submit"
						name="intent"
						value={PAYPAL_SETUP_INTENT}
						state={keys.state}
						label="Save"
						doneLabel="Set up"
						disabled={closed || undefined}
					/>
				</div>

				{/* a press the binary could not write at all, at the button that made it. */}
				{unwritten === null || phase.pending ? null : trouble(unwritten)}

				{/* a run that stopped, standing as the report of the press once no card is up — the one a
				    reload brings back included. */}
				{reportStands(live, reporting !== null) ? ledger(live) : null}

				{reporting === null ? null : (
					<Modal
						title="Setting up PayPal"
						// a run that is going cannot be left: this card is its only report.
						onDismiss={() => {
							if (underway) return;
							setReporting(null);
						}}
						exit="Close"
						exitProps={{
							type: 'button' as const,
							disabled: underway || undefined,
							onClick: () => setReporting(null)
						}}
					>
						{ledger(reporting === 'reading' ? live : null)}
					</Modal>
				)}
			</Form>
		</div>
	);
}

/**
 * whether PayPal has approved this organisation for its charity rate, as a switch with two
 * positions.
 *
 * **there is no third position and no rate is typed.** what the answer picks between is two tables
 * of published rates that stay constants in the tree (`paypalFeeRules` in
 * packages/app/src/lib/server/payments/fees.ts), and off is the value taken away rather than a
 * stored no — ./paypal-charity.ts argues both.
 *
 * **it is a fact about the account and never a preference**, which is what the label says: PayPal
 * reports it on no call, so the operator is the only party that can answer, and the deployment
 * quotes a donor covering fees off whichever table they said.
 *
 * its own press and its own form, for the reason ./paypal-charity.ts states — and one `<form>`
 * inside another is not a tree the parser keeps, so it stands beside the credentials rather than
 * inside them.
 */
function CharityRate({
	values,
	written,
	freed,
	trouble,
	busy,
	pending
}: {
	values: HeldValues;
	written: VarsWritten | null;
	/** how the last press that frees a withheld value went, drawn in the block that frees this one. */
	freed: VarsWritten | null;
	trouble: (written: ValuesRefusal) => ReactNode;
	busy: boolean;
	pending: string | null;
}): ReactNode {
	const box = `${useId()}-charity-rate`;
	const approved = charityApproved(values.seeds[CHARITY_RATE] ?? '');
	const sending = pending === CHARITY_INTENT;
	const failure = written === null ? null : refusalIn(written);

	const { form, state, onInput, onSubmit } = useSavedFormState({
		report: written,
		landed: written?.kind === 'set',
		// the switch is read off the element at every press of it, which is the reading a block with
		// no form layer takes (`SavedFormInputs.changed` in
		// packages/operator/src/saved-form-state.react.ts).
		changed: (element) => {
			const control = element.elements.namedItem(CHARITY_FIELD);
			return (control instanceof HTMLInputElement ? control.checked : false) !== approved;
		},
		busy,
		pending: sending
	});

	return (
		<div className="adm-named">
			<h3>PayPal’s charity rate</h3>
			<Form
				className="adm-stack"
				method="post"
				preventScrollReset
				ref={form}
				onInput={onInput}
				onSubmit={onSubmit}
			>
				<CheckboxGroup
					id={box}
					items={[
						{
							id: box,
							name: CHARITY_FIELD,
							value: CHARITY_APPROVED,
							label: 'PayPal has approved this organisation for its charity rate',
							// the consequence of getting it wrong, which is the one thing the label cannot
							// carry and the one direction that costs the organisation money: the two tables
							// are asymmetric, and `paypalFeeRules` in
							// packages/app/src/lib/server/payments/fees.ts is where that is argued. what the
							// switch is for is the heading over it, so nothing here says it again.
							note: 'Ticked without PayPal’s approval, a donor covering the fee is quoted less than PayPal takes and this organisation makes up the difference.',
							defaultChecked: approved,
							// closed while this press is in flight and while another press on the page
							// writes: the position is read once, at the press.
							disabled: busy || sending
						}
					]}
				/>

				{/* the name in this state has no box to be typed out of, and this press is the only one
				    that writes it — so the block that frees it stands here or nowhere. */}
				<WithheldValues
					names={withheldAmong(values, [CHARITY_RATE])}
					all={values.withheld}
					consequence="Until this is saved again, every donor covering a PayPal fee is quoted the standard rate."
					written={freed}
					trouble={trouble}
					busy={busy}
					freeing={pending === FREE_INTENT}
				/>

				<div className="adm-actions">
					<SaveButton name="intent" value={CHARITY_INTENT} state={state} />
				</div>

				{/* an outcome reports at the control that made it, and a press that landed is the
				    button's own tick — so what is left is the ways it did not happen. a press refused
				    over a name held as a credential is drawn at the block above, which is where the way
				    out of that state is (`refusalIn` in ./secret-trouble.tsx). */}
				{failure === null ? null : trouble(failure)}
			</Form>
		</div>
	);
}

/**
 * where PayPal's two keys come from.
 *
 * the one fact a box cannot carry — that both are on one app in PayPal's developer dashboard, and
 * which dashboard. ./stripe-section.tsx's `StripeKeys` says the same kind of thing about the other
 * processor.
 */
function PaypalKeys(): ReactNode {
	return (
		<p>
			Make a live app in your PayPal developer dashboard:{' '}
			<a href={DASHBOARD} target="_blank" rel="noreferrer">
				Apps &amp; Credentials &rarr; Live
			</a>
			. The client ID and the secret key are both on that app.
		</p>
	);
}
