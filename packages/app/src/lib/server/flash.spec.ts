import { describe, expect, it } from 'vitest';
import { CREATED_FLASH, redirectWithFlash, SAVED_FLASH, takeFlash } from './flash';

// a node spec, not a workers one: nothing here reaches the database. what is under test is the
// transport — a marker written on a redirect, read once at the address it landed on, and gone.
// the routes that set and take these markers have their own coverage against a real D1.
//
// no cookie jar stands between the two halves any more. the cookie is written at `/`, so a
// browser sends it to every address and nothing about path matching decides who reads it: the
// destination rides in the value and `./flash.ts` compares it to the address the load is running
// for. that comparison is a server-side string against a `Request`, so a case states the request
// and reads the response header.

const ORIGIN = 'https://donations.example.workers.dev';
const FORMS = '/admin/forms';
const FORM_ID = 'frm_flashtransport1';
const EDITOR = `${FORMS}/${FORM_ID}`;

/** a request as the browser makes it, optionally carrying what it is holding. */
function visit(path: string, cookie?: string): Request {
	const headers = new Headers();
	if (cookie !== undefined) headers.set('Cookie', cookie);
	return new Request(`${ORIGIN}${path}`, { headers });
}

/**
 * a `Set-Cookie` as the browser sends it back: the pair alone.
 *
 * the attributes are the browser's instructions and never travel on a request, so a case that
 * passed the whole header would be handing the reader text no request ever carries.
 */
function held(setCookie: string): string {
	return setCookie.split(';')[0] ?? '';
}

/** what a redirect wrote, which is the one header a case needs off it. */
function written(response: Response): string {
	const header = response.headers.get('Set-Cookie');
	if (header === null) throw new Error('the redirect wrote no cookie');
	return header;
}

