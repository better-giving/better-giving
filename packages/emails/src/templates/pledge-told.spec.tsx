import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import * as pledgeTold from './pledge-told';
import type { PledgeToldData } from './pledge-told';

const STOCK: PledgeToldData = {
	donorName: 'Maya Okafor',
	donorEmail: 'maya.okafor@example.org',
	reference: 'CFCP-AAPL-7Q2D',
	pledged: { method: 'stock', ticker: 'AAPL', shares: '50' }
};

const IRA: PledgeToldData = {
	donorName: 'James Whitfield',
	donorEmail: 'j.whitfield@example.com',
	reference: 'CFCP-IRA-4K9M',
	pledged: {
		method: 'ira_qcd',
		amountMinor: 500_000,
		currency: 'USD',
		custodian: 'Fidelity Investments'
	}
};

const rendered = (data: PledgeToldData) => renderEmail(pledgeTold.template(data));

describe('pledgeTold.template — a stock pledge', () => {
	it('says who sent how many shares of what, in the subject', async () => {
		const message = await rendered(STOCK);
		expect(message.subject).toBe('Maya Okafor says 50 shares of AAPL are on the way');
	});

	it('names the donor, their address, the shares and the reference in both arms', async () => {
		const message = await rendered(STOCK);
		for (const arm of [message.text, message.html]) {
			expect(arm).toContain('Maya Okafor');
			expect(arm).toContain('maya.okafor@example.org');
			expect(arm).toContain('50 shares of AAPL');
			expect(arm).toContain('CFCP-AAPL-7Q2D');
			expect(arm).toContain('their broker');
		}
	});

	it('states no dollar amount, which a stock gift has none of until it arrives', async () => {
		const message = await rendered(STOCK);
		// the html arm carries react's `<!--$-->` marker, so the figure is looked for there by its code.
		expect(message.text).not.toMatch(/\$|USD/);
		expect(message.html).not.toContain('USD');
	});

	it('says one share in the singular', async () => {
		const message = await rendered({
			...STOCK,
			pledged: { method: 'stock', ticker: 'AAPL', shares: '1' }
		});
		expect(message.subject).toBe('Maya Okafor says 1 share of AAPL is on the way');
	});
});

describe('pledgeTold.template — an IRA (QCD) pledge', () => {
	it('says who sent how much from which custodian, in the subject', async () => {
		const message = await rendered(IRA);
		expect(message.subject).toBe(
			'James Whitfield says USD 5,000.00 from Fidelity Investments is on the way'
		);
	});

	it('names the amount, the custodian and the reference in both arms', async () => {
		const message = await rendered(IRA);
		for (const arm of [message.text, message.html]) {
			expect(arm).toContain('USD 5,000.00 from Fidelity Investments');
			expect(arm).toContain('CFCP-IRA-4K9M');
			expect(arm).toContain('their IRA custodian');
		}
	});
});

describe('pledgeTold.template — either rail', () => {
	it('says the gift counts once it is marked received on Gifts', async () => {
		for (const data of [STOCK, IRA]) {
			const message = await rendered(data);
			expect(message.text).toContain('mark it received on Gifts');
		}
	});

	it('names the donor alone where no address is on file', async () => {
		const message = await rendered({ ...STOCK, donorEmail: null });
		expect(message.text).toContain('Donor: Maya Okafor');
		expect(message.text).not.toContain('(');
	});

	it('escapes what the donor typed in the HTML arm', async () => {
		const message = await rendered({
			...IRA,
			pledged: { ...IRA.pledged, custodian: '<b>&' } as PledgeToldData['pledged']
		});
		expect(message.html).toContain('&lt;b&gt;&amp;');
		expect(message.html).not.toContain('<b>&');
	});
});
