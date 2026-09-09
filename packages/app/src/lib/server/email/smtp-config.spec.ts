import { describe, expect, it } from 'vitest';
import {
	parseHeaderValue,
	parseMailFrom,
	parseRecipient,
	parseSmtpEndpoint,
	type SmtpEndpoint,
	type SmtpFields
} from './smtp-config';

// pure: no socket, no server, no `cloudflare:sockets`. this is the half of the SMTP
// transport that can be tested at all, which is why it is a separate module — see the note
// at the top of ./smtp.ts.

/** a complete, ordinary set of the four `SMTP_*` variables. */
const FIELDS: SmtpFields = {
	host: 'mail.example.org',
	username: 'user',
	password: 'pw'
};

/** unwraps a parse that must have succeeded, so a failing case reads as a failing case. */
function endpoint(fields: Partial<SmtpFields>): SmtpEndpoint {
	const result = parseSmtpEndpoint({ ...FIELDS, ...fields });
	if (!result.ok) throw new Error(`expected ${JSON.stringify(fields)} to parse: ${result.detail}`);
	return result.value;
}

/** unwraps a parse that must have failed, and hands back the message an operator reads. */
function refusal(fields: Partial<SmtpFields>): string {
	const result = parseSmtpEndpoint({ ...FIELDS, ...fields });
	if (result.ok) throw new Error(`expected ${JSON.stringify(fields)} to be refused; it parsed`);
	return result.detail;
}

