import { createHash, randomBytes } from 'node:crypto';

// the secrets a supporter holds — a mailed link's token and a session cookie's value — and the one
// form either is stored in: its lowercase hex SHA-256, which `supporter_link_token_hash_check` and
// `supporter_session_token_hash_check` in ../db/schema.ts hold every stored one to.

/** 256 random bits, url-safe, for a link or a cookie. */
export function mintToken(): string {
	return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}
