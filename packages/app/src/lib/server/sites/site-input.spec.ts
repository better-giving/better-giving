import { describe, expect, it } from 'vitest';
import { MAX_ALLOWED_ORIGINS } from '@better-giving/operator/origins';
import { parseSites } from './site-input';

// the node pool: this parse touches no database, which is the whole reason it is split from
// ./queries.ts.
//
// what the rules are is `@better-giving/operator/origins`' own spec's to state, and none of it is
// restated here. these cases are about the one thing this module adds: that the rules reach the
// list a deployment stores, in the order they were typed, with the group's message coming back
// whole.

describe('parseSites', () => {
	it('hands back the rows in the order they were typed, trimmed', async () => {
		const result = parseSites(['  https://give.example.org  ', 'https://shop.example.org', '']);

		// the order is the operator's — a list that came back sorted would render re-ordered on
		// the screen that typed it. a blank row is one somebody added and never filled in.
		expect(result.ok && result.value.sites).toEqual([
			'https://give.example.org',
			'https://shop.example.org'
		]);
	});

	it('stores what each row normalises to, which is what the browser will send', async () => {
		// the rule is `@better-giving/operator/origins`' own spec's to state; what is asserted here
		// is that the repaired row is what reaches the list this deployment stores, because the
		// stored entry is what `/api/v1` compares an `Origin` header against.
		const result = parseSites(['give.example.org', 'https://shop.example.org/cart?ref=x']);

		expect(result.ok && result.value.sites).toEqual([
			'https://give.example.org',
			'https://shop.example.org'
		]);
	});

	it('refuses a list holding one site twice rather than storing it once', async () => {
		// what the rule says about a repeat is `@better-giving/operator/origins`' own spec's to
		// state; what is asserted here is that the refusal reaches this endpoint, so the boxes an
		// operator pressed Save on are never stored one row shorter with nothing said about it.
		const result = parseSites(['https://give.example.org', 'https://give.example.org']);

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.problem).toBe('duplicate site');
	});

	it('refuses two spellings of one host, which is the reading the console marks a box on', async () => {
		// the two ends read one module and a repeat is the host rather than the line
		// (`@better-giving/operator/origins`), so a list the console turns down at the second box is
		// a list this endpoint turns down too.
		const result = parseSites(['https://give.example.org', 'https://give.example.org:8443']);

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.problem).toBe('duplicate site');
	});

	it('returns the group message rather than throwing on a row the rules refuse', async () => {
		// one message for the whole group, because the boxes are one repeating row editor and
		// `setError` cannot key an array field. a throw here would put a 500 in front of a typo.
		const result = parseSites(['https://give.example.org', 'https:']);
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.problem).toBe('invalid url');
	});

	it('refuses a list over the cap with the count and nothing about any row', async () => {
		// the cap belongs to this list alone: an address is only ever typed here, and a form's
		// selection cannot exceed the list it is drawn from. the sentence deliberately says
		// nothing about individual rows — a paste of two hundred is one problem, not two hundred.
		const over = Array.from(
			{ length: MAX_ALLOWED_ORIGINS + 1 },
			(_, i) => `https://site-${i}.example.org`
		);
		const result = parseSites(over);
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.problem).toContain(String(MAX_ALLOWED_ORIGINS));
	});
});
