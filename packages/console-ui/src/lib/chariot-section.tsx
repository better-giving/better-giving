import { Modal } from '@better-giving/operator/behaviour/Dialog';
import type { Tone } from '@better-giving/operator/components/closed-sets';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { CodeChip, InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { Section } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusLedger, StatusLine } from '@better-giving/operator/components/status/StatusLine';
import {
	CHARIOT_EVENT_CATEGORY,
	CHARIOT_WEBHOOK_PATH
} from '@better-giving/operator/chariot/webhook-subscription';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import type { ReactNode } from 'react';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Await, Form, Link, useRevalidator } from 'react-router';
import { chariotRun } from '../api/client';
import type {
	AddressRead,
	ChariotFacts,
	ChariotFailure,
	ChariotRunRead,
	ChariotStage,
	DeployedValues,
	PaymentsRead,
	ProcessorPayments,
	ValuesRefusal,
	VarsWritten
} from '../api/types';
import type { ChariotBox, ChariotBoxes, ChariotStop, FailedCall } from './chariot-setup';
import {
	CHARIOT_BOXES,
	CHARIOT_FIELD,
	CHARIOT_FORM,
	CHARIOT_LIVE,
	CHARIOT_SETUP_INTENT,
	LINES,
	boxesStanding,
	chariotStop,
	connectWaiting,
	failureSays,
	keyTurnedDown,
	lineAt,
	reportStands
} from './chariot-setup';
import type { HeldValues } from './held-values';
import { heldValues, withheldAmong } from './held-values';
import { useKeptPress } from './kept-press';
import { REACHED_CHARIOT, pressStopped } from './press-stopped';
import { configuredStanding } from './processor-payments';
import { keysTrouble, noAnswer } from './processor-screen';
import { useReseeded } from './reseed';
import { pollOutlived, runKind, standingRun } from './run-poll';
import { Said } from './said';
import { CHARIOT_GROUP, SECRET_GROUPS, isMasked } from './secret-groups';
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

// the whole of Chariot on this deployment — what the deployment answered about it, and the two
// boxes and one press that set gifts from donor-advised funds up.
//
// **each processor has a page, and this is Chariot's** (../routes/_sections.payments.chariot.tsx).
// it is ./paypal-section.tsx's arrangement cut to what Chariot is: one press, a run in the binary
// (`packages/console/internal/chariot/setup.go`) reported where it was pressed, and no second press
// beside it — a grant is one gift, so there is no repeating-gift block, and no rate an operator
// answers.
//
// **a processor nobody has configured draws no reading at all, and that is not a failure**, for
// PayPal's reason: the boxes that configure it are the whole truth of that state.
//
// **nothing about notifications is read back, and that is Chariot's normal state rather than a
// fault.** the deployment's port lists no subscriptions and confirms no signing secret, so the
// report's subscription reading is always `unreadable` and its webhook reading never `verifying`
// (packages/app/src/lib/server/console/report.ts). drawn, both would be a standing warning over
// every deployment that is set up. what settles the subscription is the press.
//
// **the Connect id and the signing secret have no box.** the press fetches the one and mints the
// other, so a box for either would be a second way to name what the key already found
// (`MINTED_BY_CONSOLE` in ./secret-groups.ts).
//
// **it is the screen's body and not its route.** every read it draws was taken by the route that
// mounts it and the press it makes is answered there; what it reaches for itself is the run while it
// goes.

/**
 * where a sandbox key is asked for, and where an organisation missing from Chariot's directory asks
 * to be added.
 */
const SUPPORT = 'support@givechariot.com';

/** where a live key is asked for, once Chariot has reviewed the donation form. */
const INTEGRATIONS = 'integrations@givechariot.com';

/**
 * the group this section's press writes: the three boxes' values and the two the run settles beside
 * them. taken out of the enumeration rather than named again.
 */
const CHARIOT_WRITES = SECRET_GROUPS.filter((group) => group.id === CHARIOT_GROUP).flatMap(
	(group) => group.names
);

