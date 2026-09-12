import { AnchoredNote } from '@better-giving/operator/behaviour/AnchoredCard';
import { AnchoredPanel } from '@better-giving/operator/behaviour/AnchoredPanel';
import { Modal } from '@better-giving/operator/behaviour/Dialog';
import type { Tone } from '@better-giving/operator/components/closed-sets';
import { Button } from '@better-giving/operator/components/controls/Button';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { CodeChip, InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { Disclosure } from '@better-giving/operator/components/data/Disclosure';
import { SettingRow } from '@better-giving/operator/components/data/SettingRow';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { Section } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import {
	StatusLedger,
	StatusLine,
	StatusStep
} from '@better-giving/operator/components/status/StatusLine';
import type { RailStanding } from '@better-giving/operator/console/payments';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import {
	SUBSCRIBED_EVENT_TYPES,
	webhookEndpointUrl
} from '@better-giving/operator/stripe/webhook-endpoint';
import type { ReactNode } from 'react';
import { Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Await, Form, useRevalidator } from 'react-router';
import { stripeRun } from '../api/client';
import { REACHED_STRIPE, pressStopped } from './press-stopped';
import { Said } from './said';
import { refusalIn, secretTrouble } from './secret-trouble';
import { heldValues, withheldAmong } from './held-values';
import { PAYMENTS_GROUP, SECRET_GROUPS, MINTED_BY_CONSOLE, isMasked } from './secret-groups';
import { FREE_INTENT, WithheldValues } from './withheld-values';
import type {
	AddressRead,
	DeployedValues,
	NoReport,
	PaymentsRead,
	RailLine,
	RecurringRead,
	RecurringSetup,
	Wallet,
	WalletHostLine,
	WalletsLevel,
	StripeFailure,
	StripeNamed,
	StripeRunRead,
	DeployVarName,
	StripeSetup,
	VarsUnwritten,
	VarsWritten
} from '../api/types';
import type { ConfirmLine } from './stripe-confirm';
import { confirmLines, remakesSetup } from './stripe-confirm';
import { useReseeded } from './reseed';
import type { KeysSent, PressAnswer, PressPhase, PressRefusal } from './stripe-press';
import {
	answerLanded,
	answeredRefusal,
	keysClosed,
	keysStanding,
	reportStands,
	runUnderway,
	secretStored,
	standingRefusal,
	writingElsewhere
} from './stripe-press';
import type { StripeAct, StripeKeyBoxes, StripeKeyName } from './stripe-keys';
import { KEY_FIELD, SET_UP_INTENT, STRIPE_KEY_NAMES, stripeAsked, stripeForm } from './stripe-keys';
import { useConsoleForm } from './use-console-form';
import { unreadAnswer } from './unread-answer';
import { OPENING_STAGE, PUBLISHED, REACHED, STAGES, STEP, SUBJECTS } from './stripe-run-lines';
import { WALLETS_INTENT } from './wallets-press';
import type { WalletRow, WalletRowStanding, LinkStanding } from './wallet-rows';
import { linkStanding, walletHostLines, walletRows } from './wallet-rows';

// the whole of Stripe on this deployment — two boxes, one press, and what the account is approved
// for — read and set inside the second fold of the one page.
//
// **it is one form and one press because there is one errand.** an operator holding the two keys off
// one Stripe screen has already decided everything the rest of the setup needs, so the press does
// the rest: it names the account back, registers the webhook endpoint at the address it derives,
// stores the signing secret that registration returns, publishes the publishable key, and puts the
// item a repeating gift is collected against on the account. no terminal step, no second band of
// boxes for the same three values, and nobody is shown a `whsec_`.
//
// **the operator need not know about webhooks, and nothing on this fold asks them to.** the
// endpoint, the events it is subscribed to and the secret that proves a delivery came from Stripe
// are all things the press establishes from the two keys, so none of them is a row, a reading or a
// repair press here. what an operator is told about them is one line in the confirm, at the moment
// it changes whether they press.
//
// **the boxes arrive holding what the deployment holds.** both keys are plain vars and the account
// hands each value back (`DEPLOY_VARS` in packages/operator/src/deploy-split.ts), so an operator
// reads the keys their deployment is actually charging on and can check a paste against the page
// they copied it from — which is the one thing they opened the fold to do.
//
// **what the press does follows from those two boxes and from nothing else.** the seed coming back
// unchanged is the secret key left alone, an emptied box is the key taken away, and a typed
// one runs the whole errand against the pair — the three acts ./stripe-keys.ts enumerates,
// `stripeAsked` reads to itemise the confirm, and ./stripe-edits.ts reads against what the
// deployment says it is holding.
//
// **what arms the press is a wider reading than those three, and deliberately.** the button is
// armed by either box differing from the seed it was drawn with, which is the form layer's own
// reading (./use-console-form.ts) and not the act above: an emptied publishable box asks for a
// removal this console has no errand for, so it is no act at all — and a button armed off the acts
// rests closed over it with nothing on the screen saying why. armed, the press reaches this form's
// own rules and is turned down under the box itself.
//
// **a press that takes something away asks before it does any of it, and the question is where the
// whole explanation is.** what such a press costs is stated against the operator's own boxes at the
// moment it changes whether they press — one line per value it touches, the credential nobody typed
// included. ./smtp-fold.tsx asks the same way and for the same reason.
//
// **the first set-up is not one of them, and it runs on the press itself.** there is nothing to
// agree to: every value it touches is one this deployment does not hold, no endpoint is deleted and
// no credential is replaced, so a card between Save and the run asks an operator to confirm the
// press they have just made. what separates the two is ./stripe-confirm.ts's `remakesSetup`, which
// reads whether any line of the confirm replaces something — and what that press puts up instead is
// the run's own report, which asks nothing and answers nothing.
//
// **the press reports itself step by step, because it is several round trips against three hosts.**
// it starts a run in the binary and answers at once; this fold asks that run how far it has got
// (`stripeRun` in ../api/client.ts) and draws the lines ./stripe-run-lines.tsx names — all three
// for an errand, and for a publish the one line that act has of its own. it is the arrangement the
// Creating screen is built on: one awaited request is a button that says `Setting up` with nothing
// under it saying which part is running. the removal is neither: one call and seconds, so it
// reports at the button that made it.
//
// **a failure reports once, at the line the run stopped under.** the chain carries the stage it
// stopped at, so the sentence naming what to do is attached to the subject it is about rather than
// printed at the head of the fold.
//
// **and the lines fill in where the press was made, which is the top layer for every run a press on
// this page started.** a confirm that was put up stays up while the run it started is going, so
// nobody watches a card vanish and a list appear somewhere else; a first set-up puts no confirm up
// and gets a card carrying that same ledger and no question at all. both are left on a refused pair,
// which sends the operator back to a box; on a removal, which reports at the button; and on a run
// that landed, which the button's own tick and the re-read readings above already say. both stand on
// a run that stopped, because the sentence naming what to do next belongs where the press was.
//
// **and the top layer is the only place it stands.** the ledger is a press reporting itself while it
// runs, so it belongs to the press and goes with it: what the fold itself says is where this
// deployment stands now — the two readings above the boxes, the endpoint below them, and the word
// beside the fold's own heading. a run is the binary's own memory and survives a reload, and drawn
// under the boxes for that it is a progress list an operator arrives to over a press they did not
// make and cannot finish, standing where the settled readings say the same thing better.
//
// **the card stands from the press itself, and its first line is the key check.** the first thing
// the chain does is hand the secret key to Stripe (`naming` in `packages/console/internal/stripe`),
// which is seconds of a press with nothing under it saying what is being waited on — so the card
// goes up on the press, drawing that stage as the one working and the two lines after it as
// waiting, and the run's first reading lands on the same drawing (`OPENING_STAGE` in
// ./stripe-run-lines.tsx).
//
// **a run that stopped at the key check then draws no ledger anywhere**, in the top layer or under
// the boxes: nothing was registered and nothing was stored, so there is no account of an errand to
// give. what reports it is the box, which is the one thing that has to change, and the card goes so
// that the operator is left standing in it.
//
// **the two readings only the deployment can give stand at the head of the fold, above the boxes.**
// which ways of paying the account is approved for, and where it stands on gifts that repeat. they
// are what an operator opening this fold came to find out — where a deployment already holding its
// keys stands — and the boxes underneath are what changes it, so the reading comes first and the
// press that would rewrite it comes last. they are short enough to stand as themselves now that
// nothing about the endpoint is among them, and a summary line over two ledgers would be a
// disclosure an operator has to open to find out there was nothing behind it.
//
// **a fold with neither of them draws nothing up there at all** — no band, no empty form, no
// waiting sentence. that is every deployment being set up for the first time, which is the state
// where the space above the boxes is worth most.
//
// **and they are asked for again after a run that stored the key.** the store reaches cloudflare's
// edge a moment after the run reports done, and a deployment asked in between answers as one
// holding no key at all — which is the pair of readings this fold draws nothing for, so a set-up
// that worked would show no sign of it until the page was read again (`REREADS` below).
//
// **the account name stands above them and is the one reading up there that is not permanent.** it
// comes out of the last run's facts and nothing else holds it, so it is drawn after a press in this
// session and is absent on a page load. the whole of that is beside the draw itself.
//
// **they stand in a form of their own.** the one press among them provisions what a repeating gift
// is collected against and posts an intent and nothing else, so the keys form is not where it
// belongs: a press standing there would carry two credentials through a request that reads neither.
//
// **it is a component and not a screen.** every read it draws was taken by ../routes/_index.tsx and
// the presses it makes are answered there; what this holds is the boxes, the press and the sentences
// each answer is said in. which fold this is — its label, its tone, the word beside it and what
// standing undone costs — is decided in ./home-sections.ts with the other four.
//
// **the two names every read is scoped to and the thirteen values arrive as props.** what this
// fold reaches for itself is the run, which is the one reading that changes while it is on screen —
// everything else was taken by ../routes/_index.tsx and is handed down.

/**
 * what the press that provisions repeating gifts posts.
 *
 * it survives the one press above it because it is a different act and a cheaper one: the item can
 * be archived or deleted on the Stripe dashboard long after a deployment is set up, and asking the
 * deployment to put it back costs a request where re-pasting the keys costs a re-registration and a
 * deploy. a literal of this fold's own rather than a member of ../stripe-keys.ts, because only this
 * fold and the `action` answering it need the word: the reader it reaches takes no body at all.
 */
export const RECURRING_INTENT = 'recurring';

/**
 * the press that runs the errand, named so the report card can put the reader back on it.
 *
 * the card is lifted a tick after the press, by which time the button is closed and the browser has
 * already moved the reader to the document — so the restoration
 * packages/operator/src/behaviour/Dialog.tsx makes is onto nothing, and a card that went would leave
 * them at the top of the page. the press is where they were standing, and on a run that stopped it
 * is the control the card's own sentence sends them back to.
 */
const SET_UP_PRESS = 'stripe-set-up-press';

/**
 * the form the two readings' own presses post through, named so a press outside it can reach it.
 *
 * a wallet's panel is portaled to the document body (`AnchoredPanel` in
 * `packages/operator/src/behaviour/AnchoredPanel.tsx`), so the Register press inside it is nowhere
 * near the form it belongs to and a submit that named no form would reach nothing at all. the
 * `form` attribute is what puts it back, which is the same attribute `RowControl` in
 * `packages/operator/src/components/forms/RepeatingRows.jsx` carries for the same reason.
 */
const READINGS_FORM = 'stripe-readings-form';

/** how often this fold asks how far the run has got. the Creating screen's interval. */
const POLL_MS = 2500;

/**
 * how long the fold waits before reading the deployment again once a run has stored the key, and —
 * by its length — how many times it is willing to.
 *
 * **the wait is cloudflare's edge and not this console's.** the store lands seconds before the run
 * reports done and the edge picks it up a moment later, so a deployment asked in between answers
 * every Stripe read as one it had no key to make (`awaitingKey` in ../api/types.ts) — and both
 * readings at the head of this fold draw nothing for that, deliberately. one reading taken the
 * instant the run stops very often falls inside that moment, and what an operator is left looking
 * at is the fold they pressed in, unchanged, until they reload the page.
 *
 * front-loaded and bounded: the edge is usually there within a second or two, and a deployment
 * still answering `no key` half a minute later is not behind — it is something this console cannot
 * name from here. what happens at the end of it is nothing at all: the fold goes on drawing no line
 * for a deployment answering that it holds no key, which is what it draws for that answer anyway.
 */
const REREADS: readonly number[] = [1500, 3000, 5000, 8000, 12000];

/**
 * whether both readings came back saying this deployment holds no Stripe key.
 *
 * `null` is the read nobody made — ../routes/_index.tsx asks for neither where the secrets list
 * says there is no key — and `no_key` is the deployment saying so itself
 * (`packages/operator/src/console/stripe-read.ts`). those two are the whole of what this fold draws
 * nothing for, which is what makes them the thing to wait on: every other answer is one it has a
 * line for.
 */
const withoutKey = (payments: PaymentsRead | null, gifts: RecurringRead | null): boolean => {
	const rails = payments?.kind === 'read' ? payments.report.rails : null;
	const standing = gifts?.kind === 'read' ? gifts.reading : null;
	return (
		(payments === null || (rails?.state === 'unreadable' && rails.reason === 'no_key')) &&
		(gifts === null || (standing?.state === 'unreadable' && standing.reason === 'no_key'))
	);
};

/**
 * the two credentials one press of this fold writes, taken out of the enumeration rather than named
 * again.
 *
 * one of them has a box and one does not, and `MINTED_BY_CONSOLE` in ./secret-groups.ts is which:
 * the signing secret is issued by Stripe when the endpoint is registered and is stored in the same
 * breath, so a box for it would be a box nobody can correctly fill and a row for it would be a
 * reading about a webhook. where it is stated is the confirm, which is the one place this fold says
 * which credentials the press touches — and there it is a line the press is about to write rather
 * than machinery an operator is asked to hold in their head.
 */
const PAYMENTS_CREDENTIALS = SECRET_GROUPS.filter((group) => group.id === PAYMENTS_GROUP);

/** the one in that group no box asks for, which is what the confirm states beside the boxes. */
const MINTED = PAYMENTS_CREDENTIALS.flatMap((group) =>
	group.names.filter((name) => MINTED_BY_CONSOLE.includes(name))
);

/**
 * the three names one press of this fold writes, which is what its withheld block is about.
 *
 * it is the group plus the publishable key rather than the group alone: that key is in no group —
 * it is no credential and the enumeration files it among the values no group's press sets
 * (`UNGROUPED_VARS` in ./deploy-vars.ts) — and this press stores it with the two beside it, so a
 * block scoped to the group would leave it withheld with the press that frees it drawn nowhere.
 * `withheldInGroup` in ./held-values.ts is what every other fold reads, and this is the same
 * reading over the list this press actually writes.
 */
const PAYMENTS_WRITES: readonly string[] = [...STRIPE_KEY_NAMES, ...MINTED];

/**
 * what each value the confirm states is called there, in a fundraiser's words.
 *
 * the two credentials and the var beside them. the labels for the boxes are the labels above the
 * boxes themselves, so an operator reading a line back finds the box it is about.
 */
const LABEL: Record<string, string> = {
	STRIPE_SECRET_KEY: 'Secret key',
	STRIPE_WEBHOOK_SECRET: 'Signing secret',
	STRIPE_PUBLISHABLE_KEY: 'Publishable key'
};

/**
 * what the repeating-gifts line is called.
 *
 * a cadence rather than a product name: what a fundraiser has to know is that a donor can ask to
 * give again every month or every year, and the single item Stripe collects it against is the
 * mechanism under that.
 */
const RECURRING_LABEL = 'Monthly and yearly';

const DASHBOARD = 'https://dashboard.stripe.com/apikeys';

/**
 * what the confirm asks, and the word on the control that answers it — one pair per act.
 *
 * each names what the press does rather than the form it is on, because the three are three
 * different presses under one button: the whole errand, the deploy alone, and a taking-away.
 */
const ASKS: Record<StripeAct, { title: string; press: string }> = {
	errand: { title: 'Set up Stripe with these keys?', press: 'Set it up' },
	publish: { title: 'Publish this key to your deployment?', press: 'Publish it' },
	remove: { title: 'Take Stripe off this deployment?', press: 'Take it off' }
};

export type PaymentsFoldProps = {
	/** the thirteen as cloudflare answered for them, which is what every reading here is drawn from. */
	values: DeployedValues;
	/**
	 * where the account stands, or `null` where that read was never taken.
	 *
	 * what this fold draws off it is the ways of paying. the report carries the endpoint's own
	 * readings as well and nothing here reads them: they are machinery this press establishes, and
	 * `packages/console/internal/deployment/payments.go` is where they still answer for.
	 *
	 * a promise rather than a value: it goes through the deployment's own console surface, and the
	 * boxes are drawn out of what cloudflare said without waiting for it.
	 */
	stripeAccount: Promise<PaymentsRead | null>;
	/** where the account stands on gifts that repeat, through the same door and on its own promise. */
	recurring: Promise<RecurringRead | null>;
	workerName: string;
	/** the cloudflare account every read is scoped to, named in every sentence about a refusal. */
	accountName: string;
	/**
	 * where this deployment answers, which is the origin the webhook address is built from.
	 *
	 * **it is never empty here, and that is why nothing below draws a state for an absent one.** the
	 * address is read off the cloudflare account under the worker's own name and the reading is what
	 * decides which face the page draws: an origin that came back empty, and every read of it that
	 * did not land, are the blocked face and no fold at all
	 * (`assemble` in `packages/console/internal/deployment/home.go`). a fold on the screen is a
	 * deployment whose address was read.
	 *
	 * it is the address as it stands now rather than the one the last registration used, and the two
	 * part company where a domain is attached after a set-up — which the press above repairs, since
	 * it derives the address afresh and registers again (`webhookEndpointUrl` in
	 * `packages/operator/src/stripe/webhook-endpoint.ts`).
	 */
	address: string;
	/** which boxes the last press came back naming, or `null`. nothing left this machine. */
	refused: Record<string, string> | null;
	/**
	 * the last press was turned down at the binary's own door, so no run began.
	 *
	 * it is the one reading the binary keeps about the published slot, whatever the browser did with
	 * the boxes (`asking` in `packages/console/internal/server/stripe.go`) — and what it says about
	 * the pair is what a key Stripe refuses says, so the fold draws one sentence for both.
	 */
	turnedDownPair: boolean;
	/**
	 * the router is re-reading the page over an answer it has already committed, which is the one
	 * phase in which {@link PaymentsFoldProps.refused} and {@link PaymentsFoldProps.turnedDownPair}
	 * are about the press just made.
	 *
	 * the posted intent alone cannot say that: it is carried through the re-read as well as through
	 * the request, so during a new press's own request the two above are still the press before it.
	 * ./stripe-press.ts is that reading and why it is needed.
	 */
	revalidating: boolean;
	/** the setup run the binary is holding, as the page load read it. */
	run: StripeRunRead | null;
	/**
	 * how the press that takes the two credentials off the deployment went, or `null`.
	 *
	 * only the removal answers here. the other two acts are read a stage at a time off the run
	 * above, so this carries the one act that is a single call.
	 */
	removed: VarsWritten | null;
	/** how the last press that frees a value held in a form nothing can read back went, or `null`. */
	freed: VarsWritten | null;
	/** how the last repeating-gifts press went, or `null`. */
	provision: RecurringSetup | null;
	/**
	 * how the last press that registers the sites wallet buttons are drawn on went, or `null`.
	 *
	 * it is the fold's own press and never the sites fold's: that one levels the same registrations
	 * behind the list it stores and reports it there. this is the repair for a custom domain attached
	 * to the worker after a setup, which no earlier press can have known about
	 * (../lib/wallets-press.ts).
	 */
	wallets: WalletsLevel | null;
	/** something else on the page is writing, which holds every control on it closed. */
	busy: boolean;
	/** which intent is in flight, or `null` where none is. */
	pending: string | null;
};

export function PaymentsFold({
	values,
	stripeAccount,
	recurring,
	workerName,
	accountName,
	address,
	refused,
	turnedDownPair,
	revalidating,
	run,
	removed,
	freed,
	provision,
	wallets,
	busy,
	pending
}: PaymentsFoldProps): ReactNode {
	/* how far the press has got, asked of the binary rather than of the page: reading the page again
	   is every round trip on it, one of them against the deployment this run is setting up. */
	const [polled, setPolled] = useState<StripeRunRead | null | undefined>(undefined);
	const answered = polled === undefined ? run : polled;

	/* the last thing either reading said, kept here rather than read off whichever answered last.
	   a run that landed is consumed by the reading that observed it, so the answer after that is
	   `null` on both doors — and the report an operator is looking at would go off the screen under
	   them. what clears this is the next press, which arrives as a run that is running again. */
	const [remembered, setRemembered] = useState<StripeRunRead | null>(null);
	useEffect(() => {
		if (answered === null) return;
		setRemembered(answered);
	}, [answered]);
	const live = answered ?? remembered;
	const working = live?.kind === 'running';
	/* where the router is with this fold's own press, and what it answered. the two are only
	   meaningful together (./stripe-press.ts), and they are held as one value each so that the
	   memory below can be keyed on them. */
	const phase = useMemo<PressPhase>(
		() => ({ pending: pending === SET_UP_INTENT, revalidating }),
		[pending, revalidating]
	);
	const pressAnswer = useMemo<PressAnswer>(
		() => ({ turnedDownPair, refused }),
		[turnedDownPair, refused]
	);
	/* this fold's own press under way, which is the request in flight and then whatever the answer
	   said: the request that starts the run answers at once and the reading that says the run is
	   going arrives a revalidation later, so between them neither flag is true on its own and a card
	   guarded by `working` alone would be dismissable in the gap. a press the door or the boxes
	   turned down began no run at all, and this is what keeps the button off `Setting up` over it
	   for the length of the re-read. */
	const underway = runUnderway(phase, pressAnswer, working);
	/** the rest of the page writing, which is what the seam means by its own `busy`. */
	const elsewhere = writingElsewhere(phase, busy);

	useEffect(() => {
		if (!working) return;
		let gone = false;
		const timer = setTimeout(() => {
			// the run is the binary's own memory, so a read that did not land is a console that has
			// stopped — which the page's own error boundary draws. nothing here has a state for it.
			void stripeRun().then((read) => {
				if (!gone) setPolled(read);
			});
		}, POLL_MS);
		return () => {
			gone = true;
			clearTimeout(timer);
		};
		// `polled` is what schedules the next ask: each answer is a new value, so the effect runs
		// again and the poll goes on for as long as the run does.
	}, [working, polled]);

	/* and dropped the moment another press is made. a poll's answer stands in front of the run prop
	   for as long as it is held, so the last press's stopped run would mask the one this press
	   starts — and with nothing reading as running, nothing would ever ask after it again. */
	useEffect(() => {
		if (pending !== SET_UP_INTENT) return;
		setPolled(undefined);
	}, [pending]);

	/* the page read again once, when the run stops. what it is read for is the reading at the head
	   of the fold: the account this press just set up is one only the deployment can report on, and
	   the answer on screen was taken before any of it existed. the flag is a ref rather than a
	   dependency because the revalidator is a fresh object on every render — read as one, this would
	   revalidate the page for as long as the report stayed up. */
	const revalidator = useRevalidator();
	const settled = live?.kind === 'ended';
	/** whether the run that stopped had stored the secret key by the time it did. */
	const storedKey = secretStored(live);
	const asked = useRef(false);
	useEffect(() => {
		if (!settled) {
			asked.current = false;
			return;
		}
		if (asked.current) return;
		asked.current = true;
		void revalidator.revalidate();
	}, [settled, revalidator]);

	/* and asked for again, for as long as the deployment answers that it is holding no key.
	   `REREADS` is why: the one reading above is taken the instant the run stops, which is
	   very often before cloudflare's edge has picked the key up — and the answer to that reading is
	   two readings this fold draws nothing for, so an operator whose set-up worked sees no sign of
	   it until they reload.

	   the promises are what this waits on rather than the run: they are handed down fresh by every
	   revalidation, so each answer is what schedules the next ask — and a fold that is drawing
	   something already asks for nothing. the count is a ref because nothing on the screen is drawn
	   from it.

	   the press itself is taken out of the object holding it: that object is remade every time the
	   revalidation state changes — twice per ask — so an effect keyed on it would clear and restart
	   its own wait, while the function inside it is the router's own and does not move. */
	const { revalidate } = revalidator;
	const rereads = useRef(0);
	useEffect(() => {
		if (!storedKey) {
			rereads.current = 0;
			return;
		}
		const wait = REREADS[rereads.current];
		if (wait === undefined) return;
		let gone = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		void Promise.all([stripeAccount, recurring]).then(
			([payments, gifts]) => {
				if (gone || !withoutKey(payments, gifts)) return;
				timer = setTimeout(() => {
					rereads.current += 1;
					void revalidate();
				}, wait);
			},
			// a read that threw is the page's error boundary's, and this fold is off the screen by then.
			() => {}
		);
		return () => {
			gone = true;
			clearTimeout(timer);
		};
	}, [storedKey, stripeAccount, recurring, revalidate]);

	/** what this deployment holds, or `null` where that read did not land (./held-values.ts). */
	const holding = values.vars.kind === 'read' ? heldValues(values.vars.vars) : null;
	const stored: ReadonlySet<string> | null = holding?.held ?? null;

	/* what the deployment reported for each of the two names, and nothing at all where it holds
	   none. what a box is actually drawn with is this or the press's own answer ({@link seeded}).

	   held as one value rather than built at every render: what the rules are mounted for is drawn
	   from these two strings ({@link seeded}, and then {@link stated}), so a schema rebuilt at every
	   keystroke is work with no answer of its own. */
	const reportedSecret = holding?.seeds.STRIPE_SECRET_KEY ?? '';
	const reportedPublishable = holding?.seeds.STRIPE_PUBLISHABLE_KEY ?? '';
	const reported: StripeKeyBoxes = useMemo(
		() => ({
			STRIPE_SECRET_KEY: reportedSecret,
			STRIPE_PUBLISHABLE_KEY: reportedPublishable
		}),
		[reportedSecret, reportedPublishable]
	);

	/**
	 * the sentence that stands while the deployment is being asked, and nothing where it was not
	 * asked at all.
	 *
	 * ../routes/_index.tsx resolves both readings to `null` without a round trip where this
	 * deployment holds no secret key, and it decides that off this same list of secrets — so on
	 * that path the promises are settled before the fold is drawn, and a waiting sentence would be
	 * one render of a fold saying it is asking after something it asked nobody about.
	 */
	const asking = stored?.has('STRIPE_SECRET_KEY') ? (
		<p className="adm-hint">Asking this deployment…</p>
	) : null;

	/** what the two boxes are holding right now, in the shape `stripeAsked` reads them in. */
	const boxes = (form: HTMLFormElement): StripeKeyBoxes => ({
		STRIPE_SECRET_KEY:
			(form.elements.namedItem(KEY_FIELD('STRIPE_SECRET_KEY')) as HTMLInputElement | null)?.value ??
			'',
		STRIPE_PUBLISHABLE_KEY:
			(form.elements.namedItem(KEY_FIELD('STRIPE_PUBLISHABLE_KEY')) as HTMLInputElement | null)
				?.value ?? ''
	});

	const landed = live?.kind === 'ended' && live.outcome.kind === 'done';

	/**
	 * a run that stopped at the key check, whatever stopped it.
	 *
	 * **the first thing the chain does is hand the secret key to Stripe** (`naming` in
	 * `packages/console/internal/stripe`), so a key Stripe will not take stops the run before
	 * anything is registered or stored — which makes it the one stop that is a box being wrong
	 * rather than an errand going wrong, and the box is where an operator has to go.
	 *
	 * so no card may report it, and this is what takes down the one the press put up. it is the same
	 * door {@link PaymentsFoldProps.refused} comes through, and what it buys is what that already
	 * buys: the sentence under the box, focus in it, and the next press held back until something in
	 * it changes (./use-console-form.ts). the two never stand together — a pair the shapes refused
	 * made no Stripe call at all (./stripe-edits.ts).
	 *
	 * the sentence is short and Stripe's own words are not in it: those are drawn verbatim under the
	 * line that stopped ({@link stopped}), where there is room for them.
	 *
	 * `REACHED` is 0 for that one stage and 1 or 2 for every other, so this is the mapping read
	 * rather than a second list of which stage is first (./stripe-run-lines.tsx).
	 */
	const stoppedAtKeys = live?.kind === 'ended' && REACHED[live.stage] === 0;

	/**
	 * whether a set-up press has been made from this page.
	 *
	 * **a run outlives the page it was pressed on**: it is the binary's own memory and the loader
	 * hands it back on the next read, so a fold drawn over a reload is holding the answer to a press
	 * whose boxes are gone. what such an answer says about a box is about a value this form is no
	 * longer holding — the box is back to its seed, and marking it is a refusal about nothing, with
	 * focus pulled into it on arrival.
	 *
	 * so the box-level report of a run is this fold's own press reporting itself, and what a reload
	 * arrives to instead is the settled readings: the two above the boxes, the endpoint below them,
	 * and the word beside the fold's heading.
	 */
	const [pressedHere, setPressedHere] = useState(false);
	/**
	 * and what that press carried, which is what the deployment is holding the moment it says it
	 * stored it ({@link seeded}).
	 *
	 * taken when the navigation carrying the intent begins rather than when the form is submitted: a
	 * press that asks first is stopped at the form and goes from inside the card, and one the
	 * operator answers by closing that card never goes at all — so the submit is where the pair is
	 * read and the press going into flight is where it is kept.
	 */
	const [sent, setSent] = useState<KeysSent | null>(null);
	const typed = useRef<KeysSent | null>(null);
	useEffect(() => {
		if (pending !== SET_UP_INTENT) return;
		setPressedHere(true);
		setSent(typed.current);
	}, [pending]);

	/* what this press was turned down for, kept here rather than read off the answer at every render.
	   the router drops that answer on any revalidation that is not the submission's own, and this
	   fold sets two off by itself — when the run settles, and while it waits for cloudflare's edge to
	   pick the key up — so the sentence would go while the boxes still held exactly what was turned
	   down, and the press over them would stop being held back with it. the same shape the run above
	   is kept in, and for the same reason.

	   what an edit does to it is nothing: the seam lifts both the sentence and the hold-back
	   when the box it named is typed in, which is the rule that decides when a refusal has stopped
	   being true. what drops it is the next press (./stripe-press.ts). */
	const [rememberedRefusal, setRememberedRefusal] = useState<PressRefusal | null>(null);
	useEffect(() => {
		if (!answerLanded(phase)) return;
		const refusal = answeredRefusal(pressAnswer);
		setRememberedRefusal(refusal);
		// and the pair dropped with it: a press turned down at the door or over a box started no run,
		// so what it carried is on no deployment and a run still on the page is an earlier press's.
		if (refusal !== null) setSent(null);
	}, [phase, pressAnswer]);
	const pressRefusal = standingRefusal(phase, pressAnswer, rememberedRefusal);
	/** the boxes the last press was answered with, whether the page is still carrying that answer. */
	const namedBoxes = pressRefusal?.kind === 'boxes' ? pressRefusal.errors : null;
	/** and the door's own refusal, which names no box and is one sentence about the pair. */
	const doorTurnedDown = pressRefusal?.kind === 'pair';

	const turnedDown =
		live?.kind === 'ended' &&
		live.outcome.kind === 'unnamed' &&
		live.outcome.failure.kind === 'refused'
			? live.outcome.failure
			: null;
	const keyTurnedDown =
		turnedDown !== null &&
		// a press made here, on these boxes. a run is the binary's own memory and survives a reload,
		// and the boxes a reload draws hold nothing that was ever sent — so the same answer, drawn
		// then, marks a box the operator has not typed in and pulls them into it on arrival.
		pressedHere &&
		// and not while this fold's own press is going: the answer it is drawn from is about the key
		// the press before this one carried, and the box under it is holding the one being tried now.
		!underway;
	/* what the press found out about the pair, drawn at that press rather than under a box.

	   **it is about the pair and not about one of them.** the call is made with the secret key, so
	   Stripe names that one — but a key it will not take is very often a key copied off a page that
	   is not this account's, and the other box was filled from the same page and is checked by
	   nothing, here or anywhere else. a mark on the secret box alone sends an operator to fix half
	   of what is wrong.

	   **it says what is wrong and never what to do about it.** where the keys are is a sentence the
	   note beside the heading already gives, on the screen the whole time and not only after a press
	   went wrong; repeated here it is a refusal that spends three lines telling an operator holding
	   two strings off one dashboard page to go and hold them again. */
	const keyRefusal: ReactNode = !keyTurnedDown && !doorTurnedDown ? undefined : 'Invalid key pair.';
	/* and the same refusal handed to the seam as the far end's own answer, which is what puts the
	   operator in the box Stripe named and holds the next press back until something in it changes
	   (./use-console-form.ts). only the name is read off it — the sentence is {@link keyRefusal},
	   standing at the press — so no box is marked over it ({@link keyBox}). */
	const keyRefused: Record<string, string> | null =
		keyTurnedDown || doorTurnedDown ? { STRIPE_SECRET_KEY: 'Invalid key pair.' } : null;

	/**
	 * an answer from the far end carried onto the boxes this form draws, or `null` where it named
	 * none of them.
	 *
	 * **the two ends name a box differently and this is the one place that is reconciled.** the
	 * binary and the run answer by the value's own name — `STRIPE_SECRET_KEY`, which is what it is
	 * called on the deployment (`stripeKeyEdits` in ./stripe-edits.ts) — and the seam finds a box by
	 * what that box posts, which is {@link KEY_FIELD}'s name (./use-console-form.ts). a key that is
	 * neither is a sentence drawn under nothing, with focus moved to nothing.
	 *
	 * a name this fold draws no box for is dropped rather than carried, for the reason `foldErrors`
	 * in ./org-form.ts states: focus into a panel nobody has open is a press answered by nothing
	 * moving.
	 */
	const carried = (said: Record<string, string> | null): Record<string, string> | null => {
		if (said === null) return null;
		const named = STRIPE_KEY_NAMES.filter((name) => said[name] !== undefined);
		if (named.length === 0) return null;
		return Object.fromEntries(named.map((name) => [KEY_FIELD(name), said[name] as string]));
	};

	/** the two ways one press of this form leaves something on the deployment. */
	const keysLanded = landed || removed?.kind === 'set';
	/* whether the reading this press set off has landed (./reseed.ts). what is handed in is the
	   values prop itself rather than the seeds read off it: a record built at every render is a new
	   reading at every render, and this one is the deployment answered once per re-read.
	   what a press is made against is taken while `underway` is true, which is the whole of the press
	   — the request, and then the run it started. */
	const reread = useReseeded({ landed: keysLanded, pending: underway, reading: values.vars });
	/* what the two boxes hold and whether they have been put back to it: this press's own answer
	   where it says the deployment took the pair, and the reading after it otherwise
	   (`keysStanding` in ./stripe-press.ts). the answer is seconds ahead of that reading — the
	   deployment's own is a promise the loader hands back unresolved (../routes/_index.tsx) — and a
	   fold waiting for it is one an operator meets with both boxes and the press under them shut. */
	const { seeded, spent } = useMemo(
		() => keysStanding({ reported, sent, run: live, reread }),
		[reported, sent, live, reread]
	);

	/* this form's own rules, which are what the boxes are read against before anything is sent —
	   `stripeRefusals` whole, mounted for these seeds (./stripe-keys.ts). */
	const stated = useMemo(() => stripeForm(seeded), [seeded]);
	/* what closes the two boxes and the press under them, which is not the page's own `busy`: that
	   flag is true of this form's own press as well, so read straight it shuts the boxes over this
	   form's own answer — and a refusal an operator cannot type over is a sentence naming the one
	   thing they are stopped from doing. ./stripe-press.ts is every reading in it.

	   only these two boxes and the save under them are drawn from it. every other control on this
	   fold carries a press of its own, and each of those is closed while any press on the page is
	   writing. */
	const closed = keysClosed(phase, pressAnswer, busy, working, { landed: keysLanded, spent });

	const keys = useConsoleForm(stated, {
		report: live,
		landed: keysLanded,
		spent,
		refused: carried(namedBoxes ?? keyRefused),
		/* the boxes seeded from what the deployment holds ({@link seeded}), keyed by what they post.
		   the marking is still the pass and not the seeding: nothing is said about a box until a
		   submit runs the rules (./use-console-form.ts). */
		defaultValue: {
			[KEY_FIELD('STRIPE_SECRET_KEY')]: seeded.STRIPE_SECRET_KEY,
			[KEY_FIELD('STRIPE_PUBLISHABLE_KEY')]: seeded.STRIPE_PUBLISHABLE_KEY
		},
		busy: elsewhere,
		pending: underway
	});
	/** this form's own element, which several readings below are taken off. */
	const form = keys.mount.ref;

	/**
	 * one of the two boxes bound, and the one sentence standing under it.
	 *
	 * **a turned-down pair is drawn at neither box.** it is about the two of them together and
	 * stands at the press ({@link keyRefusal}), and it reaches the seam all the same — which is
	 * where the operator is put back in a box and the next press held. so where the far end named no
	 * box, what a box draws is this form's own rules and nothing else.
	 *
	 * drawn through `MarkedText` because those rules name a prefix character for character
	 * (`stripeRefusals` in ./stripe-keys.ts), and a message printed raw shows an operator a pair of
	 * backticks. what comes off the wire is read the same way, which is the rule for every one of
	 * these strings (`@better-giving/operator/code-spans`).
	 */
	const keyBox = (name: StripeKeyName) => {
		const field = keys.fields[KEY_FIELD(name)];
		const bound = keys.box(field);
		const said = namedBoxes === null ? field.errors?.[0] : bound.error;
		return {
			...bound,
			said,
			message: said === undefined ? undefined : <MarkedText text={said} />
		};
	};
	const secret = keyBox('STRIPE_SECRET_KEY');
	const published = keyBox('STRIPE_PUBLISHABLE_KEY');
	/** the confirm's lines and the act they are about, or `null` where it is not on the screen. */
	const [confirming, setConfirming] = useState<{
		act: StripeAct;
		lines: readonly ConfirmLine[];
		/**
		 * whether the press this confirm asks about has been made from it.
		 *
		 * what the ledger inside the card is drawn against, and it is not the same question as
		 * whether a run exists: a stopped run stays in the binary until the next press clears it, so
		 * a fold opening this confirm can be holding one from the press before it — and a ledger
		 * drawn off that would report the last press under a question about the next.
		 */
		pressed: boolean;
	} | null>(null);

	/**
	 * the card a press that asked nothing puts up to report its run, or `null` where none is up.
	 *
	 * a first set-up runs straight off Save, so the card it puts up is the run's report and nothing
	 * else: no line to read, no press to make, and no way out while the chain is still going.
	 *
	 * the two words are the card standing over a press whose run has not been read yet, and the card
	 * drawing that run. either of them is a card on the screen and the word is what that card draws:
	 * they are apart because a stopped run stays in the binary until the next press clears it, so a
	 * card that drew whatever run was there the moment it went up would report the press before this
	 * one under a heading about this one.
	 */
	const [reporting, setReporting] = useState<'pressed' | 'reading' | null>(null);

	/* what makes the run this fold is holding this press's own, in either of the two ways it can be
	   known: a run read as running can be no other press's, and a press whose request has come back
	   has already started its run in the binary and revalidated the page over it. the second is a ref
	   because it is the request's own passing rather than anything drawn. */
	const answering = useRef(false);
	useEffect(() => {
		if (reporting === null) {
			answering.current = false;
			return;
		}
		if (pending === SET_UP_INTENT) {
			answering.current = true;
			return;
		}
		if (working || answering.current) setReporting('reading');
	}, [reporting, pending, working]);

	/* and the reader put back on that press when the card goes, whether they closed it or the run
	   landing did ({@link SET_UP_PRESS}).

	   every card is marked, because every press that asks nothing puts one up. what unmarks one
	   without restoring is the take-down below: a card that goes over an answer about a box leaves
	   the operator in that box. */
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

	/* a card is left when there is nothing left to read in it, and stands while there is. one rule
	   over both of them — the question a press is made from, and the report a press that asked
	   nothing puts up.

	   a refused pair leaves the operator in the box it named and a removal reports at the button, so
	   neither is readable behind a card; a run that landed is said by the button's own tick and by
	   the readings at the head of the fold, which are re-read the moment it stops, so four finished
	   lines in a dialog would be a dialog to dismiss to reach a screen that already says it worked.
	   what stands is the run itself — running, or stopped with the explanation an operator has to
	   read before deciding what to press next.

	   **and a run that stopped at the key check leaves with the refused pair rather than with the
	   stopped runs**, because nothing was registered or stored for a card to be the account of —
	   where Stripe turned the key down the box is what has to change and the sentence is under it
	   already ({@link keyRefusal}), and left standing this is a card whose only instruction is to go
	   and edit a box it is covering.

	   the door's own refusal is one of them and takes the card down here: it starts no run at all,
	   so nothing else on this fold would ever change to close a card standing over the press it
	   turned down.

	   **and only a landed run gives the press its reader back.** every other way a card leaves here
	   is an answer about a box, and the seam has already put the operator in the one it named
	   (./use-console-form.ts) — the restoration above would take them straight back out of it.

	   `landed` rather than the run being read at all, and the reading itself in the dependencies
	   beside it: the reading is what changes while the card is up, and a landed run answered twice
	   without a running one between them is a press whose close would otherwise never fire. */
	useEffect(() => {
		if (namedBoxes === null && !doorTurnedDown && removed === null && !landed && !stoppedAtKeys) {
			return;
		}
		if (!landed) held.current = false;
		setConfirming(null);
		setReporting(null);
	}, [namedBoxes, doorTurnedDown, removed, landed, stoppedAtKeys, live]);

	/* a fold put away is a fold at rest: the boxes back to their seeds, whatever was typed into them
	   gone, and no card left standing in the top layer over a page whose fold is shut. the element
	   is found rather than handed down — what shuts is several components above this one, and a flag
	   threaded through each of them would be a prop every fold states and nothing else reads.
	   ./smtp-fold.tsx answers the same thing the same way. */
	useEffect(() => {
		const fold = form.current === null ? null : form.current.closest('details');
		if (fold === null) return;
		const shut = () => {
			if (fold.open) return;
			setConfirming(null);
			setReporting(null);
			// and the press forgotten with them: the boxes are back to their seeds, so what the last
			// answer said about one of them is about a value the fold is no longer holding.
			setPressedHere(false);
			setRememberedRefusal(null);
			keys.reset();
		};
		fold.addEventListener('toggle', shut);
		return () => fold.removeEventListener('toggle', shut);
	}, [form, keys.reset]);

	/**
	 * the control that answers the card, settled as one thing: what it says, what it posts, and
	 * which rank it is drawn in.
	 *
	 * **the destructive rank is for the press that does the damage and for no other.** a removal
	 * takes both credentials off the deployment and an errand over a working set-up deletes the
	 * endpoint Stripe is already delivering to; a publish writes one var and takes nothing away, so
	 * it is the primary control `packages/operator/src/components/shell/Dialog.jsx` draws where no
	 * `danger` is handed over. red on a press that destroys nothing is a warning an operator learns
	 * to read past.
	 */
	const press =
		confirming === null
			? null
			: {
					destroys:
						confirming.act === 'remove' ||
						(confirming.act === 'errand' && remakesSetup(confirming.lines)),
					label: ASKS[confirming.act].press,
					props: {
						type: 'submit' as const,
						name: 'intent',
						value: SET_UP_INTENT,
						disabled: busy || working || undefined,
						'aria-busy': underway || undefined,
						// what the ledger inside the card is drawn against, and it is not a run existing: a
						// stopped run from the press before this card went up is not this press's report.
						onClick: () => setConfirming((was) => (was === null ? null : { ...was, pressed: true }))
					}
				};

	/**
	 * which Stripe account the secret key belongs to, drawn at the head of the fold with the other
	 * readings.
	 *
	 * **it stands only after a press in this session.** the name is in the last run's facts and
	 * nowhere else — `PaymentsReport` in ../api/types.ts is what the deployment answers and it
	 * carries no account name — so a fold drawn on a page load has nothing to draw here. making it
	 * permanent is a reading to add to what the deployment answers, which is a decision of its own.
	 */
	const named = (who: StripeNamed) => (
		<StatedValue label="Stripe account" value={who.account.name} />
	);

	/**
	 * why there was nowhere to register, in the address read's own terms.
	 *
	 * every refusal this fold draws stands on its own rather than under a box: what came back is
	 * about a press, and `Field` draws its rows only under the box it labels — the control here is a
	 * submit button and there is no box to hang one off. the row itself is
	 * `@better-giving/operator/components/forms/FieldMessage`, which is what announces it.
	 */
	const nowhere = (read: AddressRead) =>
		read.kind === 'not-deployed' ? (
			// this fold is drawn over a deployment that answered a moment ago, so the Worker went
			// between that reading and this press. the way out is the page read again.
			<FieldMessage>
				No Worker called {workerName} is in {accountName} any more, so there was no address to
				register with Stripe. Nothing was registered and nothing was stored. Reload this page.
			</FieldMessage>
		) : read.kind === 'deployed' ? (
			<FieldMessage>
				This deployment answers on no address at all, so Stripe would have nowhere to deliver to.
				Turn its <InlineCode>workers.dev</InlineCode> address back on, or attach a domain, then
				press again. Nothing was registered and nothing was stored.
			</FieldMessage>
		) : (
			<>
				<FieldMessage>
					The console couldn't work out where this deployment answers, so it had no address to
					register. Nothing was registered and nothing was stored.
				</FieldMessage>
				<Said answer={read} />
			</>
		);

	/**
	 * how the press that took the two credentials off the deployment went, at the button that made
	 * it.
	 *
	 * the same reader every other refused credentials write on this surface uses
	 * (./secret-trouble.tsx), because it is the same one call refused by the same three states of
	 * the same account. `nowhere` is the arm the caller writes and this one is the removal's own:
	 * the press above it reaches Stripe and this press reaches nothing at all, so a sentence about
	 * registering would name an errand nobody asked for.
	 */
	const wrote = secretTrouble({
		workerName,
		accountName,
		nowhere: (read: AddressRead) =>
			read.kind === 'not-deployed' ? (
				<FieldMessage>
					No Worker called {workerName} is in {accountName} any more, so there was nothing to take
					these off. Reload this page.
				</FieldMessage>
			) : read.kind === 'deployed' ? (
				<FieldMessage>
					This deployment answers on no address at all, so there was nowhere to reach it. Nothing
					was taken away. Turn its <InlineCode>workers.dev</InlineCode> address back on, or attach a
					domain, then press again.
				</FieldMessage>
			) : (
				<>
					<FieldMessage>
						The console couldn't work out where this deployment answers, so nothing was taken away.
					</FieldMessage>
					<Said answer={read} />
				</>
			)
	});

	/* the failure inside the removal's answer, or nothing: the arms that changed something, found
	   nothing to change, or refused over a value held in a form nothing can read back are each
	   drawn elsewhere (`refusalIn` in ./secret-trouble.tsx). */
	const removedFailure = removed === null ? null : refusalIn(removed);

	/**
	 * what a Stripe call that did not answer said.
	 *
	 * three arms and not one per status: a refused key, a Stripe nothing could reach, and everything
	 * else — which are three different things to go and do. what Stripe itself said rides underneath
	 * on every one of them, so nothing is lost by not rewording it here.
	 */
	const stripeTrouble = (failure: StripeFailure, what: string) => (
		<>
			<FieldMessage>
				{failure.kind === 'refused'
					? `Stripe wouldn't accept that secret key, so ${what}. Check it against the key on the Stripe dashboard and press again.`
					: failure.kind === 'unreachable'
						? `The console couldn't get an answer out of Stripe, so ${what}. Check this machine's internet connection, then press again.`
						: `Stripe would not do this, so ${what}.`}
			</FieldMessage>
			<Said answer={failure} />
		</>
	);

	/**
	 * a read or a press the deployment answered no report to.
	 *
	 * these say to reload rather than offering a press of their own: this fold is drawn on the one
	 * face that already holds a session, so a deployment that stopped answering between the page load
	 * and the press is a page whose next reading is the gate — which draws the press each of these
	 * states needs, the connect for a session and the update for a surface (../routes/_index.tsx).
	 */
	const noAnswer = (read: NoReport, what: string): ReactNode => (
		<>
			<FieldMessage>
				{read.kind === 'no-session'
					? `This console is no longer connected to this deployment, so ${what}. Reload this page and connect again.`
					: read.kind === 'refused'
						? `This deployment turned this console session down, so ${what}. Reload this page and connect again.`
						: read.kind === 'no-surface'
							? `Something is deployed at that address and it isn't answering this console, so ${what}. It is either older than this console or not this deployment at all. Reload this page and the update press is on it.`
							: read.kind === 'unreachable'
								? `The console couldn't get an answer out of this deployment, so ${what}. Check this machine's internet connection, then reload.`
								: unreadAnswer(what)}
			</FieldMessage>
			{read.kind === 'unreachable' || read.kind === 'unreadable' ? <Said answer={read} /> : null}
		</>
	);

	/** the sentence a values read that answered nothing gets, whichever door it came back through. */
	const trouble = (read: DeployedValues['vars']) => {
		if (read.kind === 'read' || read.kind === 'not-deployed') return null;
		return (
			<>
				<p className="adm-prose">
					{read.kind === 'refused'
						? `Cloudflare won't tell this sign-in what ${accountName} is holding.`
						: read.kind === 'no-credential'
							? "This machine isn't signed in to Cloudflare any more, so nothing here could be read. Reload this page to sign in again."
							: read.kind === 'unreachable'
								? "Cloudflare didn't answer, so nothing was found out either way."
								: "Cloudflare answered in a way this console couldn't read."}
				</p>
				<Said answer={read} />
			</>
		);
	};

	/**
	 * the values this deployment holds in a form nothing can read back, and the press out of that
	 * state (./withheld-values.tsx).
	 *
	 * it is what stands between such a name and a save: the binary refuses a write over one rather
	 * than leaving the name held both ways, so the value has to come off first.
	 *
	 * the names are handed in rather than read here, because the two callers are about different
	 * ones: under the boxes it is whichever of the two keys is in that state, and under a run that
	 * stopped storing it is whatever that write refused — the signing secret among them, which has
	 * no box on this fold at all. what the press frees is neither of those and is read here: one
	 * press takes every withheld name on the deployment off, and the card itemises them
	 * (./withheld-values.tsx).
	 */
	const withheldBlock = (names: readonly DeployVarName[]) => (
		<WithheldValues
			names={names}
			all={holding?.withheld ?? []}
			consequence="Until the keys above are saved again, this deployment serves no donation form."
			written={freed}
			trouble={wrote}
			busy={busy || working}
			freeing={pending === FREE_INTENT}
		/>
	);

	/**
	 * what a publish that did not land said. everything on the Stripe account is already safe.
	 *
	 * the write is a read of the worker's bindings and one patch back, so what it can answer is the
	 * account and the machine rather than a build: a name the deployment holds in a form nothing can
	 * read back, a worker that has gone, a sign-in cloudflare turned down, and the two ways nothing
	 * was found out.
	 */
	const notPublished = (written: VarsUnwritten): ReactNode => {
		if (written.kind === 'withheld') {
			// the way out is under the boxes and is not repeated here: one press frees every such
			// name, so a second copy of it would be a second control for one act.
			return (
				<FieldMessage>
					The endpoint and both credentials are done. The publishable key is not, so this deployment
					still serves no donation form.
				</FieldMessage>
			);
		}
		if (written.kind === 'nowhere') {
			return (
				<>
					<FieldMessage>
						The endpoint and both credentials are done, and there was nowhere to put the publishable
						key.
					</FieldMessage>
					{nowhere(written.address)}
				</>
			);
		}
		return (
			<>
				<FieldMessage>
					{written.kind === 'refused'
						? `Cloudflare won't let this sign-in write to ${workerName} in ${accountName}, so the publishable key was not set. Ask an administrator of that account for administrator access, or switch account.`
						: written.kind === 'unreachable'
							? "Cloudflare didn't answer, so the publishable key was not set."
							: "Cloudflare wouldn't set the publishable key."}{' '}
					Until it lands, this deployment serves no donation form, so nobody can give.
				</FieldMessage>
				<Said answer={written} />
			</>
		);
	};

	/**
	 * what stopped the run, drawn under the line whose subject it stopped.
	 *
	 * one sentence per arm and no arm that only rewords another: what is kept apart is what sends an
	 * operator somewhere different. the two that name a state nothing else could have told them are
	 * an endpoint deleted with no replacement, and a signing secret that no longer exists anywhere.
	 */
	const stopped = (outcome: StripeSetup): ReactNode => {
		if (outcome.kind === 'done') return null;
		// the console itself, and not a step of the chain: nothing observed how far the press got, so
		// no processor answer is drawn — there is none (./press-stopped.ts).
		if (outcome.kind === 'console-stopped') {
			return <FieldMessage>{pressStopped(REACHED_STRIPE)}</FieldMessage>;
		}
		if (outcome.kind === 'unnamed') {
			/* a key Stripe turned down is reported at the box holding it ({@link keyRefused}), so what
			   is left under this line is Stripe's own words about the call — the sentence stated here
			   as well would be the same instruction twice on one screen, once beside the box that has
			   to change and once where nothing can be typed. every other way this call fails is not
			   about a box, and keeps the sentence. */
			return outcome.failure.kind === 'refused' ? (
				<Said answer={outcome.failure} />
			) : (
				stripeTrouble(outcome.failure, 'nothing was registered and nothing was stored')
			);
		}
		if (outcome.kind === 'nowhere') return nowhere(outcome.address);
		if (outcome.kind === 'unlisted') {
			return stripeTrouble(
				outcome.failure,
				"this console couldn't find out what is already registered and registered nothing"
			);
		}
		if (outcome.kind === 'undeleted') {
			return stripeTrouble(
				outcome.failure,
				`the endpoint ${outcome.endpoint.id} is still registered exactly as it was`
			);
		}
		if (outcome.kind === 'uncreated') {
			return (
				<>
					{outcome.gone === null ? null : (
						<Banner tone="blocker" word="This deployment now receives nothing">
							The endpoint that was registered here, <InlineCode>{outcome.gone.id}</InlineCode>, has
							been deleted, and its replacement was not created. Press <strong>Save</strong> again
							with the two keys to register one.
						</Banner>
					)}
					{stripeTrouble(outcome.failure, 'no endpoint was registered and nothing was stored')}
				</>
			);
		}
		if (outcome.kind === 'unkept') {
			return (
				<>
					<Banner tone="blocker" word="The endpoint exists and its signing secret is gone">
						Stripe registered <InlineCode>{outcome.endpointId}</InlineCode> and is now delivering to
						this deployment, and the secret that proves those deliveries came from Stripe was not
						stored. Stripe hands a signing secret over once, at creation, and will not show it
						again, so no gift can reach the books until this endpoint is replaced.
					</Banner>
					{outcome.why === 'no-secret' ? (
						<p className="adm-prose">
							Stripe created the endpoint and returned no signing secret at all.
						</p>
					) : outcome.written.kind === 'nowhere' ? (
						nowhere(outcome.written.address)
					) : outcome.written.kind === 'withheld' ? (
						withheldBlock(outcome.written.names)
					) : (
						<>
							<FieldMessage>
								{outcome.written.kind === 'refused'
									? `Cloudflare won't let this sign-in write to ${workerName} in ${accountName}, so the secret could not be stored.`
									: outcome.written.kind === 'unreachable'
										? 'This console could not reach Cloudflare, so the secret could not be stored.'
										: 'The secret could not be stored, and this is what Cloudflare said:'}
							</FieldMessage>
							<Said answer={outcome.written} />
						</>
					)}
					{/* and not where the write was refused over a withheld name: that door turns the same
					    press down every time, so repeating it would delete this endpoint and lose another
					    signing secret for good. what has to run first is the Remove press in the block
					    above (./withheld-values.tsx), which is the instruction there. */}
					{outcome.written?.kind === 'withheld' ? null : (
						<p className="adm-prose">
							Press <strong>Save</strong> again with the same two keys. It deletes that endpoint and
							registers a new one whose secret this console can store.
						</p>
					)}
				</>
			);
		}
		if (outcome.kind === 'unrepeating') {
			/* the deployment is holding a key it has not picked up yet, which is this press's own store
			   a moment behind the edge rather than anything an operator has to fix. the deployment's
			   sentence says to set a value this press has already set, so it is not drawn at all —
			   what is drawn is the one press that finishes it, which is under this on the same fold. */
			if (outcome.awaitingKey) {
				return (
					<Banner tone="note" word="The keys are stored and published">
						This deployment serves a donation form and takes one-time gifts. It hasn’t picked the
						secret key up yet, so repeating gifts are not set up. Press{' '}
						<strong>Set up recurring gifts</strong> below in a moment.
					</Banner>
				);
			}
			if (outcome.setup.kind === 'unanswered') {
				return noAnswer(outcome.setup.read, 'the repeating-gift item was not set up');
			}
			return (
				<>
					<FieldMessage>
						This deployment could not put it on your Stripe account. The endpoint, both credentials
						and the publishable key are done, so it serves a donation form and takes one-time gifts.
					</FieldMessage>
					{/* the port's own sentence, drawn rather than printed: it names the offending value and
					    marks it (`@better-giving/operator/code-spans`). */}
					{outcome.setup.report.detail === null ? null : (
						<p className="adm-prose">
							<MarkedText text={outcome.setup.report.detail} />
						</p>
					)}
				</>
			);
		}
		if (outcome.kind === 'uncovered') {
			/* the same edge lag the step above it can meet, and the same answer: what is drawn is that
			   this finishes itself, never the deployment's sentence naming a value this press has set. */
			if (outcome.awaitingKey) {
				return (
					<Banner tone="note" word="The keys are stored and published">
						This deployment serves a donation form and takes gifts. It hasn’t picked the secret key
						up yet, so none of your sites was registered and no wallet button is drawn on them.
					</Banner>
				);
			}
			if (outcome.levelled.kind === 'unanswered') {
				return noAnswer(outcome.levelled.read, 'no site was registered for wallet buttons');
			}
			return (
				<>
					<FieldMessage>
						This deployment couldn’t read your Stripe account, so no site was registered for wallet
						buttons. Everything else is done, and it takes gifts by every other way of paying.
					</FieldMessage>
					{/* the port's own sentence, drawn rather than printed: it names the offending value and
					    marks it (`@better-giving/operator/code-spans`). */}
					{outcome.levelled.report.state === 'unreadable' ? (
						<p className="adm-prose">
							<MarkedText text={outcome.levelled.report.detail} />
						</p>
					) : null}
				</>
			);
		}
		return notPublished(outcome.published);
	};

	/**
	 * the run, drawn as the things it establishes.
	 *
	 * **it is drawn while the press runs and while a stopped one is still on screen, and never after
	 * one that landed.** a ledger of finished lines standing over a form nobody has anything left to
	 * press is a report an operator reads past on every later visit; what says a press worked is the
	 * button that carried it and the readings at the head of the fold, which now read the account
	 * this press just set up.
	 *
	 * **while a press runs it is drawn in the top layer and nowhere else, and there are two callers**:
	 * the confirm whose press started this run, and the card a press that asked nothing puts up to
	 * report itself. it is a press reporting itself while it runs, so it goes when the press does —
	 * under the boxes a running or landed run would be a progress list standing over a settled fold,
	 * saying worse what the readings above the boxes and the endpoint below them already say.
	 *
	 * **a run that stopped is the one case those readings do not cover, and it is drawn under the
	 * boxes once no card is up** ({@link reportStands}). its facts are on no reading above them: the
	 * account name is, and nothing else says what stopped or what to do next. the cards are keyed on
	 * state only the page that pressed has, and the binary keeps a stopped run across a reload on
	 * purpose (`packages/console/internal/server/stripe.go`), so a fold drawn over one would
	 * otherwise be a blank form with the failure it was reloaded to read nowhere on it.
	 *
	 * **a publish draws one line and an errand draws three.** a publish is the deploy alone
	 * (./stripe-keys.ts), so two lines that could only ever say `Waiting` would be a press promising
	 * work it does not do — and it draws the line ./stripe-run-lines.tsx keeps for that act rather
	 * than the errand's line its one stage is filed under.
	 *
	 * **`null` is a press whose run has not been read yet, and it draws an errand at the stage the
	 * chain opens on** (`OPENING_STAGE` in ./stripe-run-lines.tsx). the card goes up on the press and
	 * the first reading of the run arrives a revalidation later, so what a caller holds in between is
	 * a press it knows it made and no reading of it — and the run this fold is holding at that moment
	 * is the press before this one, which the binary keeps until the next one clears it.
	 */
	const ledger = (read: StripeRunRead | null): ReactNode => {
		const stage = read?.stage ?? OPENING_STAGE;
		const now = STAGES.indexOf(stage);
		// a run that is not running is a run that stopped: the ledger is drawn over one of those two
		// and never over one that landed, which is what the caller decides.
		const failed = read !== null && read.kind === 'ended';
		/* a publish draws the one line that act has of its own rather than the errand's three: its
		   single stage falls under the middle one, which stands for an errand against Stripe this
		   press does not make — and the two steps beside it, both behind the one it runs, would be
		   drawn `Done` under a press that made neither (./stripe-run-lines.tsx). */
		const publishing = read?.act === 'publish';
		const lines: readonly { id: string; label: string; note: string | undefined }[] = publishing
			? [PUBLISHED]
			: SUBJECTS;
		const reached = publishing ? 0 : REACHED[stage];
		/* every line the run has reached is opened into its own steps, and a line still waiting has
		   none: its subject has no steps taken yet. a line that is done keeps the steps it took
		   standing, because what a finished subject was made of is an account this fold gives nowhere
		   else — a run that closed each line behind it would leave an operator who looked away with
		   four words and no record of what earned them. nothing here is a control and nothing shuts on
		   a press, so what opens a line is the run arriving at it.

		   the line a stopped run is standing under is the one that keeps its steps shut: the stage it
		   stopped at is the stage it was working, so a step drawn there would read `Working` under a
		   line that reads `Stopped`. what stands in their place is the sentence naming what to do,
		   attached to that same line.

		   whatever the line's subject is made of is handed over whole, single stages included: the
		   ledger folds a step that stands alone into the line above it and draws no run
		   (packages/operator/src/components/status/StatusLine.jsx), so a filter here would be that
		   rule stated a second time. */
		const steps = (at: number): ReactNode => {
			if (publishing || at > reached || (failed && at === reached)) return undefined;
			return STAGES.filter((stage) => REACHED[stage] === at).map((stage) => (
				<StatusStep
					key={stage}
					state={
						STAGES.indexOf(stage) < now
							? 'done'
							: STAGES.indexOf(stage) === now
								? 'running'
								: 'waiting'
					}
				>
					{STEP[stage]}
				</StatusStep>
			));
		};
		const tone = (at: number): Tone | 'running' | 'done' =>
			at < reached ? 'done' : at > reached ? 'note' : failed ? 'blocker' : 'running';
		const word = (at: number): string =>
			at < reached ? 'Done' : at > reached ? 'Waiting' : failed ? 'Stopped' : 'Working';
		return (
			// polite: the lines change on their own and nothing is being asked of the reader, so
			// hearing one land is worth more than being interrupted by it.
			<div role="status">
				<StatusLedger>
					{lines.map((subject, at) => (
						<StatusLine
							key={subject.id}
							labelAs="h4"
							label={subject.label}
							note={subject.note}
							tone={tone(at)}
							dim={at > reached}
							mark={at > reached ? 'circle-dashed' : undefined}
							word={word(at)}
							steps={steps(at)}
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

	/**
	 * what the last repeating-gifts press did, drawn at the button that made it.
	 *
	 * announced at the control that was pressed — see {@link nowhere} for why the region is written
	 * here rather than taken from the shared `Field`.
	 */
	const provisionOutcome = (): ReactNode => {
		if (provision === null) return null;
		if (provision.kind === 'unanswered') return noAnswer(provision.read, 'nothing was set up');

		const report = provision.report;
		if (report.outcome === 'failed') {
			return (
				<>
					<FieldMessage>
						This deployment could not set it up on your Stripe account, and nothing was changed.
					</FieldMessage>
					{report.detail === null ? null : (
						<p className="adm-prose">
							<MarkedText text={report.detail} />
						</p>
					)}
				</>
			);
		}
		// the two successes are drawn apart and both are the same finished state. an operator who
		// pressed the button and changed nothing is owed that — without it, a second press reads as a
		// second setup.
		return (
			<Banner tone="done" word={report.outcome === 'set_up' ? 'Set up' : 'Already set up'}>
				{report.outcome === 'set_up'
					? 'Your Stripe account can now collect gifts that repeat.'
					: 'Your Stripe account already had this, so nothing was changed.'}
			</Banner>
		);
	};

	/**
	 * the one thing to say about a read this deployment tried to make and could not.
	 *
	 * **said once and never once per reading.** the rails and where the account stands on repeating
	 * gifts are read through one port with one key, so both failing is one fact — drawn as a row in
	 * each, an operator is told the same thing twice and has two places to look for the one sentence
	 * that names what to do.
	 *
	 * **and nothing at all where nothing was asked.** a deployment holding no Stripe key is what the
	 * two empty boxes below this already say, and a row here would restate them and then send an
	 * operator to a terminal for a key this fold has a box for. `no_key` is the member that says so
	 * — `packages/operator/src/console/stripe-read.ts` — and it is the fact rather than the sentence
	 * that decides it.
	 *
	 * **it is drawn inside the awaited block and never outside it.** both readings are awaited (the
	 * `Suspense` this stands in), and a sentence about them drawn outside that would hold every box
	 * on this fold behind two requests to the deployment before any of them was drawn.
	 *
	 * the sentence names only what could not be read, so a fold with one good reading does not
	 * disown the other, and the deployment's own detail goes underneath — the account-level read's
	 * where both failed, since that is the one whose cause the other inherits.
	 */
	const unreadable = (payments: PaymentsRead | null, gifts: RecurringRead | null): ReactNode => {
		const railsRead = payments?.kind === 'read' ? payments.report.rails : null;
		const walletsRead = payments?.kind === 'read' ? payments.report.wallets : null;
		const giftsRead = gifts?.kind === 'read' ? gifts.reading : null;

		const unread: { says: string; detail: string }[] = [];
		if (railsRead?.state === 'unreadable' && railsRead.reason === 'failed')
			unread.push({ says: 'which ways of paying it can take', detail: railsRead.detail });
		if (walletsRead?.state === 'unreadable' && walletsRead.reason === 'failed')
			unread.push({ says: 'which sites draw wallet buttons', detail: walletsRead.detail });
		if (giftsRead?.state === 'unreadable' && giftsRead.reason === 'failed')
			unread.push({ says: 'whether repeating gifts are set up', detail: giftsRead.detail });

		const first = unread[0];
		if (first === undefined) return null;
		return (
			<>
				<FieldMessage>
					This deployment couldn't read your Stripe account, so it can't say{' '}
					{unread.map((one) => one.says).join(' or ')}.
				</FieldMessage>
				<p className="adm-prose">
					<MarkedText text={first.detail} />
				</p>
			</>
		);
	};

	/**
	 * which ways of paying a donor may give by, where each of them stands, and — for the three drawn
	 * on sites rather than on the form — which of this deployment's sites they show on.
	 *
	 * the mistake it exists to answer is silent in every other way: a rail the account cannot charge
	 * is still offered on the form, and an operator finds out from a donor whose payment failed. the
	 * sentences are the deployment's own and are not shortened here — each names the one door out of
	 * its state, and three of the six lead to a Stripe screen this console does not have.
	 *
	 * **the one sentence over them says what `Approved` is not.** nothing on any screen may claim a
	 * rail works (`packages/app/src/lib/server/payments/rail-chargeability.ts`), and approval is the
	 * closest reading this console has to one — so what it is is said where it is read, and only
	 * where there are lines to read.
	 *
	 * **the wallets are rows of this ledger and not a block under it.** Apple Pay, Google Pay and
	 * Link are ways of paying a donor is offered, so an operator reading down what their form takes
	 * meets them where the card and the bank account are; drawn as a second named block they were a
	 * second subject an operator had to know to connect to the first. what is particular to them —
	 * that the button shows only on sites registered with Stripe — is one press away, in
	 * {@link hostPanel}, rather than four sites spelled out under a ledger of six rails.
	 *
	 * **Link is a row here and is in no rails reading.** it has no name in `PAYMENT_METHODS`
	 * (`packages/form/src/v1.ts`), so the account approves nothing for it and its row cannot say
	 * `Approved` — what it says instead is what its own sites add up to ({@link linkLine}).
	 *
	 * **the heading is what names the list, and nothing is drawn around it.** a run of rails over
	 * the boxes that set the keys is a second subject with nothing saying where it ends and the
	 * boxes begin, so the block carries its own name — `.adm-named` in `packages/operator/src/styles/adm.css`,
	 * which is a heading and the step under it and no more. the box a named block wears on the
	 * page's own ground would be wrong here: this fold is drawn inside an entry of the home page's
	 * ledger of sections, which is already a hairline box, and a second edge a step inside the
	 * first says nothing the first has not.
	 *
	 * **a read that could not be made draws nothing at all here.** there is no list, so there is no
	 * subject to name — and the two reasons it could not be made are both said better elsewhere:
	 * a deployment holding no key is what the empty boxes below already say, and a read that was
	 * attempted and failed is one fact about both readings rather than a row in each, which is
	 * {@link unreadable}'s.
	 *
	 * **the run is drawn as columns and not as five sentences.** every row here is the same three
	 * things — a way of paying, where it stands, and for three of them a press into the panel — so
	 * an operator reads down a column rather than across a line, and a tick or a press found at a
	 * different place on each row is a list they have to scan instead of compare. `aligned` on
	 * `StatusLedger` is that reading and the claim it makes is this ledger's own: the labels and the
	 * words here are short, and the rows that put their word on the mark leave that column empty
	 * rather than closing it up (`packages/operator/src/components/status/StatusLine.jsx`).
	 *
	 * the rails and the sites arrive narrowed rather than as the read they came out of, because
	 * {@link readings} has to know which of them landed anyway: the panels are inside this ledger, so
	 * a fold with no ledger is a fold with nowhere to draw the press's own answer.
	 */
	const rails = (
		lines: readonly RailLine[] | null,
		hosts: readonly WalletHostLine[] | null,
		outcome: ReactNode
	): ReactNode => {
		if (lines === null) return null;
		return (
			<div className="adm-named">
				<h3>Donation methods</h3>
				<p className="adm-prose">
					Approved is Stripe's permission and not a promise. A gift can still be refused over the
					currency, the amount, or the donor's own bank.
				</p>
				<StatusLedger aligned>
					{lines.map((line) => (
						<StatusLine
							key={line.rail}
							labelAs="span"
							label={line.label}
							word={STANDING[line.standing].word}
							/* an approved rail says so with the tick and nothing else: the word beside it
							   is the same statement a second time, and the label is already the whole
							   subject. it goes on to the mark as its name, so a reader who cannot see
							   the shape is told what the tick says. every other standing keeps its word
							   drawn — three of them share the one mark, so there it is the word that
							   says which problem this is. */
							wordOnMark={STANDING[line.standing].tone === 'done'}
							tone={STANDING[line.standing].tone}
							note={line.note === null ? undefined : <MarkedText text={line.note} />}
							aside={hosts === null ? undefined : railPanel(line.rail, hosts, outcome)}
						/>
					))}
					{hosts === null ? null : linkLine(hosts, outcome)}
				</StatusLedger>
			</div>
		);
	};

	/**
	 * the panel a wallet's own row opens, or nothing where the row is not a wallet's.
	 *
	 * the two rails that are wallets are named by the same keys the site reading uses
	 * ({@link WALLET_NAMES}), so which rows carry a panel is read off that record rather than
	 * listed a second time here — a wallet added to one and not the other would otherwise be a row
	 * with no panel and nothing saying so.
	 */
	const railPanel = (
		rail: string,
		hosts: readonly WalletHostLine[],
		outcome: ReactNode
	): ReactNode => {
		if (!(rail in WALLET_NAMES)) return undefined;
		return hostPanel(rail as Wallet, hosts, outcome);
	};

	/**
	 * which of this deployment's sites one wallet is drawn on, and the one press that registers
	 * them.
	 *
	 * the mistake it exists to answer is silent everywhere else: a site the account holds nothing
	 * for offers a donor whatever is left and says nothing about the difference, so an operator finds
	 * out by looking at their own donation page on a phone and wondering where Apple Pay went.
	 *
	 * **it is a panel and not a run of rows on the fold.** the same three or four sites stand
	 * under each of the three wallets, so drawn open they are the same list three times over a
	 * ledger of six rails — and the fact an operator is looking for is about one wallet, which is the
	 * row they pressed. a press opens it and a dismissal closes it, which is the shape
	 * `packages/operator/src/behaviour/AnchoredPanel.tsx` is for: there is a control inside, so it has
	 * to stay open while the pointer travels to it.
	 *
	 * **every row reports this wallet alone** (./wallet-rows.ts). a site short of Apple Pay and
	 * drawing Google Pay is two different rows in two different panels, which is the whole reason the
	 * standing is read per wallet rather than taken off the line.
	 *
	 * **the ledger is redrawn from the last press rather than from the read that was taken before
	 * it** — `walletHostLines` in ./wallet-rows.ts is where that stands.
	 *
	 * **one press under the rows and never one per row.** the press acts on the deployment's own list
	 * whole (./wallets-press.ts) — there is nothing for a row's own button to post — and a column of
	 * identical buttons beside four sites would offer four presses that all do the same thing.
	 *
	 * **and it is not drawn at all where every row is already showing.** a panel of ticks with a
	 * control under it is a screen asking for something it does not need, in a panel small enough
	 * that the press was most of what stood in it. what such a press would still have repaired — a
	 * domain attached to the worker since this reading was taken — is a reading that says so as soon
	 * as it is taken again, and the row it is short on is what draws the press back.
	 *
	 * **the answer stays whether or not the press does.** a press that has just landed is exactly
	 * the case where every row turns to showing, so an outcome drawn behind the button would go off
	 * the screen with the button that earned it.
	 *
	 * **the press names the form it posts to, because the panel is not inside it.** the panel is
	 * portaled to the document body, so a submit that named nothing would reach nothing at all
	 * ({@link READINGS_FORM}).
	 *
	 * **the outcome draws in here, in every panel, and that is one place and not three.** a dismissed
	 * panel is discarded rather than hidden (`unmountOnExit` in
	 * `packages/operator/src/behaviour/AnchoredPanel.tsx`), so at most one of the three is on the
	 * screen — and a press's answer reports at the control that made it, which is the control inside
	 * whichever panel the operator is standing in.
	 */
	const hostPanel = (
		wallet: Wallet,
		hosts: readonly WalletHostLine[],
		outcome: ReactNode
	): ReactNode => {
		const name = WALLET_NAMES[wallet];
		const rows = walletRows(hosts, wallet);
		const covered = rows.every((row) => row.standing === 'showing');
		return (
			<AnchoredPanel mark="info" label={`Where ${name} shows`}>
				<p className="adm-prose">{name} only shows on sites registered with Stripe.</p>
				<StatusLedger>
					{rows.map((row) => (
						<StatusLine
							key={row.host}
							labelAs="span"
							label={row.host}
							word={ROW_STANDING[row.standing].word}
							/* a site that draws it says so with the tick and nothing else, which is
							   {@link rails}' rule over the same shape: the word beside it would be the
							   statement made twice, and it goes on to the mark as its name so a reader who
							   cannot see the shape is told what the tick says. the other three share one
							   mark, so there the word is what says which problem this is. */
							wordOnMark={row.standing === 'showing'}
							tone={ROW_STANDING[row.standing].tone}
							note={hostNote(row, name)}
						/>
					))}
				</StatusLedger>
				{covered ? null : (
					<div className="adm-dialog__actions">
						<Button
							type="submit"
							form={READINGS_FORM}
							name="intent"
							value={WALLETS_INTENT}
							size="sm"
							variant="primary"
							disabled={busy || working}
							aria-busy={pending === WALLETS_INTENT}
						>
							Register all sites
						</Button>
					</div>
				)}
				{outcome}
			</AnchoredPanel>
		);
	};

	/**
	 * what one site's row says under its label, inside one wallet's panel.
	 *
	 * one arm per standing and no catch-all: what separates them is what the press has to do about
	 * it, and three of the four are the same press with a different thing to say about why it is
	 * needed.
	 *
	 * **the label is the site and the note says which of the operator's things it is.** the
	 * deployment's own donation page is on no site row and the operator never listed it (CLAUDE.md →
	 * Product surface), so a row carrying it with no word about that reads as a site they cannot find
	 * in their own list.
	 *
	 * **it names the act rather than quoting the press's own word.** the press is one control acting
	 * on the whole list and the row is about one site, so a sentence telling an operator to press
	 * a button that says something else about scope is a sentence they have to reconcile.
	 *
	 * **the processor's own sentence about a wallet it is not drawing is printed and never marked.**
	 * it is somebody else's prose about the operator's own domain (`WalletStanding` in
	 * `packages/app/src/lib/server/payments/provider.ts`), so a backtick in it is a character that
	 * machine wrote rather than a mark asking for a value to be drawn as code — which is the rule
	 * ./said.tsx states over every borrowed sentence on this surface.
	 */
	const hostNote = (row: WalletRow, name: string): string => {
		const who = row.own ? 'Your donation page.' : 'A site you listed.';
		if (row.standing === 'unregistered') {
			return `${who} Stripe holds nothing for this site, so no wallet button is drawn on it. Registering adds it.`;
		}
		if (row.standing === 'switched_off') {
			return `${who} Stripe holds this site on your account and it is switched off there, so no wallet button is drawn on it. Registering switches it back on.`;
		}
		// the tick and the label are the whole of a site that is fine, so what is left to say is
		// which of the operator's things it is.
		if (row.standing === 'showing') return who;
		const asks = `${who} Stripe isn’t drawing ${name} here. Registering asks Stripe to check again.`;
		return row.detail === null ? asks : `${asks} ${row.detail}`;
	};

	/**
	 * the Link row, appended to the ledger after the four rails.
	 *
	 * **it is drawn off the sites and never off the rails reading, because there is no rails
	 * reading to draw it off.** Link has no name in `PAYMENT_METHODS` (`packages/form/src/v1.ts`) —
	 * the account approves nothing for it and the form offers it as no rail of its own — so the only
	 * thing this console knows about it is which sites Stripe draws it on, and that is what the
	 * row says. `linkStanding` in ./wallet-rows.ts is the reading; a deployment whose sites could
	 * not be read gets no row at all rather than one with nothing behind its word.
	 *
	 * **it draws no sentence of its own.** it is a row of the same run as the four above it — a
	 * label, a word, a tone and the press into its own panel — and what an operator wants to know
	 * about it is which sites it shows on, which is what that panel is. a paragraph under this one
	 * row and under no other is the run's own rhythm broken at the row that is already the odd one.
	 */
	const linkLine = (hosts: readonly WalletHostLine[], outcome: ReactNode): ReactNode => {
		const standing = linkStanding(walletRows(hosts, 'link'));
		return (
			<StatusLine
				key="link"
				labelAs="span"
				label={WALLET_NAMES.link}
				word={LINK_STANDING[standing].word}
				wordOnMark={standing === 'everywhere'}
				tone={LINK_STANDING[standing].tone}
				aside={hostPanel('link', hosts, outcome)}
			/>
		);
	};

	/**
	 * how the last press that registered them went, drawn inside the panel the press was made from —
	 * or alone in the block, where the read that follows a press left no panel to draw it in.
	 *
	 * **a press that changed something and failed nothing says nothing here.** the rows above it are
	 * redrawn from that same answer, so every site it moved is already reading as moved — a
	 * sentence saying so as well is a line read once and read past on every press afterwards.
	 *
	 * **it is computed once in {@link readings} and handed into {@link rails} rather than called
	 * from inside {@link hostPanel}.** the two failures ride the same account and very often arrive
	 * together — the press could not reach Stripe, and the read revalidated right after it hits the
	 * same wall — so `walletHostLines` in ./wallet-rows.ts comes back with nothing to draw a panel
	 * from at the exact moment this has the most to say. an outcome read only where a panel drew
	 * would go down with it.
	 *
	 * what is left is the two ways nothing was attempted, and the sites one press could not move.
	 * those carry the deployment's own sentence, which names the value to fix and marks it
	 * (`levelWalletDomains` in `packages/app/src/lib/server/payments/wallet-domains.ts`), so it is
	 * drawn rather than printed.
	 */
	const walletsOutcome = (): ReactNode => {
		if (wallets === null) return null;
		if (wallets.kind === 'unanswered') {
			return noAnswer(wallets.read, 'no site was registered for wallet buttons');
		}
		const report = wallets.report;
		// the account read the press opens with, so no site was reached at all.
		if (report.state === 'unreadable') {
			return (
				<>
					<FieldMessage>
						This deployment couldn’t read your Stripe account, so no site was registered for wallet
						buttons.
					</FieldMessage>
					<p className="adm-prose">
						<MarkedText text={report.detail} />
					</p>
				</>
			);
		}
		// one site's failure stops no other, so each is reported against its own name rather than
		// collected into a sentence about the press.
		return report.hosts.map((host) =>
			host.detail === null ? null : (
				<FieldMessage key={host.line.host}>
					<CodeChip>{host.line.host}</CodeChip> <MarkedText text={host.detail} />
				</FieldMessage>
			)
		);
	};

	/**
	 * where the account stands on gifts that repeat, and the one press that changes it.
	 *
	 * one arm per state and no catch-all, so a state added to the reading draws nothing here rather
	 * than the wrong sentence with confidence.
	 *
	 * **not set up is not a fault and is never drawn as one.** a deployment that only ever wants
	 * one-time gifts is complete, so the line takes the note tone rather than attention — the
	 * severities in this fold belong to gifts that cannot reach the books.
	 *
	 * **a read that could not be made draws no line**, for {@link rails}' reason: it is the same
	 * read failing, and the fold says so once in {@link unreadable} rather than in a row here and
	 * another one above.
	 */
	const repeating = (read: RecurringRead): ReactNode => {
		const reading = read.kind === 'read' ? read.reading : null;
		if (reading === null || reading.state === 'unreadable') return null;

		/* in a fundraiser's words — what has to be known is that a donor can ask to give again every
		   month, and that Stripe is what collects it. */
		const explains =
			'Stripe collects repeating gifts against a single item on your account, and it has to exist before the first one can be collected.';

		if (reading.state === 'absent') {
			return (
				<StatusLine
					labelAs="span"
					label={RECURRING_LABEL}
					word="Not set up"
					tone="note"
					note={`${explains} Setting it up adds that one item to your Stripe account, and this deployment asks Stripe with the key it already holds. Nothing is typed here.`}
				>
					<div className="adm-status__attach adm-actions">
						<Button
							type="submit"
							name="intent"
							value={RECURRING_INTENT}
							variant="primary"
							disabled={busy || working}
							aria-busy={pending === RECURRING_INTENT}
						>
							Set up recurring gifts
						</Button>
					</div>
				</StatusLine>
			);
		}
		if (reading.state === 'archived') {
			// archived is neither set up nor missing, and the difference is what an operator has to be
			// told: the press would be refused, and the way out is on a screen this product does not
			// have.
			return (
				<StatusLine
					labelAs="span"
					label={RECURRING_LABEL}
					word="Archived"
					tone="attention"
					note={`${explains} Yours is archived, so nothing can be collected against it. Unarchive it in the Stripe dashboard, under Product catalogue.`}
				/>
			);
		}
		// the finished state, and the whole of it: the label says what repeats and the tick says the
		// account can take it. the word is stated and drawn nowhere — it is the mark's own name, so
		// a state a reader could only get from a shape still reaches somebody being read to.
		return (
			<StatusLine labelAs="span" label={RECURRING_LABEL} word="Ready" wordOnMark tone="done" />
		);
	};

	/**
	 * the two readings only the deployment can give, drawn at the head of the fold above the boxes.
	 *
	 * neither is a step in setting this deployment up, and that is why nothing collects them into a
	 * word: an account Stripe never approved for bank payments is not a deployment left unfinished,
	 * and one that only ever wants one-time gifts is complete. what says whether this fold's job is
	 * done is its own row on the page above (./home-sections.ts).
	 *
	 * each is named by its own band, and the two names are the fundraiser's rather than the
	 * account's: what an operator is reading is which ways a donor may give and whether a donor may
	 * ask to give again.
	 *
	 * **it draws nothing at all, form included, where none of the three has anything to say.** that
	 * is every deployment holding no Stripe key, which is every deployment being set up for the
	 * first time — and an empty band standing over the boxes costs the fold a step of the section's
	 * own and a boundary above the block below it, which is a heading given a rule that says a
	 * subject ended when nothing came before it. so the form is inside this rather than around it:
	 * a guard outside the awaited block cannot read what the readings resolved to.
	 *
	 * **the form holds two presses and both stand inside a block this function draws.** Register
	 * sits in a wallet's own panel ({@link hostPanel}) — outside the form in the tree, and named back
	 * on to it by {@link READINGS_FORM} — and the one that provisions what a repeating gift is
	 * collected against stands in {@link repeating}'s `absent` arm. so a form with nothing drawn
	 * provably holds neither.
	 */
	const readings = (payments: PaymentsRead | null, gifts: RecurringRead | null): ReactNode => {
		// what the block below has in it, decided before it is drawn: a read that could not be made
		// leaves no line, and a heading over nothing is a subject the screen raises and then says
		// nothing about. the press's own outcome keeps the block on its own, because an outcome
		// reports at the control that caused it and the press that failed is very often the press
		// whose next read fails too.
		const line = gifts === null || gifts.kind === 'unread' ? null : repeating(gifts);
		const outcome = busy ? null : provisionOutcome();

		const unread = unreadable(payments, gifts);
		const read = payments === null || payments.kind === 'unread' ? null : payments;
		/* the two lists the ledger is drawn from, narrowed here rather than inside {@link rails},
		   because whether each of them landed is what decides where the press's own answer goes: the
		   panels hang off the rails, so a fold with no rails has no panel to draw one in and a fold
		   whose sites could not be read has nothing to put in a panel. */
		const railLines =
			read !== null && read.report.rails.state === 'read' ? read.report.rails.rails : null;
		const hostLines = read === null ? null : walletHostLines(wallets, read);
		/* the same read that answered for the rails, so a read that did not land draws no panel and
		   says so once above. a deployment that answered nothing at all is already saying so on the
		   line above this one, which is the same sentence about the same request — but the press's own
		   outcome still draws, for {@link walletsOutcome}'s reason, so it is computed ahead of the
		   ledger and handed in rather than dropped with it. */
		const walletsResult = busy ? null : walletsOutcome();
		const methods =
			payments === null
				? null
				: payments.kind === 'unread'
					? noAnswer(payments.read, "it can't say where this Stripe account stands")
					: rails(railLines, hostLines, walletsResult);
		/* and standing on its own where no panel was drawn to carry it. */
		const loose = railLines !== null && hostLines !== null ? null : walletsResult;
		const repeats =
			gifts === null ? null : gifts.kind === 'unread' ? (
				noAnswer(gifts.read, "it can't say whether repeating gifts are set up")
			) : line === null && outcome === null ? null : (
				<div className="adm-named">
					<h3>Recurring donation</h3>
					{outcome}
					{line === null ? null : <StatusLedger>{line}</StatusLedger>}
				</div>
			);

		if (unread === null && methods === null && loose === null && repeats === null) return null;
		return (
			/* its own form, and the press inside it is the whole reason: provisioning what a repeating
			   gift is collected against posts an intent and nothing else, so standing it in the keys
			   form would carry two credentials through a request that reads neither. a `<form>` inside
			   a `<form>` is not a tree the parser keeps, so the two stand side by side. */
			<Form id={READINGS_FORM} method="post" preventScrollReset>
				<div className="adm-stack">
					{unread}
					{methods}
					{loose}
					{repeats}
				</div>
			</Form>
		);
	};

	if (values.vars.kind === 'not-deployed') {
		// this fold is drawn over a deployment that answered a moment ago, so the Worker went between
		// that reading and this one. the way out is the page read again, which draws the state it is
		// actually in rather than boxes over something that is not there.
		return (
			<Section>
				<p className="adm-prose">
					No Worker called {workerName} is in {accountName} any more, so there is nothing holding
					these. Reload this page.
				</p>
			</Section>
		);
	}
	// no box where the read did not land: a press is decided against that read and goes through the
	// same sign-in, so a read that was refused is a press that would be.
	if (values.vars.kind !== 'read') {
		return <Section>{trouble(values.vars)}</Section>;
	}

	return (
		<Section>
			{live === null || live.facts.named === null ? null : named(live.facts.named)}

			{/* the two the deployment answers, and the form the one press among them stands in — both
			    inside `readings` above, because what says whether either draws anything at all is
			    what they resolved to. */}
			<Suspense fallback={asking}>
				<Await resolve={stripeAccount}>
					{(payments) => (
						<Suspense fallback={asking}>
							<Await resolve={recurring}>{(gifts) => readings(payments, gifts)}</Await>
						</Suspense>
					)}
				</Await>
			</Suspense>

			{/* what this deployment has told Stripe to report to it, and where, once there is a
			    registration to read: the signing secret is stored in the same breath the endpoint is
			    created, so a deployment holding one is a deployment Stripe has been told to deliver to.
			    before that there is nothing to report and this draws nothing — the form below is the
			    whole of that state, and a sentence naming an address nothing delivers to yet would be
			    the one thing on this fold that is not true.

			    it stands with the readings and over the boxes because it is one: everything above the
			    form is what the deployment holds, and the form is the one thing on the fold to act on.
			    a reading drawn under it would be a fact an operator meets after the press they came
			    here to make. */}
			{stored?.has('STRIPE_WEBHOOK_SECRET') ? <Webhooks address={address} /> : null}

			{/* the heading names the boxes under it, and the block is what binds it to them:
			    `.adm-named` in packages/operator/src/styles/adm.css is a heading, the close step under
			    it, and a boundary above wide enough that what stands over it and the keys read as two
			    subjects at a squint. a plain div rather than the class on the form itself, because the
			    heading has to stand inside the block and a `<form>` inside a `<form>` is not a tree the
			    parser keeps — everything above stays its own sibling. */}
			<div className="adm-named">
				<h3>
					Your Stripe keys{' '}
					<AnchoredNote mark="info" label="Where to get your two Stripe keys">
						<StripeKeys />
					</AnchoredNote>
				</h3>

				<Form
					{...keys.mount}
					className="adm-stack"
					method="post"
					preventScrollReset
					/* every press on this form comes through here, whichever control carries it — the
					   button below, or the one inside the card it puts up — and what it decides is which
					   of those two this press is.

					   the seam goes first and answers both of the ways a press starts nothing: the rules
					   over the boxes, and the answer already standing over one of them
					   (./use-console-form.ts). a press held back there begins no navigation, so there is
					   no run to report, no question worth asking, and the button never draws `Setting up`
					   over a press that was never made — which is what the branching below is arranged
					   around. */
					onSubmit={(event) => {
						keys.mount.onSubmit(event);
						if (event.defaultPrevented) return;
						// the submit inside the card, which is the press the card was put up to ask about:
						// the question has been asked and answered, so it goes.
						if (confirming !== null) return;
						const element = form.current;
						const held = element === null ? null : boxes(element);
						const ask = held === null ? null : stripeAsked(held, seeded);
						/* and the pair as it stands at the press, kept for the answer that says the
						   deployment took it ({@link sent}). the card the branch below may put up cannot be
						   typed behind, so the press that goes from inside it carries exactly this. */
						typed.current =
							held === null || ask === null || ask.act === null
								? null
								: { act: ask.act, boxes: held };
						const lines =
							ask === null ? [] : confirmLines(ask, MINTED, (name) => stored?.has(name) ?? false);
						/* the first set-up runs on this press and asks nothing. it takes nothing away —
						   every value it touches is stated `Set` — so a card between the press and the run
						   would ask the operator to agree to the press they just made. what no row can
						   carry is the other errand: a re-save deletes the endpoint Stripe is already
						   delivering to, which is what `remakesSetup` reads (./stripe-confirm.ts). */
						if (ask?.act === 'errand' && !remakesSetup(lines)) {
							// the run still reports in the top layer: this press puts no question up, so the
							// card it puts up is the report itself.
							setReporting('pressed');
							return;
						}
						event.preventDefault();
						if (ask === null || ask.act === null) return;
						setConfirming({ act: ask.act, lines, pressed: false });
					}}
				>
					{/* the fields stand apart at the group's own step, which is what says where one label,
					    its sentence and its box end and the next one begins — the step inside a field is
					    narrower on purpose (`.adm-field` in packages/operator/src/styles/adm.css). */}
					<div className="adm-stack">
						<Field
							id={secret.id}
							name={secret.name}
							label="Secret key"
							placeholder="sk_live_…"
							// the code face. these are literals an operator checks character for character
							// against the page they were copied from.
							code
							// which of the thirteen arrive masked, the publishable key below among the ones
							// that do not, is ./secret-groups.ts's.
							masked={isMasked('STRIPE_SECRET_KEY')}
							autoComplete="off"
							spellCheck={false}
							defaultValue={secret.defaultValue}
							// closed while this form's own press is sending them, while a run is going, while
							// another press on the page writes, and while a write that landed has not yet put
							// them back — and never while a refusal to this form's own press is being
							// re-read, which is the answer an operator has to type over ({@link closed}).
							disabled={closed}
							// the far end's sentence about this box ended by the keystroke that changes it
							// (./use-console-form.ts).
							onInput={secret.onInput}
							error={secret.message}
						/>
						<Field
							id={published.id}
							name={published.name}
							label="Publishable key"
							placeholder="pk_live_…"
							code
							autoComplete="off"
							spellCheck={false}
							defaultValue={published.defaultValue}
							disabled={closed}
							onInput={published.onInput}
							error={published.message}
						/>
						{withheldBlock(holding === null ? [] : withheldAmong(holding, PAYMENTS_WRITES))}
					</div>

					{/* what Stripe turned the pair down for, standing over the press that asked and going the
					    moment either box is edited — `standing` is the same answer cut down to the boxes
					    nobody has typed in since (./use-console-form.ts). the row is a field's, drawn
					    outside a field on purpose: it is one sentence with a mark, and what it is about is
					    the two boxes above it rather than either one. */}
					{keys.standing?.[KEY_FIELD('STRIPE_SECRET_KEY')] === undefined ||
					keyRefusal === undefined ? null : (
						<FieldMessage>{keyRefusal}</FieldMessage>
					)}

					<div className="adm-actions">
						{/* the submit of this form, which also makes it the button Enter in either box
						    presses. a press that asks first is stopped at the form above rather than here:
						    what such a press takes away is stated in the card, and the submit carrying it is
						    the control in there. */}
						<SaveButton
							id={SET_UP_PRESS}
							type="submit"
							name="intent"
							value={SET_UP_INTENT}
							state={keys.state}
							label="Save"
							doneLabel="Set up"
							// closed for exactly what closes the boxes above it ({@link closed}): a press made
							// while they are shut posts a form the browser leaves those two boxes out of,
							// which the far end reads as the pair being taken away. the other half — the
							// boxes having nothing to send — is the state's own and is composed with this
							// one by packages/operator/src/components/controls/SaveButton.jsx.
							disabled={closed || undefined}
						/>
					</div>

					{/* the removal answers here and the other two acts answer in the ledger below: an
					    outcome reports at the control that caused it. a write that landed is the button's
					    own `Set up`, so what is left is the ways it did not happen. */}
					{removedFailure === null ? null : wrote(removedFailure)}

					{/* the run that stopped, standing as the report of the press above it — the one that
					    came with the page load as much as this page's own once its card is closed. not a
					    card, because no card is keyed on it: both go up on the press and only the page that
					    pressed has that. no heading, because the stopped line carries the sentence naming
					    what to do. it goes when the next press puts a card up, and the running run that
					    follows replaces the stopped one in the binary. */}
					{live !== null && reportStands(live, reporting !== null || confirming !== null)
						? ledger(live)
						: null}

					{confirming === null ? null : (
						<Modal
							title={ASKS[confirming.act].title}
							/* a run that is going cannot be left: Escape and a press on the ground are the two
							   ways out of the top layer and both come through here, and either would take the
							   only report of a chain still running against three hosts off the screen. */
							onDismiss={() => {
								if (underway) return;
								setConfirming(null);
							}}
							danger={press?.destroys ? press.label : undefined}
							dangerProps={press?.destroys ? press.props : undefined}
							exit={press !== null && !press.destroys ? press.label : undefined}
							exitProps={press !== null && !press.destroys ? press.props : undefined}
							/* `Go back` is only true while nothing has happened. once the press is made it is made,
							   and the way out says so — the run it started is not undone by leaving. */
							cancel={confirming.pressed ? 'Close' : 'Go back'}
							cancelProps={{
								type: 'button',
								disabled: underway || undefined,
								onClick: () => setConfirming(null)
							}}
						>
							{/* one line per value the press touches and nothing about the rest: an operator
							    reading this is deciding whether to make it, and a value they left alone is not
							    part of that decision. all three words are drawn in the descriptive register —
							    packages/operator/src/styles/tokens.css states that such a state carries no
							    mark and no tone, so nothing here colours the removal. the word carries it, and
							    the destructive rank on the confirm carries the rest. */}
							<div>
								{confirming.lines.map((line) => (
									<SettingRow
										key={line.name}
										label={LABEL[line.name] ?? line.name}
										value={line.act}
									/>
								))}
							</div>
							{/* the rest of what the press does, which no row can carry — drawn only for the act
							    it belongs to. it is the whole reason an errand puts a card up at all: a first
							    set-up is made at the button and reaches this only where there is a working
							    set-up to remake (./stripe-confirm.ts). */}
							{confirming.act === 'errand' && remakesSetup(confirming.lines) ? (
								<p className="adm-prose">
									The endpoint Stripe already sends payments to is deleted and registered again.
								</p>
							) : null}
							{confirming.act === 'remove' ? (
								<p className="adm-prose">
									No card can be charged on this deployment afterwards, and the signing secret
									Stripe issued goes with the key. Nothing can read that one back, so keep your own
									copy if you still need it.
								</p>
							) : null}
							{/* the run this card's own press started, reported where that press was made. a
							    removal makes no run at all and answers at the button, so it draws none. */}
							{confirming.pressed && live !== null && !landed ? ledger(live) : null}
						</Modal>
					)}

					{/* the card goes up on the press itself, before there is any reading of the run to
					    draw it from: the first stage is the console handing the secret key to Stripe, and
					    those seconds are exactly the wait the card exists to report. what it draws until
					    the first reading lands is that stage ({@link ledger}), and never the run this fold
					    is holding — a stopped run stays in the binary until the next press clears it, so it
					    is the press before this one ({@link reporting}). */}
					{reporting === null ? null : (
						<Modal
							/* the errand the card is about, which is what it goes on saying once the run
							   stops: not every stop is a failure — a set-up whose keys are stored and
							   published and whose repeating gifts are not is one — so a heading that read as
							   a verdict would be wrong on the half of them the ledger below states exactly. */
							title="Setting up Stripe"
							/* a run that is going cannot be left, for the reason the confirm above states:
							   this card is the only report of a chain still running against three hosts. */
							onDismiss={() => {
								if (underway) return;
								setReporting(null);
							}}
							/* one way out and no press to make. it is stated rather than left to the default,
							   which is an unnamed control that would submit the form this card stands inside
							   (packages/operator/src/components/shell/Dialog.jsx). */
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
		</Section>
	);
}

/**
 * where the two keys come from, one press off the heading.
 *
 * it is the last of what was a paragraph inside the form, and it is the only part of it worth
 * keeping: everything else that paragraph said is what the press does, which the confirm now says
 * against the operator's own boxes. what is left is the one fact a box cannot carry — that both keys
 * are on one screen, and which screen. ./smtp-fold.tsx's `MailProviders` says the same kind of thing
 * about a mail provider, standing above its boxes rather than behind a mark.
 */
function StripeKeys(): ReactNode {
	return (
		<p>
			Both are on one page in your Stripe dashboard:{' '}
			<a href={DASHBOARD} target="_blank" rel="noreferrer">
				Developers &rarr; API keys
			</a>
			. Copy the secret key and the publishable key from the same page, so the pair belongs to one
			account.
		</p>
	);
}

/**
 * what this deployment has told Stripe to report to it, and where.
 *
 * **it is a reading and never a control.** nothing here is a choice: the address follows from where
 * the deployment answers and the list is what the code handles, so a tick box beside an event would
 * offer a press that changes nothing. the form under it establishes all of it from the two keys,
 * and this is where an operator finds out what that press left standing.
 *
 * **every fact is `packages/operator/src/stripe/webhook-endpoint.ts`'s and none is retyped.** the
 * address is joined by the function the console registers with, so a screen and a registration
 * cannot spell one differently; the list is the module's own, so an event added there is a line here
 * without anybody remembering to add one.
 *
 * the address is drawn in a sentence rather than as a chip, because it is read as part of one — the
 * chip is the face a value takes when it stands on its own, which is what every event below is
 * (`.adm-code` and `.adm-chip` in packages/operator/src/styles/base.css and adm.css).
 *
 * the events are counted and shut, and the count is the label: the identifiers standing open under
 * a two-line reading are the longest thing on the fold and say the least — how many events there
 * are is the fact, and which ones they are is what an operator opens when they want it. the list is under a
 * `Disclosure`, so it is a `details` and the platform's own: the keyboard reaches it and find-in-page
 * opens it on a shut list (packages/operator/src/components/data/Disclosure.jsx). the summary names
 * the count and no more — the caret beside it is what says the line opens, and a `+` or a `-` after
 * the words would be a second notation for the state the caret is already drawing.
 *
 * the label stands over the list rather than beside it — an identifier is as long as it is, and a
 * label track beside it leaves every one of them reading in what is left of the row.
 *
 * the list carries its role and its name because neither survives what the sheet does to it —
 * packages/operator/src/styles/base.css takes the marker off every list in the document and
 * `.adm-list` stands the items in a grid, and either on its own stops a browser reporting how many
 * there are.
 */
function Webhooks({ address }: { address: string }): ReactNode {
	const events = `${useId()}-webhook-events`;
	return (
		<div className="adm-named">
			<h3>Webhooks</h3>
			<p className="adm-prose">
				Stripe reports these events to this deployment, at{' '}
				<InlineCode>{webhookEndpointUrl(address)}</InlineCode>.
			</p>
			<Disclosure summary={<span id={events}>{SUBSCRIBED_EVENT_TYPES.length} Events</span>}>
				{/* biome-ignore lint/a11y/noRedundantRoles: not redundant here, for the two reasons above
				    — no marker and a grid, either of which stops a browser reporting this as a list.
				    removing the attribute re-opens the defect. */}
				<ul role="list" aria-labelledby={events} className="adm-list">
					{SUBSCRIBED_EVENT_TYPES.map((event) => (
						<li key={event}>
							<CodeChip>{event}</CodeChip>
						</li>
					))}
				</ul>
			</Disclosure>
		</div>
	);
}

/**
 * what each standing is called on the page and how loudly it is said.
 *
 * **named for approval and never for outcome.** an approved rail is a necessary condition and never
 * a sufficient one — a real gift still fails on the currency, the amount, or where the donor's bank
 * is — so no word here may be read as saying a way of paying will work. `Approved` rather than
 * `Ready` for exactly that reason.
 *
 * the four that are somebody's to fix are told apart rather than collapsed, because they send an
 * operator to four different places: waiting, a requirement on the Stripe dashboard, asking for the
 * rail in the first place, and one switch. the sentence under each says which, and it is the
 * deployment's own.
 */
const STANDING: Record<RailStanding, { word: string; tone: Tone }> = {
	approved: { word: 'Approved', tone: 'done' },
	in_review: { word: 'Being reviewed', tone: 'note' },
	not_approved: { word: 'Not usable yet', tone: 'attention' },
	never_requested: { word: 'Not asked for', tone: 'attention' },
	switched_off: { word: 'Switched off', tone: 'attention' },
	account_cannot_charge: { word: 'Blocked', tone: 'blocker' }
};

/**
 * what each wallet is called on the page.
 *
 * the product names and never the processor's own keys: a fundraiser looking for the button they
 * cannot find on their phone is looking for `Apple Pay`.
 *
 * **it is also which rails carry a panel.** two of its keys are rails the deployment reports on and
 * the third is not, and `railPanel` above reads a rail's own name against this record rather than
 * against a second list — so a wallet named here and nowhere else is a row without the one thing
 * that row is for.
 */
const WALLET_NAMES: Record<Wallet, string> = {
	apple_pay: 'Apple Pay',
	google_pay: 'Google Pay',
	link: 'Link'
};

/**
 * what one site's standing for one wallet is called inside that wallet's panel, and how loudly
 * it is said.
 *
 * **named for what a donor sees and never for what the account holds.** a site registered and
 * switched off is a finished-looking setup that draws no button at all, so the word has to say the
 * button rather than the registration — an operator reading `Registered` beside a site nobody is
 * offered Apple Pay on has been told the opposite of what they came to find out.
 *
 * the three that are somebody's to fix share one mark and are told apart by the word, because they
 * are three different things for one press to do: add a site, switch one back on, and get the
 * processor to draw a button it is holding back.
 */
const ROW_STANDING: Record<WalletRowStanding, { word: string; tone: Tone }> = {
	showing: { word: 'Showing', tone: 'done' },
	not_showing: { word: 'Not showing', tone: 'attention' },
	switched_off: { word: 'Switched off', tone: 'attention' },
	unregistered: { word: 'Not registered', tone: 'attention' }
};

/**
 * what the Link row says beside its label, off what its own sites add up to.
 *
 * two words where the rows above it have six, because there is one act behind every way this row is
 * short: the press that registers the sites. which site is short of it, and why, is the
 * panel the row opens — so a word here that named the reason would be the panel's own ledger
 * summarised into a column that has no room for it.
 *
 * `Showing` is the same word a site drawing it takes in that panel ({@link ROW_STANDING}), and
 * deliberately: the row is the panel's own reading said once, so a second vocabulary for it would be
 * two names for one fact a press away from each other.
 */
const LINK_STANDING: Record<LinkStanding, { word: string; tone: Tone }> = {
	everywhere: { word: 'Showing', tone: 'done' },
	not_everywhere: { word: 'Not showing everywhere', tone: 'attention' }
};
