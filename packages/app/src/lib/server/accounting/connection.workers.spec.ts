import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import {
	connectQuickbooks,
	disconnectQuickbooks,
	fillQuickbooksAccounts,
	quickbooksStore,
	readQuickbooksConnection,
	saveQuickbooksAccounts,
	saveQuickbooksCompanyName,
	saveQuickbooksStartAt
} from './connection';

// the singleton connection row, against a real D1.
//
// a workers spec because every claim here is the database's: that the row is one row, that a
// rotated refresh token replaces the one that was stored, and that a disconnect leaves nothing
// behind. a stand-in would only prove the stand-in (CONTRIBUTING.md -> Tests).

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.prepare('delete from quickbooks_connection').run();
});

const CONNECTED_FROM = new Date('2026-01-01T00:00:00.000Z');

const TOKENS = {
	accessToken: 'access-one',
	accessTokenExpiresAt: new Date('2026-09-19T13:00:00.000Z'),
	refreshToken: 'refresh-one',
	refreshTokenExpiresAt: new Date('2026-12-28T12:00:00.000Z')
};

async function connect(): Promise<void> {
	await connectQuickbooks(db, {
		realmId: '4620816365',
		tokens: TOKENS,
		startAt: CONNECTED_FROM
	});
}

describe('connecting a company', () => {
	it('writes the one row, with the tokens the exchange issued', async () => {
		await connect();

		expect(await readQuickbooksConnection(db)).toEqual({
			realmId: '4620816365',
			companyName: null,
			income: null,
			fee: null,
			deposit: null,
			startAt: CONNECTED_FROM
		});
	});

	it('replaces the connection where one is already held', async () => {
		await connect();

		await connectQuickbooks(db, {
			realmId: '9999999999',
			tokens: { ...TOKENS, accessToken: 'access-two', refreshToken: 'refresh-two' },
			startAt: new Date('2026-05-01T00:00:00.000Z')
		});

		// connecting a second company is connecting this deployment's company: the id check in
		// ../db/schema.ts pins the row to one, so the other shape is a write the database refuses.
		const { results } = await env.DB.prepare(
			'select realm_id, refresh_token from quickbooks_connection'
		).all();
		expect(results).toEqual([{ realm_id: '9999999999', refresh_token: 'refresh-two' }]);
	});

	it('keeps every answer already given when a dead credential is reconnected', async () => {
		await connect();
		await saveQuickbooksCompanyName(db, 'Riverside Shelter');
		await saveQuickbooksStartAt(db, new Date('2025-07-01T00:00:00.000Z'));
		await saveQuickbooksAccounts(db, {
			income: { id: '79', name: 'Donations' },
			fee: { id: '80', name: 'Merchant fees' },
			deposit: { id: '35', name: 'Checking' }
		});

		await connectQuickbooks(db, {
			realmId: '4620816365',
			tokens: { ...TOKENS, accessToken: 'access-two', refreshToken: 'refresh-two' },
			startAt: new Date('2026-05-01T00:00:00.000Z')
		});

		expect(await readQuickbooksConnection(db)).toEqual({
			realmId: '4620816365',
			companyName: 'Riverside Shelter',
			income: { id: '79', name: 'Donations' },
			fee: { id: '80', name: 'Merchant fees' },
			deposit: { id: '35', name: 'Checking' },
			startAt: new Date('2025-07-01T00:00:00.000Z')
		});
	});

	it('forgets the previous company’s accounts where a different company is connected', async () => {
		await connect();
		await saveQuickbooksCompanyName(db, 'Riverside Shelter');
		await saveQuickbooksStartAt(db, new Date('2025-07-01T00:00:00.000Z'));
		await saveQuickbooksAccounts(db, {
			income: { id: '79', name: 'Donations' },
			fee: { id: '80', name: 'Merchant fees' },
			deposit: { id: '35', name: 'Checking' }
		});

		await connectQuickbooks(db, {
			realmId: '9999999999',
			tokens: { ...TOKENS, accessToken: 'access-two', refreshToken: 'refresh-two' },
			startAt: new Date('2026-05-01T00:00:00.000Z')
		});

		// an id out of the old company's chart names nothing in the new one, so a gift sent against
		// it is refused as an invalid reference — and a screen drawing the new company's name beside
		// the old company's accounts reads as correct.
		expect(await readQuickbooksConnection(db)).toEqual({
			realmId: '9999999999',
			companyName: null,
			income: null,
			fee: null,
			deposit: null,
			// the operator's own answer rather than the company's, and as true of the books they have
			// just connected as of the ones they left.
			startAt: new Date('2025-07-01T00:00:00.000Z')
		});
	});

	it('names no company until one has been read back', async () => {
		await connect();

		await saveQuickbooksCompanyName(db, 'Riverside Shelter');

		expect(await readQuickbooksConnection(db)).toMatchObject({
			companyName: 'Riverside Shelter'
		});
	});
});

