import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { CodeSlab } from '@better-giving/operator/components/data/CodeSlab';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { SelectWithNote } from '@better-giving/operator/components/forms/SelectWithNote';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { Stack } from '@better-giving/operator/components/shell/Layout';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { StatusLedger, StatusLine } from '@better-giving/operator/components/status/StatusLine';
import type {
	LedgerAccountLine,
	QuickbooksCompany,
	QuickbooksReport
} from '@better-giving/operator/console/quickbooks';
import { QUICKBOOKS_PRODUCTION_URL } from '@better-giving/operator/console/quickbooks';
import { useSaveState } from '@better-giving/operator/save-state.react';
import type { SavedFormState } from '@better-giving/operator/saved-form-state.react';
import { useSavedFormState } from '@better-giving/operator/saved-form-state.react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Form, useRevalidator } from 'react-router';
import type {
	DeployedValues,
	QuickbooksRead,
	ValuesRefusal,
	VarsRead,
	VarsWritten
} from '../api/types';
import type { HeldValues } from './held-values';
import { heldValues, withheldInGroup } from './held-values';
import { keysTrouble, valuesGuard } from './processor-screen';
import type {
	QuickbooksAnswer,
	QuickbooksPicks,
	StepName,
	StepStanding
} from './quickbooks-standing';
import {
	KEY_LABEL,
	PICK_BLANK,
	PICKS,
	QUICKBOOKS_FORM,
	UNANSWERED,
	accountPicker,
	backlogSays,
	backlogStands,
	chartStands,
	companyCalled,
	connectAddress,
	credentialsPhase,
	credentialsStands,
	disconnectLines,
	keysAsk,
	landedPress,
	ownPress,
	picksArmed,
	picksHeld,
	picksMissing,
	picksToSave,
	previewed,
	quickbooksRefused,
	retriedGifts,
	retriedStands,
	retryButton,
	startDateAsk,
	startDay,
	startToSave,
	stepsStand,
	unanswered
} from './quickbooks-standing';
import { useReseeded } from './reseed';
import { secretEdits } from './secret-edits';
import type { GroupReport } from './secret-group-form';
import { refusalIn } from './secret-trouble';
import type { SecretGroup } from './secret-groups';
import {
	QUICKBOOKS_GROUP,
	SECRET_GROUPS,
	VALUE_FIELD,
	groupIntent,
	isMasked
} from './secret-groups';
import type { Box as BoundBox } from './use-console-form';
import { useConsoleForm } from './use-console-form';
import { FREE_INTENT, WithheldValues } from './withheld-values';

// where this deployment's books go, and every press an operator has over them — the three values
// off their Intuit app, the company they connect, where a gift is posted in its chart, the gifts
// that have not gone over and the day they are sent from.
//
// **it is the screen's body and not its route.** every read it draws was taken by whatever mounts
// it and every press over the books is a callback answered there — ./chariot-section.tsx's
// arrangement with the router taken out of it: nothing here fetches or reads a loader, so the one
// place such a press becomes a request is the route. the three boxes are the one exception and post
// for themselves, as ./chariot-section.tsx's own do: the group's intent (`groupIntent` in
// ./secret-groups.ts), answered by that same route's `clientAction`. a read that did not land is
// asked again through the router's revalidator, as ./chariot-section.tsx does.
//
// **it is a checklist and one group under it.** Setup, Connect and Accounts are steps, one fold
// each in a ledger of sections; Sync is not a step and is drawn only once all three are done.
// which step is open, shut or locked is `stepsStand` in ./quickbooks-standing.ts, and every other
// decision about a value is beside it there — this package's pool is node-only, so a rule left in
// this file is one no spec can reach (../../vite.config.ts).
//
// **it is not a processor and draws no reading of one.** no money moves on these three values and
// no set-up job waits on them (packages/operator/src/console/quickbooks.ts), so there is no rail,
// no webhook and no account standing here — a deployment that keeps its books somewhere else is
// not half set up.
//
// **nothing here confirms that the books are keeping up.** a connected deployment says which
// company, and the backlog speaks only under that company and only where a gift was given up on
// (./quickbooks-standing.ts).
//
// **the address an operator registers arrives on the report, whole.** it is this deployment's own
// address and the path Intuit sends a browser back to, and only the deployment can say either: no
// hostname is committed to this repository (CLAUDE.md) and the path is packages/app's, which this
// package may not import. so nothing here or above it composes one.

/** where an operator makes the Intuit app whose three values go in the boxes. */
const INTUIT_DEVELOPER = 'https://developer.intuit.com/app/developer/dashboard';

/**
 * the three values this section's boxes set, taken out of the enumeration rather than named again.
 *
 * all three, because every call is built from all three: an operator holding two of them has
 * configured nothing.
 */