describe('parseSmtpEndpoint', () => {
	it('reads the four variables into something dialable, defaulting the port', () => {
		expect(endpoint({})).toEqual({
			host: 'mail.example.org',
			port: 465,
			username: 'user',
			password: 'pw'
		});
	});

	/**
	 * 587 is refused by name, not coerced to 465. it is the port every provider's own
	 * instructions lead with, so an operator reaching this has done nothing wrong and needs the
	 * reason rather than a rule — and silently dialling 465 instead would hand them a connection
	 * failure against a host that does answer on the port they were told to use.
	 */
	it('refuses SMTP_PORT=587 by name, with the reason rather than the rule', () => {
		const detail = refusal({ port: '587' });
		expect(detail).toContain('SMTP_PORT');
		expect(detail).toContain('587');
		expect(detail).toContain('465');
		expect(detail).toContain('in the clear');
	});

	/**
	 * implicit TLS only — 465, and nothing else. there is no TLS mode on the endpoint because
	 * there is no second mode, and there is no second mode because 587's is opportunistic: the
	 * client opens in the clear, and `worker-mailer@1.2.1` runs `auth()` unconditionally
	 * whether or not the upgrade happened. a stripped STARTTLS therefore puts
	 * `AUTH PLAIN <base64(user\0password)>` on an unencrypted socket and reports success.
	 */
	it.each([
		{ port: '2525', why: 'a submission alias with the same problem' },
		{ port: '1025', why: 'a mail catcher' }
	])('refuses SMTP_PORT=$port, because it is $why', ({ port }) => {
		const detail = refusal({ port });
		expect(detail).toContain(port);
		expect(detail).toContain('465');
		expect(detail).toContain('in the clear');
	});

	// a value that is not a number at all is the same refusal rather than a stranger one:
	// `Number('')` is 0 and `Number('465 ')` is 465, so an unguarded parse turns a typo into a
	// port nobody set.
	it.each(['', 'four sixty five', '465abc', '0x1d1'])(
		'refuses the unreadable SMTP_PORT %j rather than coercing it',
		(port) => {
			expect(refusal({ port })).toContain('SMTP_PORT');
		}
	);

	// unset is the common case — every provider's instructions lead with a host — and there is
	// only one port left to default to, so it is a default rather than a required field.
	it('defaults an unset SMTP_PORT to 465', () => {
		expect(endpoint({}).port).toBe(465);
		expect(endpoint({ port: '465' }).port).toBe(465);
	});

	/**
	 * port 25 keeps its own sentence. it is prohibited outbound by the platform — refused
	 * before the connection reaches the mail host, so nothing an operator changes on their
	 * server can fix it — which is a different instruction from "this app will not use that
	 * port".
	 */
	it('refuses SMTP_PORT=25 as a platform prohibition, naming the port that works', () => {
		const detail = refusal({ port: '25' });
		expect(detail).toContain('25');
		expect(detail).toContain('prohibit');
		expect(detail).toContain('465');
	});

	/**
	 * the hazard the split exists to kill, asserted rather than assumed.
	 *
	 * these characters are exactly the ones a combined connection URL cannot carry in its
	 * userinfo without the operator percent-encoding them and this module decoding them again.
	 * nothing parses the credential: what is set is what is offered to AUTH, byte for byte.
	 * Mailgun's `postmaster@<domain>` login is what makes that encoding step routine.
	 */
	it.each([
		{ label: 'an at sign, as in a Mailgun login', username: 'postmaster@example.org' },
		{ label: 'a colon', password: 'p:ssword' },
		{ label: 'a slash and an at sign', password: 'ab/cd@ef' },
		{ label: 'a literal percent', password: '100%sure' },
		{ label: 'a hash', password: 'pw#1' },
		{ label: 'an already-encoded-looking value, left alone', password: 're_ab%40c' }
	])('takes a credential containing $label verbatim', (fields) => {
		const { username, password } = endpoint(fields);
		expect(username).toBe(fields.username ?? FIELDS.username);
		expect(password).toBe(fields.password ?? FIELDS.password);
	});

	/**
	 * `SMTP_HOST` is a hostname and nothing else — not a URL, not `host:port`.
	 *
	 * this is the likeliest thing an operator gets wrong here, and every row below reaches
	 * `connect({ hostname, port })` verbatim if it is not refused: a hostname with a scheme, a
	 * slash or a colon in it is not a name any resolver will answer for, so it fails as an
	 * opaque socket error that names none of this — and `./smtp-failure.ts` then reads it as
	 * `connect_failed`, "transient, waiting will help", which is the wrong instruction for a
	 * value that will never work.
	 *
	 * the two shapes that actually get pasted are a whole connection URL and the `host:port`
	 * pair every provider's setup card prints, and both must say the same thing back: the
	 * hostname alone, and the port is a different variable that almost certainly wants to be
	 * unset.
	 */
	it.each([
		{ form: 'a whole connection URL', host: 'smtp://user:pw@mail.example.org:465' },
		{ form: 'an implicit-TLS URL', host: 'smtps://smtp.resend.com:465' },
		{ form: 'the host:port pair off a setup card', host: 'smtp.example.org:465' },
		{ form: 'a trailing slash', host: 'mail.example.org/' },
		{ form: 'a path', host: 'mail.example.org/submission' },
		{ form: 'an address rather than a host', host: 'user@mail.example.org' },
		{ form: 'inner whitespace', host: ' mail .org' },
		{ form: 'a smuggled line break', host: 'a\r\nb.example.org' },
		{ form: 'a tab', host: 'mail\t.example.org' }
	])('refuses $form, which is not a hostname', ({ host }) => {
		const detail = refusal({ host });
		expect(detail).toContain('SMTP_HOST');
		// the sentence has to say what to type instead, because the value the operator has in
		// front of them is the one their provider printed.
		expect(detail).toContain('hostname');
		expect(detail).toContain('SMTP_PORT');
	});

	// and an ordinary hostname is still ordinary. a rule written to catch a pasted URL must not
	// start refusing the hosts every provider actually hands out.
	it.each([
		'mail.example.org',
		'smtp.resend.com',
		'email-smtp.us-east-1.amazonaws.com',
		'smtp-relay.gmail.com',
		'mx1.mail-host.example.co.uk',
		'MAIL.EXAMPLE.ORG',
		'mail.example.org.'
	])('still accepts the plain hostname %s', (host) => {
		expect(parseSmtpEndpoint({ ...FIELDS, host }).ok).toBe(true);
	});

	/**
	 * a class of address, not a list of spellings, and `SMTP_HOST` is a bare env string.
	 *
	 * no URL parser stands in front of this value, so nothing normalises it on the way in:
	 * every spelling below is exactly what the operator typed, and each has to be decoded here
	 * or dialled. that cuts both ways — the IPv4 forms (`127.1`, `2130706433`, `0x7f000001`)
	 * arrive unnormalised, and the IPv6 forms arrive without the brackets a URL host would have
	 * carried and without canonicalisation, so `0:0:0:0:0:0:0:1` is as ordinary a spelling of
	 * loopback here as `::1`.
	 */
	it.each([
		{ form: 'the obvious one', host: 'localhost' },
		{ form: 'a subdomain of it', host: 'mail.localhost' },
		{ form: 'uppercase', host: 'LOCALHOST' },
		{ form: 'dotted-quad loopback', host: '127.0.0.1' },
		{ form: 'the rest of 127/8', host: '127.9.9.9' },
		{ form: 'short-form loopback', host: '127.1' },
		{ form: 'integer loopback', host: '2130706433' },
		{ form: 'hex loopback', host: '0x7f000001' },
		{ form: 'a trailing dot', host: '127.0.0.1.' },
		{ form: 'the unspecified address', host: '0.0.0.0' },
		{ form: 'private 10/8', host: '10.0.0.5' },
		{ form: 'private 192.168/16', host: '192.168.1.10' },
		{ form: 'private 172.16/12', host: '172.16.0.1' },
		{ form: 'link-local, where the metadata address lives', host: '169.254.169.254' },
		// IPv6, in the spelling an env variable actually carries — bare and uncanonicalised, which
		// is what `SMTP_HOST=::1` gives you. the bracketed rows are the URL spelling and are here
		// only because a bracket is what somebody copying out of a config file pastes; a check
		// that recognised those alone would refuse the spelling nobody types and dial the one
		// everybody does.
		{ form: 'IPv6 loopback', host: '::1' },
		{ form: 'IPv6 loopback, fully written out', host: '0:0:0:0:0:0:0:1' },
		{ form: 'IPv6 loopback with leading zeroes', host: '0000:0000:0000:0000:0000:0000:0000:0001' },
		{ form: 'the IPv6 unspecified address', host: '::' },
		{ form: 'the IPv6 unspecified address, written out', host: '0:0:0:0:0:0:0:0' },
		{ form: 'a v4-mapped literal', host: '::ffff:127.0.0.1' },
		{ form: 'a v4-mapped literal, canonicalised', host: '::ffff:7f00:1' },
		{ form: 'IPv6 unique-local', host: 'fd00::1' },
		{ form: 'IPv6 unique-local, the fc half', host: 'fc00::1' },
		{ form: 'IPv6 link-local', host: 'fe80::1' },
		{ form: 'IPv6 link-local, uppercase', host: 'FE80::1' },
		{ form: 'bracketed loopback, as copied out of a config', host: '[::1]' },
		{ form: 'bracketed unique-local', host: '[fd00::1]' },
		{ form: 'bracketed link-local', host: '[fe80::1]' }
	])('refuses $form ($host), which a Worker cannot reach', ({ host }) => {
		expect(refusal({ host })).toContain('cannot reach');
	});

	// and a routable IPv6 address is still routable, bracketed or not — the blocklist is the
	// unreachable classes, never "looks like IPv6".
	it.each(['2606:4700:4700::1111', '[2606:4700:4700::1111]', '2001:4860:4860::8888'])(
		'still accepts the public address %s',
		(host) => {
			expect(parseSmtpEndpoint({ ...FIELDS, host }).ok).toBe(true);
		}
	);

	/**
	 * and it does not over-reach. a predicate that decodes integer and hex forms is a predicate
	 * that can decide a real hostname is an address, and refusing a working mail host is a
	 * worse failure than the one being fixed — the operator has no way to argue with it.
	 */
	it.each([
		'smtp.resend.com',
		'email-smtp.us-east-1.amazonaws.com',
		'mail.example.org',
		'localhost.example.org',
		'11.22.33.44',
		'8.8.8.8',
		'172.32.0.1',
		'169.253.0.1',
		'[2606:4700:4700::1111]'
	])('still accepts %s', (host) => {
		expect(parseSmtpEndpoint({ ...FIELDS, host }).ok).toBe(true);
	});

	/**
	 * an open relay a Worker can reach is not a shape worth supporting, and "there is no
	 * password" is a far better message than the AUTH failure it would otherwise become.
	 *
	 * an absent field arrives here rather than being caught upstream because this function has
	 * to be total: the factory filters for absent variables first, and this is what keeps it from
	 * being the only thing that does.
	 */
	it.each([
		{ label: 'SMTP_HOST', fields: { host: undefined } },
		{ label: 'SMTP_USERNAME', fields: { username: undefined } },
		{ label: 'SMTP_PASSWORD', fields: { password: undefined } }
	])('refuses an absent $label by name', ({ label, fields }) => {
		expect(refusal(fields)).toContain(label);
	});

	// every refusal names the variable and where it is put right — CLAUDE.md's rule that an
	// operator-facing message names the offending value and where to fix it.
	//
	// where is the operator console for every value that fold has a box for, and a command for the
	// port alone: that fold states 465 and its press carries no value for `SMTP_PORT`, so a
	// terminal is the whole of the way out of a stored one (`PORT_FIX` in ./smtp-config.ts).
	it.each([
		{
			label: 'port 25',
			fields: { port: '25' },
			names: 'SMTP_PORT',
			where: 'pnpm run deploy --var SMTP_PORT'
		},
		{
			label: 'port 587',
			fields: { port: '587' },
			names: 'SMTP_PORT',
			where: 'pnpm run deploy --var SMTP_PORT'
		},
		{
			label: 'an unreachable host',
			fields: { host: 'localhost' },
			names: 'SMTP_HOST',
			where: 'under SMTP on the console'
		},
		{
			label: 'no password',
			fields: { password: undefined },
			names: 'SMTP_PASSWORD',
			where: 'under SMTP on the console'
		}
	])('names $names and where it is put right when refusing $label', ({ fields, names, where }) => {
		const detail = refusal(fields);
		expect(detail).toContain(names);
		expect(detail).toContain(where);
	});

	/**
	 * the console draws every one of these sentences — as the email capability's own line and
	 * beside the send-test button — and its SMTP fold has a box for each of these three values. a
	 * command here sends an operator to a terminal for something they are looking at, which is
	 * what CLAUDE.md's two operator surfaces rules out: neither of them ever means a terminal.
	 *
	 * the port is the exception and is not on this list, for the reason `PORT_FIX` states.
	 */
	it.each([
		{ label: 'an unreachable host', fields: { host: 'localhost' } },
		{ label: 'a host that is not a hostname', fields: { host: 'smtp://user:pw@a.example:465' } },
		{ label: 'no password', fields: { password: undefined } },
		{ label: 'no username', fields: { username: undefined } }
	])('names no command for a value the console has a box for, refusing $label', ({ fields }) => {
		expect(refusal(fields)).not.toContain('pnpm');
	});
});

