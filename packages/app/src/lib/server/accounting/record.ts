import { eq, sql } from 'drizzle-orm';
import { POSTING_ACCOUNTS, type PostingAccountKey } from '../db/accounts';
import type { Db } from '../db/client';
import { entryGroup, type PaymentProviderName } from '../db/schema';
import { findPaymentDonor } from '../donations/queries';
import {
	findEntryGroup,
	findEntryGroupById,
	type EntryGroupListRow,
	type EntryLine
} from '../ledger/queries';
import { isProcessor } from '../payments/provider';
import { keyedOnARefund, readAnswered } from './outbox';
import {
	failed,
	HOLDING_OF,
	isHoldingRole,
	type AccountingResult,
	type AccountRole,
	type CorrectionLine,
	type CorrectionRecord,
	type HoldingRole,
	type Sendable
} from './provider';

// what one queued entry group turns out to be, read out of the books.
//
// the delivery holds an id off `quickbooks_sync` and nothing else (../db/schema.ts), and what an
// adapter needs is a gift, a correction or a reversal. this is the whole of the distance between
// those, and it is a module of its own for the reason ./provider.ts is: it reads this app's books and
// knows nothing about QuickBooks, while ./quickbooks.ts speaks to QuickBooks and knows nothing
// about `entry_group`.
//
// nothing here writes `quickbooks_sync`. the outbox is written by the posting that owes it and read
// by the delivery that sends it; the one thing read off it here is where the record a reversal
// answers went, through ./outbox.ts, which owns what a reversal answers.
//
// ---------------------------------------------------------------------------
// two entry groups, one record.
//
// a settled charge posts the gift and the processor's cut as separate entry groups sharing a source
// id (../donations/entries.ts), and the company's books hold them as one transaction — so the fee
// is read here, off the `fee` sibling, rather than sent as a record of its own. that is the same
// fact ../accounting/outbox.ts states from the other side, where it queues no row for a `fee`
// group at all, and it is why a `fee` id arriving here is a defect rather than something to map.
//
// ---------------------------------------------------------------------------
// a group keyed on a refund-direction row is a reversal, whatever its source type.
//
// ../donations/reverse.ts posts a withdrawal under `('refund', row)`, puts one that did not stand
// back under `('payment', row)`, and settles up a lost dispute under `('adjustment', row)`. read by
// source type alone, the second would go over as a new gift and the third as a hand correction, so
// the row is read first and all three go over as what they are: the lines they hold, each in its
// role, against the gift's donor.

/**
 * which of the operator's roles each of this app's nine accounts stands for.
 *
 * total over `PostingAccountKey`, so an account added to ../db/accounts.ts is a compile error here
 * rather than a posting that silently has nowhere to go.
 *
 * `processor` is 1020 Undeposited Funds, which this app holds for every processor at once: which
 * processor's holding it is in the company's books is the rail that settled the gift, read off the
 * payment ({@link HOLDING_OF}), and a correction naming it has no payment to read. 1010 Bank / Cash
 * is where a gift received in hand is debited (../donations/entries.ts), so it is the company's own
 * Undeposited Funds — money nobody has banked yet — and never its bank account.
 *
 * `null` is deliberate on four of them:
 *
 *   accountsReceivable — a pledge, which this app does not yet post and a company records as an
 *                        invoice rather than as money arrived.
 *   salesTaxPayable    — owed to a jurisdiction, and never an account the QuickBooks screen asks an
 *                        operator to pick.
 *   the two net-asset classes — closing entries, which a bookkeeper makes in their own books.
 *
 * an entry naming one of those is refused by name rather than posted to whichever role looked
 * closest: nothing the operator picked says where a tax liability belongs.
 */
const ROLE_OF: Readonly<Record<PostingAccountKey, AccountRole | 'processor' | null>> = {
	bankCash: 'undepositedFunds',
	undepositedFunds: 'processor',
	accountsReceivable: null,
	salesTaxPayable: null,
	netAssetsWithoutRestrictions: null,
	netAssetsWithRestrictions: null,
	donationsDeductible: 'income',
	donationsNonDeductible: 'income',
	processorFees: 'fee'
};

/** the same table by account id, which is what a ledger line carries. */
const BY_ACCOUNT_ID = new Map<
	string,
	{ key: PostingAccountKey; role: AccountRole | 'processor' | null }
>(
	(Object.keys(POSTING_ACCOUNTS) as PostingAccountKey[]).map((key) => [
		POSTING_ACCOUNTS[key].id,
		{ key, role: ROLE_OF[key] }
	])
);

/**
 * what a queued entry group is to be sent as, or why it cannot be.
 *
 * the refusals are terminal, every one of them: an id nothing carries, a `fee` group the outbox
 * never queues, a source type nothing sends, and an account no role stands for.
 * none of those is answered by asking again, and `LANDING_OF` in ./deliver.ts is where each of them
 * is read as a row to give up on rather than a call to make later.
 */