const CREDENTIALS = SECRET_GROUPS.filter((group) => group.id === QUICKBOOKS_GROUP).flatMap(
	(group) => group.names
);

/**
 * the example the address box stands on while it is empty, which is every deployment holding no
 * address of its own.
 *
 * **a placeholder is an example and never a value** — the rule ./smtp-fold.tsx's boxes are drawn
 * under, and this box is where it bites. the production address is the same string on every
 * deployment posting to a real company, and a developer connecting a sandbox one types their own:
 * a box drawn holding it is a box the next press stores whether or not anybody read it, and the
 * press an operator makes about the other two boxes is then a deployment posting to a real
 * company's books. nothing here is posted and nothing here is seeded, so an address the operator
 * removed stays removed.
 */
const PLACEHOLDER: Record<string, string> = { QUICKBOOKS_API_URL: QUICKBOOKS_PRODUCTION_URL };

/** each step's word, and the line under it where it has one. Accounts has none. */
const STEP_LINE: Record<StepName, { label: string; note?: string }> = {
	setup: { label: 'Setup', note: 'Create an Intuit app and put its credentials here' },
	connect: { label: 'Connect', note: 'Connect to your app' },
	accounts: { label: 'Accounts' }
};

/** what each picker is called. every one says what it is for without a heading over it. */
const PICK_LABEL: Record<(typeof PICKS)[number], string> = {
	income: 'Gifts go to',
	fee: 'Processing fees go to',
	deposit: 'Net amount goes to'
};

/** what a picker submits under, and the id every description on it is named from. */
const PICK_FIELD = (pick: (typeof PICKS)[number]): string => `quickbooks-${pick}`;

/** the same for the one box a day is typed in. */
const START_FIELD = 'quickbooks-start';

/* the page this section is drawn on names an answer by the type it is handed
   (./quickbooks-standing.ts), so the two spell one thing once. */
export type { QuickbooksAnswer } from './quickbooks-standing';

export type QuickbooksSectionProps = {
	/** the values as cloudflare answered for them, which is what the boxes are drawn with. */
	values: DeployedValues;
	/** where the books stand, as the route resolved it. */
	books: QuickbooksRead;
	workerName: string;
	/** the cloudflare account every read is scoped to, named in every sentence about a refusal. */
	accountName: string;
	/** how the last press of the three boxes was answered (./secret-group-form.tsx). */
	secrets: GroupReport | null;
	/** how the last press on the connection was answered, or `null` where none has been made. */
	answer: QuickbooksAnswer | null;
	/** how the last press that frees a value held in a form nothing can read back went, or `null`. */
	freed: VarsWritten | null;
	/** something on the page is writing, which holds every control on it closed. */
	busy: boolean;
	/** which intent is in flight, or `null` where none is. */
	pending: string | null;
	/** the router is re-reading the page over an answer it has already committed. */
	revalidating: boolean;
	/** the press that answers the address the operator's browser opens to connect a company. */
	onConnect: () => void;
	/** the three accounts a gift is posted into, by id, and all three together. */
	onAccounts: (picks: QuickbooksPicks) => void;
	/**
	 * what moving the day to `day` would send and skip, written nowhere. its answer arrives on
	 * `answer` as the `start-date-preview` report, and decides whether the move asks first.
	 */
	onPreviewStartDate: (day: string) => void;
	/** the earliest day a gift goes over, as `YYYY-MM-DD`. */
	onStartDate: (day: string) => void;
	/** every gift that was given up on, queued again. */
	onRetry: () => void;
	/** the credential revoked at Intuit and the connection gone from here. */
	onDisconnect: () => void;
};

/** what every block below reads off the last press and off what is in flight. */
type Presses = Pick<
	QuickbooksSectionProps,
	| 'answer'
	| 'busy'
	| 'pending'
	| 'onConnect'
	| 'onAccounts'
	| 'onPreviewStartDate'
	| 'onStartDate'
	| 'onRetry'
	| 'onDisconnect'
>;

/** a step's button saying `Saving` or `Saved`, reported up so the step stays open under it. */
type OnConfirming = (active: boolean) => void;

/** the step held open as its button starts or stops drawing its save. */
const holdOpen =
	(step: StepName, active: boolean) =>
	(held: StepName | null): StepName | null =>
		active ? step : held === step ? null : held;

/** whether a button's rung is one a finished step stays open for. */
const confirmingIn = (state: SavedFormState): boolean => state === 'pending' || state === 'done';

