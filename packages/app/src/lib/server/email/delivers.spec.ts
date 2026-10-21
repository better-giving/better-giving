import { describe, expect, it } from 'vitest';
import { mailDelivers } from './delivers';

// whether the deployment's mail values are a host that delivers, which is a stricter question
// than whether the four variables are set. `.env.example` ships four placeholders that are set
// and still deliver nothing, and `mail.example.org` is a host this suite treats as real-shaped
// (./factory.spec.ts) — so a check that refused every `example.org` would refuse the suite.

/** a host, login, password and from-address that are not the placeholders `.env.example` ships. */
const DELIVERS = {
	SMTP_HOST: 'mail.example.org',
	SMTP_USERNAME: 'apikey',
	SMTP_PASSWORD: 'pw',
	MAIL_FROM: 'giving@riverbanktrust.org'
};

describe('mailDelivers', () => {
	it('is false when a mail variable is missing', () => {
		expect(mailDelivers({})).toBe(false);
		expect(mailDelivers({ ...DELIVERS, SMTP_PASSWORD: '   ' })).toBe(false);
	});

	it.each([
		{ label: 'the example host', env: { SMTP_HOST: 'smtp.example.org' } },
		{ label: 'the example host in another case', env: { SMTP_HOST: 'SMTP.EXAMPLE.ORG' } },
		{ label: 'the example username', env: { SMTP_USERNAME: 'REPLACE_ME' } },
		{ label: 'the example password', env: { SMTP_PASSWORD: 'REPLACE_ME' } },
		{ label: 'the example from-address', env: { MAIL_FROM: 'donations@example.org' } },
		{
			label: 'the example from-address in another case',
			env: { MAIL_FROM: 'Donations@Example.ORG' }
		}
	])('is false when $label is still the placeholder', ({ env }) => {
		expect(mailDelivers({ ...DELIVERS, ...env })).toBe(false);
	});

	it('is true for a real-shaped host, login, password and from-address', () => {
		expect(mailDelivers(DELIVERS)).toBe(true);
		expect(mailDelivers({ ...DELIVERS, SMTP_HOST: '  mail.example.org \n' })).toBe(true);
	});

	it('does not treat every example.org value as a placeholder', () => {
		expect(mailDelivers({ ...DELIVERS, SMTP_USERNAME: 'replace_me' })).toBe(true);
		expect(mailDelivers({ ...DELIVERS, MAIL_FROM: 'giving@example.org' })).toBe(true);
	});
});
