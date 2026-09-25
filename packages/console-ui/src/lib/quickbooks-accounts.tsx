import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { SelectWithNote } from '@better-giving/operator/components/forms/SelectWithNote';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { Stack } from '@better-giving/operator/components/shell/Layout';
import type {
	LedgerAccountLine,
	QuickbooksCompany,
	QuickbooksReport
} from '@better-giving/operator/console/quickbooks';
import { useSavedFormState } from '@better-giving/operator/saved-form-state.react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { HoldingPick } from '../api/types';
import type {
	AccountPick,
	Asked,
	OnConfirming,
	QuickbooksAnswer,
	QuickbooksPicks
} from './quickbooks-standing';
import {
	GIFT_PICKS,
	HOLDING_HINT,
	NONE,
	PICK_BLANK,
	PICK_GROUP_LEGEND,
	PICK_LABEL,
	PICKS,
	accountPicker,
	answeredSince,
	awaitingSays,
	chartStands,
	confirmingIn,
	holdingsDrawn,
	landedPress,
	misfitPick,
	misfitSays,
	ownPress,
	picksArmed,
	picksHeld,
	picksMissing,
	picksToSave,
	savingUntilRead,
	unanswered,
	unansweredSays
} from './quickbooks-standing';
import { useReseeded } from './reseed';

// the Accounts step of the QuickBooks section: where a gift is posted in the company's own chart,
// drawn by ./quickbooks-section.tsx inside that step and nowhere else.
//
// **two groups, because a gift is two questions.** what it is recorded as — income, and the
// processor's cut as a cost — and where its money waits before it reaches the bank: one holding per
// processor the deployment takes gifts through, and one for gifts recorded by hand. no pick is the
// bank. the deployment hears no payout, so the bookkeeper records each one off the bank feed as a
// transfer out of the holding it left (packages/operator/src/console/quickbooks.ts), and each
// holding says so over its own picker.
//
// every decision about a value is in ./quickbooks-standing.ts, for the section's reason: this
// package's pool is node-only (../../vite.config.ts).

/** what a picker submits under, and the id every description on it is named from. */
const PICK_FIELD = (pick: AccountPick): string => `quickbooks-${pick}`;

export type AccountsPanelProps = {
	report: QuickbooksReport;
	company: QuickbooksCompany;
	/** the names the deployment holds a value under, which is what says which processors it takes. */
	held: ReadonlySet<string>;
	/** how the last press on the connection was answered, or `null` where none has been made. */
	answer: QuickbooksAnswer | null;
	/** something on the page is writing, which holds every control on it closed. */
	busy: boolean;
	/** which intent is in flight, or `null` where none is. */
	pending: string | null;
	/** every role's account by id, `''` for a holding left at none, saved together. */
	onAccounts: (picks: QuickbooksPicks) => void;
	/** the save's button saying `Saving` or `Saved`, so the step stays open under it. */
	onConfirming: OnConfirming;
	/** what the save says after its confirmation about the rest of the page. */
	elsewhere: string | undefined;
};

