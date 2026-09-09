import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { parseContact } from '../contacts/contact-input';
import { createDb } from '../db/client';
import { commitDonor } from './donor';

// one case, in a file of its own, and the isolation is the reason it is not in ./donor.workers.spec.ts.
//
// what it needs is a database that genuinely refuses the write, and the only honest way to have one
// is to take the table away — a stand-in for D1 proves the stand-in (CLAUDE.md). the pool undoes a
// test's rows between tests in a file but not its DDL, so the drop below outlives the test that made
// it and every later case in the same file finds no `contact` table. it does not outlive the file:
// storage is copied fresh per spec file, which is what makes one case alone here safe and the same
// case beside its neighbours order-dependent.
//
// so this file holds exactly one test and must go on holding exactly one.

it('answers a write the database will not take with a sentence rather than a throw', async () => {
	const db = createDb(env.DB);
	const parsed = parseContact({
		kind: 'individual',
		first_name: 'Ada',
		last_name: 'Okafor',
		primary_email: 'ada@example.org'
	});
	if (!parsed.ok) throw new Error('the fixture donor does not parse');

	await env.DB.prepare('drop table contact').run();

	const committed = await commitDonor(db, parsed.value, null);

	// the arm the repeating-gift path checks before it creates a commitment: a throw here would be a
	// 500 with no body on a public payment endpoint, and a commitment created anyway would collect
	// money against a donor row that is not here.
	expect(committed.ok).toBe(false);
	expect(committed.ok || committed.detail).toContain('pnpm run logs');
});
