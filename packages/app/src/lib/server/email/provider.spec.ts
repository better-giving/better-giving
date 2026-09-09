import { describe, expect, it, vi } from 'vitest';
import {
	refusing,
	sealed,
	SEND_FAILURE_REASONS,
	type EmailMessage,
	type EmailProvider,
	type SendFailureReason,
	type SendResult
} from './provider';

// the port's contract, exercised against fakes rather than against a transport — which is
// the point of having a port. no socket is opened anywhere in this file.
//
// the fakes below prove the type, not the promise: a provider that returns `{ ok: false }`
// returning `{ ok: false }` is a tautology, and nothing here stands behind "send never
// throws" — see `sealed`, which is where that promise is enforced, and ./smtp.spec.ts, which
// is where the real transport is held to it.

const MESSAGE: EmailMessage = {
	to: 'donor@example.org',
	subject: 'Your donation receipt',
	text: 'Thank you.',
	html: '<p>Thank you.</p>'
};

/** a provider that always fails with the given reason — the shape every transport must keep. */
function failing(reason: SendFailureReason): EmailProvider {
	return refusing(reason, `failed with ${reason}`);
}

describe('EmailProvider — the failure contract', () => {
	/**
	 * the one rule the ledger depends on. the caller that sends a receipt has already
	 * committed a `batch()` and D1 has no way to take it back, so a delivery failure must
	 * arrive as a value the caller can ignore — never as an exception that could be caught
	 * by a `try` somebody eventually wraps around the posting too.
	 */
	it.each(SEND_FAILURE_REASONS)('resolves rather than throwing on %s', async (reason) => {
		const result = await failing(reason).send(MESSAGE);
		expect(result.ok).toBe(false);
	});

	/**
	 * the union is discriminated, so a caller cannot read `reason` off a success and cannot
	 * mistake "not sent" for "sent". asserted at runtime because that is what a caller
	 * branching on `result.ok` actually observes.
	 */
	it('carries a reason and an actionable detail on every failure', async () => {
		for (const reason of SEND_FAILURE_REASONS) {
			const result = await failing(reason).send(MESSAGE);
			if (result.ok) throw new Error('the failing fake reported success');
			expect(result.reason).toBe(reason);
			expect(result.detail.length).toBeGreaterThan(0);
		}
	});

	// success carries nothing else. a provider that returned a message id or a transport
	// handle here would put a vendor's vocabulary on the port, which is the thing it exists
	// to keep out.
	it('carries nothing but `ok` on success', async () => {
		const sender: EmailProvider = {
			async send(): Promise<SendResult> {
				return { ok: true };
			}
		};
		expect(await sender.send(MESSAGE)).toEqual({ ok: true });
	});

	/**
	 * the reasons a caller has to be able to tell apart, pinned as literals in one place.
	 *
	 * pinning them as literals is what makes the rule on `SEND_FAILURE_REASONS` enforceable: a
	 * reason meaning "this deployment chose not to send" fails here, before any caller can reach
	 * for it to stay quiet about receipts that never left.
	 */
	it('pins the closed set of failure reasons', () => {
		expect(SEND_FAILURE_REASONS).toEqual([
			'not_configured',
			'invalid_message',
			'connect_failed',
			'auth_failed',
			'rejected',
			'internal_error'
		]);
	});

	/**
	 * nothing that refuses before dialling may claim the message might have gone out. a
	 * refusing provider never opens a socket, so `indeterminate` is a constant `false` there —
	 * and it is asserted because the day somebody adds a parameter for it is the day a
	 * misconfiguration starts telling an operator their receipt may have been delivered.
	 */
	it('reports nothing as indeterminate when nothing was attempted', async () => {
		for (const reason of SEND_FAILURE_REASONS) {
			const result = await failing(reason).send(MESSAGE);
			if (result.ok) throw new Error('the failing fake reported success');
			expect(result.indeterminate).toBe(false);
		}
	});
});

describe('sealed — the contract, enforced', () => {
	/**
	 * the assertion the port's prose could not make. every provider this app
	 * hands out goes through `sealed`, so a transport that throws — an adapter bug, a rejected
	 * import, a socket layer raising a `DOMException` — cannot put an exception on the path of a
	 * caller that has already committed a `batch()`.
	 */
	it.each([
		{ label: 'an Error', thrown: new Error('the socket exploded') },
		{ label: 'a string', thrown: 'the socket exploded' },
		{ label: 'a DOMException', thrown: new DOMException('aborted', 'AbortError') },
		{ label: 'undefined', thrown: undefined }
	])('turns $label thrown by a provider into a result', async ({ thrown }) => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const throwing: EmailProvider = {
			send(): Promise<SendResult> {
				throw thrown;
			}
		};

		const result = await sealed(throwing).send(MESSAGE);
		if (result.ok) throw new Error('a throwing provider reported a send');
		expect(result.reason).toBe('internal_error');
		// unknown, and it says so: a transport can throw after data was accepted.
		expect(result.indeterminate).toBe(true);

		// it logs. a seal that hid a real adapter bug would turn one into a deployment that
		// quietly sends nothing and reports a tidy reason for it.
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	// a provider that keeps its contract is passed through untouched — the seal is a net, not a
	// translation layer.
	it('passes a well-behaved result through unchanged', async () => {
		const sender: EmailProvider = {
			async send(): Promise<SendResult> {
				return { ok: true };
			}
		};
		expect(await sealed(sender).send(MESSAGE)).toEqual({ ok: true });
		expect(await sealed(failing('rejected')).send(MESSAGE)).toMatchObject({
			ok: false,
			reason: 'rejected'
		});
	});

	/**
	 * the log is itself a throw site, so it belongs inside the `try` rather than bare in the
	 * catch. writing a thrown value to the console serialises it, which runs a getter or a
	 * `toString` the transport supplied — and `console` is a host object this app does not own
	 * either. unguarded, it puts a throw in the one function whose whole job is to have none, on
	 * exactly the path where a `batch()` has already committed. `messageOf` in ./smtp-failure.ts
	 * is held to the same standard against the same hazard.
	 */
	it('still reports when logging the throw is itself a throw', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {
			throw new Error('the log sink is unavailable');
		});
		const throwing: EmailProvider = {
			send(): Promise<SendResult> {
				throw new Error('the socket exploded');
			}
		};

		await expect(sealed(throwing).send(MESSAGE)).resolves.toMatchObject({
			ok: false,
			reason: 'internal_error'
		});
		spy.mockRestore();
	});

	// a rejected promise is the same failure as a synchronous throw, and it is the one an
	// `async` transport actually produces.
	it('catches a rejection as well as a throw', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const rejecting: EmailProvider = {
			send: () => Promise.reject(new Error('nope'))
		};
		expect(await sealed(rejecting).send(MESSAGE)).toMatchObject({ reason: 'internal_error' });
		spy.mockRestore();
	});
});