export function QuickbooksSection({
	values,
	books,
	workerName,
	accountName,
	secrets,
	answer,
	freed,
	busy,
	pending,
	revalidating,
	onConnect,
	onAccounts,
	onPreviewStartDate,
	onStartDate,
	onRetry,
	onDisconnect
}: QuickbooksSectionProps): ReactNode {
	/* which step's button is drawing its save, keyed by the step: a finished step shuts only once
	   the tick that finished it has been seen (`stepsStand` in ./quickbooks-standing.ts). */
	const [confirming, setConfirming] = useState<StepName | null>(null);
	const holdSetup = useCallback<OnConfirming>(
		(active) => setConfirming(holdOpen('setup', active)),
		[]
	);
	const holdAccounts = useCallback<OnConfirming>(
		(active) => setConfirming(holdOpen('accounts', active)),
		[]
	);

	const guard = valuesGuard(values.vars, { workerName, accountName });
	if (guard !== null || values.vars.kind !== 'read') return guard;
	const holding = heldValues(values.vars.vars);
	const configured = CREDENTIALS.every((name) => holding.held.has(name));
	const steps = stepsStand({ configured, books, answer, confirming });
	const report = books.kind === 'read' ? books.report : null;
	const company = report?.connection.state === 'connected' ? report.connection : null;
	const presses: Presses = {
		answer,
		busy,
		pending,
		onConnect,
		onAccounts,
		onPreviewStartDate,
		onStartDate,
		onRetry,
		onDisconnect
	};

	return (
		<>
			<StatusLedger sections>
				<Step name="setup" standing={steps.setup}>
					<Stack>
						<p>
							<a href={INTUIT_DEVELOPER} target="_blank" rel="noreferrer">
								Intuit Developer <Mark name="external-link" />
							</a>
						</p>
						{SECRET_GROUPS.filter((group) => group.id === QUICKBOOKS_GROUP).map((group) => (
							<Credentials
								key={group.id}
								group={group}
								held={holding}
								reading={values.vars}
								report={secrets?.group === group.id ? secrets : null}
								freed={freed}
								company={company}
								busy={busy}
								pending={pending}
								revalidating={revalidating}
								trouble={keysTrouble({ workerName, accountName })}
								onConfirming={holdSetup}
							/>
						))}
						{/* apart from the form above: this is copied out to Intuit, where the boxes are
						    typed in from it. */}
						{report === null ? null : (
							<div className="adm-stated adm-break">
								<span className="adm-field__label">
									Add this to your Intuit app’s redirect URIs
								</span>
								<CodeSlab
									oneline
									copyable
									content={report.callbackAddress}
									copyLabel="Copy address"
								/>
							</div>
						)}
					</Stack>
				</Step>
				<Step name="connect" standing={steps.connect}>
					<ConnectPanel books={books} {...presses} />
				</Step>
				<Step name="accounts" standing={steps.accounts}>
					{report === null || company === null ? (
						/* locked until a company is connected, so this is never opened — but a fold with
						   nothing beneath it draws no caret and no lock, so it holds an empty panel. */
						<Stack />
					) : (
						<AccountsPanel
							report={report}
							company={company}
							onConfirming={holdAccounts}
							{...presses}
						/>
					)}
				</Step>
			</StatusLedger>

			{/* not a step: a plain group under the checklist, headed by its word and drawn only once
			    every step above is done. */}
			{steps.sync && report !== null && company !== null ? (
				<div className="adm-named">
					<h2>Sync</h2>
					<Stack>
						<Backlog report={report} {...presses} />
						<StartDateForm company={company} {...presses} />
					</Stack>
				</div>
			) : null}
		</>
	);
}

/** one step of the checklist: its word, its line, its mark, and what it opens onto. */
function Step({
	name,
	standing,
	children
}: {
	name: StepName;
	standing: StepStanding;
	children: ReactNode;
}): ReactNode {
	const { label, note } = STEP_LINE[name];
	return (
		<StatusLine
			label={label}
			note={note}
			labelAs="h2"
			tone={standing.trouble ? 'blocker' : standing.done ? 'done' : 'note'}
			// a step not yet done is the unfilled outline, which the note tone would draw as `info`.
			mark={standing.trouble || standing.done ? undefined : 'circle-dashed'}
			locked={standing.locked}
			open={standing.open}
			beneath={children}
		/>
	);
}

/**
 * the three values off the operator's Intuit app, in three boxes that are always on the screen.
 *
 * **it draws no stated-value row and no press that reveals the boxes.** the whole of this section
 * is behind these three, so an operator who opened this step opened it over them — a row saying a
 * value is stored and a press to reach the box under it are two readings of the same fact, one
 * press apart. ./stripe-section.tsx draws its pair the same way.
 *
 * a component of its own because it holds what the section around it must not see: conform's
 * reading of its own boxes, the element a landed save puts back, and which reading that save was
 * made against.
 *
 * **a change over a connected company asks first.** a token was bought with the pair it replaces,
 * so the press is what leaves the company unreachable until it is connected again — the confirm
 * itemises the boxes it changes and that cost, and nothing about it is said on the page.
 */
