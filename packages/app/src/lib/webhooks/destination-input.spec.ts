import { describe, expect, it } from 'vitest';
import { DESTINATION_INPUT, HAS_CREDENTIALS } from './destination-input';

const parse = (url: string) => DESTINATION_INPUT.safeParse({ url, events: ['gift.made'] });

describe('DESTINATION_INPUT', () => {
	it.each([
		'https://user:secret@crm.example.org/hooks',
		'https://token@crm.example.org',
		'user:secret@crm.example.org/hooks'
	])('refuses %s, which carries a user name or password, under the address box', (url) => {
		const parsed = parse(url);

		expect(parsed.success).toBe(false);
		expect(parsed.error?.issues).toEqual([
			expect.objectContaining({ path: ['url'], message: HAS_CREDENTIALS })
		]);
	});

	it.each([
		'https://crm.example.org/hooks?notify=ops@example.org',
		'crm.example.org/hooks#ops@example.org'
	])('takes %s, whose @ is past the host', (url) => {
		expect(parse(url).success).toBe(true);
	});
});
