import type { FormReadinessLine } from '$lib/forms/readiness';
import type { ConfigEnv } from '../config/env';
import { chargingProcessors } from '../config/readiness';
import type { OrgProfile } from '../db/schema';
import { identityMissing } from '../org/identity';
import { servedProcessors } from '../payments/factory';
import { noticeVariable } from '../payments/webhook-secret';

// what stands between this deployment and a donor giving through one of its forms, as the block
// at the top of the two screens that write a form renders it — the one that makes one and the one
// that publishes one. the forms list writes nothing and carries no block, so it does not call
// this; those two routes and the Live check behind them are its callers.
//
// presence of a row's columns and of deploy-time values, and the shape a processor's values have
// to take, and nothing past it: no processor is asked anything, for the reason `setupReadiness` in
// ../config/readiness.ts asks none. a line names a job and how it stands, and the screen words it
// (`FORM_READINESS_JOBS` in `$lib/forms/readiness.ts`).
//
// the organisation and processor lines are the two `publishedConfig` in ./published-config.ts
// refuses to serve without, which is what makes them blockers here. the processor line reads the
// answer that refusal reads, `servedProcessors` in ../payments/factory.ts, so a value set in a
// shape no call can use (an unparseable `PAYPAL_API_URL`) blocks Live rather than being accepted
// and serving nothing.

/**
 * the organisation's identity: `identityMissing` in ../org/identity.ts, the same list of fields the
 * screen holding those boxes puts on them.
 */
function organisationLine(profile: OrgProfile | null): FormReadinessLine {
	return {
		job: 'organisation',
		severity: identityMissing(profile).length === 0 ? 'resolved' : 'blocker'
	};
}

/**
 * what stops this deployment's donation forms, or `null` when nothing is.
 *
 * `null` rather than a list of resolved lines, because the block is not rendered at all when
 * everything is done. a resolved line does stay in the list while any sibling is unresolved — see
 * `FormReadinessLine`.
 *
 * the notices line is drawn only once some processor can serve a form, and asks only about those:
 * before that it is a question about a processor nobody has set up, and the processor line already
 * stands. a processor whose charge pair is set and whose values are usable is exactly one a form is
 * served on (`ServedProcessors` in ../payments/factory.ts).
 */
export function formsReadiness(
	profile: OrgProfile | null,
	config: ConfigEnv
): FormReadinessLine[] | null {
	const served = servedProcessors(config);
	const lines: FormReadinessLine[] = [
		organisationLine(profile),
		{ job: 'processor', severity: served.serves ? 'resolved' : 'blocker' }
	];
	if (served.serves) {
		const serving = chargingProcessors(config).filter((name) => served.configured.includes(name));
		const unheard = serving.some((processor) => config[noticeVariable(processor)] === undefined);
		lines.push({ job: 'notices', severity: unheard ? 'warning' : 'resolved' });
	}
	return lines.every((line) => line.severity === 'resolved') ? null : lines;
}