function Credentials({
	group,
	held,
	reading,
	report,
	freed,
	company,
	busy,
	pending,
	revalidating,
	trouble,
	onConfirming
}: {
	group: SecretGroup;
	/** what cloudflare says this deployment holds, which is what the boxes are drawn with. */
	held: HeldValues;
	/** the reading those seeds came out of, compared by identity to tell one re-read from the next. */
	reading: VarsRead;
	report: GroupReport | null;
	/** how the last press that frees a value held in a form nothing can read back went, or `null`. */
	freed: VarsWritten | null;
	/** the company connected, which is what makes storing a different pair cost something. */
	company: QuickbooksCompany | null;
	/** something on the page is writing, which holds every control on it closed. */
	busy: boolean;
	/** which intent is in flight, or `null` where none is. */
	pending: string | null;
	/** the router is re-reading the page over an answer it has already committed. */
	revalidating: boolean;
	/** what a failed write says, in the words the screen holding the account name has for it. */
	trouble: (written: ValuesRefusal) => ReactNode;
	onConfirming: OnConfirming;
}): ReactNode {
	const errors = report !== null && 'errors' in report ? report.errors : null;
	const written = report !== null && 'written' in report ? report.written : null;
	/* the failure inside that answer, or nothing: the two arms that stored something or found
	   nothing to store are `stands` below, and the one over a value held in a form nothing can read
	   back is drawn at the block that frees it (./withheld-values.tsx). */
	const failure = written === null ? null : refusalIn(written);
	/* what that answer leaves on the screen: the button's confirmation, whether the boxes have
	   anything left to say, and the sentence a press that stored nothing carries
	   (./quickbooks-standing.ts). */
	const stands = credentialsStands(written);
	const intent = groupIntent(group);
	/** this form's own request in flight; every other press on this page writes somewhere else. */
	const own = pending === intent;
	/* the boxes go back to what the deployment holds on the reading that lands after this press and
	   not on the answer that arrives ahead of it: these seeds are a reading of the deployment, and
	   the answer commits two router phases before one does (./reseed.ts). */
	const spent = useReseeded({ landed: stands.settled, pending: own, reading });
	/* this press from end to end, and what the boxes are closed for
	   (../closed-while-writing.spec.ts): the request, and then the reading that shows what it left
	   behind. a press that settled nothing ends both on the render its answer arrives in. */
	const { underway, closed } = credentialsPhase({
		own,
		revalidating,
		busy,
		settled: stands.settled,
		spent
	});
	const seeds = Object.fromEntries(group.names.map((name) => [name, held.seeds[name] ?? '']));

	const credentials = useConsoleForm(QUICKBOOKS_FORM, {
		report,
		landed: stands.landed,
		spent,
		refused: quickbooksRefused(errors, group.names),
		/* the boxes seeded from what the deployment holds, keyed by what they post. the marking is
		   still the pass and not the seeding: nothing is said about a box until a submit runs the
		   rules (./use-console-form.ts). */
		defaultValue: Object.fromEntries(group.names.map((name) => [VALUE_FIELD(name), seeds[name]])),
		busy,
		pending: underway
	});

	const saving = confirmingIn(credentials.state);
	useEffect(() => onConfirming(saving), [saving, onConfirming]);

	/** the lines the confirm over the press itemises, while it is up. */
	const [asking, setAsking] = useState<readonly string[] | null>(null);

	/**
	 * one box bound: the id every describing block on it is named from, what it posts, what it was
	 * drawn holding, and the one sentence standing under it (./use-console-form.ts).
	 *
	 * the index is asserted because the schema states a box for every name in the group, which
	 * ./quickbooks-standing.spec.ts holds — so a name with no metadata behind it is not a state this
	 * reaches.
	 */
	const box = (name: string) => credentials.box(credentials.fields[VALUE_FIELD(name)] as BoundBox);

	return (
		<Form
			{...credentials.mount}
			className="adm-stack"
			method="post"
			preventScrollReset
			onSubmit={(event) => {
				credentials.mount.onSubmit(event);
				if (event.defaultPrevented) return;
				// the press inside the confirm, which is the one the confirm was put up to ask about.
				if (asking !== null) {
					setAsking(null);
					return;
				}
				if (company === null) return;
				const lines = keysAsk(
					secretEdits(group.names, new FormData(event.currentTarget), seeds),
					seeds,
					company
				);
				if (lines === null) return;
				event.preventDefault();
				setAsking(lines);
			}}
		>
			{group.names.map((name) => {
				const bound = box(name);
				return (
					<Field
						key={name}
						id={bound.id}
						name={bound.name}
						label={KEY_LABEL[name] ?? name}
						// the code face. these are literals an operator checks character for character
						// against their Intuit app.
						code
						// which of the three arrives masked is ./secret-groups.ts's.
						masked={isMasked(name)}
						autoComplete="off"
						spellCheck={false}
						defaultValue={bound.defaultValue}
						// the example the box stands on while it is empty, which is one box and every
						// deployment holding no address of its own ({@link PLACEHOLDER}).
						placeholder={PLACEHOLDER[name]}
						// closed while the press that reads them is in flight and while another press on
						// the page writes ({@link credentialsPhase}): the press reads these boxes once,
						// and a value typed into one behind it is a credential the operator believes
						// they stored.
						disabled={closed}
						/* the deployment's sentence about this box ended by the keystroke that changes
						   it (./use-console-form.ts). */
						onInput={bound.onInput}
						error={bound.error}
					/>
				);
			})}

			{/* the names of this group the deployment holds in a form nothing can read back, which are
			    the boxes drawn empty over a value that is there. no save can set one of them until it
			    comes off (./withheld-values.tsx). */}
			<WithheldValues
				names={withheldInGroup(held, group)}
				all={held.withheld}
				consequence="Until these are saved again, this deployment sends nothing to your books."
				written={freed}
				trouble={trouble}
				busy={busy}
				freeing={pending === FREE_INTENT}
			/>

			<div className="adm-actions">
				{/* the three words are the button's own defaults
				    (`@better-giving/operator/components/controls/SaveButton`): the step this press
				    stands in already names what is being saved. */}
				<SaveButton type="submit" name="intent" value={intent} state={credentials.state} />
				{underway ? (
					// said at the control while it waits, because this press takes seconds where a save
					// usually takes a moment. what it says is where the value is going and how long, and
					// never what Cloudflare is doing to get it there.
					<p className="adm-hint">Storing it on your deployment. A few seconds.</p>
				) : stands.says === null ? null : (
					// a press that stored nothing, at the button that made it: the confirmation is the
					// write's and this is what stands in its place, so the press is answered by something
					// moving rather than by the button going quiet ({@link credentialsStands}).
					<p className="adm-hint">{stands.says}</p>
				)}
			</div>

			{failure === null ? null : trouble(failure)}

			{/* inside the form, so the press in it submits the boxes the operator typed. */}
			{asking === null ? null : (
				<Modal
					title="Replace the keys?"
					onDismiss={() => setAsking(null)}
					danger="Replace keys"
					dangerProps={{ type: 'submit' as const, name: 'intent', value: intent }}
					cancel="Go back"
					cancelProps={{ type: 'button' as const, onClick: () => setAsking(null) }}
				>
					<Lines lines={asking} />
				</Modal>
			)}
		</Form>
	);
}

