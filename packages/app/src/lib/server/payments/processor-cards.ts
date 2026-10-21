import { PAYMENT_METHOD_LABELS } from '@better-giving/form/v1';
import { OFFERED_PAYMENT_METHODS } from '$lib/forms/offered-rails';
import { type ConfigEnv, readConfigEnv } from '../config/env';
import { chargingProcessors } from '../config/readiness';
import type { Db } from '../db/client';
import { ipnHasSettledAGift } from '../donations/pending-crypto-read';
import { railNotes } from '../forms/rail-notes';
import { createPaymentProviders } from './factory';
import { PAYPAL_US_FEE_RULES_CHARITY, paypalFeeRules } from './fees';
import {
	PROCESSOR_LABELS,
	PROCESSOR_NAMES,
	type PaymentProvider,
	type ProcessorName,
	type RecurringGiftStanding,
	takesRepeatingGifts
} from './provider';
import { railEvidence } from './rail-evidence';
import {
	type RailChargeability,
	type RailStanding,
	readRailChargeability
} from './rail-chargeability';
import { readRecurringProvision } from './recurring-provision';
import { readWalletDomains, type WalletDomainsReading } from './wallet-domains';
import { walletHosts } from './wallet-hosts';
import { webhookAddress } from './webhook-address';
import { readWebhookRegistration, type WebhookRegistration } from './webhook-registration';
import { type WebhookSecretStanding, webhookSecretStanding } from './webhook-secret';

// where every payment processor this deployment holds keys for stands, as the dashboard's Payments
// screen draws it (../../../routes/_app.admin.payments.tsx): one card per processor, and the rest
// named as not set up.
//
// every reading goes through the payment port with the deployment's own keys — ./rail-chargeability.ts,
// ./webhook-registration.ts, ./wallet-domains.ts and ./recurring-provision.ts — and is folded here
// into what a card says. nothing is written down: every fact is on somebody else's account, and a
// copy in a row would be a claim nothing here could tell had changed.
//
// **a read that could not be made is a state of its card and never of the page.** each card
// carries the reads it lost and the port's sentence for the first of them, and every other card,
// and every other reading on that card, is drawn as it came back.

/** a processor this deployment holds no keys for, under the name an operator knows it by. */
export type UnsetProcessor = { readonly processor: ProcessorName; readonly label: string };

/** one way of paying on a card's ledger. */
export type RailRow = {
	readonly rail: string;
	readonly label: string;
	readonly standing: RailStanding;
	/** the deployment's own sentence about the standing (../forms/rail-notes.ts), or `null`. */
	readonly note: string | null;
};

/**
 * whether the processor is telling this deployment a gift was paid.
 *
 *   working     — the value that verifies a notice is in `.env`, and nothing read off the account
 *                 says a notice is not arriving. on a processor that keeps no endpoint, a notice
 *                 that value verified has settled a gift here.
 *   unconfirmed — the value is set on a processor that keeps no endpoint, and no notice it
 *                 verified has settled a gift here yet: nothing on the account says whether it is
 *                 the one the processor signs with.
 *   unset       — that value is not in `.env`, so every notice is turned away whatever the
 *                 account holds.
 *   failing     — the value is set and the account holds no endpoint at this address, holds one
 *                 that is switched off or short of an event, or holds one created with another
 *                 secret.
 */
export type NoticesStanding = 'working' | 'unconfirmed' | 'unset' | 'failing';

/** whether Link is drawn on every hostname this deployment wants wallet buttons on. */
export type LinkStanding = 'everywhere' | 'not_everywhere';

/** the reads a card could not make, said once, and the port's sentence for the first of them. */
export type Unreadable = { readonly says: readonly string[]; readonly detail: string };

