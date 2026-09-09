import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import seedSql from '../../../../scripts/seed-local.sql?raw';
import { createDb, type Db } from '../db/client';
import { identityMissing } from '../org/identity';
import { writeOrgRow } from '../org/org-row.testing';
import { readOrgProfile } from '../org/queries';
import { readSites } from '../sites/queries';
import { readSetupState } from './setup-state';

// the committed seed file, run against real D1 over the committed migrations: the checks its
// statements have to satisfy are `org_profile`'s own (../db/schema.ts), and what passes here is
// the one command a contributor runs to clear the set-up gate (../../../routes/_app.tsx).
//
// the file's own text, imported with `?raw`, so the assertion is about what a contributor runs.

/**
 * the file cut into the statements `wrangler d1 execute --file` would send.
 *
 * cut here at all because `env.DB.exec`, the one API that takes a whole file, cannot take this
 * one: it treats every newline as a statement boundary, so the header's first line comes back as
 * `D1_EXEC_ERROR: ... SQL code did not contain a statement`. the command a contributor runs is
 * unaffected — wrangler splits the file before sending it.
 *
 * a comment line is skipped rather than scanned for the boundary, which is the whole of what this
 * has to get right: the header's second paragraph ends a clause with a semicolon, and a split on
 * `;` alone cuts the first statement in half there and sends a fragment.
 */
function splitStatements(sql: string): string[] {
	const statements: string[] = [];
	let current: string[] = [];
	for (const line of sql.split('\n')) {
		current.push(line);
		if (line.trimStart().startsWith('--')) continue;
		if (!line.trimEnd().endsWith(';')) continue;
		statements.push(current.join('\n').trim());
		current = [];
	}
	return statements;
}

const seedStatements = splitStatements(seedSql);

/** the seed as a contributor applies it: every statement in the file, in order, comments and all. */
const applySeed = async () => {
	for (const statement of seedStatements) await env.DB.prepare(statement).run();
};

/**
 * every job's state, read the way both gated loaders read it (./setup-state.ts).
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
	db = createDb(env.DB);
});

// storage is isolated per test file rather than per test, so both tables are emptied between
// them — the seed writes `org_profile`, and `site` is cleared so the empty-list case below reads
// what this seed left rather than what an earlier test did.
beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare('delete from org_profile'),
		env.DB.prepare('delete from site')
	]);
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
		await env.DB.prepare("update org_profile set notification_email = 'gifts@example.org'").run();

		await applySeed();

		const profile = await readOrgProfile(db);
		expect(profile?.notificationEmail).toBe('gifts@example.org');
	});

	// a row the console wrote: the legal name it requires, every other box left empty.
	it('fills only what a row already there is missing', async () => {
		await writeOrgRow(env.DB, { notification_email: 'gifts@example.org' });

		await applySeed();

		const profile = await readOrgProfile(db);
		expect(profile?.legalName).toBe('Hope Foundation');
		expect(profile?.notificationEmail).toBe('gifts@example.org');
		expect(profile?.taxId).toBe('12-3456789');
	});

	// a checkout gives on its own donation page at `/{form_id}` (../../../routes/$formId.tsx), which
	// is on no `site` row, so the seed leaves the list empty and a form needs no site to be given to.
	it('leaves the site list empty', async () => {
		await applySeed();

		await expect(readSites(db)).resolves.toEqual([]);
	});
});
