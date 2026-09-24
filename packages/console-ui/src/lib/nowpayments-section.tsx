import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { SettingRow } from '@better-giving/operator/components/data/SettingRow';
import { CoinPicker } from '@better-giving/operator/components/forms/CoinPicker';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { Section } from '@better-giving/operator/components/shell/Layout';
import { StatusLedger, StatusLine } from '@better-giving/operator/components/status/StatusLine';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import type { ReactNode } from 'react';
import { Fragment, Suspense, useEffect, useState } from 'react';
import { Await, Form } from 'react-router';
import { nowpaymentsCurrencies } from '../api/client';
import type {
	DeployedValues,
	NowpaymentsPress,
	PaymentsRead,
	ValuesRefusal,
	VarsWritten
} from '../api/types';
import type { HeldValues } from './held-values';
import { heldValues, withheldAmong } from './held-values';
import type { CoinsRead } from './nowpayments-coins';
import {
	COINS_CHOOSE,
	COINS_DEBOUNCE,
	COINS_UNREAD,
	coinsBox,
	coinsLanded,
	coinsTyped
} from './nowpayments-coins';
import type { NowpaymentsAnswer, NowpaymentsBox, NowpaymentsLine } from './nowpayments-setup';
import {
	NOWPAYMENTS_BOXES,
	NOWPAYMENTS_FIELD,
	NOWPAYMENTS_FORM,
	NOWPAYMENTS_NAME,
	NOWPAYMENTS_SAVE_INTENT,
	nowpaymentsAnswer,
	nowpaymentsAsks,
	nowpaymentsHeld,
	nowpaymentsPhase,
	railsToDraw
} from './nowpayments-setup';
import { STANDING, configuredStanding, processorStanding } from './processor-payments';
import { keysTrouble, noAnswer } from './processor-screen';
import { useReseeded } from './reseed';
import { Said } from './said';
import { NOWPAYMENTS_GROUP, SECRET_GROUPS, isMasked } from './secret-groups';
import { refusalIn } from './secret-trouble';
import { useConsoleForm } from './use-console-form';
import { FREE_INTENT, WithheldValues } from './withheld-values';

// the whole of NOWPayments on this deployment — what the deployment could not answer about it, and
// the three boxes and one press that set crypto gifts up.
//
// **each processor has a page, and this is NOWPayments'** (../routes/_sections.payments.nowpayments.tsx).
// it is ./chariot-section.tsx's arrangement cut to a press that starts no run: the binary checks the
// key and the payout currency against NOWPayments and writes all three in the request that made the
// press (./nowpayments-setup.ts), so the answer lands at the button or at the box it is about, and no
// card reports anything.
//
// **a processor nobody has configured draws no reading at all**, for ./paypal-section.tsx's reason.
// one that answered draws its one rail only where the rail is not approved — the account has no coin
// selected — because working is the silent default (`railsToDraw` in ./nowpayments-setup.ts). the
// line is drawn as ./paypal-section.tsx's `Rails` draws a standing. a read that did not land draws
// the deployment's sentence about it.
//
// **the payout box offers what the key lists, and reads that list itself.** the coins the account
// can be paid out in are a read rather than a press, so it is made from the box and never through
// the route (../api/client.ts): a press closes every control on the page while it is in flight, and
// a list read again behind a key being typed must close nothing. the key it is read under is the one
// in the box above it and never one the deployment is holding, which is what makes the list about
// the account whose key is about to be saved. ./nowpayments-coins.ts holds every decision the box
// makes, and this file is its drawing.
//
// **nothing about notifications is drawn.** each payment names its own callback address, so the
// deployment reports the subscription `not_applicable` and there is no endpoint to register, read or
// repair.
//
// **it is the screen's body and not its route.** every read it draws was taken by the route that
// mounts it and the press it makes is answered there.

/**
 * the group this section's press writes, taken out of the enumeration rather than named again.
 */
const NOWPAYMENTS_WRITES = SECRET_GROUPS.filter((group) => group.id === NOWPAYMENTS_GROUP).flatMap(
	(group) => group.names
);

/** what each box is called. */
const LABEL: Record<NowpaymentsBox, string> = {
	apiKey: 'API key',
	ipnSecret: 'IPN secret',
	outcomeCurrency: 'Payout currency'
};

