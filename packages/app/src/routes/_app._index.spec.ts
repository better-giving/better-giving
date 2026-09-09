import { describe, expect, it } from 'vitest';
import { loader } from './_app._index';

// see ./_app.admin._index.spec.ts for why an address with nothing to render still has a spec.

describe('/', () => {
	it('forwards to the home screen, which is the dashboard', () => {
		const response = loader();

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/admin');
	});
});
