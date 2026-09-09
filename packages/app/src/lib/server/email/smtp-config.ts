// what the SMTP exchange is allowed to be handed — the connection secrets (`SMTP_HOST`,
// `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `MAIL_FROM`) and the envelope fields of a
// message — decided from the strings alone.
//
// split from ./smtp.ts for the reason `org/org-input.ts` is split from `org/queries.ts`:
// every rule here — which scheme, which port, what a missing credential means, what may go in
// a `RCPT TO:` — is decidable with no socket and no server, so it is testable with neither. it
// is also the half that must never be skipped, because the alternative to refusing a bad value
// here is a `cloudflare:sockets` error four layers down that names none of it.
//
// the platform rules this encodes are cloudflare's, not preferences:
//   - port 25 is prohibited outbound from a Worker (`Connections to port 25 are
//     prohibited`). 465 is not.
//   - localhost, private-network addresses and Cloudflare's own IP ranges are unreachable
//     (`proxy request failed, cannot connect to the specified address`).
// each fails at connect time as an opaque socket error, which is exactly the failure an
// operator cannot act on — so the port and the address classes below are refused here, by
// name, with the fix in the message.
//
// cloudflare's own ranges are the one class not enumerated, deliberately: they are a
// published list that changes, so a copy here would rot into refusing a host that works —
// the failure this module cannot afford, since a refusal is final and a missed one only
// falls through to the connect error everything else already handles. an operator does not
// type a Cloudflare IP as their mail host; they type `localhost`, which is covered.

import { mailFromFault } from '@better-giving/operator/console/mail-from';
import { EMAIL } from '@better-giving/operator/console/org-rules';
import { setCommand, type DeployValueName } from '@better-giving/operator/deploy-split';
import { redact } from '../../redact';

/**
 * the `SMTP_*` variables as they come off the platform env, before anything is known about
 * them. every field is optional for the reason `ConfigEnv`'s are: absent, blank and
 * not-a-string all arrive here as `undefined`, and this module has to be able to say which
 * one is missing rather than assume none is.
 */
export interface SmtpFields {
	readonly host?: string | undefined;
	/** `SMTP_PORT`, raw and unparsed. absent means 465 — see `parseSmtpEndpoint`. */
	readonly port?: string | undefined;
	readonly username?: string | undefined;
	readonly password?: string | undefined;
}

/** connection settings that could be dialled. */
export interface SmtpEndpoint {
	readonly host: string;
	/**
	 * always 465, and it is a field rather than a constant only so the dialler reads it from
	 * one place. there is no TLS mode beside it because there is no second mode — see
	 * `parseSmtpEndpoint`.
	 */
	readonly port: number;
	readonly username: string;
	readonly password: string;
}

/**
 * no `reason` on the failure arm, and that is deliberate rather than incidental. the two
 * secrets refuse as `not_configured` and the message fields refuse as `invalid_message`, but
 * neither word appears here: the caller attaches the reason, so this module stays free of the
 * port's vocabulary and stays testable without importing it.
 */
export type SmtpConfigResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly detail: string };

/**
 * the only port this app dials. 465 is implicit TLS — encrypted from the first byte — which
 * is the whole of the reason it is the only one; see `parseSmtpEndpoint`.
 */
const IMPLICIT_TLS_PORT = 465;

/**
 * where one of the connection variables is set, named by the caller.
 *
 * the fold and not a command. every sentence built on this is drawn on the operator console — as
 * the email capability's own line and beside the send-test button — and that screen has a box for
 * each of these four values, so a command here would send an operator to a terminal for something
 * they are looking at. the console's SMTP fold is where they are typed and stored.
 *
 * `names` is still taken, and it is still what {@link marked} above names in the sentence before
 * this one: which values are wrong is the part a fold cannot say.
 */
function fix(...names: readonly DeployValueName[]): string {
	return `Set ${names.length === 1 ? 'it' : 'them'} under SMTP on the console.`;
}

