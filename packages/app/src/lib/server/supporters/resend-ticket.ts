import { createCookie } from 'react-router';
import { cookiesSecure } from '../runtime/cookie-scheme';

// what Send it again on /fundraise/sent (src/routes/fundraise.sent.tsx) resends after a start: the
// pending page and the address its confirm link went to. the start's flash ($lib/server/flash.ts)
// is spent by the screen it lands on, so that screen's loader writes this for the presses after
// it, and never into the address. a browser can write any value here, so it only ever names what
// to look up: `resendConfirmLink` in ./links.ts mails nothing unless the page is pending and the
// address's own.

/** a starter's tab left open on Check your email: a day of presses, well past a link's hour. */
const TICKET_SECONDS = 24 * 60 * 60;

/**
 * at `/fundraise`, so the screen's own post, which the router sends to `/fundraise/sent.data`, is
 * sent it; `secure` is stated per response, for `../flash.ts`'s reason.
 */
const ticket = createCookie('supporter_resend', {
	path: '/fundraise',
	httpOnly: true,
	sameSite: 'lax',
	maxAge: TICKET_SECONDS
});

export type ResendTicket = { readonly pageId: string; readonly email: string };

/** the `Set-Cookie` value naming the page a start just made. */
export function writeResendTicket(request: Request, held: ResendTicket): Promise<string> {
	return ticket.serialize(held, { secure: cookiesSecure(request) });
}

/** the `Set-Cookie` value dropping the ticket, for a screen drawn after a sign-in request. */
export function clearResendTicket(request: Request): Promise<string> {
	return ticket.serialize('', { maxAge: 0, secure: cookiesSecure(request) });
}

/** the ticket the request carries, or null where it carries none this app wrote. */
export async function readResendTicket(request: Request): Promise<ResendTicket | null> {
	const value: unknown = await ticket.parse(request.headers.get('Cookie'));
	if (typeof value !== 'object' || value === null) return null;
	const { pageId, email } = value as Partial<ResendTicket>;
	if (typeof pageId !== 'string' || pageId === '' || typeof email !== 'string') return null;
	return { pageId, email };
}