/** what a confirm itemises, a line each. */
function Lines({ lines }: { lines: readonly string[] }): ReactNode {
	return (
		<ul className="adm-list">
			{lines.map((line) => (
				<li key={line}>{line}</li>
			))}
		</ul>
	);
}

/** the company this deployment posts into, or the way to connect one. */
function ConnectPanel({
	books,
	answer,
	busy,
	pending,
	onConnect,
	onDisconnect
}: { books: QuickbooksRead } & Pick<
	Presses,
	'answer' | 'busy' | 'pending' | 'onConnect' | 'onDisconnect'
>): ReactNode {
	/* the page read again, which is the one way back from a read that did not land. */
	const revalidator = useRevalidator();
	if (books.kind === 'unread')
		return (
			<Stack tight>
				<FieldMessage>{UNANSWERED}</FieldMessage>
				<div className="adm-actions">
					<Button
						type="button"
						onClick={() => void revalidator.revalidate()}
						aria-busy={revalidator.state === 'loading' || undefined}
					>
						Try again
					</Button>
				</div>
			</Stack>
		);
	const { connection, accounts } = books.report;
	const pressing = { answer, busy, pending, onConnect };
	if (connection.state !== 'connected')
		return (
			<Stack tight>
				<ConnectPress label="Choose a company" {...pressing} />
			</Stack>
		);
	const chart = chartStands(accounts);
	return (
		<Stack>
			<h3>{companyCalled(connection)}</h3>
			{chart?.step === 'connect' ? (
				<Stack tight>
					<FieldMessage>{chart.says}</FieldMessage>
					<ConnectPress label="Sign in again" {...pressing} />
				</Stack>
			) : null}
			<Disconnect
				company={connection}
				answer={answer}
				busy={busy}
				pending={pending}
				onDisconnect={onDisconnect}
			/>
		</Stack>
	);
}

