import { createHash, timingSafeEqual } from 'node:crypto';

// the one constant-time compare in this repository, and there is exactly one on purpose.
//
// two secrets are checked over HTTP here — `ADMIN_PASSWORD` at the staff sign-in
// (./auth/credential.ts) and `CONSOLE_TOKEN` on the console surface (./console/access.ts) — and a
// second implementation is how one of them ends up with an early `return` in it. the hazard is not
// obvious at a call site: `timingSafeEqual` throws unless both buffers are the same length, so the
// natural fix is a length check in front of it, and that check is the leak.
//
// a module at this level rather than inside either caller's folder, for the reason ./flash.ts and
// ./zod-issues.ts are here: it belongs to no one capability, and putting it under `auth/` would
// make the console's import read as the console holding a session.

/**
 * constant-time string equality.
 *
 * `timingSafeEqual` throws unless both buffers are the same length, and the obvious
 * fix — comparing lengths first and returning early — leaks the length of the
 * configured secret through response timing. hashing both sides to a fixed 32 bytes
 * removes the length branch entirely: every comparison is one SHA-256 per side plus a
 * 32-byte constant-time compare, whatever was posted.
 *
 * the digests never leave this function and are never stored, so an unkeyed hash is
 * the right primitive here — this is a comparison, not password storage, and the "use
 * a KDF" rule does not apply to a value that is already a high-entropy deploy secret.
 * SHA-256's cost does scale with input length in 64-byte blocks, so a determined
 * attacker could in principle learn the configured secret's block count; that is a
 * far weaker signal than the byte-position leak an early `return` would hand over.
 *
 * verified under workerd: `node:crypto`'s `createHash` and `timingSafeEqual` are both
 * available with the `nodejs_compat` flag at this project's compatibility date.
 */
export function secretEquals(a: string, b: string): boolean {
	return timingSafeEqual(sha256(a), sha256(b));
}

function sha256(value: string): Uint8Array {
	return createHash('sha256').update(value, 'utf8').digest();
}