/** one processor's card. `null` on a member is that reading having nothing to draw. */
export type ProcessorCard = {
	readonly processor: ProcessorName;
	readonly label: string;
	readonly unreadable: Unreadable | null;
	/**
	 * the ledger under Donation methods. every offered rail the account answered for where the
	 * processor publishes an approval per rail; only the rails short of approval where it publishes
	 * none, since an approval there is the keys working and says nothing about the rail
	 * (./rail-evidence.ts). `null` where there is no row to draw.
	 */
	readonly rails: readonly RailRow[] | null;
	readonly link: LinkStanding | null;
	readonly notices: NoticesStanding | null;
	/**
	 * whether the account lists an endpoint at this deployment's address, which is what decides
	 * whether a repair keeps the endpoint or registers one. `null` on a processor that keeps none, and
	 * where the account could not be read.
	 */
	readonly endpointListed: boolean | null;
	/** what repeating gifts are collected against. `null` for a processor that takes none. */
	readonly recurring: RecurringGiftStanding | null;
	/**
	 * whether a donor covering PayPal's fee is quoted its charity rate, read the way the quote reads
	 * it (`paypalFeeRules` in ./fees.ts). `null` on every other processor, which has one rate.
	 */
	readonly charityRate: boolean | null;
};

export type PaymentsScreen = {
	readonly cards: readonly ProcessorCard[];
	readonly others: readonly UnsetProcessor[];
};

/**
 * every card, changing nothing.
 *
 * set up is the charge pair in `.env` (`chargingProcessors` in ../config/readiness.ts), the same
 * reading the setup line and the forms' go-live block take, so this screen and the block that links
 * here never disagree about whether a processor is there. a pair the factory will not build a client
 * from is still a card: its reads come back refused with the factory's sentence naming the value.
 *
 * the processors are read together and so are the reads inside each, because none waits on
 * another's answer and an operator is holding the screen open.
 */
export async function readPaymentsScreen(
	env: unknown,
	db: Db,
	requestUrl: string
): Promise<PaymentsScreen> {
	const config = readConfigEnv(env);
	const charging = chargingProcessors(config);
	const processors = createPaymentProviders(env);
	// the address a processor answers this deployment on is the request's own: no hostname is
	// committed to this repository (AGENTS.md).
	const origin = new URL(requestUrl).origin;
	const asked = await walletHosts(db, requestUrl);

	return {
		cards: await Promise.all(
			charging.map((name) =>
				readCard(env, config, db, name, processors.for(name), origin, asked.hosts)
			)
		),
		others: PROCESSOR_NAMES.filter((name) => !charging.includes(name)).map((processor) => ({
			processor,
			label: PROCESSOR_LABELS[processor]
		}))
	};
}

async function readCard(
	env: unknown,
	config: ConfigEnv,
	db: Db,
	processor: ProcessorName,
	provider: PaymentProvider,
	origin: string,
	hosts: readonly string[]
): Promise<ProcessorCard> {
	const confirmation = NOTICES_CONFIRMED_BY[processor];
	const [chargeability, registration, domains, recurring, confirmed] = await Promise.all([
		readRailChargeability(provider),
		readWebhookRegistration(provider, webhookAddress(processor, origin)),
		readWalletDomains(provider, hosts),
		takesRepeatingGifts(processor) ? readRecurringProvision(provider) : null,
		confirmation === 'endpoint' ? null : confirmation(db)
	]);
	const secret = await webhookSecretStanding(env, processor, registration);

	const rails = chargeability.state === 'read' ? railRows(processor, chargeability) : [];

	const label = PROCESSOR_LABELS[processor];
	const notices = noticesStanding(secret, registration, confirmed);

	// in the order the card draws them, so the sentence names them as a reader meets them.
	const lost: { says: string; detail: string }[] = [];
	if (chargeability.state === 'unreadable') {
		lost.push({ says: 'which ways of paying it can take', detail: chargeability.detail });
	}
	if (domains.state === 'unreadable') {
		lost.push({ says: 'which sites draw wallet buttons', detail: domains.detail });
	}
	if (notices === null && registration.state === 'unreadable') {
		lost.push({
			says: `whether ${label} is telling it when a gift is paid`,
			detail: registration.detail
		});
	}
	if (recurring?.state === 'unreadable') {
		lost.push({ says: 'whether repeating gifts are set up', detail: recurring.detail });
	}
	const [first] = lost;

	return {
		processor,
		label,
		// the first read's sentence, which is the account-level one where more than one failed and
		// so the one whose cause the others inherit.
		unreadable:
			first === undefined ? null : { says: lost.map((one) => one.says), detail: first.detail },
		rails: rails.length === 0 ? null : rails,
		link: linkStanding(domains),
		notices,
		endpointListed:
			confirmation !== 'endpoint' || registration.state === 'unreadable'
				? null
				: registration.state === 'registered',
		recurring: recurring === null || recurring.state === 'unreadable' ? null : recurring.state,
		charityRate:
			processor === 'paypal' ? paypalFeeRules(config) === PAYPAL_US_FEE_RULES_CHARITY : null
	};
}