/** where a gift is posted, as pickers over the chart, or as stored where the chart was not read. */
export function AccountsPanel({
	report,
	company,
	held,
	onConfirming,
	elsewhere,
	answer,
	busy,
	pending,
	onAccounts
}: AccountsPanelProps): ReactNode {
	const holdings = holdingsDrawn(company, held);
	/* a standing condition on the whole step rather than a press's answer: the connection moved
	   while nobody was here, and it holds every gift until a save. */
	const awaiting = awaitingSays(company);
	const moved = awaiting === null ? null : <FieldMessage tone="needed">{awaiting}</FieldMessage>;

	if (report.accounts?.state === 'read')
		return (
			<Stack>
				{moved}
				<AccountsForm
					company={company}
					chart={report.accounts.accounts}
					holdings={holdings}
					answer={answer}
					busy={busy}
					pending={pending}
					onAccounts={onAccounts}
					onConfirming={onConfirming}
					elsewhere={elsewhere}
				/>
			</Stack>
		);
	/* they do not disappear and do not fall back to a box an operator types an id into: what a gift
	   is posted to is settled against the company's own books or not at all. what is wrong is said
	   at the step it blocks (`chartStands` in ./quickbooks-standing.ts) — a lapsed credential at
	   Connect, anything else here. */
	const chart = chartStands(report.accounts);
	const stated = (pick: AccountPick, unpicked: string) => (
		<StatedValue key={pick} label={PICK_LABEL[pick]} value={company[pick]?.name ?? unpicked} />
	);
	return (
		<Stack>
			{moved}
			<div className="adm-named">
				<h3>{PICK_GROUP_LEGEND.gift}</h3>
				<Stack tight>{GIFT_PICKS.map((pick) => stated(pick, 'Not picked'))}</Stack>
			</div>
			<div className="adm-named">
				<h3>{PICK_GROUP_LEGEND.holding}</h3>
				<Stack tight>{holdings.map((pick) => stated(pick, NONE))}</Stack>
			</div>
			{chart?.step === 'accounts' ? <FieldMessage>{chart.says}</FieldMessage> : null}
		</Stack>
	);
}

/** the answer standing at the press, and the picks that press sent. */
type AskedPicks = Asked & { readonly picks: QuickbooksPicks };

/** the picks as the deployment holds them, as one value a render can be compared against. */
const seedOf = (picks: QuickbooksPicks): string => PICKS.map((pick) => picks[pick]).join('|');

/**
 * the pickers over the company's own chart, in their two groups and saved together.
 *
 * **the pickers hold their choice here rather than in the document**, because what each one offers
 * is a function of what it is showing (`accountPicker` in ./quickbooks-standing.ts) and whether the
 * press is armed is a comparison of every pick against what is stored — both are read off this
 * state rather than off the elements. a reading that lands behind them moves them through the seed
 * comparison below, and a put-back on the element (`useSavedFormState` in
 * packages/operator/src/saved-form-state.react.ts) is asked for by nobody ({@link spent} at the
 * press). the seed is compared as a value rather than as the reading's identity, so a read that
 * changed nothing leaves what an operator has chosen alone —
 * packages/operator/src/components/forms/CoinPicker.jsx and DateField.jsx keep theirs the same way.
 *
 * **an unchosen income or fees picker is marked by the press and not before it**, and from then on
 * as it changes (`picksArmed` in ./quickbooks-standing.ts): the connect fills what it can, so the
 * one left empty is found by pressing save.
 *
 * **a refusal naming a picker is marked on that picker** (`misfitPick`), and focus goes to it once
 * it can take focus — the pickers are closed while the page re-reads behind the answer — keyed on
 * that answer arriving. it stands until the picker moves off the account it was refused over.
 */
