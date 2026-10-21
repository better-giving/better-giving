import { causeChain } from './rejection';

// what a spec needs to read a constraint failure the database threw, raw or through drizzle.
//
// not a spec itself — no project's `include` matches this name, which is what keeps it a module
// two specs import rather than a third file of tests. nothing in the app imports it; it imports
// the app's own walk, which is the direction that keeps the two from drifting — a private copy
// here would go on passing after ./rejection.ts stopped finding a code.

/**
 * the whole error chain as text, for matching the database's extended result code.
 *
 * walking the chain is the point. libSQL keeps the symbolic code (`SQLITE_CONSTRAINT_CHECK`) out
 * of its message and in a field, and drizzle catches the driver's error and rethrows its own
 * `Failed query: insert into …` with that error demoted to `cause` — so a `toThrow(/…/)` matches
 * prose and never sees the code. ./rejection.ts's `causeChain` puts each link's code beside its
 * message. `CONTRIBUTING.md` → Tests asks for the code's name rather than the prose, and this is
 * what makes that reachable.
 *
 * one copy, imported by every spec that asserts a rejection — a raw `client.execute` included,
 * since with no drizzle in the path the code is still not in the message.
 *
 * throws rather than returning when the statement succeeds, so a test that stopped exercising
 * the constraint fails instead of matching an empty string.
 */
export async function rejectionCode(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn();
	} catch (e) {
		return causeChain(e).join(' <- ');
	}
	throw new Error('expected the database to reject this statement, but it succeeded');
}
