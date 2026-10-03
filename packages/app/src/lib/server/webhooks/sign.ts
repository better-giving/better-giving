// the three headers a post to a destination carries, signed to the Standard Webhooks spec
// (https://www.standardwebhooks.com/), so a receiver verifies with that spec's library in its own
// language.
//
// **the HMAC is keyed with the secret's bytes**: what follows `whsec_`, base64-decoded. keyed with
// the `whsec_…` text instead, every signature is well formed and none verifies.
//
// **what is signed is exactly what is sent.** the caller serializes the body once and hands this
// module that string, and the post carries the same string; a body stringified again after
// signing differs by a byte and fails.
//
// `webhook-id` is the delivery row's, the same on every attempt; `webhook-timestamp` is the
// attempt's own, so every retry is signed afresh and a receiver's replay window reads it.

const SECRET_PREFIX = 'whsec_';

export type SignedHeaders = {
	readonly 'webhook-id': string;
	readonly 'webhook-timestamp': string;
	readonly 'webhook-signature': string;
};

/** the headers for posting `body` as delivery `id` at `at`, signed with `secret`. */
export async function signedHeaders(input: {
	readonly secret: string;
	readonly id: string;
	readonly at: Date;
	readonly body: string;
}): Promise<SignedHeaders> {
	const timestamp = String(Math.floor(input.at.getTime() / 1_000));
	const key = await crypto.subtle.importKey(
		'raw',
		secretBytes(input.secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const mac = await crypto.subtle.sign(
		'HMAC',
		key,
		new TextEncoder().encode(`${input.id}.${timestamp}.${input.body}`)
	);
	return {
		'webhook-id': input.id,
		'webhook-timestamp': timestamp,
		'webhook-signature': `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`
	};
}

/** `webhook_destination_signing_secret_check` holds every stored secret to the prefix. */
function secretBytes(secret: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(atob(secret.slice(SECRET_PREFIX.length)), (c) => c.charCodeAt(0));
}
