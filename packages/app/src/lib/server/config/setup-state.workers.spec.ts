import { MIN_ADMIN_PASSWORD_LENGTH } from '@better-giving/operator/admin-password';
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { readSetupState } from './setup-state';

// a workers spec because `readSetupState` reads `org_profile` off D1 before it says anything, and
// CLAUDE.md refuses a stand-in for it. what is asserted here is the other half of the reading: the
// password line, which is decided from the deployment's own variables and nothing else.

/** the state of the one line this file is about. */
async function passwordState(db: Db, deploymentEnv: unknown) {
	const state = await readSetupState(db, deploymentEnv);
	return state?.lines.find((line) => line.id === 'password')?.state;
}

let db: Db;
beforeAll(() => {
	db = createDb(env.DB);
});

describe('the dashboard-password set-up line', () => {
	it('is done for a password this deployment will authenticate against', async () => {
		const password = 'x'.repeat(MIN_ADMIN_PASSWORD_LENGTH);
		await expect(passwordState(db, { ADMIN_PASSWORD: password })).resolves.toBe('ready');
	});

	// the defect this line exists for: a stored value short enough that `readStaffCredential`
	// refuses it used to tick the job, which stood the set-up gate aside and drew a sign-in screen
	// whose every attempt came back unavailable — with the console reporting the password
	// configured and no way out of the loop from inside the product.
	it('is unfinished for a password the sign-in path would refuse', async () => {
		const tooShort = 'x'.repeat(MIN_ADMIN_PASSWORD_LENGTH - 1);
		await expect(passwordState(db, { ADMIN_PASSWORD: tooShort })).resolves.toBe('todo');
	});

	it('is unfinished when no password is set at all', async () => {
		await expect(passwordState(db, {})).resolves.toBe('todo');
	});
});
