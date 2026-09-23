import { describe, expect, it } from 'vitest';
import { listeningSays } from './zapier-standing';

describe('listeningSays', () => {
	it.each([
		[0, null],
		[1, '1 Zap listening'],
		[3, '3 Zaps listening']
	])('%i reads %s', (count, said) => {
		expect(listeningSays(count)).toBe(said);
	});
});
