import { processorOf, refusing, type PaymentProvider, type ProcessorName } from './provider';
import { requiredCredentials, type Processors } from './factory';

// what a spec needs to hand a `Processors` to something that takes one, when the thing it is
// actually driving is a single port.
//
// not a spec itself — no pool's `include` matches this name, which is what keeps it a module the
// specs import rather than a third file of tests. it builds nothing a deployment would build:
// `createPaymentProviders` in ./factory.ts reads the platform env and decides what a deployment can
// charge on, and that decision is what ./factory.spec.ts covers. what is here is the other half —
// every consumer above the factory takes the set as an argument so that a case can drive an arm of
// `PaymentResult` with no env, no account and no network, and this is the argument.

/**
 * the set a deployment holding exactly one processor resolves to, over a port a spec built.
 *
 * the processor is read off the port rather than taken beside it, which is the same rule the app
 * follows: `PaymentProvider.processor` in ./provider.ts is what a row is written with and what a
 * standing is reported for, so a helper that let a case pair a port with some other name would make
 * a spec that cannot be wrong.
 *
 * asking it for a different processor gets a refusal rather than this port, because that is what a
 * deployment holding one processor's credentials answers — a helper that handed the same port back
 * under every name would turn the rail-to-processor table into something no case could catch.
 */
export function soleProcessor(provider: PaymentProvider): Processors {
	return {
		configured: [provider.processor],
		for: (name) => (name === provider.processor ? provider : absent(name)),
		forRail: (rail) => {
			const name = processorOf(rail);
			return name === provider.processor ? provider : absent(name);
		},
		// nothing is unset on the one processor this set holds a port for, and every credential is on
		// any other — which is what a deployment holding one processor's keys answers. the names are
		// the factory's and this helper reads none, so a case asserting on them is asserting on a
		// deployment rather than on a spec's own list.
		unset: (name) => (name === provider.processor ? [] : requiredCredentials(name))
	};
}

/** what a processor this set holds no port for answers, in the shape the factory's own refusal has. */
function absent(name: ProcessorName): PaymentProvider {
	return refusing(name, 'not_configured', `this spec holds no ${name} port.`);
}
