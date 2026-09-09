// the one thing that can link the signing secret a deployment holds to the endpoint the processor
// is signing with.
//
// why anything is needed. the secret is returned once, by the create, and no read on either of
// Stripe's APIs hands it back (https://docs.stripe.com/api/webhook_endpoints/list) — so the two
// values can never be compared directly. a deployment holding the secret of an endpoint that has
// since been replaced is indistinguishable, from every read available, from one holding the right
// secret: every screen prints `Stored`, verification fails on every delivery, and settlements stop
// with nothing saying so. what closes that is this digest, written onto the endpoint at creation
// and compared against the stored value by `webhookSecretStanding` in
// `packages/app/src/lib/server/payments/webhook-secret.ts`.
//
// **it is here rather than beside either writer because both ends stamp and read the stamp.** the
// operator console registers an endpoint and stamps the secret it stored on it, and the deployment
// reads the stamp back off the endpoint to say whether what it holds is still the right secret. a
// second spelling of the key or of the digest is a stamp one end writes and the other cannot find,
// which reads exactly like the missing secret this exists to detect — the reason `./../
// deploy-split.ts` is in this package, applied to a value rather than to a name.
//
// a digest and never the secret. Stripe already holds the secret, so what this puts on the account
// tells its dashboard nothing it does not have; the secret itself written there would be a
// credential sitting where a list read can reach it.
//
// it imports nothing and names no processor. the digest is over an opaque string, so the module is
// as reachable from a state layer as from an adapter.

/**
 * how many hex characters of the digest are kept.
 *
 * sixteen, which is 64 bits — far past any chance of two of an account's at most sixteen endpoints
 * colliding, and short enough to sit in a metadata value and be read at a glance. the truncation is
 * not a security measure and is not load-bearing: a preimage of a 256-bit random secret is not
 * reachable at either length.
 */
const KEPT = 16;

/**
 * the fingerprint of a signing secret, or `null` for a value that is not one.
 *
 * `null` rather than the digest of an empty string, because an unset variable and a set one must not
 * produce comparable values: two deployments with nothing set would otherwise agree, and a console
 * would report a match over a deployment that verifies nothing.
 *
 * `crypto.subtle` rather than a node import. it is the platform primitive on both sides of this
 * module — the deployment runs inside workerd, and the console runs on node, where the same global
 * is what a bare import would reach anyway.
 */
export async function secretFingerprint(secret: string | null | undefined): Promise<string | null> {
	if (typeof secret !== 'string' || secret.trim() === '') return null;

	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
		.slice(0, KEPT);
}

/**
 * the metadata key an endpoint's fingerprint is written under.
 *
 * a stated name rather than a derived one, because it is read by a deployment that did not write it:
 * an operator's account outlives any one build of this app, and a key spelled from a constant that
 * later changes is a stamp nothing can find. `signing_secret_fingerprint` says what it is to whoever
 * finds it in the Stripe dashboard, which is the other reader this value has.
 */
export const FINGERPRINT_METADATA_KEY = 'signing_secret_fingerprint';