export async function readSendable(
	db: Db,
	entryGroupId: string
): Promise<AccountingResult<Sendable>> {
	const group = await findEntryGroupById(db, entryGroupId);
	if (group === null) {
		return failed(
			'not_found',
			`No journal entry carries the id ${entryGroupId}, so there is nothing to send for it.`
		);
	}

	if (group.sourceType !== 'fee' && (await isReversal(db, group.id))) {
		return reversalOf(db, group);
	}
	if (group.sourceType === 'payment') return giftOf(db, group);
	if (group.sourceType === 'adjustment') return correctionOf(group);

	// `fee` is the one worth naming: it is posted beside every charge that carried one, and sending
	// it on its own would send the same money twice. the outbox queues none, so arriving here means
	// something upstream queued an entry group by a rule of its own.
	return failed(
		'internal_error',
		`A ${group.sourceType} journal entry was handed to the QuickBooks delivery, which sends gifts, corrections and reversals only. Nothing was sent.`
	);
}

async function isReversal(db: Db, entryGroupId: string): Promise<boolean> {
	const [row] = await db
		.select({ reversal: sql<number>`${keyedOnARefund(entryGroup.sourceId)}` })
		.from(entryGroup)
		.where(eq(entryGroup.id, entryGroupId));
	return row?.reversal === 1;
}

/**
 * a reversal as one record: its lines, 1020's in the holding of the processor that refunded, and
 * the record it answers in the company's books.
 */
async function reversalOf(db: Db, group: EntryGroupListRow): Promise<AccountingResult<Sendable>> {
	const answers = await readAnswered(db, group.id);
	if (answers === null) {
		// unreachable through the delivery, which takes a reversal only once what it answers is sent.
		return failed(
			'internal_error',
			`The journal entry ${group.id} reverses one QuickBooks holds no record of, so there is nothing in its books to take it off. Nothing was sent.`
		);
	}
	const donor = await findPaymentDonor(db, group.sourceId);
	if (donor === null) {
		return failed(
			'internal_error',
			`The books hold a reversal against refund ${group.sourceId} and no gift behind it names a donor, so there is nobody to take it off. Nothing was sent.`
		);
	}
	const lines = sidesOf(
		group,
		donor.provider !== null && isProcessor(donor.provider)
			? { ok: true, value: HOLDING_OF[donor.provider] }
			: failed(
					'unmapped_account',
					`The journal entry ${group.id} moves money through Undeposited Funds against a refund no processor made, so there is no processor account in QuickBooks to take it from. Nothing was sent.`
				)
	);
	if (!lines.ok) return lines;
	return {
		ok: true,
		value: {
			kind: 'reversal',
			reversal: {
				key: group.id,
				occurredAt: group.occurredAt,
				currency: group.currency,
				memo: group.memo,
				donor: { displayName: donor.displayName, email: donor.email },
				answers,
				lines: lines.value
			}
		}
	};
}

/**
 * a gift as one record: what was recognised, what the processor kept, and who gave it.
 *
 * the two figures are read off the lines rather than off the donation row, because the lines are
 * what the books actually hold — a partial capture, a fee the processor restated, and a gift split
 * across funds all show up here and in no other reading.
 */
async function giftOf(db: Db, group: EntryGroupListRow): Promise<AccountingResult<Sendable>> {
	const income = totalIn(group.lines, 'income', (amount) => -amount);
	if (!income.ok) return income;
	if (income.value <= 0) {
		return failed(
			'internal_error',
			`The journal entry ${group.id} credits no income account, so there is no gift in it to send.`
		);
	}

	const feeGroup = await findEntryGroup(db, 'fee', group.sourceId);
	const fee =
		feeGroup === null
			? ({ ok: true, value: 0 } as const)
			: totalIn(feeGroup.lines, 'fee', (amount) => amount);
	if (!fee.ok) return fee;

	const donor = await findPaymentDonor(db, group.sourceId);
	if (donor === null) {
		return failed(
			'internal_error',
			`The books hold a gift against payment ${group.sourceId} and no payment row carries that id, so there is no donor to name on it.`
		);
	}

	const holding = holdingOf(group, donor.provider);
	if (!holding.ok) return holding;

	return {
		ok: true,
		value: {
			kind: 'gift',
			gift: {
				key: group.id,
				occurredAt: group.occurredAt,
				currency: group.currency,
				donor: { displayName: donor.displayName, email: donor.email },
				memo: group.memo,
				incomeMinor: income.value,
				feeMinor: fee.value,
				holding: holding.value
			}
		}
	};
}

