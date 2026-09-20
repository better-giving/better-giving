import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { CodeSlab } from '@better-giving/operator/components/data/CodeSlab';
import { DateField } from '@better-giving/operator/components/forms/DateField';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { SelectWithNote } from '@better-giving/operator/components/forms/SelectWithNote';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { Section } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import type {
	LedgerAccountLine,
	QuickbooksAccountsReading,
	QuickbooksCompany,
	QuickbooksPress,
	QuickbooksPressReport,
	QuickbooksRecourse,
	QuickbooksReport
} from '@better-giving/operator/console/quickbooks';
import { useSavedFormState } from '@better-giving/operator/saved-form-state.react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { DeployedValues, NoReport, VarsWritten } from '../api/types';
import { heldValues } from './held-values';
import { keysTrouble, noAnswer, valuesGuard } from './processor-screen';
import type { AccountPick, QuickbooksPicks } from './quickbooks-standing';
import {
	PICKS,
	accountPicker,
	backlogSays,
	backlogStands,
	picksHeld,
	picksToSave,
	quickbooksIntent,
	retriedSays,
	startDay,
	startToSave,
	unpickableStands
} from './quickbooks-standing';
import { Said } from './said';
import type { GroupReport } from './secret-group-form';
import { SecretGroupForm } from './secret-group-form';
import { QUICKBOOKS_GROUP, SECRET_GROUPS, groupIntent } from './secret-groups';
import { FREE_INTENT } from './withheld-values';

// where this deployment's books go, and every press an operator has over them — the three values
// off their Intuit app, the company they connect, where a gift is posted in its chart, and the
// gifts that have not gone over.
//
// **it is the screen's body and not its route.** every read it draws was taken by whatever mounts
// it and every press it makes is a callback answered there — ./chariot-section.tsx's arrangement
// with the router taken out of it: nothing here fetches, navigates or reads a loader, so the one
// place a press becomes a request is the route.
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
// company and what the three picks are, and the backlog speaks only where a gift was given up on
// (./quickbooks-standing.ts).
//
// **the address an operator registers is handed in.** it is this deployment's own address and the
// path Intuit sends a browser back to, and neither is knowable here: no hostname is committed to
// this repository (CLAUDE.md) and the path is packages/app's, which this package may not import.

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

/**
 * how the last press on the connection was answered.
 *
 * the two kinds a repeating-gifts press answers in (`RecurringSetup` in ../api/types.ts):
 * `reported` is the deployment saying what the press did, and `unanswered` is nothing coming back
 * that says. the press is named on both arms, because an outcome reports at the control that
 * caused it and one section draws five of them.
 */
export type QuickbooksAnswer =
	| { kind: 'reported'; report: QuickbooksPressReport }
	| { kind: 'unanswered'; press: QuickbooksPress; read: NoReport };

/** where the books stand, or which way the deployment did not say. */
export type QuickbooksRead =
	| { kind: 'read'; report: QuickbooksReport }
	| { kind: 'unread'; read: NoReport };

