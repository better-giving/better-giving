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
 * asking it for a different processor gets a refusal rather than this port, because that is what a
 * deployment holding one processor's credentials answers — a helper that handed the same port back
 * under every name would turn the rail-to-processor table into something no case could catch.
 */
export function soleProcessor(provider: PaymentProvider): Processors {
	return processorsOf(provider);
}

/**
 * the set a deployment holding one port per processor resolves to, in the order they are given.
 *
 * what {@link soleProcessor} is over more than one, and the one thing a case covering an
 * intersection needs: `offeredCadences` in ../forms/offered-cadences.ts offers a cadence only where
 * every configured processor can collect it, so a case about that claim has to hand over a set
 * whose processors disagree.
 *
 * each port answers under its own `PaymentProvider.processor` and every other name gets a refusal,
 * which is the rule the single-port case is written under and the reason neither takes a name
 * beside the port: a helper that let a case pair a port with some other processor would make a spec
 * that cannot be wrong.
 */
export function processorsOf(...providers: readonly PaymentProvider[]): Processors {
	const held = new Map(providers.map((provider) => [provider.processor, provider]));
	const portFor = (name: ProcessorName) => held.get(name) ?? absent(name);
	return {
		configured: [...held.keys()],
		for: portFor,
		forRail: (rail) => portFor(processorOf(rail)),
		// nothing is unset on a processor this set holds a port for, and every credential is on any
		// other — which is what a deployment holding those processors' keys answers. the names are
		// the factory's and this helper reads none, so a case asserting on them is asserting on a
		// deployment rather than on a spec's own list.
		unset: (name) => (held.has(name) ? [] : requiredCredentials(name))
	};
}

/** what a processor this set holds no port for answers, in the shape the factory's own refusal has. */
function absent(name: ProcessorName): PaymentProvider {
	return refusing(name, 'not_configured', `this spec holds no ${name} port.`);
}