/**
 * the press that starts the round trip, and the address it answers with.
 *
 * **the address is a link the operator follows rather than somewhere this console sends them.**
 * Intuit sends the browser back to the deployment and never here, so a console that navigated to
 * it would leave the operator on a page of the deployment's with this one gone; the link opens
 * beside this page and they come back to it. it stands where the press stood, since the press
 * has done its whole job once it has answered.
 */
function ConnectPress({
	label,
	answer,
	busy,
	pending,
	onConnect
}: { label: string } & Pick<Presses, 'answer' | 'busy' | 'pending' | 'onConnect'>): ReactNode {
	const own = ownPress(pending, 'connect');
	const address = connectAddress(answer);
	const silent = unanswered(answer, 'connect');
	return (
		<>
			<div className="adm-actions">
				{address === null ? (
					/* held with `aria-disabled` rather than `disabled`, and the press guarded behind it:
					   a disabled button cannot hold focus, so the keyboard drops to the document at the
					   moment the answer arrives beside it (packages/app/src/routes/_app.admin.books.tsx
					   argues it at its own press). */
					<Button
						type="button"
						variant="primary"
						onClick={() => {
							if (busy) return;
							onConnect();
						}}
						aria-disabled={busy || undefined}
						aria-busy={own || undefined}
					>
						{label}
					</Button>
				) : (
					<Button
						as="a" // full-load-ok: the deployment's address, never this console's.
						href={address}
						target="_blank"
						rel="noreferrer"
						variant="primary"
						markAfter="external-link"
					>
						Continue at Intuit
					</Button>
				)}
			</div>
			{address === null ? null : <p className="adm-hint">Then come back to this page.</p>}
			{silent === null ? null : <FieldMessage>{UNANSWERED}</FieldMessage>}
		</>
	);
}

/** the way out, and the confirm that says what it costs. */
function Disconnect({
	company,
	answer,
	busy,
	pending,
	onDisconnect
}: { company: QuickbooksCompany } & Pick<
	Presses,
	'answer' | 'busy' | 'pending' | 'onDisconnect'
>): ReactNode {
	const own = ownPress(pending, 'disconnect');
	const [asking, setAsking] = useState(false);
	const silent = unanswered(answer, 'disconnect');
	return (
		<>
			{/* its own block under the company, with no heading of its own to open it. */}
			<div className="adm-actions adm-break">
				{/* `aria-disabled` and a guarded press, for `ConnectPress`'s reason above. */}
				<Button
					type="button"
					onClick={() => {
						if (busy) return;
						setAsking(true);
					}}
					aria-disabled={busy || undefined}
					aria-busy={own || undefined}
				>
					Disconnect
				</Button>
			</div>
			{/* a press that landed is reported by the step it leaves: the company and this button are
			    gone, and the way to connect one stands where they were. */}
			{silent === null ? null : <FieldMessage>{UNANSWERED}</FieldMessage>}
			{asking ? (
				<Modal
					title={`Disconnect ${companyCalled(company)}?`}
					onDismiss={() => setAsking(false)}
					danger="Disconnect"
					dangerProps={{
						type: 'button' as const,
						disabled: busy || undefined,
						onClick: () => {
							setAsking(false);
							onDisconnect();
						}
					}}
					cancel="Go back"
					cancelProps={{ type: 'button' as const, onClick: () => setAsking(false) }}
				>
					<Lines lines={disconnectLines(company)} />
				</Modal>
			) : null}
		</>
	);
}

/** where a gift is posted, as pickers over the chart, or as stored where the chart was not read. */
function AccountsPanel({
	report,
	company,
	onConfirming,
	...presses
}: {
	report: QuickbooksReport;
	company: QuickbooksCompany;
	onConfirming: OnConfirming;
} & Presses): ReactNode {
	if (report.accounts?.state === 'read')
		return (
			<AccountsForm
				company={company}
				chart={report.accounts.accounts}
				onConfirming={onConfirming}
				{...presses}
			/>
		);
	/* they do not disappear and do not fall back to a box an operator types an id into: what a gift
	   is posted to is settled against the company's own books or not at all. what is wrong is said
	   at the step it blocks (`chartStands` in ./quickbooks-standing.ts) — a lapsed credential at
	   Connect, anything else here. */
	const chart = chartStands(report.accounts);
	return (
		<Stack>
			{PICKS.map((pick) => (
				<StatedValue
					key={pick}
					label={PICK_LABEL[pick]}
					value={company[pick]?.name ?? 'Not picked'}
				/>
			))}
			{chart?.step === 'accounts' ? <FieldMessage>{chart.says}</FieldMessage> : null}
		</Stack>
	);
}

/** the three as the deployment holds them, as one value a render can be compared against. */
const seedOf = (picks: QuickbooksPicks): string => `${picks.income}|${picks.fee}|${picks.deposit}`;