/** where a box's value comes from, for the boxes whose label cannot say it. */
const HINT: Partial<Record<NowpaymentsBox, ReactNode>> = {
	outcomeCurrency: 'Must match the outcome wallet set in your NOWPayments dashboard.'
};

/** what the one press says it will do, where it asks first ({@link nowpaymentsAsks}). */
const ASK = {
	title: 'Replace the API key?',
	press: 'Replace key',
	consequence: 'Payments made under the old key stop being read by this deployment.'
};

export type NowpaymentsSectionProps = {
	/** the values as cloudflare answered for them, which is what the boxes are drawn with. */
	values: DeployedValues;
	/**
	 * where every processor account stands, on the promise the loader handed down — the same read the
	 * other processor screens await, for the reason ./paypal-section.tsx states.
	 */
	payments: Promise<PaymentsRead | null>;
	workerName: string;
	/** the cloudflare account every read is scoped to, named in every sentence about a refusal. */
	accountName: string;
	/** how the last press of the three boxes was answered. */
	nowpayments: NowpaymentsAnswer;
	/** how the last press that frees a value held in a form nothing can read back went, or `null`. */
	freed: VarsWritten | null;
	/** the router is re-reading the page over an answer it has already committed. */
	revalidating: boolean;
	/** something on the page is writing, which holds every other control on it closed. */
	busy: boolean;
	/** which intent is in flight, or `null` where none is. */
	pending: string | null;
};

export function NowpaymentsSection({
	values,
	payments,
	workerName,
	accountName,
	nowpayments,
	freed,
	revalidating,
	busy,
	pending
}: NowpaymentsSectionProps): ReactNode {
	// never drawn: the sections layout stands a gate in this page's place (../lib/cloudflare-gate.ts).
	if (values.vars.kind !== 'read') return null;
	return (
		<Section>
			{/* what the account could not answer, above the boxes that change it, for the Stripe screen's
			    reason. no skeleton while it is asked: what usually lands is nothing, and a placeholder
			    that resolves to nothing moves the page for no reading. */}
			<Suspense fallback={null}>
				<Await resolve={payments}>{(read) => <NowpaymentsAccount read={read} />}</Await>
			</Suspense>

			<NowpaymentsKeysForm
				values={heldValues(values.vars.vars)}
				reading={values.vars}
				answer={nowpayments}
				freed={freed}
				trouble={keysTrouble({ workerName, accountName })}
				revalidating={revalidating}
				busy={busy}
				pending={pending}
			/>
		</Section>
	);
}

/**
 * what the deployment could not answer about NOWPayments, or its rail where that is not approved,
 * and nothing otherwise.
 *
 * the sentence under the unreadable line is the deployment's own, drawn rather than printed: it names the
 * value to fix and marks it (`@better-giving/operator/code-spans`).
 */
function NowpaymentsAccount({ read }: { read: PaymentsRead | null }): ReactNode {
	if (read?.kind === 'unread') {
		return noAnswer(read.read, "it can't say where NOWPayments stands");
	}
	const standing = configuredStanding(processorStanding(read, 'nowpayments'));
	const lines = railsToDraw(read);
	if (lines.length > 0) {
		return (
			<div className="adm-named">
				<h3>Donation methods</h3>
				<StatusLedger aligned>
					{lines.map((line) => (
						<StatusLine
							key={line.rail}
							labelAs="span"
							label={line.label}
							word={STANDING[line.standing].word}
							tone={STANDING[line.standing].tone}
							note={line.note === null ? undefined : <MarkedText text={line.note} />}
						/>
					))}
				</StatusLedger>
			</div>
		);
	}
	if (standing?.rails.state !== 'unreadable') return null;
	return (
		<div className="adm-stack">
			<FieldMessage>
				This deployment couldn’t reach NOWPayments, so it can’t say whether crypto gifts can be
				taken.
			</FieldMessage>
			<p className="adm-prose">
				<MarkedText text={standing.rails.detail} />
			</p>
		</div>
	);
}

