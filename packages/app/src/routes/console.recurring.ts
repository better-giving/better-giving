import type {
	ProcessorRecurring,
	ProcessorRecurringSetup,
	RecurringReport,
	RecurringSetupReport
} from '@better-giving/operator/console/recurring';
import { consoleJson } from '$lib/server/console/surface';
import { createPaymentProviders, processorSetupFix } from '$lib/server/payments/factory';
import {
	PROCESSOR_LABELS,
	PROCESSOR_NAMES,
	type ProcessorName
} from '$lib/server/payments/provider';
import {
	readRecurringProvisions,
	setUpRecurringGiftsOn
} from '$lib/server/payments/recurring-provision';
import { platform } from '../context';
import type { Route } from './+types/console.recurring';

// where this deployment stands on gifts that repeat, and the one press that puts it there.
//
// on the same surface and behind the same check as the report: the check is the `middleware` on
// ./console.ts and this file makes no decision about who may read or press — see the header there,
// and $lib/server/console/surface.ts for what this surface owes.
//
// **it is here rather than in the console because only this deployment holds the keys.** the read
// and the press both go through the payment port with this deployment's own credentials, which are
// deploy-time and live under `$lib/server/**` (CLAUDE.md). that is the asymmetry with setting a
// processor up in the first place: that press calls the processor with a key an operator has just
// pasted, because there is nothing on the deployment yet to ask; by the time this one is pressed
// there is.
//
// **the read answers for every processor this deployment holds a key for, and for no other**, and
// so does a press that names none. both adapters take the repeating arms, so a press fixed on
// one processor would leave a deployment set up on the other with nothing that could move its real
// account — and a standing reported for an account this deployment holds no key for would be a row
// drawn over boxes nobody has filled. which of the two a processor is in is `Processors.configured`
// in $lib/server/payments/factory.ts, read through the same entry point the port's own refusal is
// decided by, so the two can never mean different deployments.
//
// **the press is one press, and the body it takes is the one account it is about.** a press naming
// nothing sets up every configured processor that needs it, because a donor is offered a repeating
// gift only where every configured processor can collect one ($lib/forms/offered-cadences.ts) — so
// there is no state between them an operator would ever want to choose, and the console's button
// names nothing. the report carries an outcome per account and one word over the whole, which
// $lib/server/payments/recurring-provision.ts decides.
//
// **what names one is a caller pressing seconds after it stored that processor's credentials.**
// which accounts this deployment counts as configured is read off the values it is serving, and a
// credential stored moments ago is not among them yet — so a press naming none would act on every
// account but the one it was made for and report the run finished having never asked about it.
// named, that account is asked whatever the values say, and the refusal that comes back names the
// variable and carries the reason a caller waits on. that reason is the answer's, not the sentence's:
// a caller matching a fragment of prose is matching one that names a single processor's variable.
//
// **a press that would act on no account at all is refused rather than reported.** every line of the
// report is an account, so a report of none is a finished-looking answer about nothing — and what a
// press naming nothing on a deployment holding no credentials would otherwise answer is a refusal
// per processor about values nobody has begun setting.
//
// **the read is the port's read arm and never the find-or-create one.** `prepareRecurringGifts`
// makes what the account is missing, so a screen drawn from it would provision an operator's
// account as a side effect of them opening a page. the two are told apart in
// $lib/server/payments/recurring-provision.ts and neither decision is restated here.
//
// **this is a block and never a member of the report.** a deployment that only ever wants one-time
// gifts is not incomplete, so it answers on its own address and must not join the envelope — the
// folds on the console are the run an operator works down until it is clear, and one for this would
// be a permanent unfinished item on every fork that never offers a monthly gift.
//
// **the read is a GET and the press is a POST, on one address.** the surface's other two writes
// answer a GET with a 405 because their read is the report; this one has a read of its own, and it
// is the same question the press is about. the read takes no body and reports every account: what
// one holds is found by an id this app derives, so there is nothing for a reader to name.
//
// nothing is written down here. what an account holds is read fresh every time, because it lives on
// somebody else's account and a copy in a row would be a claim about a third party's state that
// nothing in this deployment could ever be told had changed.

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	const named = await namedProcessor(request);
	if (!named.ok)
		return consoleJson({ error: named.error, message: named.message, fix: PRESS_BODY_FIX }, 400);

	const processors = createPaymentProviders(context.get(platform).env);
	const run = await setUpRecurringGiftsOn(processors, named.processor);

	// nothing to act on is the deployment's own state rather than a value the request got wrong, and
	// a 409 is what says so: nothing failed, so it is no 500, and no body a caller could send moves
	// it. what does is on the `fix`, which is where each processor's credentials come from.
	if (!run.acted)
		return consoleJson(
			{
				error: 'nothing_to_set_up',
				message:
					'This deployment holds no payment processor credentials, so there is no account to set ' +
					'repeating gifts up on.',
				fix: processorSetupFix(PROCESSOR_NAMES)
			},
			409
		);

	const report: RecurringSetupReport = {
		outcome: run.outcome,
		processors: PROCESSOR_NAMES.flatMap((processor): ProcessorRecurringSetup[] => {
			const setup = run.setups[processor];
			if (setup === undefined) return [];
			return [{ processor, label: PROCESSOR_LABELS[processor], ...setup }];
		})
	};

	// a hole in the deployment and a refusal from the processor are both 500s rather than 400s, for
	// the same reason: no value a caller could send fixes either.
	return consoleJson(report, report.outcome === 'failed' ? 500 : 200);
}