/** what each box is called. */
const LABEL: Record<ChariotBox, string> = {
	apiKey: 'API key',
	address: 'API address'
};

/** where a box's value comes from, for the boxes whose label cannot say it. */
const HINT: Partial<Record<ChariotBox, ReactNode>> = {
	apiKey: (
		<>
			Chariot issues keys by email. Ask <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a> for a sandbox
			key. A live key comes from <a href={`mailto:${INTEGRATIONS}`}>{INTEGRATIONS}</a> once Chariot
			has reviewed your donation form.
		</>
	)
};

/** the two boxes' names, which a refusal about the key at this address is about together. */
const CHARIOT_BOX_FIELDS = CHARIOT_BOXES.map((box) => CHARIOT_FIELD(box));

/** how often the screen asks how far the run has got. the Stripe screen's interval. */
const POLL_MS = 2500;

/** the press, named so the card can put the reader back on it when it goes. */
const SET_UP_PRESS = 'chariot-set-up-press';

/**
 * what the last press of the set-up said, as the route reads it off the action.
 *
 * ./paypal-section.tsx's `PaypalPress`: the run is read off the loader, and this carries the three
 * ways a press started none.
 */
export type ChariotPress = {
	/** the setup run the binary is holding, as the page load read it. */
	run: ChariotRunRead | null;
	/** the boxes the last press came back naming, by field, or `null`. */
	refused: Record<string, string> | null;
	/** the binary's own door turned the boxes down, so no run began. */
	turnedDown: boolean;
	/** the binary could not write anywhere, so no run began. */
	unwritten: ValuesRefusal | null;
};

export type ChariotSectionProps = {
	/** the values as cloudflare answered for them, which is what the boxes are drawn with. */
	values: DeployedValues;
	/**
	 * where every processor account stands, on the promise the loader handed down — the same read the
	 * other two processor screens await, for the reason ./paypal-section.tsx states.
	 */
	payments: Promise<PaymentsRead | null>;
	workerName: string;
	/** the cloudflare account every read is scoped to, named in every sentence about a refusal. */
	accountName: string;
	/** the set-up press and its run. */
	chariot: ChariotPress;
	/** how the last press that frees a value held in a form nothing can read back went, or `null`. */
	freed: VarsWritten | null;
	/** the router is re-reading the page over an answer it has already committed. */
	revalidating: boolean;
	/** something else on the page is writing, which holds every control on it closed. */
	busy: boolean;
	/** which intent is in flight, or `null` where none is. */
	pending: string | null;
};

export function ChariotSection({
	values,
	payments,
	workerName,
	accountName,
	chariot,
	freed,
	revalidating,
	busy,
	pending
}: ChariotSectionProps): ReactNode {
	// never drawn: the sections layout stands a gate in this page's place (../lib/cloudflare-gate.ts).
	if (values.vars.kind !== 'read') return null;
	const holding = heldValues(values.vars.vars);
	return (
		<Section>
			{/* what the account could not answer, above the boxes that change it, for the Stripe screen's
			    reason. no skeleton while it is asked: what usually lands is nothing, and a placeholder
			    that resolves to nothing moves the page for no reading. */}
			<Suspense fallback={null}>
				<Await resolve={payments}>{(read) => <ChariotAccount read={read} />}</Await>
			</Suspense>

			{/* once the press has stored the signing secret, which it mints in the same run that creates
			    the subscription — the placement and the gate are ./stripe-section.tsx's `Webhooks`. */}
			{holding.held.has('CHARIOT_WEBHOOK_SECRET') ? <Webhooks /> : null}

			<ChariotKeysForm
				values={holding}
				reading={values.vars}
				press={chariot}
				freed={freed}
				trouble={keysTrouble({ workerName, accountName })}
				workerName={workerName}
				accountName={accountName}
				busy={busy}
				pending={pending}
				revalidating={revalidating}
			/>
		</Section>
	);
}

