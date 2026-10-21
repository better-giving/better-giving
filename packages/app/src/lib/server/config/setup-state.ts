import type { Db } from '../db/client';
import type { OrgProfile } from '../db/schema';
import { readStaffCredential } from '../auth/credential';
import { readAuthEnv } from '../auth/env';
import { readOrgProfile } from '../org/queries';
import { readConfigEnv } from './env';
import type { SetupLine } from './readiness';
import { setupReadiness } from './readiness';

// the five jobs read off this running deployment, and the organisation's row they are read from.
//
// **a read that did not land answers `null`.** the five are a reading of rows and values, and the
// row is also where everything that names this deployment takes the registered name from — the
// protected layout's identity band (../../../routes/_app.tsx), and the screens and mail outside
// it. a throw there would replace those screens with a bare error on exactly the deployment whose
// database is not answering, so the failure is logged and each caller goes on without the name.

/** the five, and the row this deployment is named from. `null` where a read threw. */
export type SetupState = {
	readonly lines: SetupLine[];
	readonly profile: OrgProfile | null;
};

export async function readSetupState(db: Db, env: unknown): Promise<SetupState | null> {
	let profile: OrgProfile | null;
	try {
		// one row and one round trip, on a read every screen behind the sign-in pays for.
		profile = await readOrgProfile(db);
	} catch (e) {
		console.error('reading the organisation profile failed:', e);
		return null;
	}

	return {
		lines: setupReadiness({
			// the same reader the sign-in path asks, rather than a second opinion about the same
			// value: a password this deployment will not authenticate against is a job that is not
			// done.
			password: readStaffCredential(readAuthEnv(env)).ok,
			profile,
			config: readConfigEnv(env)
		}),
		profile
	};
}