/** the three boxes and the one press. */
function NowpaymentsKeysForm({
	values,
	reading,
	answer,
	freed,
	trouble,
	revalidating,
	busy,
	pending
}: {
	/** what the deployment is holding, which is what the boxes are drawn with (./held-values.ts). */
	values: HeldValues;
	/** the read `values` was taken from, whose identity says the page has been read again (./reseed.ts). */
	reading: DeployedValues['vars'];
	answer: NowpaymentsAnswer;
	/** what a failed write says (./processor-screen.tsx). */
	trouble: (written: ValuesRefusal) => ReactNode;
} & Pick<NowpaymentsSectionProps, 'freed' | 'revalidating' | 'busy' | 'pending'>): ReactNode {
	const own = pending === NOWPAYMENTS_SAVE_INTENT;
	const standing = nowpaymentsAnswer(answer);
	const spent = useReseeded({ landed: standing.stored, pending: own, reading });
	const { inFlight, underway, closed } = nowpaymentsPhase({
		own,
		revalidating,
		busy,
		stored: standing.stored,
		spent
	});
	/* nothing the last press said stands over the next one while it is sent: it is about boxes that
	   may no longer hold what it was said of. */
	const said = inFlight ? null : standing;
	const failure = said === null || said.written === null ? null : refusalIn(said.written);

	/* the answer as the route handed it, whose identity changes with each press and with nothing else,
	   so a second refusal naming the same box moves focus again. */
	const report = answer.saved ?? answer.refused;
	const seeds = values.seeds;
	const keys = useConsoleForm(NOWPAYMENTS_FORM, {
		report,
		landed: standing.stored,
		spent,
		refused: said?.boxes ?? null,
		defaultValue: Object.fromEntries(
			NOWPAYMENTS_BOXES.map((box) => [NOWPAYMENTS_FIELD(box), seeds[NOWPAYMENTS_NAME[box]] ?? ''])
		),
		busy: busy && !own,
		pending: underway
	});
	const form = keys.mount.ref;

	/** the confirm's lines, or `null` where it is not on the screen. */
	const [confirming, setConfirming] = useState<readonly NowpaymentsLine[] | null>(null);

	const seedKey = seeds[NOWPAYMENTS_NAME.apiKey] ?? '';
	/** what the key box is holding, which is the key the coin list is read under. */
	const [key, setKey] = useState(seedKey);
	/* a landed write puts the boxes back by resetting the form (./reseed.ts), and a reset fires no
	   input event — so the key the list is read under is taken off the seed again here. */
	useEffect(() => {
		setKey(seedKey);
	}, [seedKey]);

	/** the coins that key can be paid out in, as far as the box has been told (./nowpayments-coins.ts). */
	const [coins, setCoins] = useState<CoinsRead>(COINS_UNREAD);
	useEffect(() => {
		const asked = key.trim();
		setCoins((read) => coinsTyped(read, asked));
		if (asked === '') return;
		const timer = setTimeout(() => {
			/* a read that could not be made at all leaves the box exactly as it was, and says nothing:
			   it means the binary has stopped, which every press on this page then reports at itself
			   and the route draws as the whole screen (../routes/_index.tsx). */
			nowpaymentsCurrencies(asked).then(
				(listing) => setCoins((read) => coinsLanded(read, asked, listing)),
				() => {}
			);
		}, COINS_DEBOUNCE);
		return () => clearTimeout(timer);
	}, [key]);

	const coinBox = coinsBox(coins, seeds[NOWPAYMENTS_NAME.outcomeCurrency] ?? '');

	/* the question is left the moment its own press is answered, whatever the answer says: a landed
	   write reports at the button underneath, and a refused one leaves the operator in the box it
	   named — neither is readable behind a card. */
	useEffect(() => {
		if (report === null) return;
		setConfirming(null);
	}, [report]);

	/** what the three boxes hold right now, trimmed as the route reads them. */
	const typed = (element: HTMLFormElement): NowpaymentsPress => {
		const value = (box: NowpaymentsBox) =>
			nowpaymentsHeld(element.elements.namedItem(NOWPAYMENTS_FIELD(box)));
		return {
			apiKey: value('apiKey'),
			ipnSecret: value('ipnSecret'),
			outcomeCurrency: value('outcomeCurrency')
		};
	};

	return (
		/* the boundary `.adm-named` stands between blocks (packages/operator/src/styles/adm.css), with
		   no heading, for ./chariot-section.tsx's reason: the page's title already names what the boxes
		   set. */
		<div className="adm-named">
			<Form
				{...keys.mount}
				className="adm-stack"
				method="post"
				preventScrollReset
				/* the seam goes first and answers both ways a press starts nothing. a press past it that
				   replaces a held key asks first, and the submit inside the card is the press itself. */
				onSubmit={(event) => {
					keys.mount.onSubmit(event);
					if (event.defaultPrevented) return;
					if (confirming !== null) return;
					const element = form.current;
					if (element === null) return;
					const lines = nowpaymentsAsks(typed(element), seeds, values.held);
					if (lines === null) return;
					event.preventDefault();
					setConfirming(lines);
				}}
			>
				<div className="adm-stack">
					{NOWPAYMENTS_BOXES.map((box) => {
						const bound = keys.box(keys.fields[NOWPAYMENTS_FIELD(box)]);
						return (
							<Fragment key={box}>
								{/* the payout coin is chosen out of what the key lists and the two credentials are
								    typed, so one of the three is a list and the other two are boxes. the list is
								    searched rather than scrolled: what the key lists is two hundred codes an
								    operator is matching one of against their NOWPayments dashboard. */}
								{box === 'outcomeCurrency' ? (
									<>
										<CoinPicker
											id={bound.id}
											name={bound.name}
											label={LABEL[box]}
											hint={HINT[box]}
											options={coinBox.options}
											retired={coinBox.retired}
											note={coinBox.note}
											placeholder={COINS_CHOOSE}
											defaultValue={bound.defaultValue}
											disabled={closed || coinBox.disabled}
											onChoose={() => bound.onInput?.()}
											error={bound.error}
										/>
										{coinBox.detail === null ? null : <Said answer={{ detail: coinBox.detail }} />}
									</>
								) : (
									<Field
										id={bound.id}
										name={bound.name}
										label={LABEL[box]}
										hint={HINT[box]}
										code
										masked={isMasked(NOWPAYMENTS_NAME[box])}
										autoComplete="off"
										spellCheck={false}
										defaultValue={bound.defaultValue}
										disabled={closed}
										onInput={(event) => {
											bound.onInput?.();
											if (box === 'apiKey') setKey(event.currentTarget.value);
										}}
										error={bound.error}
									/>
								)}
								{/* NOWPayments' own words about this box, for as long as its sentence stands. */}
								{said?.said?.box === box && keys.standing?.[bound.name] !== undefined ? (
									<Said answer={said.said} />
								) : null}
							</Fragment>
						);
					})}
					<WithheldValues
						names={withheldAmong(values, NOWPAYMENTS_WRITES)}
						all={values.withheld}
						consequence="Until these are saved again, this deployment takes no crypto gift through NOWPayments."
						written={freed}
						trouble={trouble}
						busy={busy && pending !== FREE_INTENT}
						freeing={pending === FREE_INTENT}
					/>
				</div>

				<div className="adm-actions">
					<SaveButton
						type="submit"
						name="intent"
						value={NOWPAYMENTS_SAVE_INTENT}
						state={keys.state}
						disabled={closed || undefined}
					/>
				</div>

				{/* what stopped the press short of a write, and a write that did not land, at the button
				    that made it. a landed write is the button's own tick. */}
				{said === null || said.unanswered === null ? null : (
					<>
						<FieldMessage>NOWPayments didn’t answer, so nothing was saved. Try again.</FieldMessage>
						<Said answer={{ detail: said.unanswered }} />
					</>
				)}
				{failure === null ? null : trouble(failure)}

				{confirming === null ? null : (
					<Modal
						title={ASK.title}
						onDismiss={() => setConfirming(null)}
						danger={ASK.press}
						dangerProps={{
							type: 'submit',
							name: 'intent',
							value: NOWPAYMENTS_SAVE_INTENT,
							disabled: own || undefined,
							'aria-busy': own || undefined
						}}
						cancel="Go back"
						cancelProps={{ type: 'button', onClick: () => setConfirming(null) }}
					>
						{/* what the press costs, which is the one thing the screen behind the card cannot say,
						    and then one line per box it changes. the words are drawn in the descriptive
						    register — packages/operator/src/styles/tokens.css states that such a state carries
						    no mark and no tone. */}
						<p className="adm-prose">{ASK.consequence}</p>
						<div>
							{confirming.map((line) => (
								<SettingRow key={line.box} label={LABEL[line.box]} value={line.act} />
							))}
						</div>
					</Modal>
				)}
			</Form>
		</div>
	);
}