describe('the store the adapter takes', () => {
	it('reads the connection with the accounts a send needs', async () => {
		await connect();
		await saveQuickbooksAccounts(db, {
			income: { id: '79', name: 'Donations' },
			fee: { id: '80', name: 'Merchant fees' },
			deposit: { id: '35', name: 'Checking' }
		});

		expect(await quickbooksStore(db).read()).toEqual({
			companyId: '4620816365',
			...TOKENS,
			incomeAccountId: '79',
			feeAccountId: '80',
			depositAccountId: '35'
		});
	});

	it('reads nothing where no company is connected', async () => {
		expect(await quickbooksStore(db).read()).toBeNull();
	});

	it('persists a rotated refresh token over the one that was presented', async () => {
		await connect();
		const rotated = {
			accessToken: 'access-two',
			accessTokenExpiresAt: new Date('2026-09-19T14:00:00.000Z'),
			refreshToken: 'refresh-two',
			refreshTokenExpiresAt: new Date('2027-01-01T00:00:00.000Z')
		};

		expect(await quickbooksStore(db).saveTokens(TOKENS.refreshToken, rotated)).toBe('stored');

		// Intuit retires the token it rotated away from, so a pair written anywhere but this column
		// is the connection lost the next time the old one is presented.
		expect(await quickbooksStore(db).read()).toMatchObject(rotated);
	});

	it('stores nothing where another caller has already rotated the token presented', async () => {
		await connect();
		const winner = { ...TOKENS, accessToken: 'access-two', refreshToken: 'refresh-two' };
		await quickbooksStore(db).saveTokens(TOKENS.refreshToken, winner);

		const outcome = await quickbooksStore(db).saveTokens(TOKENS.refreshToken, {
			...TOKENS,
			accessToken: 'access-three',
			refreshToken: 'refresh-three'
		});

		// Intuit retired `refresh-one` when it issued the winner its pair, so a write landing here
		// would replace a live credential with one that was already dead.
		expect(outcome).toBe('superseded');
		expect(await quickbooksStore(db).read()).toMatchObject(winner);
	});

	it('leaves the chosen accounts alone when it writes a rotated pair', async () => {
		await connect();
		await saveQuickbooksAccounts(db, {
			income: { id: '79', name: 'Donations' },
			fee: { id: '80', name: 'Merchant fees' },
			deposit: { id: '35', name: 'Checking' }
		});

		await quickbooksStore(db).saveTokens(TOKENS.refreshToken, {
			...TOKENS,
			refreshToken: 'refresh-two'
		});

		expect(await quickbooksStore(db).read()).toMatchObject({ incomeAccountId: '79' });
	});
});

describe('the accounts an operator picks', () => {
	it('stores each id with the name the screen shows beside it', async () => {
		await connect();

		await saveQuickbooksAccounts(db, {
			income: { id: '79', name: 'Donations' },
			fee: { id: '80', name: 'Merchant fees' },
			deposit: { id: '35', name: 'Checking' }
		});

		expect(await readQuickbooksConnection(db)).toMatchObject({
			income: { id: '79', name: 'Donations' },
			fee: { id: '80', name: 'Merchant fees' },
			deposit: { id: '35', name: 'Checking' }
		});
	});
});

describe('the accounts filled in at connect', () => {
	const DEFAULTS = {
		income: { id: '81', name: 'Contributions' },
		fee: { id: '82', name: 'Bank Charges' },
		deposit: { id: '36', name: 'Savings' }
	};

	it('are written where none is held', async () => {
		await connect();

		await fillQuickbooksAccounts(db, '4620816365', DEFAULTS);

		expect(await readQuickbooksConnection(db)).toMatchObject(DEFAULTS);
	});

	it('write only the roles the chart named, leaving the rest unpicked', async () => {
		await connect();

		await fillQuickbooksAccounts(db, '4620816365', { ...DEFAULTS, fee: null, deposit: null });

		expect(await readQuickbooksConnection(db)).toMatchObject({
			income: DEFAULTS.income,
			fee: null,
			deposit: null
		});
	});

	// a reconnect to another company can land between the chart read and this write, and account
	// ids are per-company small integers, so the old company's would name real accounts in the new.
	it('write nothing once a different company is connected than the chart was read from', async () => {
		await connect();

		await fillQuickbooksAccounts(db, '9999999999', DEFAULTS);

		expect(await readQuickbooksConnection(db)).toMatchObject({
			income: null,
			fee: null,
			deposit: null
		});
	});

	it('never overwrite accounts an operator already picked', async () => {
		await connect();
		const picked = {
			income: { id: '79', name: 'Donations' },
			fee: { id: '80', name: 'Merchant fees' },
			deposit: { id: '35', name: 'Checking' }
		};
		await saveQuickbooksAccounts(db, picked);

		await fillQuickbooksAccounts(db, '4620816365', DEFAULTS);

		expect(await readQuickbooksConnection(db)).toMatchObject(picked);
	});
});

describe('the date gifts are sent from', () => {
	it('moves the date a gift is sent from', async () => {
		await connect();
		const later = new Date('2026-04-01T00:00:00.000Z');

		await saveQuickbooksStartAt(db, later);

		expect((await readQuickbooksConnection(db))?.startAt).toEqual(later);
	});
});

describe('disconnecting', () => {
	it('leaves no credential behind', async () => {
		await connect();

		await disconnectQuickbooks(db);

		expect(await readQuickbooksConnection(db)).toBeNull();
		expect(await quickbooksStore(db).read()).toBeNull();
	});
});