export type QuickbooksSectionProps = {
	/** the values as cloudflare answered for them, which is what the boxes are drawn with. */
	values: DeployedValues;
	/** where the books stand, as the route resolved it. */
	books: QuickbooksRead;
	/**
	 * the address to register in the operator's Intuit app: this deployment's own address and the
	 * path Intuit sends a browser back to, composed by the route.
	 */
	callbackAddress: string;
	workerName: string;
	/** the cloudflare account every read is scoped to, named in every sentence about a refusal. */
	accountName: string;
	/** how the last press of the three boxes was answered (./secret-group-form.tsx). */
	secrets: GroupReport | null;
	/** how the last press on the connection was answered, or `null` where none has been made. */
	answer: QuickbooksAnswer | null;
	/** how the last press that frees a value held in a form nothing can read back went, or `null`. */
	freed: VarsWritten | null;
	/** the router is re-reading the page over an answer it has already committed. */
	revalidating: boolean;
	/** something on the page is writing, which holds every control on it closed. */
	busy: boolean;
	/** which intent is in flight, or `null` where none is. */
	pending: string | null;
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
	callbackAddress,
	workerName,
	accountName,
	secrets,
	answer,
	freed,
	revalidating,
	busy,
	pending,
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
				<SecretGroupForm
					key={group.id}
					group={group}
					values={holding}
					report={secrets?.group === group.id ? secrets : null}
					busy={busy}
					pending={pending === groupIntent(group)}
					revalidating={revalidating}
					trouble={keysTrouble({ workerName, accountName })}
					boxLabel={(name) => LABEL[name] ?? name}
					boxHint={(name) => HINT[name]}
					consequence={
						connected ? (
							<p className="adm-prose">
								A token is bought with these, so storing a different pair leaves the connected
								company unreachable until you connect again.
							</p>
						) : undefined
					}
					withheldSays="Until these are saved again, this deployment sends nothing to your books."
					withheldWritten={freed}
					freeing={pending === FREE_INTENT}
				/>
			))}

			{/* nothing below the boxes until all three are held: no company can be connected and no
			    chart read, so every press down there would answer the same way every time. */}
			{!configured ? null : books.kind === 'unread' ? (
				noAnswer(books.read, 'it can’t say where your books stand')
			) : (
				<Books
					report={books.report}
					callbackAddress={callbackAddress}
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

/** whether the last answer is this press's, landed. */
const landedPress = (answer: QuickbooksAnswer | null, press: QuickbooksPress): boolean =>
	answer?.kind === 'reported' && answer.report.press === press;

/** the address the connect press answered with, or `null` where the last answer is another press's. */
const connectAddress = (answer: QuickbooksAnswer | null): string | null =>
	answer?.kind === 'reported' && answer.report.press === 'connect' ? answer.report.url : null;

/** how many gifts the retry press queued again, or `null` for the same reason. */
const retriedGifts = (answer: QuickbooksAnswer | null): number | null =>
	answer?.kind === 'reported' && answer.report.press === 'retry' ? answer.report.retried : null;

/** the deployment answering nothing to one press, drawn at that press and at no other. */
const unanswered = (answer: QuickbooksAnswer | null, press: QuickbooksPress): NoReport | null =>
	answer?.kind === 'unanswered' && answer.press === press ? answer.read : null;

/** the company, or the way to connect one, and the backlog under either. */
function Books({
	report,
	callbackAddress,
	answer,
	busy,
	pending,
	onConnect,
	onAccounts,
	onStartDate,
	onRetry,
	onDisconnect
}: { report: QuickbooksReport; callbackAddress: string } & Presses): ReactNode {
	const connection = report.connection;
	return (
		<>
			{connection.state === 'connected' ? (
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
			) : (
				<div className="adm-named">
					<p className="adm-prose">
						Register this address in your Intuit app — Intuit won’t send your browser back here
						without it.
					</p>
					<CodeSlab oneline copyable content={callbackAddress} />
					<ConnectPress
						label="Connect a company"
						answer={answer}
						busy={busy}
						pending={pending}
						onConnect={onConnect}
					/>
				</div>
			)}
			<Backlog
				backlog={report.backlog}
				answer={answer}
				busy={busy}
				pending={pending}
				onRetry={onRetry}
			/>
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
				<Button
					type="button"
					variant="primary"
					onClick={onConnect}
					disabled={busy || undefined}
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
		<div className="adm-named">
			<StatedValue label="Company" value={company.companyName ?? company.realmId}>
				{company.companyName === null
					? 'Intuit hasn’t said what this company is called yet.'
					: undefined}
			</StatedValue>

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

			<StartDateForm
				company={company}
				answer={answer}
				busy={busy}
				pending={pending}
				onStartDate={onStartDate}
			/>

			<Disconnect
				company={company}
				answer={answer}
				busy={busy}
				pending={pending}
				onDisconnect={onDisconnect}
			/>
		</div>
	);
}

/** the three as the pickers hold them right now. */
/** the three as the deployment holds them, as one value a render can be compared against. */
const seedOf = (picks: QuickbooksPicks): string => `${picks.income}|${picks.fee}|${picks.deposit}`;

/**
 * the three pickers over the company's own chart, saved together.
 *
 * **the pickers hold their choice here rather than in the document**, which is what lets a reading
 * that lands behind them move them: a `<select>` seeded through `defaultValue` keeps whatever it
 * was mounted with however many readings arrive, and the put-back a landed write performs
 * (`useSavedFormState` in packages/operator/src/saved-form-state.react.ts) would then put the boxes
 * back to the picks the press was made against. the seed is compared as a value rather than as the
 * reading's identity, so a read that changed nothing leaves what an operator has chosen alone —
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
		changed: picksToSave(picks, company),
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
				if (!picksToSave(picks, company)) return;
				onAccounts(picks);
			}}
		>
			{PICKS.map((pick) => {
				const box = accountPicker(chart, company[pick]);
				return (
					<SelectWithNote
						key={pick}
						id={PICK_FIELD(pick)}
						name={PICK_FIELD(pick)}
						label={PICK_LABEL[pick]}
						options={box.options}
						retired={box.retired}
						value={picks[pick]}
						onChange={(event) => setPicks({ ...picks, [pick]: event.currentTarget.value })}
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

/** the day this deployment's history starts going over. */
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
			<DateField
				id={START_FIELD}
				name={START_FIELD}
				label="Send gifts given from"
				hint="Gifts given before this day never go over."
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
				<Button
					type="button"
					variant="danger"
					onClick={() => setAsking(true)}
					disabled={busy || undefined}
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
	backlog,
	answer,
	busy,
	pending,
	onRetry
}: { backlog: QuickbooksReport['backlog'] } & Pick<
	Presses,
	'answer' | 'busy' | 'pending' | 'onRetry'
>): ReactNode {
	const own = pending === quickbooksIntent('retry');
	const stands = backlogStands(backlog, new Date());
	const queued = retriedGifts(answer);
	const silent = unanswered(answer, 'retry');
	/* the press's own outcome keeps the block standing on its own: a retry that queued everything
	   leaves nothing behind it to say, and the answer would go with the block that reported it. */
	if (stands === null && queued === null && silent === null) return null;
	return (
		<div className="adm-named">
			{stands === null ? null : (
				<>
					<FieldMessage>{backlogSays(stands)}</FieldMessage>
					<div className="adm-actions">
						<Button
							type="button"
							onClick={onRetry}
							disabled={busy || undefined}
							aria-busy={own || undefined}
						>
							Try these again
						</Button>
					</div>
				</>
			)}
			{queued === null ? null : (
				<Banner tone="done" word="Queued">
					{retriedSays(queued)}
				</Banner>
			)}
			{silent === null ? null : noAnswer(silent, 'nothing was tried again')}
		</div>
	);
}
