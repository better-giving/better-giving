import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { client, run, stmt } from '../db/database.testing';
import { rejectionCode } from '../db/rejection.testing';
import { disablePledgeRail, enablePledgeRail, readPledgeRails } from './pledge-rails';

// the deployment's stock and IRA (QCD) details, against a real database: that a rail turns on only
// with every detail, and that turning it off keeps them (CONTRIBUTING.md -> Tests).

let db: Db;

beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	await run(stmt('delete from pledge_rail'));
});

describe('readPledgeRails', () => {
	it('reads both rails off, with nothing saved, before the deployer has touched either', async () => {
		expect(await readPledgeRails(db)).toEqual({
			stock: {
				enabled: false,
				details: { brokerageName: null, dtcNumber: null, accountNumber: null, accountName: null }
			},
			ira_qcd: { enabled: false, details: { payeeName: null, mailingAddress: null } }
		});
	});
});

const HARBOR = {
	brokerageName: 'Harbor Street Securities',
	dtcNumber: '0164',
	accountNumber: 'Z12-345678',
	accountName: 'Cedar Fork Community Pantry Inc.'
};

const PAYEE = {
	payeeName: 'Cedar Fork Community Pantry Inc.',
	mailingAddress: '412 Alder Lane, Suite 3\nCedar Fork, OR 97330'
};

describe('enablePledgeRail', () => {
	it('turns stock on with its details, leaving IRA (QCD) off', async () => {
		await enablePledgeRail(db, { rail: 'stock', details: HARBOR });
		const rails = await readPledgeRails(db);
		expect(rails.stock).toEqual({ enabled: true, details: HARBOR });
		expect(rails.ira_qcd.enabled).toBe(false);
	});

	it('replaces the details a second save states', async () => {
		await enablePledgeRail(db, { rail: 'ira_qcd', details: PAYEE });
		await enablePledgeRail(db, {
			rail: 'ira_qcd',
			details: { ...PAYEE, payeeName: 'Cedar Fork Pantry' }
		});
		expect((await readPledgeRails(db)).ira_qcd).toEqual({
			enabled: true,
			details: { ...PAYEE, payeeName: 'Cedar Fork Pantry' }
		});
	});

	it('refuses a blank detail and leaves the rail as it was', async () => {
		expect(
			await rejectionCode(() =>
				enablePledgeRail(db, { rail: 'stock', details: { ...HARBOR, dtcNumber: '  ' } })
			)
		).toContain('SQLITE_CONSTRAINT_CHECK');
		expect((await readPledgeRails(db)).stock.enabled).toBe(false);
	});
});

describe('disablePledgeRail', () => {
	it('turns the rail off and keeps what was saved', async () => {
		await enablePledgeRail(db, { rail: 'stock', details: HARBOR });
		await disablePledgeRail(db, 'stock');
		expect((await readPledgeRails(db)).stock).toEqual({ enabled: false, details: HARBOR });
	});

	it('is a rail off already when nothing was ever saved', async () => {
		await disablePledgeRail(db, 'ira_qcd');
		expect((await readPledgeRails(db)).ira_qcd).toEqual({
			enabled: false,
			details: { payeeName: null, mailingAddress: null }
		});
	});
});
