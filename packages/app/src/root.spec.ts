import { describe, expect, it } from 'vitest';
import { loader } from './root';

// the root loader reads one thing, whether the request carries the returning-staff marker, and reads
// it off the `Cookie` header alone: it takes no context, so it has no database, no signing key and
// no session to reach ($lib/staff-marker.ts).

const asked = (cookie?: string) =>
	loader({
		request: new Request(
			'https://give.example.org/',
			cookie === undefined ? {} : { headers: { cookie } }
		)
	} as Parameters<typeof loader>[0]);

describe('the root loader', () => {
	it('says no marker for a donor', () => {
		expect(asked()).toEqual({ staffMarker: false });
		expect(asked('theme=dark')).toEqual({ staffMarker: false });
	});

	it('says there is one for a browser that carries the marker', () => {
		expect(asked('bg_staff_seen=1')).toEqual({ staffMarker: true });
		expect(asked('a=b; bg_staff_seen=1')).toEqual({ staffMarker: true });
	});

	it('is not fooled by a session cookie alone', () => {
		expect(asked('better-auth.session_token=abc')).toEqual({ staffMarker: false });
	});
});
