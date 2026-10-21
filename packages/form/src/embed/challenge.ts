// which anti-abuse check a donation form runs, read off its served config: ALTCHA where the config
// names `altchaChallengeUrl`, Turnstile otherwise. a deployment serves exactly one of the two
// (`FormConfig.altchaChallengeUrl` in ../v1.ts), and the endpoint verifies whichever it served.
//
// `../../package.json` exports this module as `./embed/challenge`, for the deployment's own
// donation page to switch the way the embedded runtime (./runtime.ts) does rather than answer the
// question a second time.

import type { Failure } from '../checkout.machine';
import type { FormChallenge } from '../element';
import type { FormConfig } from '../v1';
import { createAltchaChallenge, type AltchaSeam } from './altcha';
import { createChallenge as createTurnstileChallenge, type ChallengeSeam } from './turnstile';

export type ChallengeSeams = {
	readonly turnstile?: ChallengeSeam;
	readonly altcha?: AltchaSeam;
};

export type ChallengeOptions = {
	/**
	 * the address the config was read from, which the served challenge path is resolved against.
	 *
	 * required rather than defaulted to the page's own address: on a host's page that is a stranger's
	 * site, and the challenge is the deployment's.
	 */
	readonly configUrl: string;
	/** the widget entering interactive mode and leaving it; a Turnstile widget alone says either. */
	readonly onInteractive?: (needed: boolean) => void;
	readonly seam?: ChallengeSeams;
};

/** the check the config names, started; its token travels out through `onToken` either way. */
export function createChallenge(
	config: FormConfig,
	mount: HTMLElement,
	onToken: (token: string) => void,
	onUnavailable: (failure: Failure) => void,
	options: ChallengeOptions
): FormChallenge {
	if (config.altchaChallengeUrl !== undefined) {
		const url = new URL(config.altchaChallengeUrl, options.configUrl).href;
		return createAltchaChallenge(url, onToken, onUnavailable, options.seam?.altcha);
	}
	return createTurnstileChallenge(
		config,
		mount,
		onToken,
		onUnavailable,
		options.seam?.turnstile,
		options.onInteractive
	);
}