/**
 * the three pickers over the company's own chart, saved together.
 *
 * **the pickers hold their choice here rather than in the document**, because what each one offers
 * is a function of what it is showing (`accountPicker` in ./quickbooks-standing.ts) and whether the
 * press is armed is a comparison of all three against what is stored — both are read off this
 * state rather than off the elements. a reading that lands behind them moves them through the seed
 * comparison below, and a put-back on the element (`useSavedFormState` in
 * packages/operator/src/saved-form-state.react.ts) is asked for by nobody ({@link spent} at the
 * press). the seed is compared as a value rather than as the reading's identity, so a read that
 * changed nothing leaves what an operator has chosen alone —
 * packages/operator/src/components/forms/CoinPicker.jsx and DateField.jsx keep theirs the same way.
 *
 * **an unchosen picker is marked by the press and not before it**, and from then on as it changes
 * (`picksArmed` in ./quickbooks-standing.ts): the connect fills what it can, so the one left empty
 * is found by pressing save.
 */
function AccountsForm({
	company,
	chart,
	answer,
	busy,
	pending,
	onAccounts,
	onConfirming
}: {
	company: QuickbooksCompany;
	chart: readonly LedgerAccountLine[];
	onConfirming: OnConfirming;
} & Pick<Presses, 'answer' | 'busy' | 'pending' | 'onAccounts'>): ReactNode {
	const own = ownPress(pending, 'accounts');
	const held = picksHeld(company);
	const [picks, setPicks] = useState(held);
	const [seed, setSeed] = useState(seedOf(held));
	const [tried, setTried] = useState(false);
	if (seed !== seedOf(held)) {
		setSeed(seedOf(held));
		setPicks(held);
	}
	const saved = useSavedFormState({
		report: answer,
		landed: landedPress(answer, 'accounts'),
		/* **a landed answer empties nothing here**, which is what `spent` is asked. the three are
		   held in state above and the put-back is the seed comparison, so there is nothing for the
		   form's own reset to restore: it takes each picker back to the pick it was first drawn with
		   and hands that to the state above as a choice — the picks as they stood before the
		   operator changed them, over the ones this press just stored. the answer commits as the
		   re-read begins (./reseed.ts), so nothing moves them again until that read lands, and three
		   pickers would spend the whole of it showing picks that are no longer stored. */
		spent: false,
		changed: picksArmed(picks, company, chart),
		busy,
		pending: own
	});
	const saving = confirmingIn(saved.state);
	useEffect(() => onConfirming(saving), [saving, onConfirming]);
	const silent = unanswered(answer, 'accounts');
	return (
		<form
			ref={saved.form}
			className="adm-stack"
			onSubmit={(event) => {
				// the press is a callback and never a navigation: whatever mounts this section is what
				// turns it into a request.
				event.preventDefault();
				const [first] = picksMissing(picks);
				if (first !== undefined) {
					setTried(true);
					document.getElementById(PICK_FIELD(first))?.focus();
					return;
				}
				if (!picksToSave(picks, company, chart)) return;
				onAccounts(picks);
			}}
		>
			{PICKS.map((pick) => {
				/* the list is built for what this picker is showing rather than for what the company
				   stores: the two are different readings, and a list missing the selection is drawn
				   and posted as the first account in it (./quickbooks-standing.ts). it holds only the
				   accounts that fit this picker, and a stored one that does not is its retired line. */
				const box = accountPicker(chart, pick, company[pick], picks[pick]);
				return (
					<SelectWithNote
						key={pick}
						id={PICK_FIELD(pick)}
						name={PICK_FIELD(pick)}
						label={PICK_LABEL[pick]}
						options={box.options}
						retired={box.retired}
						value={picks[pick]}
						onValueChange={(value) => setPicks({ ...picks, [pick]: value })}
						error={tried && picks[pick] === '' ? PICK_BLANK : undefined}
						disabled={busy || undefined}
					/>
				);
			})}
			<div className="adm-actions">
				<SaveButton type="submit" state={saved.state} disabled={busy || undefined} />
			</div>
			{silent === null ? null : <FieldMessage>{UNANSWERED}</FieldMessage>}
		</form>
	);
}

/**
 * the gifts that were given up on, and the press that queues them again — which reports what it
 * queued on itself, and stands until that report has been seen.
 */
