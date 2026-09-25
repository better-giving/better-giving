// the one reading of a processor's API address box, shared by every set-up that draws one.
//
// it follows `Base` in packages/console/internal/cf/client.go, which the binary reads every typed
// address with, so a box refused here is one the binary would refuse and a box passed here is one
// it calls.

/** what an address box holding something other than an address says under it. */
export const NOT_AN_ADDRESS = 'an https:// address with nothing after the domain';

/**
 * whether a typed address is one the binary calls, already trimmed: one trailing slash is dropped,
 * and what is left is an https origin and nothing more.
 */
export function isApiAddress(typed: string): boolean {
	const bare = typed.endsWith('/') ? typed.slice(0, -1) : typed;
	// no path, query, fragment or user in front of the host: any of them is past the origin.
	return /^https:\/\/[^/?#@\s]+$/.test(bare) && URL.canParse(bare);
}