/**
 * what the deployment could not answer about Chariot, and nothing where it answered.
 *
 * **only the rails are read here, and only a rail that could not be read draws.** the subscription
 * and signing-secret readings are Chariot's normal state and never drawn (the header states why). a
 * rail that was read is always approved — a key Chariot accepts is the whole of what the deployment
 * reports (`readAccountChargeability` in packages/app/src/lib/server/payments/chariot.ts) — and a
 * rail is taken to work unless something says otherwise, so a read rail draws no row.
 */
function ChariotAccount({ read }: { read: PaymentsRead | null }): ReactNode {
	if (read === null) return null;
	if (read.kind === 'unread') {
		return noAnswer(read.read, "it can't say where Chariot stands");
	}
	const entry: ProcessorPayments | undefined = read.report.processors.find(
		(one) => one.processor === 'chariot'
	);
	const standing = configuredStanding(entry ?? null);
	if (standing?.rails.state !== 'unreadable') return null;
	return (
		<div className="adm-stack">
			<FieldMessage>
				This deployment couldn’t reach Chariot, so it can’t say whether gifts from donor-advised
				funds can be taken.
			</FieldMessage>
			<p className="adm-prose">
				<MarkedText text={standing.rails.detail} />
			</p>
		</div>
	);
}

/**
 * what this deployment's set-up told Chariot to report to it, and where.
 *
 * `Webhooks` in ./stripe-section.tsx cut to one event: a reading and never a control, every fact
 * packages/operator/src/chariot/webhook-subscription.ts's, and the path rather than the address, and
 * the heading and its sentence as one `hgroup`, for that component's reasons. one identifier is
 * shorter than any count of it, so it stands open and is no list.
 *
 * the event is a line of a ledger rather than a bare chip, so what the press left standing reads as
 * the same tick the run's own lines end on. the word rides the mark: the identifier is the whole
 * subject, and `Subscribed` beside it would say the tick a second time.
 */
function Webhooks(): ReactNode {
	return (
		<div className="adm-named">
			<div className="adm-stack">
				<hgroup>
					<h3>Webhooks</h3>
					<p className="adm-prose">
						Chariot reports this event to this deployment, at{' '}
						<InlineCode>{CHARIOT_WEBHOOK_PATH}</InlineCode>.
					</p>
				</hgroup>
				<StatusLedger>
					<StatusLine
						labelAs="span"
						label={<CodeChip>{CHARIOT_EVENT_CATEGORY}</CodeChip>}
						tone="done"
						word="Subscribed"
						wordOnMark
					/>
				</StatusLedger>
			</div>
		</div>
	);
}

/**
 * what a line says once the chain has found out about its subject, or its standing note until then.
 *
 * the organisation is named as Chariot's directory lists it and the Connect by its id, drawn as code
 * because it is what an operator quotes to Chariot.
 */
function lineNote(stage: ChariotStage, facts: ChariotFacts | null, note: string): ReactNode {
	const organisation = facts?.organisation;
	const connect = facts?.connect;
	const subscription = facts?.subscription;
	if (stage === 'finding' && organisation) {
		return [organisation.name, organisation.city, organisation.state]
			.filter((part) => part !== '')
			.join(', ');
	}
	if (stage === 'connecting' && connect) {
		return (
			<>
				Connect <InlineCode>{connect.id}</InlineCode>
			</>
		);
	}
	if (stage === 'subscribing' && subscription) {
		return subscription.kind === 'replaced'
			? 'Older notification addresses are replaced with a new one.'
			: 'A notification address is added for this deployment.';
	}
	return note;
}

/** what each call Chariot did not carry out was for, completing "Chariot didn't …". */
const CALLED: Record<FailedCall, string> = {
	check: 'check this key',
	search: 'search its directory for your EIN',
	connect: 'connect your organisation',
	list: 'list its notification addresses',
	subscribe: 'add a notification address for this deployment'
};

