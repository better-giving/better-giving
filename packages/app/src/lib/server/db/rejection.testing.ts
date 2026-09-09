import { causeChain } from './rejection';

// what a spec needs to read a D1 constraint failure that came back through drizzle.
//
// not a spec itself — no pool's `include` matches this name, which is what keeps it a module
// two specs import rather than a third file of tests. nothing in the app imports it; it imports
// the app's own walk, which is the direction that keeps the two from drifting — a private copy
// here would go on passing after ./rejection.ts stopped finding a code.

/**
 * the whole error chain as text, for matching D1's extended result code.
 *
 * walking `cause` is the point. D1 appends the symbolic code (`SQLITE_CONSTRAINT_CHECK`) to its
 * own message, but drizzle catches that and rethrows its own `Failed query: insert into …` with
 * the D1 error demoted to `cause` — so a `toThrow(/…/)` on a drizzle call matches drizzle's SQL
 * echo and never sees the code. `CONTRIBUTING.md` → Tests asks for the code's name rather than the
 * prose, and this is what makes that reachable.
 *
 * one copy, imported by every spec that asserts a rejection through drizzle. the probes that go
 * straight at `env.DB.prepare` — `./strict.workers.spec.ts` and the raw-binding cases at the end
 * of `../forms/queries.workers.spec.ts` — need none of this, because there is no drizzle in the
 * path to demote anything, and they are deliberately left with their own smaller helper.
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