describe('parseMailFrom', () => {
	it.each(['donations@example.org', 'no-reply@sub.example.co.uk'])('accepts %s', (address) => {
		expect(parseMailFrom(address)).toEqual({ ok: true, value: address });
	});

	/**
	 * a bare address only. the value is handed to the `MAIL FROM:` envelope command as well
	 * as to the `From:` header, and a display name in the envelope is rejected by a strict
	 * host and accepted by a lenient one — which then fails SPF at the far end, days later,
	 * in somebody else's spam folder.
	 */
	it('refuses the `Name <addr>` form and says what to type instead', () => {
		const result = parseMailFrom('Hope Foundation <donations@example.org>');
		if (result.ok) throw new Error('the display-name form was accepted');
		expect(result.detail).toContain('bare address');
		expect(result.detail).toContain('MAIL_FROM');
	});

	it.each(['', 'donations', 'donations at example.org'])('refuses %j', (address) => {
		expect(parseMailFrom(address).ok).toBe(false);
	});
});

describe('parseRecipient', () => {
	it.each(['donor@example.org', ' donor@example.org ', 'a.b+c@sub.example.co.uk'])(
		'accepts %j, trimmed',
		(value) => {
			expect(parseRecipient(value)).toEqual({ ok: true, value: value.trim() });
		}
	);

	/**
	 * SMTP envelope injection, and it is not hypothetical for this library.
	 * `worker-mailer@1.2.1` writes `RCPT TO: <${email}>` straight onto the socket with no
	 * validation of its own, so a CR/LF in the address is an extra command in the session —
	 * one that adds a recipient the caller never named. `to` is held to the same bare-address
	 * rule as `MAIL_FROM`, and it is the half that comes from a row.
	 */
	it.each([
		{ attack: 'a smuggled RCPT TO', to: 'donor@x.org>\r\nRCPT TO: <attacker@evil.com' },
		{ attack: 'a bare LF', to: 'donor@x.org\nRCPT TO: <attacker@evil.com' },
		{ attack: 'the display-name form', to: 'Ada <donor@x.org>' }
	])('refuses $attack', ({ to }) => {
		const result = parseRecipient(to);
		if (result.ok) throw new Error(`${to} was accepted as a recipient`);
		expect(result.detail).toContain('bare address');
		// quoted through JSON.stringify, so the control characters are visible in the message
		// rather than silently breaking the sentence they are being reported in.
		expect(result.detail).not.toContain('\n');
	});

	it.each(['', 'donor', 'not an address'])('refuses %j', (to) => {
		expect(parseRecipient(to).ok).toBe(false);
	});
});

