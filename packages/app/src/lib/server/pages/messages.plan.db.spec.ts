import { expect, it } from 'vitest';
import type { Db } from '../db/client';
import {
	moderatedKeyAt,
	readModeratedBetween,
	readModeratedMessages,
	readShownMessages
} from './messages';
import { planStepsOf, statementsOf } from '../integrations/statements.testing';

// both message lists page newest first over `donation`, a table that grows with every gift ever
// taken, so what neither read may do is scan it or sort it. the plan is read for the statements
// each read prepares, with the values it binds: a partial index is only chosen when sqlite can see
// the read's `where` imply the index's own.

const PAGE_READ = /^SCAN donation USING INDEX donation_note_public_received_at_idx\b/;

it('pages the donate page’s messages through the public notes’ index, never a sort', async () => {
	const plan = await planStepsOf(await statementsOf((db) => readShownMessages(db, null)));

	expect(plan).toContainEqual(expect.stringMatching(PAGE_READ));
	expect(plan).not.toContainEqual(expect.stringMatching(/^SCAN donation$/));
	expect(plan).not.toContainEqual(expect.stringMatching(/USE TEMP B-TREE FOR ORDER BY/));
});

it('pages the admin messages, hidden ones too, through the same index, never a sort', async () => {
	const plan = await planStepsOf(await statementsOf((db) => readModeratedMessages(db, null)));

	expect(plan).toContainEqual(expect.stringMatching(PAGE_READ));
	expect(plan).not.toContainEqual(expect.stringMatching(/^SCAN donation$/));
	expect(plan).not.toContainEqual(expect.stringMatching(/USE TEMP B-TREE FOR ORDER BY/));
});

const KEY = { receivedAt: Date.parse('2026-09-10T11:00:00.000Z'), id: 'don_m' } as const;
const PAGE_SEEK =
	/^SEARCH donation USING INDEX donation_note_public_received_at_idx \(\(received_at,id\)<\(\?,\?\)\)/;

it('resumes the admin messages by seeking the index past the cursor, never a sort', async () => {
	const reads = [
		(db: Db) => readModeratedMessages(db, KEY),
		(db: Db) => moderatedKeyAt(db, KEY, 3),
		(db: Db) => readModeratedBetween(db, KEY, null)
	];
	for (const read of reads) {
		const plan = await planStepsOf(await statementsOf(read));

		expect(plan).toContainEqual(expect.stringMatching(PAGE_SEEK));
		expect(plan).not.toContainEqual(expect.stringMatching(/^SCAN donation$/));
		expect(plan).not.toContainEqual(expect.stringMatching(/USE TEMP B-TREE FOR ORDER BY/));
	}
});

it('reads a span of the admin messages between two cursors from the same index', async () => {
	const through = { receivedAt: Date.parse('2026-09-01T00:00:00.000Z'), id: 'don_a' };
	const plan = await planStepsOf(
		await statementsOf((db) => readModeratedBetween(db, KEY, through))
	);

	expect(plan).toContainEqual(
		expect.stringMatching(
			/^SEARCH donation USING INDEX donation_note_public_received_at_idx \(\(received_at,id\)>\(\?,\?\) AND \(received_at,id\)<\(\?,\?\)\)/
		)
	);
	expect(plan).not.toContainEqual(expect.stringMatching(/USE TEMP B-TREE FOR ORDER BY/));
});