/**
 * where every account this deployment can reach stands, changing nothing.
 *
 * a read that could not be made is a state and a 200 rather than a failure of the request: it says
 * nothing about what the account holds, and it carries the sentence that names the value to fix. a
 * processor this deployment holds no key for carries no reading at all, which is the arm above that
 * one — `packages/operator/src/console/recurring.ts` states what each means to the screen.
 *
 * the accounts are read together, and each reading is its own: one processor nobody could reach
 * must never be reported as an answer about another.
 */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
	const processors = createPaymentProviders(context.get(platform).env);
	const provisions = await readRecurringProvisions(processors);

	const report: RecurringReport = {
		processors: PROCESSOR_NAMES.flatMap((processor): ProcessorRecurring[] => {
			const reading = provisions[processor];
			if (reading === undefined) return [];
			return [{ processor, label: PROCESSOR_LABELS[processor], reading }];
		})
	};

	return consoleJson(report);
}

/** what the press names, or why the body naming it could not be read. */
type NamedProcessor =
	| { readonly ok: true; readonly processor: ProcessorName | null }
	| { readonly ok: false; readonly error: string; readonly message: string };

/** where a caller reads what this press takes, on every refusal of a body. */
const PRESS_BODY_FIX =
	'Send `{ "processor": "stripe" }` or `{ "processor": "paypal" }` to act on that account, or ' +
	'no body at all to act on every processor this deployment holds credentials for.';

/**
 * the account this press is about, or `null` where it names none.
 *
 * a name no processor answers to is refused rather than dropped: a press that fell back to every
 * account over a misspelling would be the caller that names one getting the press it cannot have.
 */
async function namedProcessor(request: Request): Promise<NamedProcessor> {
	// the request body is read exactly once, here, by the endpoint that owns it (CLAUDE.md).
	const sent = await request.text();
	// no body at all is a press naming none, which is what this address took before it took a name
	// and what a `curl -X POST` against it still sends.
	if (sent.trim() === '') return { ok: true, processor: null };

	let body: unknown;
	try {
		body = JSON.parse(sent);
	} catch {
		return { ok: false, error: 'bad_body', message: 'The request body is not JSON.' };
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body))
		return { ok: false, error: 'bad_body', message: 'The request body is not a JSON object.' };

	// null and absent are one request: a caller that sends the name it is holding rather than leaving
	// the key out is not pressing about a different account.
	const named = (body as Record<string, unknown>).processor;
	if (named === undefined || named === null) return { ok: true, processor: null };

	const processor = PROCESSOR_NAMES.find((name) => name === named);
	if (processor === undefined)
		return {
			ok: false,
			error: 'bad_processor',
			message: '`processor` is not a processor this deployment can charge on.'
		};
	return { ok: true, processor };
}
