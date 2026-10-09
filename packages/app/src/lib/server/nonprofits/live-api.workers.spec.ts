import { describe, expect, it } from 'vitest';
import { API, lookUpFiling } from './filing';
import { refuseLiveApiCalls } from './live-api.setup';

// the guard ./live-api.setup.ts puts in front of every spec: a request to the live API is refused
// before it leaves, and the spec that made it fails at its end even where the caller swallowed the
// refusal, as `lookUpFiling` does. each case drains what it made so its own end stays clean.

const REFUSED = /nonprofits\.better\.giving[\s\S]*mock src\/lib\/server\/nonprofits\/filing\.ts/;

describe('a spec that reaches the live nonprofit API unmocked', () => {
	it('is refused at the request, naming the host', async () => {
		await expect(fetch(`${API}/v1/orgs/123456789`)).rejects.toThrow(REFUSED);
		expect(refuseLiveApiCalls).toThrow(REFUSED);
	});

	it('fails at its end where the lookup answered null over the refusal', async () => {
		expect(await lookUpFiling('12-3456789')).toBeNull();
		expect(refuseLiveApiCalls).toThrow(REFUSED);
	});
});