/**
 * a list of variable names, each marked, joined as prose.
 *
 * the marking rule is `codeSpans` in `@better-giving/operator/code-spans`: a variable name is
 * marked wherever it is written, and these sentences are rendered beside the send-test button,
 * where an unmarked name sits next to a marked one in the line under it.
 */
function marked(names: readonly string[]): string {
	return names.map((name) => `\`${name}\``).join(' and ');
}

/**
 * how to fix `SMTP_PORT`, which is the one variable whose right answer is usually to remove it.
 *
 * both halves are built from the name rather than spelling it twice, and the set half names 465 in
 * the sentence rather than on the command line, because the command comes whole from `setCommand`
 * and carries a placeholder where the value goes.
 *
 * the clear half is the half most operators want, and it is not a command. absent means 465, and a
 * var is cleared on the Worker's Variables and Secrets page or by setting it to the empty string —
 * `readConfigEnv` in ../config/env.ts reads both as absent. a deploy cannot remove one: `keep_vars`
 * in wrangler.jsonc is what keeps the other twelve through every deploy after the one that set
 * them.
 *
 * **it keeps its commands where {@link fix} above gave them up, and the reason is what the console
 * can do rather than what it draws.** that fold states 465 and asks for no port, so its press
 * carries no value for this name at all (`STATED_VALUES` in
 * `packages/console-ui/src/lib/secret-groups.ts`) — a stored port is neither set nor cleared from any
 * screen, and this is the one mail value a terminal is still the whole of the way out of.
 */
const PORT_NAME = 'SMTP_PORT' satisfies DeployValueName;
const PORT_FIX =
	`Set it to 465 with \`${setCommand(PORT_NAME)}\`, or clear it on the Worker's Variables and ` +
	'Secrets page and let it default.';

/**
 * `SMTP_PORT` as a number, or `null` if it is not one.
 *
 * decimal digits only, and `Number()` alone is not that. it reads `0x1d1` as 465, `''` as 0
 * and `'1e3'` as 1000 — so an unguarded parse silently turns a typo into a port the operator
 * never wrote, and the one value it would have coerced into 465 is the one where nothing goes
 * wrong until a socket fails to open.
 */
function parsePort(value: string): number | null {
	return /^[0-9]+$/.test(value) ? Number(value) : null;
}

/**
 * turns the `SMTP_*` variables into something dialable, or explains which one is not.
 *
 * four variables rather than one URL, and the credential is taken verbatim. nothing parses
 * `SMTP_PASSWORD`, so `p@ss:w/rd%20` is exactly the string the host is offered. do not
 * recombine these into one connection string: a credential inside a URL's userinfo has to be
 * percent-encoded by the operator to parse at all and percent-decoded here before the AUTH
 * exchange, and a missed decode authenticates as a password nobody set. it is unusable from the
 * operator's side too — not encoding reads as "this is not a URL" over a credential that is
 * perfectly correct, encoding hands them a value they cannot read back, and a literal `%` in a
 * password is a malformed escape. Mailgun makes that routine rather than theoretical: its login
 * is a full address, so `postmaster%40example.org` every single time.
 *
 * implicit TLS only. port 465 only. 587 is refused, and that is a security decision rather
 * than a simplification.
 *
 * `SMTP_PORT` is optional and defaults to 465; any other value — including 587 — is refused
 * with a sentence saying why. there is exactly one connection mode: TLS from the first byte,
 * `secureTransport: 'on'`, no plaintext phase at any point in the session.
 *
 * what 587 costs. STARTTLS is opportunistic by construction: the client opens in the clear,
 * reads the host's EHLO reply, and upgrades only if that reply advertised `STARTTLS`. the
 * reply is cleartext, so anything on the path can delete that line — and `worker-mailer@1.2.1`
 * then proceeds to `AUTH` anyway (its session is one comma-joined expression:
 * `startTls && !secure && supportsStartTls && (await tls(), await ehlo()), await auth()`).
 * the result is `AUTH PLAIN <base64(user\0password)>` written to an unencrypted socket, a send
 * that reports success, and nothing anywhere saying the connection was downgraded. base64 is
 * not encryption. on this app that password is typically a live provider API key with the
 * authority to send mail as the organisation.
 *
 * what it costs to refuse it: Postmark, which documents that it does not offer 465 at all
 * ("Postmark does not support port 465" — postmarkapp.com/support/article/common-smtp-
 * connection-errors) and is therefore unreachable from this app. Resend, Amazon SES, Mailgun
 * and SendGrid all document 465 as implicit TLS, as does essentially every self-hosted MTA.
 * one excluded vendor is the price of a credential that cannot be stripped onto the wire.
 * DEPLOY.md says so out loud rather than leaving an operator to discover it.
 */
