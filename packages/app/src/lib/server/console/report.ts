import type { Db } from '../db/client';
import { toFormValues } from '../org/form-values';
import type { OrgProfileField, OrgProfileFormValues } from '../org/org-input';
import type { OrgProfileField as WireOrgField } from '@better-giving/operator/console/org';
import { readOrgProfile } from '../org/queries';
import { readSites } from '../sites/queries';
import type { ConsoleReport as Wire } from '@better-giving/operator/console/report';
import type { ConsoleSession } from './access';

// what this deployment answers about itself, in one shape.
//
// the read and both writes return this, and that is the design rather than a convenience: a write
// whose answer is the report is a console that cannot hold a second view of the deployment, so
// there is no moment where a saved site list and the screen that lists them disagree.
//
// **the envelope itself is stated once, in `@better-giving/operator/console/report`.** the console
// reads what this writes and the two packages import nothing of each other's, so a shape written
// out on both sides is a member one half stops sending and the other goes on drawing a space for.
// what is instantiated here is the one member that package has no statement of: the organisation's
// profile, this app's own type. the members' own rules are stated there.
//
// everything in here is a row, and both rows are written back over this wire — the list of sites
// this deployment's forms may be used on, and the organisation's legal identity — which is what
// makes this surface a mutation surface and not a report.
//
// **no configuration value is in here and none may be added.** the console reads all thirteen off
// the Cloudflare account it is signed in to (`DEPLOY_VARS` in
// `@better-giving/operator/deploy-split`), so a member reporting one too would be a second seed
// disagreeing with the first mid-deploy. the console's own session credential is on no list here
// at all — see `tokenSlot` in ./access.ts.
//
// **one member is not a row: the version.** it is a constant the build
// wrote into the bundle, so it says which release this worker was cut from rather than what an
// operator set — `packages/app/version-define.ts` is where it is defined and where the name is
// typed, and a build whose environment named no version answers `null`.

/** the whole of what this surface answers, whether the request read or wrote. */
export type ConsoleReport = Wire<OrgProfileFormValues>;

/**
 * one vocabulary at both ends of the wire, held to it here.
 *
 * the console draws a box per field off `@better-giving/operator/console/org`'s list, and this
 * deployment refuses a save off ../org/org-input.ts's, which is where the rules are. the two are
 * the same ten names and nothing but this line says so: each has to extend the other, so a field
 * added on one side and not the other stops compiling at the file that owns the wire rather than
 * arriving as a box no console draws or a box no save reaches.
 *
 * a type and not a value, so it costs the worker nothing: both imports are erased, and this
 * declaration emits no code at all.
 *
 * the two below are exported for the second vocabulary held the same way — the wallets in
 * ./wallet-hosts.ts — because a copy of a two-line comparison is how one of them stops comparing
 * anything without failing.
 */
export type SameNames<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** takes nothing but `true`, which is what turns the comparison above into an error. */
export type Agreed<Same extends true> = Same;
export type OrgWireFields = Agreed<SameNames<OrgProfileField, WireOrgField>>;

/**
 * the deployment's own answer, assembled once.
 *
 * the two reads overlap rather than queue — neither has anything to say to the other.
 *
 * no `platform.env` is passed in and none may be: this value is serialized to a caller, and an env
 * in scope here is the Stripe secret one spread away from being one of the fields.
 */
export async function consoleReport(db: Db, session: ConsoleSession): Promise<ConsoleReport> {
	const [sites, profile] = await Promise.all([readSites(db), readOrgProfile(db)]);

	return {
		sites,
		org: profile === null ? null : toFormValues(profile),
		// a bare global with nothing to import, the way the generated bindings are: the build
		// replaces it (`versionDefine` in `packages/app/version-define.ts`), and a checkout build
		// leaves it `null`.
		version: __BETTER_GIVING_VERSION__,
		// ISO 8601 rather than the epoch seconds the token carries: the envelope is read by a
		// console deciding when to warn, and a string that says what it is beats a number whose
		// unit has to be known.
		session: { expiresAt: session.expiresAt.toISOString() }
	};
}