function Backlog({
	report,
	answer,
	busy,
	pending,
	onRetry
}: { report: QuickbooksReport } & Pick<
	Presses,
	'answer' | 'busy' | 'pending' | 'onRetry'
>): ReactNode {
	const own = ownPress(pending, 'retry');
	const stands = backlogStands(report, new Date());
	const queued = retriedGifts(answer);
	const said = queued === null ? null : retriedStands(queued);
	const save = useSaveState({ landed: said?.doneLabel != null, changed: false, pending: own });
	const silent = unanswered(answer, 'retry');
	const button = retryButton({
		backlog: stands !== null,
		pending: own,
		done: save.done,
		doneLabel: said?.doneLabel ?? null
	});
	if (!button.shown && said?.says == null && silent === null) return null;
	return (
		<Stack tight>
			{stands === null ? null : <FieldMessage>{backlogSays(stands)}</FieldMessage>}
			<div className="adm-actions">
				{button.shown ? (
					/* one element from rest to report, so the keyboard stays on the press that
					   reported. `aria-disabled` and a guarded press, for `ConnectPress`'s reason. */
					<SaveButton
						type="button"
						state={button.state}
						label="Try these again"
						doneLabel={said?.doneLabel ?? undefined}
						onClick={() => {
							if (busy) return;
							onRetry();
						}}
						aria-disabled={busy || undefined}
					/>
				) : null}
				{said?.says == null ? null : <p className="adm-hint">{said.says}</p>}
			</div>
			{silent === null ? null : <FieldMessage>{UNANSWERED}</FieldMessage>}
		</Stack>
	);
}

/** the day the box holds right now, as the field posts it. */
function dayIn(form: HTMLFormElement): string {
	const control = form.elements.namedItem(START_FIELD);
	return control instanceof HTMLInputElement ? control.value.trim() : '';
}

/**
 * the earliest date a gift may carry to reach the books.
 *
 * **the save asks the deployment what the move touches before it makes it.** a move earlier
 * queues every gift owed from the new day on and a move later skips the unsent ones before it, so
 * the press previews first and the move goes only once that answer is read: straight away where
 * it touches nothing, and behind a confirm naming what it sends or skips where it does
 * (`startDateAsk` in ./quickbooks-standing.ts).
 */
function StartDateForm({
	company,
	answer,
	busy,
	pending,
	onPreviewStartDate,
	onStartDate
}: { company: QuickbooksCompany } & Pick<
	Presses,
	'answer' | 'busy' | 'pending' | 'onPreviewStartDate' | 'onStartDate'
>): ReactNode {
	const own = ownPress(pending, 'start-date-preview', 'start-date');
	/* the day the preview was asked for, and the answer standing when it was: only an answer that
	   arrived after the press is that press's preview. */
	const [asked, setAsked] = useState<{ day: string; over: QuickbooksAnswer | null } | null>(null);
	const preview = asked === null || answer === asked.over ? null : previewed(answer);
	const ask = asked === null || preview === null ? null : startDateAsk(asked.day, company, preview);
	const touchesNothing = asked !== null && preview !== null && ask === null;

	useEffect(() => {
		if (!touchesNothing || asked === null) return;
		setAsked(null);
		onStartDate(asked.day);
	}, [touchesNothing, asked, onStartDate]);

	const saved = useSavedFormState({
		report: answer,
		landed: landedPress(answer, 'start-date'),
		changed: (form) => startToSave(dayIn(form), company),
		busy,
		pending: own || touchesNothing
	});
	const silent = unanswered(answer, 'start-date-preview') ?? unanswered(answer, 'start-date');
	/* the confirm's own press, which makes the move it was put up to ask about. */
	const move =
		asked === null
			? undefined
			: {
					type: 'button' as const,
					onClick: () => {
						setAsked(null);
						onStartDate(asked.day);
					}
				};
	return (
		<form
			ref={saved.form}
			className="adm-stack adm-break"
			onInput={saved.onInput}
			onSubmit={(event) => {
				event.preventDefault();
				const day = dayIn(event.currentTarget);
				if (!startToSave(day, company)) return;
				setAsked({ day, over: answer });
				onPreviewStartDate(day);
			}}
		>
			{/* broken off the backlog above where that stands, and first in the group where it does not. */}
			<Field
				id={START_FIELD}
				name={START_FIELD}
				type="date"
				label="Sync gifts from"
				defaultValue={startDay(company.startAt)}
				disabled={busy || undefined}
			/>
			<div className="adm-actions">
				<SaveButton type="submit" state={saved.state} disabled={busy || undefined} />
			</div>
			{silent === null ? null : <FieldMessage>{UNANSWERED}</FieldMessage>}
			{asked === null || ask === null ? null : (
				<Modal
					title={ask.title}
					onDismiss={() => setAsked(null)}
					exit={ask.rank === 'exit' ? ask.press : undefined}
					exitProps={ask.rank === 'exit' ? move : undefined}
					danger={ask.rank === 'danger' ? ask.press : undefined}
					dangerProps={ask.rank === 'danger' ? move : undefined}
					cancel="Go back"
					cancelProps={{ type: 'button' as const, onClick: () => setAsked(null) }}
				>
					<Lines lines={ask.lines} />
				</Modal>
			)}
		</form>
	);
}