export function parseSmtpEndpoint(fields: SmtpFields): SmtpConfigResult<SmtpEndpoint> {
	// total, though both callers filter for absent variables first. an open relay a Worker can
	// reach is not a deployment shape worth supporting, and "SMTP_PASSWORD is not set" is a far
	// better message than the AUTH failure it would otherwise become — so this refuses rather
	// than trusting the two lists upstream to stay in step with this one.
	const absent: DeployValueName[] = [
		...(fields.host ? [] : ['SMTP_HOST' as const]),
		...(fields.username ? [] : ['SMTP_USERNAME' as const]),
		...(fields.password ? [] : ['SMTP_PASSWORD' as const])
	];
	if (absent.length > 0) {
		return {
			ok: false,
			detail:
				`${marked(absent)} ${absent.length === 1 ? 'is' : 'are'} not set, so there is ` +
				`nothing to dial or no credential to offer, and no mail can be sent. ${fix(...absent)}`
		};
	}

	const host = fields.host ?? '';

	if (isUnreachableHost(host)) {
		return {
			ok: false,
			detail:
				`\`SMTP_HOST\` is \`${redact(host)}\`, which a Worker cannot reach: Cloudflare blocks ` +
				'outbound connections to localhost, private-network addresses and its own IP ranges. ' +
				'A local mail catcher (MailHog, Mailpit) cannot be used from `wrangler dev` for the ' +
				`same reason. Use a real submission host. ${fix('SMTP_HOST')}`
		};
	}

	/**
	 * `SMTP_HOST` is a hostname, and this is the check the operator most needs.
	 *
	 * the value goes to `connect({ hostname, port })` as it stands, so anything that is not a
	 * name a resolver can answer for fails as an opaque socket error — which `./smtp-failure.ts`
	 * reads as `connect_failed`, "transient, waiting will help", the wrong instruction for a
	 * value that can never work. the two shapes that get pasted are a whole `smtp://…` URL and
	 * the `host:port` pair on every provider's setup card, so the sentence names the hostname
	 * alone and says where a port goes, rather than only refusing.
	 */
	if (!isHostnameShaped(host)) {
		return {
			ok: false,
			detail:
				`\`SMTP_HOST\` is \`${redact(host)}\`, which is not a hostname. It takes the hostname on ` +
				'its own: `smtp.resend.com`, not `smtp://user:pw@smtp.resend.com:465` and not ' +
				'`smtp.resend.com:465`: no scheme, no credentials, no path, no port. The port is ' +
				'`SMTP_PORT`, and it almost certainly wants to be unset: 465 is the default and the ' +
				`only value it accepts. ${fix('SMTP_HOST')}`
		};
	}

	// no port written is the common case, and defaulting it is better than refusing: every
	// provider's own instructions lead with a host, and there is only one port to default to.
	const port = fields.port === undefined ? IMPLICIT_TLS_PORT : parsePort(fields.port);

	if (port === null) {
		return {
			ok: false,
			detail:
				`\`SMTP_PORT\` is \`${redact(fields.port ?? '')}\`, which is not a port number. It is ` +
				`optional. Unset, this app dials 465, the only port it dials. ${PORT_FIX}`
		};
	}

	if (port === 25) {
		return {
			ok: false,
			detail:
				'`SMTP_PORT` is 25, which Cloudflare Workers prohibit outbound: the connection is ' +
				'refused by the platform before it reaches your mail host, so no setting on the host ' +
				`can fix it. Use 465, which is TLS from the first byte. ${PORT_FIX}`
		};
	}

	/**
	 * any port but 465 is refused, and 587 is the one this sentence is written for. it is the
	 * port every provider's own instructions lead with, so an operator reaching it here has
	 * done nothing wrong and needs the reason rather than a rule.
	 */
	if (port !== IMPLICIT_TLS_PORT) {
		return {
			ok: false,
			detail:
				`\`SMTP_PORT\` is \`${redact(fields.port ?? '')}\`, and this app dials port 465 and ` +
				'nothing else. 465 is encrypted from the first byte. Port 587 is not: it opens in the clear and ' +
				'upgrades only if the server offers STARTTLS in a plaintext reply, so anything on ' +
				'the network path can remove that offer, and the SMTP client then sends your ' +
				'username and password in the clear and reports the message as delivered. That ' +
				'password is usually a live API key. Almost every provider offers 465 alongside 587 ' +
				'(Resend, Amazon SES, Mailgun and SendGrid all do); Postmark is the exception and ' +
				`cannot be used here. ${PORT_FIX}`
		};
	}

	return {
		ok: true,
		value: { host, port, username: fields.username ?? '', password: fields.password ?? '' }
	};
}