describe('parseHeaderValue', () => {
	it('accepts an ordinary subject verbatim, including punctuation', () => {
		expect(parseHeaderValue('subject line', 'Your donation receipt from Smith & Sons')).toEqual({
			ok: true,
			value: 'Your donation receipt from Smith & Sons'
		});
	});

	/**
	 * header injection, and the realistic path is a paste rather than an attack.
	 * `org.legalName` reaches the receipt subject and is stored with `.trim()` only — outer
	 * whitespace, not an embedded newline — and no column check forbids one. an operator
	 * copying a name out of a spreadsheet cell is how it gets there.
	 */
	it.each([
		{ label: 'CRLF', value: 'Receipt\r\nBcc: attacker@evil.com' },
		{ label: 'a bare LF', value: 'Receipt\nBcc: attacker@evil.com' },
		{ label: 'a bare CR', value: 'Receipt\rBcc: attacker@evil.com' }
	])('refuses a subject containing $label', ({ value }) => {
		const result = parseHeaderValue('subject line', value);
		if (result.ok) throw new Error('a subject with a line break was accepted');
		expect(result.detail).toContain('subject line');
		expect(result.detail).toContain('the console');
	});

	// it refuses rather than stripping. a stripped subject sends a quietly mangled receipt and
	// leaves the stored value wrong for the next one.
	it('does not silently repair the value', () => {
		expect(parseHeaderValue('subject line', 'a\nb').ok).toBe(false);
	});
});
