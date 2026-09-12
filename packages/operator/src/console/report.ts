// the envelope a deployment's console surface answers in, stated once for both ends of the wire.
//
// it is here for the reason ./token.ts is here: the deployment writes this value and the operator
// console reads it, the two live in packages that import nothing of each other's, and an envelope
// written out on each side is a member one half stops sending and the other goes on drawing a
// space for. what the deployment answers in it and why every write answers in it too is stated
// where it is assembled, in `packages/app/src/lib/server/console/report.ts`.
//
// **the organisation's profile is a type parameter, and this package states what it is.** it is
// `OrgProfileValues` in ./org.ts, which moved here out of the app the moment a console surface had
// to render one, the way ./token.ts arrived before it, so that neither end restates a shape the
// other writes. a shape copied into the console instead is how the two ends come to disagree about
// what the envelope carries.
//
// it stays a parameter rather than being fixed to what this package now holds. a console that
// reads only part of the envelope instantiates only that part, and a member typed for it that it
// never guards is a shape asserted rather than read.
//
// **no configuration value crosses this wire.** the console reads all seventeen off the Cloudflare
// account it is signed in to (`DEPLOY_VARS` in ../deploy-split.ts), so a deployment reporting one
// too would be a second seed disagreeing with the first mid-deploy. the session credential is not
// among the names the deployment reads at all — see `tokenSlot` in
// `packages/app/src/lib/server/console/access.ts`.

/** the whole of what the console surface answers, whether the request read or wrote. */
export interface ConsoleReport<Org> {
	/** every site this deployment's forms may be used on, in the operator's own order. */
	readonly sites: readonly string[];
	/**
	 * the organisation's legal identity as the wire and the form both name it, or `null` when
	 * nobody has saved it yet.
	 *
	 * `null` is a real answer rather than an error: a fresh deployment has no profile, and the
	 * screens that write a donation form are where that is reported
	 * (`packages/app/src/lib/server/forms/readiness.ts`).
	 */
	readonly org: Org | null;
	/**
	 * the release this deployment's worker was built from, without a leading `v`, or `null`.
	 *
	 * `null` is two deployments at once and a console must treat them alike: one built from a
	 * checkout rather than a tagged release, and one deployed before this member existed, which
	 * answers with no member at all rather than `null`. neither can be
	 * compared against a release, so a console that reads `null` judges by migrations alone
	 * rather than offering an update it cannot justify.
	 *
	 * a bare version string and no ordering with it: the deployment states what it runs and the
	 * console decides what that means, because the console is the half that knows which release
	 * it is holding.
	 */
	readonly version: string | null;
	/**
	 * when the session the request proved it holds stops being one, ISO 8601.
	 *
	 * it rides in the envelope so a console can warn before the session dies rather than
	 * discovering it on the next request. a string that says what it is rather than the epoch
	 * seconds the token carries: the reader is a console deciding when to warn, and a number whose
	 * unit has to be known is one a reader gets wrong once.
	 */
	readonly session: { readonly expiresAt: string };
}