/**
 * who holds a gift's money: the role of the line that is neither income nor a fee.
 *
 * the rail is what settles 1020's role, and a gift debited there by a payment naming no processor
 * is one nothing in this app posts — refused rather than sent into whichever processor came first.
 */
function holdingOf(
	group: EntryGroupListRow,
	provider: PaymentProviderName | null
): AccountingResult<HoldingRole> {
	for (const line of group.lines) {
		const role = BY_ACCOUNT_ID.get(line.accountId)?.role;
		if (role === 'processor') {
			return provider !== null && isProcessor(provider)
				? { ok: true, value: HOLDING_OF[provider] }
				: failed(
						'unmapped_account',
						`The journal entry ${group.id} holds a gift in Undeposited Funds against a payment no processor settled, so there is no processor account in QuickBooks to put it in. Nothing was sent.`
					);
		}
		if (role !== undefined && role !== null && isHoldingRole(role))
			return { ok: true, value: role };
	}
	return failed(
		'internal_error',
		`The journal entry ${group.id} credits income and debits no account the money is held in, which nothing in this app posts.`
	);
}

/** a correcting entry, one line per line, each in the role its account maps to. */
function correctionOf(group: EntryGroupListRow): AccountingResult<Sendable> {
	const lines = sidesOf(
		group,
		failed(
			'unmapped_account',
			`The journal entry moves money through ${POSTING_ACCOUNTS.undepositedFunds.name}, which this app holds for every processor at once, and a correction names no payment to tell which processor's QuickBooks account it belongs in. Post this correction in QuickBooks instead.`
		)
	);
	if (!lines.ok) return lines;
	return {
		ok: true,
		value: {
			kind: 'correction',
			correction: {
				key: group.id,
				occurredAt: group.occurredAt,
				currency: group.currency,
				memo: group.memo,
				lines: lines.value
			}
		}
	};
}

/** each line in the role its account maps to, 1020's in `processor` or refused as it says. */
function sidesOf(
	group: EntryGroupListRow,
	processor: AccountingResult<HoldingRole>
): AccountingResult<CorrectionRecord['lines']> {
	const lines: CorrectionLine[] = [];
	for (const line of group.lines) {
		const role = roleOf(line);
		if (!role.ok) return role;
		let landed: AccountRole;
		if (role.value !== 'processor') landed = role.value;
		else if (processor.ok) landed = processor.value;
		else return processor;
		lines.push({
			role: landed,
			// `+` is a debit and `−` a credit project-wide (../ledger/posting.ts). the direction is
			// named here rather than carried as a sign, so nothing downstream has to know that.
			posting: line.amountMinor >= 0 ? 'debit' : 'credit',
			amountMinor: Math.abs(line.amountMinor)
		});
	}

	const [first, second, ...rest] = lines;
	if (first === undefined || second === undefined) {
		// unreachable: `post()` refuses an entry group with fewer than two lines, so this is the
		// tuple being a tuple rather than a state the books can hold.
		return failed(
			'internal_error',
			`The journal entry ${group.id} has fewer than two lines, which nothing in this app can post.`
		);
	}
	return { ok: true, value: [first, second, ...rest] };
}

/**
 * what the lines in one role net to, each amount read in the direction the caller asked for.
 *
 * net rather than a sum of one side, because a gift split across funds is several lines in the one
 * role and the figure that goes over is what they come to together. lines in the other roles are
 * the entry's own counterparts and are passed over; a line naming an account with no role at all
 * refuses the whole read, because a figure summed past one is a gift sent at the wrong amount with
 * nothing anywhere looking wrong.
 */
function totalIn(
	lines: readonly EntryLine[],
	role: 'income' | 'fee',
	read: (amountMinor: number) => number
): AccountingResult<number> {
	let total = 0;
	for (const line of lines) {
		const lineRole = roleOf(line);
		if (!lineRole.ok) return lineRole;
		if (lineRole.value !== role) continue;
		total += read(line.amountMinor);
	}
	return { ok: true, value: total };
}

/** the role a line's account stands for, or a refusal naming the account that has none. */
function roleOf(line: EntryLine): AccountingResult<AccountRole | 'processor'> {
	const known = BY_ACCOUNT_ID.get(line.accountId);
	if (known === undefined) {
		return failed(
			'unmapped_account',
			`The journal entry names the account ${line.accountId}, which is not one this deployment's chart of accounts holds. Nothing was sent.`
		);
	}
	if (known.role === null) {
		return failed(
			'unmapped_account',
			`The journal entry moves money through ${POSTING_ACCOUNTS[known.key].name}, and only income, processor fees and the accounts gifts are held in are sent to QuickBooks. Post this correction in QuickBooks instead.`
		);
	}
	return { ok: true, value: known.role };
}
