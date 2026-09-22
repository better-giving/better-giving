import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { CodeSlab } from '@better-giving/operator/components/data/CodeSlab';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { SelectWithNote } from '@better-giving/operator/components/forms/SelectWithNote';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { Section } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import type {
	LedgerAccountLine,
	QuickbooksAccountsReading,
	QuickbooksCompany,
	QuickbooksRecourse,
	QuickbooksReport
} from '@better-giving/operator/console/quickbooks';
import { QUICKBOOKS_PRODUCTION_URL } from '@better-giving/operator/console/quickbooks';
import { useSavedFormState } from '@better-giving/operator/saved-form-state.react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Form } from 'react-router';
import type {
	DeployedValues,
	QuickbooksRead,
	ValuesRefusal,
	VarsRead,
	VarsWritten
} from '../api/types';
import type { HeldValues } from './held-values';
import { heldValues, withheldInGroup } from './held-values';
import { keysTrouble, noAnswer, valuesGuard } from './processor-screen';
import type { AccountPick, QuickbooksAnswer, QuickbooksPicks } from './quickbooks-standing';
import {
	PICKS,
	QUICKBOOKS_FORM,
	accountPicker,
	backlogSays,
	backlogStands,
	connectAddress,
	credentialsPhase,
	credentialsStands,
	landedPress,
	picksHeld,
	picksToSave,
	quickbooksIntent,
	quickbooksRefused,
	retriedGifts,
	retriedStands,
	startDay,
	startToSave,
	unanswered,
	unpickableStands
} from './quickbooks-standing';
import { useReseeded } from './reseed';
import { Said } from './said';
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
// off their Intuit app, the company they connect, where a gift is posted in its chart, and the
// gifts that have not gone over.
//
// **it is the screen's body and not its route.** every read it draws was taken by whatever mounts
// it and every press over the books is a callback answered there — ./chariot-section.tsx's
// arrangement with the router taken out of it: nothing here fetches or reads a loader, so the one
// place such a press becomes a request is the route. the three boxes are the one exception and post
// for themselves, as ./chariot-section.tsx's own do: the group's intent (`groupIntent` in
// ./secret-groups.ts), answered by that same route's `clientAction`.
//
// **it is not a processor and draws no reading of one.** no money moves on these three values and
// no set-up job waits on them (packages/operator/src/console/quickbooks.ts), so there is no rail,
// no webhook and no account standing here — a deployment that keeps its books somewhere else is
// not half set up.
//
// **the whole of it is behind the three boxes.** every call to Intuit is built from all three and
// there is no default for any of them (`REQUIRED` in
// packages/app/src/lib/server/accounting/factory.ts), so a deployment short of one can connect
// nothing and read no chart — and a block offering either would be a press that answers the same
// way every time.
//
// **nothing here confirms that the books are keeping up.** a connected deployment says which
// company and what the three picks are, and the backlog speaks only under that company and only
// where a gift was given up on (./quickbooks-standing.ts).
//
// **the address an operator registers arrives on the report, whole.** it is this deployment's own
// address and the path Intuit sends a browser back to, and only the deployment can say either: no
// hostname is committed to this repository (CLAUDE.md) and the path is packages/app's, which this
// package may not import. so nothing here or above it composes one.

/**
 * the three values this section's boxes set, taken out of the enumeration rather than named again.
 *
 * all three, because every call is built from all three: an operator holding two of them has
 * configured nothing.
 */
const CREDENTIALS = SECRET_GROUPS.filter((group) => group.id === QUICKBOOKS_GROUP).flatMap(
	(group) => group.names
);

/** what each box is called. the pair takes Intuit's own labels, which is where they are read off. */
const LABEL: Record<string, string> = {
	QUICKBOOKS_CLIENT_ID: 'Client ID',
	QUICKBOOKS_CLIENT_SECRET: 'Client secret',
	QUICKBOOKS_API_URL: 'API address'
};

/** where a box's value comes from, for the box whose label cannot say it. */
const HINT: Record<string, ReactNode> = {
	QUICKBOOKS_API_URL:
		'Intuit’s production address for a real company, and its sandbox address for a test one.'
};

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

/** what each picker is called. every one says what it is for without the heading over it. */
const PICK_LABEL: Record<AccountPick, string> = {
	income: 'Account gifts are recorded in',
	fee: 'Account processor fees are recorded in',
	deposit: 'Account money is deposited into'
};