describe('a flash marker', () => {
	it('reaches the load at the address the redirect sent, carrying the marker it was given', async () => {
		const sent = await redirectWithFlash(visit(EDITOR), SAVED_FLASH, EDITOR, 'giving');

		const taken = await takeFlash(visit(EDITOR, held(written(sent))), SAVED_FLASH);
		expect(taken?.marker).toBe('giving');
	});

	it('survives the data request the router makes for that same screen', async () => {
		// the reason the cookie is written at `/` rather than at the screen it reports on. after the
		// first navigation the router does not ask for `/admin/forms/<id>`; it asks for
		// `/admin/forms/<id>.data`, and a cookie scoped to the screen's own path is not sent there. a
		// path-scoped flash therefore works on the first load and silently stops working after it.
		const sent = await redirectWithFlash(visit(EDITOR), SAVED_FLASH, EDITOR, 'giving');

		const taken = await takeFlash(visit(`${EDITOR}.data`, held(written(sent))), SAVED_FLASH);
		expect(taken?.marker).toBe('giving');
	});

	it('is delivered to one response, so a reload at the same address reports nothing', async () => {
		// the defect this transport exists to remove. as a query parameter the outcome sits in the
		// address bar, so a reload re-announces a save nobody has just performed — and a bookmark
		// announces it days later.
		const sent = await redirectWithFlash(visit(EDITOR), SAVED_FLASH, EDITOR, 'giving');
		const taken = await takeFlash(visit(EDITOR, held(written(sent))), SAVED_FLASH);

		// the clearing rides on the response that publishes the marker, so what the browser holds
		// after that response is an expired cookie and the next request carries nothing.
		expect(taken?.clear).toMatch(/Max-Age=0/);
		expect(await takeFlash(visit(EDITOR), SAVED_FLASH)).toBe(null);
	});

	it('goes only to the address it was written for, and is left alone elsewhere', async () => {
		// the marker names a section of one screen, so a screen it was not written for must not be
		// handed it — and must not burn it either, since the operator may still land where it was
		// aimed. at `/` the cookie is sent to every screen, which is what makes the second half of
		// that a rule rather than a consequence.
		const sent = await redirectWithFlash(visit(FORMS), SAVED_FLASH, EDITOR, 'giving');
		const cookie = held(written(sent));

		expect(await takeFlash(visit(FORMS, cookie), SAVED_FLASH)).toBe(null);
		expect((await takeFlash(visit(EDITOR, cookie), SAVED_FLASH))?.marker).toBe('giving');
	});

	it('keeps a create’s marker apart from an editor’s', async () => {
		// the reason the two flashes have different names. both are written at `/` under a name of
		// their own, so a create waiting to be landed on and a save waiting to be landed on are two
		// cookies rather than one slot the second write empties.
		const created = written(await redirectWithFlash(visit(EDITOR), CREATED_FLASH, FORMS, FORM_ID));
		const saved = written(await redirectWithFlash(visit(EDITOR), SAVED_FLASH, EDITOR, 'giving'));
		const jar = `${held(created)}; ${held(saved)}`;

		expect((await takeFlash(visit(EDITOR, jar), SAVED_FLASH))?.marker).toBe('giving');
		expect((await takeFlash(visit(FORMS, jar), CREATED_FLASH))?.marker).toBe(FORM_ID);
	});

	it('redirects to the destination it wrote the marker for', async () => {
		const sent = await redirectWithFlash(visit(EDITOR), SAVED_FLASH, EDITOR, 'giving');

		expect(sent.status).toBe(303);
		expect(sent.headers.get('Location')).toBe(EDITOR);
	});

	it('is written http-only and lax at the root, and expires on its own', async () => {
		// `httpOnly` because nothing in the browser has any business reading it. `lax` because a 303
		// the browser follows is a top-level navigation, which `strict` would withhold the cookie on
		// — the one request the flash exists for. and a max-age rather than a session cookie: a
		// marker nobody lands on has to die without waiting for the browser to close.
		const header = written(await redirectWithFlash(visit(EDITOR), SAVED_FLASH, EDITOR, 'x'));

		expect(header).toMatch(/^admin_saved=/);
		expect(header).toMatch(/Path=\//);
		expect(header).toMatch(/HttpOnly/);
		expect(header).toMatch(/SameSite=Lax/);
		const maxAge = /Max-Age=(\d+)/.exec(header)?.[1];
		expect(Number(maxAge)).toBeGreaterThan(0);
		expect(Number(maxAge)).toBeLessThanOrEqual(300);
	});

	it('is secure over https and not over the dev server’s http', async () => {
		// react router's `createCookie` states no `secure` of its own, so a deployment would ship
		// without one unless this is decided per request. it cannot be a constant either: `true`
		// everywhere is a cookie no browser stores against `pnpm dev`, which serves over http.
		const deployed = written(await redirectWithFlash(visit(EDITOR), SAVED_FLASH, EDITOR, 'x'));
		expect(deployed).toMatch(/Secure/);

		const local = new Request(`http://localhost:5321${EDITOR}`);
		const dev = written(await redirectWithFlash(local, SAVED_FLASH, EDITOR, 'x'));
		expect(dev).not.toMatch(/Secure/);
	});

	it('is taken at the path of a destination that carries a query', async () => {
		// the destination is a `Location` and a screen's address at once, and the two are not the
		// same string: a query belongs to the redirect and never to the address a load runs for, so
		// one stored verbatim would be a marker no screen ever matches.
		const destination = `${FORMS}?highlight=${FORM_ID}`;
		const sent = await redirectWithFlash(visit(EDITOR), CREATED_FLASH, destination, FORM_ID);

		expect(sent.headers.get('Location')).toBe(destination);
		expect((await takeFlash(visit(FORMS, held(written(sent))), CREATED_FLASH))?.marker).toBe(
			FORM_ID
		);
	});

	it('reports nothing where no redirect has been', async () => {
		expect(await takeFlash(visit(EDITOR), SAVED_FLASH)).toBe(null);
	});

	it('reports nothing for a value this app did not write', async () => {
		// somebody else's cookie under the same name, or one left behind by a deployment that spelled
		// the value differently. a value that does not carry a destination and a marker is not one of
		// ours, and reading it as one would put an arbitrary string in front of the screen's own
		// lookup rather than in front of an operator.
		expect(await takeFlash(visit(EDITOR, 'admin_saved=details'), SAVED_FLASH)).toBe(null);
	});
});
