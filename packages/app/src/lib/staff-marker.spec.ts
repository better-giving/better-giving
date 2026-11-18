import { describe, expect, it } from 'vitest';
import { hasStaffMarker, STAFF_MARKER_COOKIE, staffMarkerCookie } from './staff-marker';

const headers = (cookie?: string) => new Headers(cookie === undefined ? {} : { cookie });

describe('hasStaffMarker', () => {
	it('is false for a request with no cookie header', () => {
		expect(hasStaffMarker(headers())).toBe(false);
	});

	it('is true for the marker with its fixed value, among other cookies', () => {
		expect(hasStaffMarker(headers(`${STAFF_MARKER_COOKIE}=1`))).toBe(true);
		expect(hasStaffMarker(headers(`a=b; ${STAFF_MARKER_COOKIE}=1; c=d`))).toBe(true);
	});

	it('is false for another value, another name, or a name that only contains it', () => {
		expect(hasStaffMarker(headers(`${STAFF_MARKER_COOKIE}=0`))).toBe(false);
		expect(hasStaffMarker(headers(`${STAFF_MARKER_COOKIE}=`))).toBe(false);
		expect(hasStaffMarker(headers('other=1'))).toBe(false);
		expect(hasStaffMarker(headers(`x${STAFF_MARKER_COOKIE}=1`))).toBe(false);
		expect(hasStaffMarker(headers(`${STAFF_MARKER_COOKIE}x=1`))).toBe(false);
	});
});

describe('staffMarkerCookie', () => {
	it('is the fixed value for about a year, site-wide, HttpOnly and SameSite=Lax', () => {
		expect(staffMarkerCookie(new URL('http://localhost:5321/login'))).toBe(
			'bg_staff_seen=1; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax'
		);
	});

	it('adds Secure over https and only then', () => {
		expect(staffMarkerCookie(new URL('https://give.example.org/login'))).toBe(
			'bg_staff_seen=1; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure'
		);
	});

	it('is read back by hasStaffMarker as the browser would send it', () => {
		const sent = staffMarkerCookie(new URL('https://give.example.org/')).split(';', 1)[0];
		expect(hasStaffMarker(headers(sent))).toBe(true);
	});
});