/** what a picker submits under, and the id every description on it is named from. */
const PICK_FIELD = (pick: AccountPick): string => `quickbooks-${pick}`;

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
	| 'onStartDate'
	| 'onRetry'
	| 'onDisconnect'
>;

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
	onStartDate,
	onRetry,
	onDisconnect
}: QuickbooksSectionProps): ReactNode {
	const guard = valuesGuard(values.vars, { workerName, accountName });
	if (guard !== null || values.vars.kind !== 'read') return guard;
	const holding = heldValues(values.vars.vars);
	const configured = CREDENTIALS.every((name) => holding.held.has(name));
	const connected = books.kind === 'read' && books.report.connection.state === 'connected';

	return (
		<Section>
			{/* the boxes carry no band of their own, for ./chariot-section.tsx's reason: the page's
			    title already names what they set. */}
			{SECRET_GROUPS.filter((group) => group.id === QUICKBOOKS_GROUP).map((group) => (
				<Credentials
					key={group.id}
					group={group}
					held={holding}
					reading={values.vars}
					report={secrets?.group === group.id ? secrets : null}
					freed={freed}
					connected={connected}
					busy={busy}
					pending={pending}
					revalidating={revalidating}
					trouble={keysTrouble({ workerName, accountName })}
				/>
			))}

			{/* nothing below the boxes until all three are held: no company can be connected and no
			    chart read, so every press down there would answer the same way every time. */}
			{!configured ? null : books.kind === 'unread' ? (
				noAnswer(books.read, 'it can’t say where your books stand')
			) : (
				<Books
					report={books.report}
					answer={answer}
					busy={busy}
					pending={pending}
					onConnect={onConnect}
					onAccounts={onAccounts}
					onStartDate={onStartDate}
					onRetry={onRetry}
					onDisconnect={onDisconnect}
				/>
			)}
		</Section>
	);
}

/**
 * the three values off the operator's Intuit app, in three boxes that are always on the screen.
 *
 * **it draws no stated-value row and no press that reveals the boxes.** the whole of this section
 * is behind these three, so an operator who opened this page opened it over them — a row saying a
 * value is stored and a press to reach the box under it are two readings of the same fact, one
 * press apart. ./stripe-section.tsx draws its pair the same way.
 *
 * a component of its own because it holds what the section around it must not see: conform's
 * reading of its own boxes, the element a landed save puts back, and which reading that save was
 * made against.
 */