// ---------------------------------------------------------------------------
// which hosts a worker cannot reach.
//
// a class of address, decoded — never a list of spellings. an address has many spellings and a
// shortlist only ever holds the ones somebody thought of: `127.1`, `2130706433`, `0x7f000001`
// and `127.0.0.1.` are all `127.0.0.1`, and `0:0:0:0:0:0:0:1` is `::1`. every spelling this
// misses is dialled, fails as the opaque `proxy request failed` this module exists to pre-empt,
// and is then read by `./smtp-failure.ts` as `connect_failed` — "transient, waiting will help"
// — which is the wrong instruction for an address that will never work.
//
// `SMTP_HOST` is a bare environment string and nothing normalises it on the way in. no URL
// parser stands in front of it, so what the operator typed is what arrives: IPv4 in any
// `inet_aton` form, IPv6 with no brackets and no canonicalisation, either case. so both
// families are parsed here rather than matched — IPv4 with `inet_aton`'s semantics because that
// is what a resolver does with these strings, and IPv6 expanded to its eight hextets so that
// every legal spelling of one address compares equal.
// ---------------------------------------------------------------------------

/** IPv4 ranges a Worker's outbound connection cannot leave for, as `[network, prefix bits]`. */
const BLOCKED_IPV4: readonly (readonly [number, number])[] = [
	[0x00000000, 8], // 0.0.0.0/8 — "this network"; 0.0.0.0 itself is the common spelling
	[0x0a000000, 8], // 10/8 — private
	[0x7f000000, 8], // 127/8 — loopback, and 127.0.0.1 is not the only one
	[0xa9fe0000, 16], // 169.254/16 — link-local, and the metadata address lives here
	[0xac100000, 12], // 172.16/12 — private
	[0xc0a80000, 16] // 192.168/16 — private
];

/**
 * whether a hostname is one this app refuses to dial before it tries.
 *
 * the brackets are optional and are stripped first. an IPv6 literal is bracketed only inside a
 * URL, and this value never passes through one — `SMTP_HOST=::1` is the spelling an operator
 * actually types, and `[::1]` is what somebody copying out of a config file pastes. both are
 * the same address and both are refused.
 */