/**
 * the offered rails the account answered for, in a donor's own order ($lib/forms/offered-rails.ts),
 * each with the deployment's sentence about its standing (../forms/rail-notes.ts) — and of those,
 * only the ones short of approval where the processor publishes no approval per rail.
 */
function railRows(
	processor: ProcessorName,
	chargeability: Extract<RailChargeability, { state: 'read' }>
): RailRow[] {
	const notes = railNotes(processor, chargeability);
	const perRail = railEvidence(processor) === 'per_rail_approval';
	return OFFERED_PAYMENT_METHODS.flatMap((rail): RailRow[] => {
		const standing = chargeability.rails[rail];
		if (standing === undefined || (!perRail && standing === 'approved')) return [];
		return [{ rail, label: PAYMENT_METHOD_LABELS[rail], standing, note: notes[rail] ?? null }];
	});
}

/**
 * Link's reach, off the hostnames the account was asked about: drawn on one only where it is
 * registered there, honoured and Link is active on it.
 *
 * no hostname at all is `not_everywhere` and never `everywhere` — `every` over an empty list is
 * true, and a tick over sites nobody asked about is the opposite of what is so.
 */
function linkStanding(domains: WalletDomainsReading): LinkStanding | null {
	if (domains.state !== 'read') return null;
	const drawn = domains.hosts.every(
		(host) => host.state === 'registered' && host.drawing && host.wallets.link.state === 'active'
	);
	return domains.hosts.length > 0 && drawn ? 'everywhere' : 'not_everywhere';
}

/**
 * what says the processor's notices reach this deployment: the endpoint read off the account, or,
 * for a processor that keeps none, a read of this deployment's own rows for a notice that verified.
 *
 * NOWPayments keeps none: every payment carries its own callback address (./nowpayments.ts), so an
 * endpoint reading for it has no object, and no read of the account hands back the IPN secret to
 * compare. a gift a verified IPN settled is the proof (`ipnHasSettledAGift` in
 * ../donations/pending-crypto-read.ts).
 *
 * total over `ProcessorName`, so a processor added without an entry is a compile error rather than
 * a card reading a missing endpoint as a fault, or a set value as working.
 */
const NOTICES_CONFIRMED_BY: Readonly<
	Record<ProcessorName, 'endpoint' | ((db: Db) => Promise<boolean>)>
> = {
	stripe: 'endpoint',
	paypal: 'endpoint',
	chariot: 'endpoint',
	nowpayments: ipnHasSettledAGift
};

/**
 * the notices standing, most basic fault first, or `null` where the account could not be read —
 * which the card says once among the reads it lost.
 *
 * an unset value is answered before anything on the account is looked at, because no endpoint makes
 * up for it. `confirmed` is the read of this deployment's rows on a processor that keeps no
 * endpoint (`NOTICES_CONFIRMED_BY` above), and `null` on every other.
 */
function noticesStanding(
	secret: WebhookSecretStanding,
	registration: WebhookRegistration,
	confirmed: boolean | null
): NoticesStanding | null {
	if (secret.state === 'unset') return 'unset';
	if (confirmed !== null) return confirmed ? 'working' : 'unconfirmed';
	if (registration.state === 'unreadable') return null;
	if (registration.state === 'unregistered') return 'failing';
	if (secret.state === 'stale' || !registration.complete) return 'failing';
	return 'working';
}
