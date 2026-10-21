import { Banner } from '@better-giving/operator/components/status/Banner';
import type { ReactNode } from 'react';
import { href, Link } from 'react-router';
import type { FormReadinessJob, FormReadinessLine } from '$lib/forms/readiness';

// what stands between this deployment and a donor giving, on the two screens that write: the one
// that makes a form and the one that publishes one. it holds no state and reaches no server —
// everything it renders arrives as a prop.
//
// it sits under `$lib/admin/` rather than beside either route because both mount it, and every file
// directly under `src/routes/` is an address to `flatRoutes`.
//
// it is mounted directly under the screen's heading and never above it. above the heading a screen
// outlines as this block and then its own h1, so a reader jumping to the page's heading lands past
// the block they most needed to read. under the heading it is still the first thing in the body of
// the page, which is the whole of what standing above the h1 buys.
//
// the forms list does not carry it and must not. that screen writes nothing, so it gates nothing,
// and a standing account of the deployment repeated over a list an operator is only reading is a
// second place to read the same thing — with two chances to word it differently.
//
// the facts are the deployment's rather than any one form's — without the identity fields or a
// processor's keys `publishedConfig` serves no form at all. that is why one block can say this on
// both screens without either of them wording it for itself.
//
// **every blocker is one band.** the blockers are one question — can a donor give through this
// form — so they are one list under one title. a missing notice value blocks. where the processor
// line blocks too, no form is served (`servedProcessors` in `$lib/server/payments/factory.ts`
// requires the notice value as well as the charge keys) and a gift is not charged. the processor
// sentence names the deployment with no charge keys. those keys are set when the notices line
// blocks, so that sentence is not drawn beside it.
//
// a resolved line is not drawn. `$lib/server/forms/readiness.ts` keeps it in the list beside an
// unresolved one, and answers `null` once every line is resolved, so this renders nothing when there
// is nothing to say and a caller states no condition of its own around it.

/** which of the two screens that write a form this block stands on. */
export type FormsReadinessContext = 'new' | 'form';

/**
 * what the blockers' band is titled on each screen, and in which tone.
 *
 * on the form page a blocker is what stops the press an operator came to make, so it is the blocker
 * tone. on the new form nothing is stopped: the form is saved, as a draft, so the band is attention
 * and its title says what will happen rather than what cannot.
 */
const BLOCKED: Record<FormsReadinessContext, { tone: 'blocker' | 'attention'; title: string }> = {
	form: { tone: 'blocker', title: 'This form can’t go live yet' },
	new: { tone: 'attention', title: 'This form will be saved as a draft' }
};

// the page that says what to ask whoever set up this site for.
const PAYMENTS = href('/admin/payments');

/**
 * each job's sentence, worded for who is reading.
 *
 * the person who deployed the site can open the page each one is settled from, so theirs links
 * there; a member can open neither, so theirs names who to ask and links nowhere — a link to a
 * screen that refuses them is a press with one answer. a processor's keys and its notices secret
 * are environment variables (AGENTS.md → Boundaries), so the Payments page says what to ask for
 * rather than holding a box.
 */
const SENTENCES: Record<FormReadinessJob, (deployer: boolean) => ReactNode> = {
	organisation: (deployer) =>
		deployer ? (
			<>
				Receipts need the organisation’s EIN and registered name. Add them in{' '}
				<Link to={href('/admin/settings')}>Settings</Link>.
			</>
		) : (
			'Receipts need the organisation’s EIN and registered name, which only the person who ' +
			'deployed this site can add. Ask them to add it in Settings.'
		),
	processor: (deployer) =>
		deployer ? (
			<>
				No payment processor is set up, so no gift can be charged.{' '}
				<Link to={PAYMENTS}>Payments</Link> says what to ask whoever set up this site.
			</>
		) : (
			'No payment processor is set up, so no gift can be charged. Ask whoever set up this site ' +
			'to add one.'
		),
	notices: (deployer) =>
		deployer ? (
			<>
				{'Payment notices aren’t set up, so a gift couldn’t be marked paid. The form stays offline ' +
					'until they are. '}
				<Link to={PAYMENTS}>Payments</Link> says what to ask whoever set up this site.
			</>
		) : (
			'Payment notices aren’t set up, so a gift couldn’t be marked paid. The form stays offline ' +
			'until they are. Ask whoever set up this site to set it up.'
		)
};

type FormsReadinessProps = {
	/**
	 * the lines as `formsReadiness` in `$lib/server/forms/readiness.ts` wrote them.
	 *
	 * the vocabulary is `$lib/forms/readiness.ts`, which both a component and that module may
	 * import; the module itself lives under `$lib/server/**` and a component may not reach it.
	 */
	readonly lines: readonly FormReadinessLine[] | null;
	/** whether the viewer deployed the site, which is who each sentence is worded for. */
	readonly deployer: boolean;
	readonly context: FormsReadinessContext;
};

export function FormsReadiness({ lines, deployer, context }: FormsReadinessProps) {
	if (!lines) return null;

	const blockers = lines.filter((line) => line.severity === 'blocker');
	const drawn = blockers.some((line) => line.job === 'notices')
		? blockers.filter((line) => line.job !== 'processor')
		: blockers;
	const blocked = BLOCKED[context];

	return (
		<>
			{drawn.length > 0 ? (
				<Banner
					tone={blocked.tone}
					word={blocked.title}
					body={
						<ul className="adm-banner__list">
							{drawn.map((line) => (
								<li key={line.job}>{SENTENCES[line.job](deployer)}</li>
							))}
						</ul>
					}
				/>
			) : null}
			{/* outside the band rather than in it: it is what the screen does about the band, which
			    the status box below already acts on by offering Draft alone. */}
			{drawn.length > 0 && context === 'new' ? (
				<p className="adm-hint">It can go live once the items above are done.</p>
			) : null}
		</>
	);
}
