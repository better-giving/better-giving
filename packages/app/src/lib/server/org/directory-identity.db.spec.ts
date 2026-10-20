import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client';
import { client, run, stmt } from '../db/database.testing';
import { readDirectoryIdentity } from './directory-identity';
import { saveProfile } from './profile.testing';

// the read `pnpm setup-webhook:chariot` makes of the profile, over the row the settings save writes,
// so a column the save stops writing is a red here rather than a deployer told no EIN is saved.

beforeEach(async () => {
	await run(stmt('delete from org_profile'));
});

describe('readDirectoryIdentity', () => {
	it('reads the EIN and the notification address the profile holds', async () => {
		await saveProfile(createDb(client), {
			tax_id: '98-7654321',
			notification_email: 'ops@hope.example'
		});

		expect(await readDirectoryIdentity(client)).toEqual({
			ein: '98-7654321',
			notificationEmail: 'ops@hope.example'
		});
	});

	it('reads neither where no profile is saved', async () => {
		expect(await readDirectoryIdentity(client)).toEqual({ ein: null, notificationEmail: null });
	});
});
