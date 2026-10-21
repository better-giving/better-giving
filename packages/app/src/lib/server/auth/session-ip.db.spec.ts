import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { authSession } from '$lib/server/db/auth-schema';
import { createDb } from '$lib/server/db/client';
import { client } from '$lib/server/db/database.testing';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import { createAuth, signInMember } from './index';

const db = createDb(client);
const auth = createAuth(
	db,
	{ ADMIN_PASSWORD: 'correct-horse-battery' },
	{ secret: 'ab'.repeat(32), requestOrigin: 'https://donate.example.org' }
);

/** stamped as the server entry stamps it, beside the two headers a caller can forge. */
function forgedHeaders(stamped: string): Headers {
	return new Headers({
		[CLIENT_IP_HEADER]: stamped,
		'cf-connecting-ip': '198.51.100.2',
		'x-forwarded-for': '198.51.100.9, 198.51.100.10'
	});
}

describe('the address a session records', () => {
	it('is the stamped one, not a forged cf-connecting-ip or forwarded chain', async () => {
		const email = 'priya@example.org';
		const password = 'a-long-enough-password';
		await auth.api.signUpEmail({ body: { email, password, name: 'Priya' } });

		const signIn = await signInMember(auth, {
			email,
			password,
			headers: forgedHeaders('203.0.113.7')
		});
		expect(signIn.ok).toBe(true);

		const sessions = await db
			.select({ ipAddress: authSession.ipAddress })
			.from(authSession)
			.where(eq(authSession.ipAddress, '203.0.113.7'));
		expect(sessions).toHaveLength(1);
		const forged = await db
			.select({ id: authSession.id })
			.from(authSession)
			.where(eq(authSession.ipAddress, '198.51.100.2'));
		expect(forged).toHaveLength(0);
	});
});
