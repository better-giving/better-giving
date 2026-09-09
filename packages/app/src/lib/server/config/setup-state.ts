import type { Db } from '../db/client';
import type { OrgProfile } from '../db/schema';
import { readStaffCredential } from '../auth/credential';
import { readAuthEnv } from '../auth/env';
import { readOrgProfile } from '../org/queries';
import { readConfigEnv } from './env';
import type { SetupLine } from './readiness';
import { setupReadiness } from './readiness';

// the five jobs read off this running deployment, which is the one place either loader that gates
// on them gets them from.
//
// **two loaders and one read.** the sign-in screen and the layout every dashboard screen sits under
// both refuse to serve while set-up is unfinished — ../../../routes/login.tsx and
// ../../../routes/_app.tsx — and a deployment answering one of them differently from the other is
// an operator signing in to be told the same thing again in different words.
//
// **a read that did not land answers `null`, and a `null` gates nothing.** the five are a reading of
// rows and values; a database that would not answer found no job undone. gating on that would hide
// the screens that explain a database which is not answering, on exactly the deployment that needs
// them — so the failure is logged and both callers carry on serving.
//
// the profile comes back with the lines because both callers want the registered name off the same
// row: the sign-in screen names whose deployment this is, and the layout draws the identity band.

/** the five, and the row the two callers name this deployment from. `null` where a read threw. */
export type SetupState = {
	readonly lines: SetupLine[];
	readonly profile: OrgProfile | null;
};

export async function readSetupState(db: Db, env: unknown): Promise<SetupState | null> {
	let profile: OrgProfile | null;
	try {
		// one row and one round trip, on a read every screen behind either gate pays for.
		profile = await readOrgProfile(db);
	} catch (e) {
		console.error('reading what the set-up gate is drawn from failed:', e);
		return null;
	}

	return {
		lines: setupReadiness({
			// the same reader the sign-in path asks, rather than a second opinion about the same
			// value: a password this deployment will not authenticate against is a job that is not
			// done, and a line calling it done is the set-up gate standing aside for a sign-in
			// screen whose box can never succeed.
			password: readStaffCredential(readAuthEnv(env)).ok,
			profile,
			config: readConfigEnv(env)
		}),
		profile
	};
}