function isUnreachableHost(host: string): boolean {
	// the trailing dot is a fully-qualified name and resolves identically; `127.0.0.1.` is
	// `127.0.0.1`, and lowercasing is for `LOCALHOST`.
	const name = unbracket(host.trim()).toLowerCase().replace(/\.$/, '');

	if (name === 'localhost' || name.endsWith('.localhost')) return true;

	const ipv6 = parseIpv6(name);
	if (ipv6 !== null) return isUnreachableIpv6(ipv6);

	const address = parseIpv4(name);
	return (
		address !== null && BLOCKED_IPV4.some(([network, bits]) => inNetwork(address, network, bits))
	);
}

/** an IPv6 literal without its URL brackets, or the value unchanged. */
function unbracket(host: string): string {
	return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * whether `SMTP_HOST` is shaped like something a resolver can answer for.
 *
 * IP literals are exempt from the colon rule and nothing else is. a colon in a hostname is a
 * port somebody appended; a colon in an IPv6 address is the address. the two are told apart by
 * parsing rather than by counting, so `smtp.example.org:465` is refused while
 * `2606:4700:4700::1111` is dialled.
 */
function isHostnameShaped(host: string): boolean {
	const name = unbracket(host.trim());
	if (name === '') return false;
	if (parseIpv6(name) !== null) return true;
	// a scheme, a credential, a path, a port, or whitespace of any kind — including the CR/LF a
	// paste can carry. none of them belongs in a value handed to `connect({ hostname })`.
	return !/[\s/@:\\?#[\]]/.test(name);
}

/** whether `address` sits in `network/bits`, both as unsigned 32-bit numbers. */
function inNetwork(address: number, network: number, bits: number): boolean {
	return address >>> (32 - bits) === network >>> (32 - bits);
}

/**
 * a host string as an IPv4 address, or `null` if it is not one.
 *
 * `inet_aton` semantics, which is the whole point: one to four parts, each decimal, `0`-octal
 * or `0x`-hex, and the last part absorbs every byte the earlier ones did not name. that is
 * what makes `127.1`, `2130706433` and `0x7f000001` the same address as `127.0.0.1` — the
 * forms a shortlist misses and a scanner reaches for first.
 */
function parseIpv4(host: string): number | null {
	const parts = host.split('.');
	if (parts.length > 4) return null;

	const numbers: number[] = [];
	for (const part of parts) {
		const value = parseIpv4Part(part);
		if (value === null) return null;
		numbers.push(value);
	}

	const last = numbers[numbers.length - 1] ?? 0;
	const leading = numbers.slice(0, -1);
	if (leading.some((value) => value > 0xff)) return null;
	if (last >= 2 ** (32 - 8 * leading.length)) return null;

	let address = last;
	for (const [index, value] of leading.entries()) address += value * 2 ** (32 - 8 * (index + 1));
	return address;
}

function parseIpv4Part(part: string): number | null {
	let value: number;
	if (/^0[xX][0-9a-fA-F]+$/.test(part)) value = Number.parseInt(part.slice(2), 16);
	else if (/^0[0-7]+$/.test(part)) value = Number.parseInt(part.slice(1), 8);
	else if (/^[0-9]+$/.test(part)) value = Number.parseInt(part, 10);
	else return null;
	return Number.isSafeInteger(value) ? value : null;
}

/**
 * an IPv6 literal as its eight hextets, or `null` if it is not one.
 *
 * expanded rather than text-matched, because one address has many legal spellings and this
 * value arrives exactly as it was typed: `::1`, `0:0:0:0:0:0:0:1` and
 * `0000:0000:0000:0000:0000:0000:0000:0001` are the same address, and a prefix test on the
 * string only recognises the shortest one.
 *
 * the trailing dotted-quad form is accepted because that is how a v4-mapped address is written
 * (`::ffff:127.0.0.1`), and it must decode to the same eight hextets as `::ffff:7f00:1`.
 */
function parseIpv6(host: string): number[] | null {
	if (!host.includes(':')) return null;

	let text = host;
	const tail = text.slice(text.lastIndexOf(':') + 1);
	// a trailing IPv4 literal occupies the last two hextets.
	if (tail.includes('.')) {
		const quad = tail.split('.');
		if (quad.length !== 4) return null;
		const bytes: number[] = [];
		for (const part of quad) {
			if (!/^[0-9]{1,3}$/.test(part)) return null;
			const value = Number(part);
			if (value > 0xff) return null;
			bytes.push(value);
		}
		const [a = 0, b = 0, c = 0, d = 0] = bytes;
		text = `${text.slice(0, text.lastIndexOf(':') + 1)}${((a << 8) | b).toString(16)}:${(
			(c << 8) | d
		).toString(16)}`;
	}

	const halves = text.split('::');
	if (halves.length > 2) return null;

	const read = (group: string): number[] | null => {
		if (group === '') return [];
		const parts = group.split(':');
		const hextets: number[] = [];
		for (const part of parts) {
			if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
			hextets.push(Number.parseInt(part, 16));
		}
		return hextets;
	};

	const head = read(halves[0] ?? '');
	if (head === null) return null;

	// no `::` means every hextet is written out, so there are exactly eight.
	if (halves.length === 1) return head.length === 8 ? head : null;

	const rest = read(halves[1] ?? '');
	if (rest === null) return null;
	const zeroes = 8 - head.length - rest.length;
	// `::` stands for at least one hextet of zeroes; fewer means the address was over-specified.
	return zeroes < 1 ? null : [...head, ...Array<number>(zeroes).fill(0), ...rest];
}

/**
 * the IPv6 classes a Worker cannot reach, decided on the expanded address.
 *
 * `::ffff:*` is refused wholesale rather than decoded back into its IPv4 half. a v4-mapped
 * literal is not how anybody names a mail host, so the only thing lost is a spelling nobody
 * uses, and the only thing gained by decoding it would be permission to dial `::ffff:8.8.8.8`.
 */
function isUnreachableIpv6(hextets: readonly number[]): boolean {
	const [first = 0] = hextets;
	const leading = hextets.slice(0, 5).every((hextet) => hextet === 0);

	// :: (unspecified) and ::1 (loopback).
	if (hextets.every((hextet) => hextet === 0)) return true;
	if (leading && hextets[5] === 0 && hextets[6] === 0 && hextets[7] === 1) return true;
	// ::ffff:0:0/96 — v4-mapped.
	if (leading && hextets[5] === 0xffff) return true;
	// fc00::/7 — unique local.
	if ((first & 0xfe00) === 0xfc00) return true;
	// fe80::/10 — link-local.
	return (first & 0xffc0) === 0xfe80;
}

const FROM_FIX = 'Set it under SMTP on the console.';

/**
 * validates `MAIL_FROM` — the donor-facing From address.
 *
 * **what makes a value wrong is `mailFromFault`'s and what is said about it is this
 * function's.** the same two arms are read at the box the operator types the address into
 * (`packages/console-ui/src/lib/smtp-fold-state.ts`), and the reason a display name is refused
 * at all is written where that reading is. the sentences stay here because they are written
 * for a deployment log — they name the variable, quote the value through {@link redact} and
 * say where to set it — and the console says the same two things to a person standing at a
 * labelled box.
 *
 * it is a deploy-time secret and not a settings row, even though it carries no credential.
 * the address is authorised by the same third party that issued the SMTP password — the SPF
 * record and DKIM key are on the domain, registered with that provider — so an address the
 * operator can edit in /admin independently of the credential is an address that silently
 * stops delivering. it belongs beside the credential, and `org_profile.notification_email` is
 * a different value entirely: that one is where operational mail arrives.
 */
export function parseMailFrom(value: string): SmtpConfigResult<string> {
	const address = value.trim();

	switch (mailFromFault(address)) {
		case 'display-name':
			return {
				ok: false,
				detail:
					`\`MAIL_FROM\` is \`${redact(address)}\`, but it must be a bare address: ` +
					`\`donate@example.org\`, ` +
					`not \`Name <donate@example.org>\`. ${FROM_FIX}`
			};
		case 'not-an-address':
			return {
				ok: false,
				detail: `\`MAIL_FROM\` is \`${redact(address)}\`, which is not an email address. ${FROM_FIX}`
			};
		case null:
			return { ok: true, value: address };
	}
}

// ---------------------------------------------------------------------------
// the message's own fields, held to the same rule as `MAIL_FROM`.
//
// `parseMailFrom` above argues at length that an envelope value must be a bare, whitespace-
// free address, and `from` is not the only value that reaches one. `worker-mailer@1.2.1` writes
// `RCPT TO: <${email}>` with no validation of its own, sets `headers.To = emails.join(', ')`,
// and its `encodeHeader` returns pure-ASCII input verbatim — so a `to` of
// `donor@x.org>\r\nRCPT TO: <attacker@evil.com` adds a recipient to the envelope and a
// `subject` containing CRLF injects a header.
//
// the realistic path is not an attacker, it is a paste. `org.legalName` reaches the receipt
// subject and is stored with `.trim()` only — `org-input.ts`'s `clean()` strips outer
// whitespace, not embedded CR/LF, and no column check forbids one. a legal name copied out of
// a spreadsheet cell is how a newline gets into a header.
//
// checked here, in the module that already owns "what may be handed to an SMTP session", and
// enforced in ./smtp.ts before a socket is opened.
// ---------------------------------------------------------------------------

/** CR or LF anywhere. one character, and it is the whole of header injection. */
const LINE_BREAK = /[\r\n]/;

/**
 * the recipient, held to the envelope rule.
 *
 * what an address looks like is `EMAIL` in `@better-giving/operator/console/org-rules`, the one
 * spelling of that pattern both operator surfaces read — deliberately weak, for the reason
 * argued on it there. a stricter one here would refuse a recipient the From box beside it accepts.
 *
 * the detail quotes the value through `JSON.stringify` rather than raw, so a CR/LF renders as
 * `\r\n` in the message an operator reads instead of silently breaking the sentence in two —
 * and so the offending character is visible at all, which is the point of naming it.
 */
export function parseRecipient(value: string): SmtpConfigResult<string> {
	const address = value.trim();

	if (LINE_BREAK.test(address) || address.includes('<') || address.includes('>')) {
		return {
			ok: false,
			detail:
				`The recipient address \`${JSON.stringify(value)}\` is not a bare address. It goes into ` +
				'the SMTP envelope as `RCPT TO: <address>`, so a line break or an angle bracket in it ' +
				'would add a command to the session rather than a name to the message. Use a plain ' +
				'`someone@example.org`.'
		};
	}

	if (!EMAIL.test(address)) {
		return {
			ok: false,
			detail:
				`The recipient address \`${JSON.stringify(value)}\` is not an email address. Nothing was ` +
				'sent.'
		};
	}

	return { ok: true, value: address };
}

/**
 * a header value — today only the subject.
 *
 * it refuses rather than stripping. a subject with a newline in it means something upstream is
 * carrying one (an organisation's legal name, most likely), and silently rewriting it would
 * send a receipt with a quietly mangled subject and leave the stored value wrong for the next
 * one. refusing puts the value on screen where somebody can fix the row.
 */
export function parseHeaderValue(label: string, value: string): SmtpConfigResult<string> {
	if (LINE_BREAK.test(value)) {
		return {
			ok: false,
			detail:
				`The ${label} contains a line break (\`${JSON.stringify(value)}\`), which cannot go into ` +
				'an email header: a header ends at the newline, so everything after it would become ' +
				'a header of its own. This usually means a saved value has a stray newline in it: ' +
				'check your organisation details on the console, under Organisation.'
		};
	}

	return { ok: true, value };
}
