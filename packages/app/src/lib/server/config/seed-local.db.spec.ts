import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import seedSql from '../../../../scripts/seed-local.sql?raw';
import { createDb, type Db } from '../db/client';
import { identityMissing } from '../org/identity';
import { writeOrgRow } from '../org/org-row.testing';
import { readOrgProfile } from '../org/queries';
import { readSites } from '../sites/queries';
import { readSetupState } from './setup-state';
import { client, run, stmt } from '$lib/server/db/database.testing';

// the committed seed file, run against a real database over the committed migrations: the checks its
// statements have to satisfy are `org_profile`'s own (../db/schema.ts), and what passes here is
// the one command a contributor runs to fill the organisation's row on a checkout.
//
// the file's own text, imported with `?raw`, and sent the way the command sends it, so the assertion
// is about what a contributor runs.

/**
 * the seed as `pnpm db:seed` applies it (../../../../scripts/seed.ts): the whole file in one
 * `executeMultiple`, comments and all.
 */
const applySeed = () => client.executeMultiple(seedSql);

/**
 * every job's state, as ./setup-state.ts reads it.
 *
 * the deployment env is empty, which is a checkout holding no `.dev.vars` — so what a line says
 * here is what the seed alone settled.
 */
async function jobStates(db: Db): Promise<Record<string, string>> {
	const state = await readSetupState(db, {});
	return Object.fromEntries((state?.lines ?? []).map((line) => [line.id, line.state]));
}

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

// storage is isolated per test file rather than per test, so both tables are emptied between
// them — the seed writes `org_profile`, and `site` is cleared so the empty-list case below reads
// what this seed left rather than what an earlier test did.
beforeEach(async () => {
	await client.batch([stmt('delete from org_profile'), stmt('delete from site')]);
});

describe('the local seed', () => {
	it('fills the identity a donation form is refused without', async () => {
		await applySeed();

		const profile = await readOrgProfile(db);
		expect(identityMissing(profile)).toEqual([]);
		expect(profile?.notificationEmail).not.toBeNull();
	});

	it('finishes the two jobs that are rows and leaves payments to `.dev.vars`', async () => {
		await applySeed();

		await expect(jobStates(db)).resolves.toMatchObject({
			organisation: 'ready',
			notifications: 'ready',
			payments: 'todo'
		});
	});

	it('runs twice and keeps an address typed between the runs', async () => {
		await applySeed();
		await run(stmt("update org_profile set notification_email = 'gifts@example.org'"));

		await applySeed();

		const profile = await readOrgProfile(db);
		expect(profile?.notificationEmail).toBe('gifts@example.org');
	});

	// a row the console wrote: the legal name it requires, every other box left empty.
	it('fills only what a row already there is missing', async () => {
		await writeOrgRow(client, { notification_email: 'gifts@example.org' });

		await applySeed();

		const profile = await readOrgProfile(db);
		expect(profile?.legalName).toBe('Hope Foundation');
		expect(profile?.notificationEmail).toBe('gifts@example.org');
		expect(profile?.taxId).toBe('12-3456789');
	});

	// a checkout gives on its own donation page at `/donate` (../../../routes/donate.tsx), which is
	// on no `site` row, so the seed leaves the list empty and a gift needs no site to be given.
	it('leaves the site list empty', async () => {
		await applySeed();

		await expect(readSites(db)).resolves.toEqual([]);
	});
});