function Credentials({
	group,
	held,
	reading,
	report,
	freed,
	connected,
	busy,
	pending,
	revalidating,
	trouble
}: {
	group: SecretGroup;
	/** what cloudflare says this deployment holds, which is what the boxes are drawn with. */
	held: HeldValues;
	/** the reading those seeds came out of, compared by identity to tell one re-read from the next. */
	reading: VarsRead;
	report: GroupReport | null;
	/** how the last press that frees a value held in a form nothing can read back went, or `null`. */
	freed: VarsWritten | null;
	/** a company is connected, which is what makes storing a different pair cost something. */
	connected: boolean;
	/** something on the page is writing, which holds every control on it closed. */
	busy: boolean;
	/** which intent is in flight, or `null` where none is. */
	pending: string | null;
	/** the router is re-reading the page over an answer it has already committed. */
	revalidating: boolean;
	/** what a failed write says, in the words the screen holding the account name has for it. */
	trouble: (written: ValuesRefusal) => ReactNode;
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

	const credentials = useConsoleForm(QUICKBOOKS_FORM, {
		report,
		landed: stands.landed,
		spent,
		refused: quickbooksRefused(errors, group.names),
		/* the boxes seeded from what the deployment holds, keyed by what they post. the marking is
		   still the pass and not the seeding: nothing is said about a box until a submit runs the
		   rules (./use-console-form.ts). */
		defaultValue: Object.fromEntries(
			group.names.map((name) => [VALUE_FIELD(name), held.seeds[name] ?? ''])
		),
		busy,
		pending: underway
	});

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
		<Form {...credentials.mount} className="adm-stack" method="post" preventScrollReset>
			<div className="adm-stack">
				{group.names.map((name) => {
					const bound = box(name);
					return (
						<Field
							key={name}
							id={bound.id}
							name={bound.name}
							label={LABEL[name] ?? name}
							hint={HINT[name]}
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
			</div>

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

			{/* what storing these costs, beside the press that does it rather than over the boxes: it
			    is read by somebody who has already typed. */}
			{connected ? (
				<p className="adm-prose">
					A token is bought with these, so storing a different pair leaves the connected company
					unreachable until you connect again.
				</p>
			) : null}

			<div className="adm-actions">
				{/* the three words are the button's own defaults
				    (`@better-giving/operator/components/controls/SaveButton`): the page this press
				    stands on already names what is being saved. */}
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
		</Form>
	);
}

/** the company and what it is owed, or the way to connect one. */
function Books({
	report,
	answer,
	busy,
	pending,
	onConnect,
	onAccounts,
	onStartDate,
	onRetry,
	onDisconnect
}: { report: QuickbooksReport } & Presses): ReactNode {
	const connection = report.connection;
	if (connection.state !== 'connected')
		return (
			<div className="adm-named">
				{/* the address is the deployment's and the round trip ends there: Intuit cannot reach this
				    console at all, so a sentence saying "back here" would name the wrong machine. */}
				<p className="adm-prose">
					Register this address in your Intuit app. Without it, Intuit won’t send your browser back
					to this deployment.
				</p>
				<CodeSlab oneline copyable content={report.callbackAddress} />
				<ConnectPress
					label="Connect a company"
					answer={answer}
					busy={busy}
					pending={pending}
					onConnect={onConnect}
				/>
			</div>
		);
	return (
		<>
			<Company
				company={connection}
				accounts={report.accounts}
				answer={answer}
				busy={busy}
				pending={pending}
				onConnect={onConnect}
				onAccounts={onAccounts}
				onStartDate={onStartDate}
				onDisconnect={onDisconnect}
			/>
			{/* under the company and nowhere else: what is owed is owed to it, and the press queues
			    gifts for it. ./quickbooks-standing.ts's `backlogStands` refuses a disconnected read as
			    well, which is where a case reaches the rule. */}
			<Backlog report={report} answer={answer} busy={busy} pending={pending} onRetry={onRetry} />
		</>
	);
}

/**
 * the press that starts the round trip, and the address it answers with.
 *
 * **the address is a link the operator follows rather than somewhere this console sends them.**
 * Intuit sends the browser back to the deployment and never here, so a console that navigated to
 * it would leave the operator on a page of the deployment's with this one gone; the link opens
 * beside this page and they come back to it.
 */
function ConnectPress({
	label,
	answer,
	busy,
	pending,
	onConnect
}: { label: string } & Pick<Presses, 'answer' | 'busy' | 'pending' | 'onConnect'>): ReactNode {
	const own = pending === quickbooksIntent('connect');
	const address = connectAddress(answer);
	const silent = unanswered(answer, 'connect');
	return (
		<>
			<div className="adm-actions">
				{/* held with `aria-disabled` rather than `disabled`, and the press guarded behind it:
				    a disabled button cannot hold focus, so the keyboard drops to the document at the
				    moment the answer arrives beside it (packages/app/src/routes/_app.admin.books.tsx
				    argues it at its own press). */}
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
			</div>
			{address === null ? null : (
				<p className="adm-prose">
					<a href={address} target="_blank" rel="noreferrer">
						Choose a company at Intuit
					</a>
					, then come back to this page.
				</p>
			)}
			{silent === null ? null : noAnswer(silent, 'there is no address to open')}
		</>
	);
}

/** the company this deployment posts into, what it posts where, and the way out. */
function Company({
	company,
	accounts,
	answer,
	busy,
	pending,
	onConnect,
	onAccounts,
	onStartDate,
	onDisconnect
}: {
	company: QuickbooksCompany;
	accounts: QuickbooksAccountsReading | null;
} & Pick<
	Presses,
	'answer' | 'busy' | 'pending' | 'onConnect' | 'onAccounts' | 'onStartDate' | 'onDisconnect'
>): ReactNode {
	return (
		/* four blocks, each opening a subject of its own and told apart by the one boundary the sheet
		   draws over them (`* + .adm-named` in packages/operator/src/styles/adm.css). they stand
		   directly in the section rather than inside a wrapper of their own: the rule keys on a
		   sibling, so a wrapper would take the one boundary for the four of them and leave the blocks
		   inside it at the container's gap — a block's save as near the block below it as it is to
		   its own boxes, which is what was on the screen. the class goes on a wrapper around each
		   block rather than on the block's own element, because the step inside a named block is the
		   close one a heading takes from what it names, and these hold a column of controls and the
		   press that saves them at the stack's step. */
		<>
			<div className="adm-named">
				<StatedValue label="Company" value={company.companyName ?? company.realmId}>
					{company.companyName === null
						? 'Intuit hasn’t said what this company is called yet.'
						: undefined}
				</StatedValue>
			</div>

			<div className="adm-named">
				{accounts?.state === 'read' ? (
					<AccountsForm
						company={company}
						chart={accounts.accounts}
						answer={answer}
						busy={busy}
						pending={pending}
						onAccounts={onAccounts}
					/>
				) : (
					<Unpickable
						company={company}
						detail={accounts?.state === 'unreadable' ? accounts.detail : null}
						recourse={accounts?.state === 'unreadable' ? accounts.recourse : null}
						answer={answer}
						busy={busy}
						pending={pending}
						onConnect={onConnect}
					/>
				)}
			</div>

			<div className="adm-named">
				<StartDateForm
					company={company}
					answer={answer}
					busy={busy}
					pending={pending}
					onStartDate={onStartDate}
				/>
			</div>

			{/* the way out is a block of its own, though it is a press with no heading over it: it
			    belongs to none of the blocks above — ./withheld-values.tsx draws its own bare press
			    inside the form whose values it is about, and takes no boundary for that reason — and
			    this class is the whole of what the sheet has for a break between blocks. */}
			<div className="adm-named">
				<Disconnect
					company={company}
					answer={answer}
					busy={busy}
					pending={pending}
					onDisconnect={onDisconnect}
				/>
			</div>
		</>
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
 */
function AccountsForm({
	company,
	chart,
	answer,
	busy,
	pending,
	onAccounts
}: {
	company: QuickbooksCompany;
	chart: readonly LedgerAccountLine[];
} & Pick<Presses, 'answer' | 'busy' | 'pending' | 'onAccounts'>): ReactNode {
	const own = pending === quickbooksIntent('accounts');
	const held = picksHeld(company);
	const [picks, setPicks] = useState(held);
	const [seed, setSeed] = useState(seedOf(held));
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
		changed: picksToSave(picks, company, chart),
		busy,
		pending: own
	});
	const silent = unanswered(answer, 'accounts');
	return (
		<form
			ref={saved.form}
			className="adm-stack"
			onSubmit={(event) => {
				// the press is a callback and never a navigation: whatever mounts this section is what
				// turns it into a request.
				event.preventDefault();
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
						disabled={busy || undefined}
					/>
				);
			})}
			<div className="adm-actions">
				<SaveButton type="submit" state={saved.state} disabled={busy || undefined} />
			</div>
			{silent === null ? null : noAnswer(silent, 'nothing was changed')}
		</form>
	);
}

/**
 * where the three pickers would be, on a deployment whose chart could not be read.
 *
 * they do not disappear and do not fall back to a box an operator types an id into: what a gift is
 * posted to is settled against the company's own books or not at all. what stands here on every
 * arm is the three as they are stored and the deployment's own sentence about the read.
 *
 * **what varies is the way back, and only a lapsed credential has one.** which press and which
 * sentence stand is `unpickableStands` in ./quickbooks-standing.ts, which argues it — a decision
 * left in this file is one no spec can reach, because this package pins one node pool and no dom
 * (../../vite.config.ts).
 */
function Unpickable({
	company,
	detail,
	recourse,
	answer,
	busy,
	pending,
	onConnect
}: {
	company: QuickbooksCompany;
	detail: string | null;
	recourse: QuickbooksRecourse | null;
} & Pick<Presses, 'answer' | 'busy' | 'pending' | 'onConnect'>): ReactNode {
	const stands = unpickableStands(recourse);
	return (
		<div className="adm-stack">
			{PICKS.map((pick) => (
				<StatedValue
					key={pick}
					label={PICK_LABEL[pick]}
					value={company[pick]?.name ?? 'Not picked'}
				/>
			))}
			<FieldMessage>
				This deployment couldn’t read your chart of accounts, so the three can’t be picked here.
			</FieldMessage>
			{/* above the quotation: it follows on from the sentence over it rather than from what the
			    deployment said. */}
			{stands.says === null ? null : <p className="adm-prose">{stands.says}</p>}
			{detail === null ? null : <Said answer={{ detail }} />}
			{stands.connect ? (
				<ConnectPress
					label="Connect again"
					answer={answer}
					busy={busy}
					pending={pending}
					onConnect={onConnect}
				/>
			) : null}
		</div>
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
 * it moves nothing that has already settled: the queue row is written in the settling gift's own
 * batch and never swept up afterwards (`outboxStatements` in
 * packages/app/src/lib/server/accounting/outbox.ts), so an earlier day sends no gift that is
 * already in the past.
 */
function StartDateForm({
	company,
	answer,
	busy,
	pending,
	onStartDate
}: { company: QuickbooksCompany } & Pick<
	Presses,
	'answer' | 'busy' | 'pending' | 'onStartDate'
>): ReactNode {
	const own = pending === quickbooksIntent('start-date');
	const saved = useSavedFormState({
		report: answer,
		landed: landedPress(answer, 'start-date'),
		changed: (form) => startToSave(dayIn(form), company),
		busy,
		pending: own
	});
	const silent = unanswered(answer, 'start-date');
	return (
		<form
			ref={saved.form}
			className="adm-stack"
			onInput={saved.onInput}
			onSubmit={(event) => {
				event.preventDefault();
				const day = dayIn(event.currentTarget);
				if (!startToSave(day, company)) return;
				onStartDate(day);
			}}
		>
			{/* a box standing on its own, so its label stands over it — the floating construction
			    packages/operator/src/components/forms/DateField.jsx draws is scoped by its own header
			    to a date box inside a named group of them. */}
			<Field
				id={START_FIELD}
				name={START_FIELD}
				type="date"
				label="Send gifts dated from"
				hint="Gifts dated before this day are never sent. Choosing an earlier day sends nothing that has already settled."
				defaultValue={startDay(company.startAt)}
				disabled={busy || undefined}
			/>
			<div className="adm-actions">
				<SaveButton type="submit" state={saved.state} disabled={busy || undefined} />
			</div>
			{silent === null ? null : noAnswer(silent, 'the day was not changed')}
		</form>
	);
}

/** the way out, and the card that says what it costs. */
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
	const own = pending === quickbooksIntent('disconnect');
	const [asking, setAsking] = useState(false);
	const silent = unanswered(answer, 'disconnect');
	const name = company.companyName ?? 'this company';
	return (
		<>
			<div className="adm-actions">
				{/* `aria-disabled` and a guarded press, for `ConnectPress`'s reason above. */}
				<Button
					type="button"
					variant="danger"
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
			{/* a press that landed is reported by the section it leaves: the company, the pickers and
			    this button are gone, and the way to connect one stands where they were. */}
			{silent === null ? null : noAnswer(silent, 'nothing was disconnected')}
			{asking ? (
				<Modal
					title="Disconnect these books?"
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
					{/* what the press costs, itemised, and nothing about it said on the page behind. what
					    it leaves alone is left off: a line nobody has to act on is a line spent making
					    the two that matter harder to count. */}
					<ul className="adm-list">
						<li>Gifts stop being sent to {name}.</li>
						<li>This deployment forgets the company and the three accounts.</li>
					</ul>
				</Modal>
			) : null}
		</>
	);
}

/** the gifts that were given up on, and the press that queues them again. */
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
	const own = pending === quickbooksIntent('retry');
	const stands = backlogStands(report, new Date());
	const queued = retriedGifts(answer);
	const silent = unanswered(answer, 'retry');
	/* the press's own outcome keeps the block standing on its own: a retry that queued everything
	   leaves nothing behind it to say, and the answer would go with the block that reported it. */
	if (stands === null && queued === null && silent === null) return null;
	const said = queued === null ? null : retriedStands(queued);
	return (
		<div className="adm-named">
			{stands === null ? null : (
				<>
					<FieldMessage>{backlogSays(stands)}</FieldMessage>
					<div className="adm-actions">
						{/* `aria-disabled` and a guarded press, for `ConnectPress`'s reason. */}
						<Button
							type="button"
							onClick={() => {
								if (busy) return;
								onRetry();
							}}
							aria-disabled={busy || undefined}
							aria-busy={own || undefined}
						>
							Try these again
						</Button>
					</div>
				</>
			)}
			{said === null ? null : (
				<Banner tone={said.tone} word={said.word}>
					{said.says}
				</Banner>
			)}
			{silent === null ? null : noAnswer(silent, 'nothing was tried again')}
		</div>
	);
}