/** the two boxes, the one press, and the run it starts. */
function ChariotKeysForm({
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
}: {
	/** what the deployment is holding, which is what the boxes are drawn with (./held-values.ts). */
	values: HeldValues;
	/** the read `values` was taken from, whose identity says the page has been read again (./reseed.ts). */
	reading: DeployedValues['vars'];
	press: ChariotPress;
	/** what a failed write says (./processor-screen.tsx). */
	trouble: (written: ValuesRefusal) => ReactNode;
} & Pick<
	ChariotSectionProps,
	'freed' | 'workerName' | 'accountName' | 'busy' | 'pending' | 'revalidating'
>): ReactNode {
	/* how far the press has got, asked of the binary rather than of the page, and the last thing
	   either reading said — ./paypal-section.tsx argues both. */
	const [polled, setPolled] = useState<ChariotRunRead | null | undefined>(undefined);
	const [remembered, setRemembered] = useState<ChariotRunRead | null>(null);
	const { answered, live } = standingRun({ run: press.run, polled, remembered });
	useEffect(() => {
		if (answered === null) return;
		setRemembered(answered);
	}, [answered]);
	const working = live?.kind === 'running';
	const landed = live?.kind === 'ended' && live.outcome.kind === 'done';

	const phase = useMemo<PressPhase>(
		() => ({ pending: pending === CHARIOT_SETUP_INTENT, revalidating }),
		[pending, revalidating]
	);
	const turnedDown = press.turnedDown || press.unwritten !== null;
	const pressAnswer = useMemo<PressAnswer>(
		() => ({ turnedDownPair: turnedDown, refused: press.refused }),
		[turnedDown, press.refused]
	);
	const underway = runUnderway(phase, pressAnswer, working);
	const elsewhere = writingElsewhere(phase, busy);

	useEffect(() => {
		if (!working) return;
		let gone = false;
		const timer = setTimeout(() => {
			// a read that did not land is a console that has stopped, which the page's error boundary draws.
			void chariotRun().then((read) => {
				if (!gone) setPolled(read);
			});
		}, POLL_MS);
		return () => {
			gone = true;
			clearTimeout(timer);
		};
		// `polled` schedules the next ask: each answer is a new value, so the poll goes on with the run.
	}, [working, polled]);

	/* the page read again once, when the run stops, so the reading above is of what this press set up.
	   a ref rather than a dependency: the revalidator is a fresh object each render. */
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

	/* the boxes as they stood at the submit, kept once the press is in flight (`boxesStanding` in
	   ./chariot-setup.ts). they outlive the page (./kept-press.ts). */
	const typed = useRef<ChariotBoxes | null>(null);
	const [sent, setSent] = useKeptPress<ChariotBoxes>(CHARIOT_SETUP_INTENT);
	const [pressedHere, setPressedHere] = useState(false);
	useEffect(() => {
		if (pending !== CHARIOT_SETUP_INTENT) return;
		setPolled(undefined);
		setPressedHere(true);
		setSent(typed.current);
	}, [pending]);
	const loaded = runKind(press.run);
	const seen = useRef(loaded);
	useEffect(() => {
		if (!pollOutlived(seen.current, loaded)) return;
		seen.current = loaded;
		setPolled(undefined);
	}, [loaded]);

	const [rememberedRefusal, setRememberedRefusal] = useState<PressRefusal | null>(null);
	useEffect(() => {
		if (!answerLanded(phase)) return;
		const refusal = answeredRefusal(pressAnswer);
		setRememberedRefusal(refusal);
		if (refusal !== null) setSent(null);
	}, [phase, pressAnswer]);
	const pressRefusal = standingRefusal(phase, pressAnswer, rememberedRefusal);
	const namedBoxes = pressRefusal?.kind === 'boxes' ? pressRefusal.errors : null;

	/* Chariot turning the key down, on a press made here and not while the next one is going: a run
	   survives a reload, and a reloaded page's boxes hold nothing that was sent. */
	const keyRefused = keyTurnedDown(live) && pressedHere && !underway;
	/* the door's refusal is a sentence about the boxes as a whole; the unwritten press is its own. */
	const doorTurnedDown = pressRefusal?.kind === 'pair' && press.unwritten === null;

	const reportedKey = values.seeds.CHARIOT_API_KEY ?? '';
	const reportedAddress = values.seeds.CHARIOT_API_URL || CHARIOT_LIVE;
	const reported: ChariotBoxes = useMemo(
		() => ({ apiKey: reportedKey, address: reportedAddress }),
		[reportedKey, reportedAddress]
	);
	const reread = useReseeded({ landed, pending: underway, reading });
	const { seeded, spent } = useMemo(
		() => boxesStanding({ reported, sent, run: live, reread }),
		[reported, sent, live, reread]
	);
	const closed = keysClosed(phase, pressAnswer, busy, working, { landed, spent });

	const keySentence = 'Chariot didn’t accept this key at this address. Check both.';
	const doorSentence = 'The console couldn’t read these boxes. Check both.';

	const keys = useConsoleForm(CHARIOT_FORM, {
		report: live,
		landed,
		spent,
		/* a refusal about the key and the address together is handed to the seam as the far end's
		   answer about the key's box, which puts the operator back in it, and as about both boxes, so
		   an edit to either ends it; the sentence stands at the press, since it is about more than
		   that box. */
		refused:
			namedBoxes ??
			(doorTurnedDown
				? { [CHARIOT_FIELD('apiKey')]: doorSentence }
				: keyRefused
					? { [CHARIOT_FIELD('apiKey')]: keySentence }
					: null),
		together: namedBoxes === null ? CHARIOT_BOX_FIELDS : null,
		defaultValue: {
			[CHARIOT_FIELD('apiKey')]: seeded.apiKey,
			[CHARIOT_FIELD('address')]: seeded.address
		},
		busy: elsewhere,
		pending: underway,
		// a run that ended short of `done` is repaired by pressing again over the same boxes.
		armed: live?.kind === 'ended' && live.outcome.kind !== 'done'
	});
	const form = keys.mount.ref;

	/** one box bound, with a refusal about more than one box drawn at none of them. */
	const bind = (box: ChariotBox) => {
		const field = keys.fields[CHARIOT_FIELD(box)];
		const bound = keys.box(field);
		const said = namedBoxes === null ? field.errors?.[0] : bound.error;
		return { ...bound, message: said === undefined ? undefined : <MarkedText text={said} /> };
	};
	const bound: Record<ChariotBox, ReturnType<typeof bind>> = {
		apiKey: bind('apiKey'),
		address: bind('address')
	};

	/** the card the press puts up: `pressed` before its run is read, `reading` once it is. */
	const [reporting, setReporting] = useState<'pressed' | 'reading' | null>(null);
	const answering = useRef(false);
	useEffect(() => {
		if (reporting === null) {
			answering.current = false;
			return;
		}
		if (pending === CHARIOT_SETUP_INTENT) {
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

	/* the card goes when nothing is left to read in it: a refusal that started no run, a key Chariot
	   turned down, and a run that landed. a run that stopped anywhere else keeps it. */
	useEffect(() => {
		if (pressRefusal === null && !landed && !keyTurnedDown(live)) return;
		if (!landed) held.current = false;
		setReporting(null);
	}, [pressRefusal, landed, live]);

	/** why there was nowhere to subscribe or write to, in the address read's own terms. */
	const nowhere = (read: AddressRead, what: string): ReactNode =>
		read.kind === 'not-deployed' ? (
			<FieldMessage>
				No Worker called {workerName} is in {accountName} any more, so {what}. Reload this page.
			</FieldMessage>
		) : read.kind === 'deployed' ? (
			<FieldMessage>
				This deployment answers on no address at all, so Chariot would have nowhere to send
				notifications. Turn its <InlineCode>workers.dev</InlineCode> address back on, or attach a
				domain, then press Save again. Nothing was set up.
			</FieldMessage>
		) : (
			<>
				<FieldMessage>
					The console couldn't work out where this deployment answers, so {what}.
				</FieldMessage>
				<Said answer={read} />
			</>
		);

	/** a Chariot call that did not answer, with Chariot's own words underneath. */
	const chariotTrouble = (failure: ChariotFailure, call: FailedCall): ReactNode => {
		const says = failureSays(failure);
		return (
			<>
				<FieldMessage>
					{says === 'refused'
						? keySentence
						: says === 'forbidden'
							? 'Chariot won’t let this key set this up. Contact Chariot.'
							: says === 'unreachable'
								? 'Chariot didn’t answer. Try again.'
								: `Chariot didn’t ${CALLED[call]}, so nothing was set up.`}
				</FieldMessage>
				<Said answer={failure} />
			</>
		);
	};

	/** what stopped the run, drawn under the line whose stage it stopped at. */
	const stopped = (stop: ChariotStop): ReactNode => {
		switch (stop.kind) {
			case 'landed':
				return null;
			case 'key':
				// a turned-down key is said at the press, so what is left here is Chariot's own words.
				return live?.kind === 'ended' && live.outcome.kind === 'unauthorized' ? (
					<Said answer={live.outcome.failure} />
				) : null;
			case 'failure':
				return chariotTrouble(stop.failure, stop.call);
			case 'unprofiled':
				return noAnswer(stop.read, 'the console couldn’t read your EIN and nothing was set up');
			case 'no-ein':
				return (
					<FieldMessage>
						Add your EIN in the <Link to="/organisation">Organisation</Link> section first.
					</FieldMessage>
				);
			case 'no-contact':
				return (
					<FieldMessage>
						Chariot needs a contact email for your organisation. Add a notification email in{' '}
						<Link to="/organisation">Organisation</Link>, then press Save again.
					</FieldMessage>
				);
			case 'unlisted':
				return (
					<FieldMessage>
						Your EIN isn’t in Chariot’s directory. Check it in{' '}
						<Link to="/organisation">Organisation</Link>, or ask{' '}
						<a href={`mailto:${SUPPORT}`}>{SUPPORT}</a> to add you.
					</FieldMessage>
				);
			case 'ambiguous':
				return (
					<>
						<FieldMessage>
							Chariot lists more than one organisation with your EIN. Contact Chariot.
						</FieldMessage>
						<ul className="adm-list">
							{stop.candidates.map((candidate) => (
								<li key={candidate.id}>
									{[candidate.name, candidate.city, candidate.state]
										.filter((part) => part !== '')
										.join(', ')}
								</li>
							))}
						</ul>
					</>
				);
			case 'ineligible':
				return (
					<FieldMessage>
						Chariot doesn’t accept fund gifts for {stop.name ?? 'your organisation'}. Check your EIN
						in <Link to="/organisation">Organisation</Link>, or contact Chariot.
					</FieldMessage>
				);
			case 'nowhere':
				return nowhere(stop.address, 'nothing was set up');
			case 'insecure':
				return (
					<FieldMessage>
						This deployment answers on <InlineCode>{stop.origin}</InlineCode>, and Chariot only
						sends notifications to an <InlineCode>https://</InlineCode> address. Attach a domain
						served over HTTPS, then press Save again. Nothing was set up.
					</FieldMessage>
				);
			case 'unstored':
				return (
					<>
						<FieldMessage>
							Your organisation is connected on Chariot, but nothing was saved to your deployment,
							so it takes no fund gift yet. Press Save again.
						</FieldMessage>
						{stop.written.kind === 'withheld' ? (
							<WithheldValues
								names={stop.written.names}
								all={values.withheld}
								consequence="Until the key above is saved again, this deployment takes no fund gift through Chariot."
								written={freed}
								trouble={trouble}
								busy={busy || working}
								freeing={pending === FREE_INTENT}
							/>
						) : stop.written.kind === 'nowhere' ? (
							nowhere(stop.written.address, 'nothing was saved')
						) : (
							trouble(stop.written)
						)}
					</>
				);
			case 'unretired':
				return (
					<FieldMessage>
						Set up, but an older notification address is still active. Press Save again.
					</FieldMessage>
				);
			case 'console-stopped':
				return <FieldMessage>{pressStopped(REACHED_CHARIOT)}</FieldMessage>;
		}
	};

	/**
	 * the run, one line per stage.
	 *
	 * `null` is a press whose run has not been read yet, drawn at the stage the chain opens on.
	 */
	const ledger = (read: ChariotRunRead | null): ReactNode => {
		const reached = lineAt(read?.stage ?? 'checking');
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
							note={lineNote(line.stage, read?.facts ?? null, line.note)}
							tone={tone(at)}
							dim={at > reached}
							mark={at > reached ? 'circle-dashed' : undefined}
							word={word(at)}
						>
							{at === reached && read?.kind === 'ended' ? (
								<div className="adm-status__attach">
									{stopped(chariotStop(read.outcome, read.facts))}
								</div>
							) : null}
						</StatusLine>
					))}
				</StatusLedger>
			</div>
		);
	};

	/** what the two boxes hold right now. */
	const boxes = (element: HTMLFormElement): ChariotBoxes => {
		const value = (box: ChariotBox) => {
			const control = element.elements.namedItem(CHARIOT_FIELD(box));
			return control instanceof HTMLInputElement ? control.value.trim() : '';
		};
		return {
			apiKey: value('apiKey'),
			address: value('address') || CHARIOT_LIVE
		};
	};

	return (
		/* the break between blocks (`.adm-break` in packages/operator/src/styles/adm.css), with no
		   heading: the page's title already names what the boxes set, and without the step the form
		   reads as the tail of the block above it. */
		<Form
			{...keys.mount}
			className="adm-stack adm-break"
			method="post"
			preventScrollReset
			/* the seam goes first and answers both ways a press starts nothing; a press past it keeps
			   the boxes it sent and puts up the card that reports the run. */
			onSubmit={(event) => {
				keys.mount.onSubmit(event);
				if (event.defaultPrevented) return;
				typed.current = boxes(event.currentTarget);
				setReporting('pressed');
			}}
		>
			<div className="adm-stack">
				{CHARIOT_BOXES.map((box) => (
					<Field
						key={box}
						id={bound[box].id}
						name={bound[box].name}
						label={LABEL[box]}
						hint={HINT[box]}
						code
						masked={box === 'apiKey' && isMasked('CHARIOT_API_KEY')}
						autoComplete="off"
						spellCheck={false}
						defaultValue={bound[box].defaultValue}
						disabled={closed}
						onInput={bound[box].onInput}
						error={bound[box].message}
					/>
				))}
				<WithheldValues
					names={withheldAmong(values, CHARIOT_WRITES)}
					all={values.withheld}
					consequence="Until these are saved again, this deployment takes no fund gift through Chariot."
					written={freed}
					trouble={trouble}
					busy={busy || working}
					freeing={pending === FREE_INTENT}
				/>
			</div>

			{/* the key turned down, at the press that asked and gone the moment either box is edited:
			    `standing` is the answer cut down to the boxes nobody has typed in since. */}
			{(keyRefused || doorTurnedDown) && keys.standing?.[CHARIOT_FIELD('apiKey')] !== undefined ? (
				<FieldMessage>{doorTurnedDown ? doorSentence : keySentence}</FieldMessage>
			) : null}

			<div className="adm-actions">
				<SaveButton
					id={SET_UP_PRESS}
					type="submit"
					name="intent"
					value={CHARIOT_SETUP_INTENT}
					state={keys.state}
					label="Save"
					doneLabel="Set up"
					disabled={closed || undefined}
				/>
			</div>

			{/* a Connect Chariot holds switched off, at the press that stored it: the card that drew the
			    run has gone by the time it lands. */}
			{connectWaiting(live) && reporting === null ? (
				<Banner tone="note" word="Chariot hasn’t switched on your fund gifts yet" />
			) : null}

			{/* a press the binary could not write at all, at the button that made it. */}
			{press.unwritten === null || phase.pending ? null : trouble(press.unwritten)}

			{/* a run that stopped, standing as the report of the press once no card is up. */}
			{reportStands(live, reporting !== null) ? ledger(live) : null}

			{reporting === null ? null : (
				<Modal
					title="Setting up Chariot"
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
	);
}