function AccountsForm({
	company,
	chart,
	holdings,
	answer,
	busy,
	pending,
	onAccounts,
	onConfirming,
	elsewhere
}: {
	company: QuickbooksCompany;
	chart: readonly LedgerAccountLine[];
	/** the holdings drawn, in the order they stand ({@link holdingsDrawn}). */
	holdings: readonly HoldingPick[];
} & Pick<
	AccountsPanelProps,
	'answer' | 'busy' | 'pending' | 'onAccounts' | 'onConfirming' | 'elsewhere'
>): ReactNode {
	const own = ownPress(pending, 'accounts');
	/* the answer standing at this form's last press: one drawn over an answer it never pressed for
	   holds nothing and confirms nothing. */
	const [asked, setAsked] = useState<AskedPicks | null>(null);
	const mine = answeredSince(answer, asked);
	const landed = landedPress(mine, 'accounts');
	/* the reading this press was made against, and whether the one after it has landed: the save
	   stays `Saving` until it has, so the confirmation is said over the page the save left
	   (`savingUntilRead` in ./quickbooks-standing.ts). */
	const spent = useReseeded({ landed, pending: own, reading: company });
	const held = picksHeld(company);
	const [picks, setPicks] = useState(held);
	const [seed, setSeed] = useState(seedOf(held));
	const [tried, setTried] = useState(false);
	if (seed !== seedOf(held)) {
		setSeed(seedOf(held));
		setPicks(held);
	}
	const saved = useSavedFormState({
		report: mine,
		landed,
		/* **a landed answer empties nothing here**, which is what `spent` is asked. the picks are
		   held in state above and the put-back is the seed comparison, so there is nothing for the
		   form's own reset to restore: it takes each picker back to the pick it was first drawn with
		   and hands that to the state above as a choice — the picks as they stood before the
		   operator changed them, over the ones this press just stored. the answer commits as the
		   re-read begins (./reseed.ts), so nothing moves them again until that read lands, and the
		   pickers would spend the whole of it showing picks that are no longer stored. */
		spent: false,
		changed: picksArmed(picks, company, chart),
		busy,
		pending: savingUntilRead({ own, landed, spent })
	});
	const saving = confirmingIn(saved.state);
	// let go on the way out as well: a chart that stops reading swaps this form out mid-save.
	useEffect(() => {
		onConfirming(saving);
		return () => onConfirming(false);
	}, [saving, onConfirming]);

	const misfit = misfitPick(mine, [...GIFT_PICKS, ...holdings]);
	const refusedOver = misfit !== null && asked !== null && picks[misfit] === asked.picks[misfit];
	const focusedFor = useRef<QuickbooksAnswer | null>(null);
	useEffect(() => {
		if (misfit === null || busy || focusedFor.current === mine) return;
		focusedFor.current = mine;
		document.getElementById(PICK_FIELD(misfit))?.focus();
	}, [misfit, mine, busy]);

	/* the refusal a picker carries is said there, and every other one at the press. */
	const silent = misfit === null ? unanswered(answer, 'accounts') : null;

	const picker = (pick: AccountPick, hint?: string): ReactNode => {
		/* the list is built for what this picker is showing rather than for what the company
		   stores: the two are different readings, and a list missing the selection is drawn and
		   posted as the first account in it (./quickbooks-standing.ts). it holds only the accounts
		   that fit this picker, and a stored one that does not is its retired line. */
		const box = accountPicker(chart, pick, company[pick], picks[pick]);
		const blank = tried && picksMissing(picks).includes(pick);
		const error = blank
			? PICK_BLANK
			: refusedOver && pick === misfit
				? misfitSays(pick)
				: undefined;
		return (
			<SelectWithNote
				key={pick}
				id={PICK_FIELD(pick)}
				name={PICK_FIELD(pick)}
				label={PICK_LABEL[pick]}
				hint={hint}
				options={box.options}
				retired={box.retired}
				value={picks[pick]}
				onValueChange={(value) => setPicks({ ...picks, [pick]: value })}
				error={error}
				disabled={busy || undefined}
			/>
		);
	};

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
				setAsked({ over: answer, picks });
				onAccounts(picks);
			}}
		>
			<fieldset className="adm-fieldset">
				<legend className="adm-fieldset__legend">{PICK_GROUP_LEGEND.gift}</legend>
				{GIFT_PICKS.map((pick) => picker(pick))}
			</fieldset>
			<fieldset className="adm-fieldset">
				<legend className="adm-fieldset__legend">{PICK_GROUP_LEGEND.holding}</legend>
				{holdings.map((pick) => picker(pick, HOLDING_HINT[pick]))}
			</fieldset>
			<div className="adm-actions">
				<SaveButton
					type="submit"
					state={saved.state}
					disabled={busy || undefined}
					elsewhere={elsewhere}
				/>
			</div>
			{silent === null ? null : <FieldMessage>{unansweredSays(silent)}</FieldMessage>}
		</form>
	);
}
