import type { Coin } from '@better-giving/operator/components/forms/CoinPicker';
import { CoinPicker } from '@better-giving/operator/components/forms/CoinPicker';

/*
 * the searchable coin list and the states nobody opens it in.
 *
 * the row is the specimen's whole point: a mark, the ticker on the first line and the network's
 * pill on the second, with the words starting at one x down the list whatever each mark drew. the
 * three fixtures below are the three marks — a logo that arrives, a coin whose listing carried
 * none, and a path that will never resolve — so the column offset is readable against all three at
 * once, and the broken one is the only way to see the fallback without switching a network off.
 *
 * the codes and the tickers are NOWPayments' own pairs, which is what makes the list worth
 * looking at: `usdc`, `usdcmatic` and `usdcsol` are three codes under one ticker and three
 * different pills, and `dai` is a coin NOWPayments names no ticker for, drawn as its code.
 *
 * the sentences are ../../../operator/src/components/forms/SelectWithNote.jsx's three registers,
 * unchanged: `hint` over the box, `error` under it, and `note` under that.
 *
 * the coin no longer offered is drawn chosen, because that is the only state it exists in: it is a
 * coin the deployment is holding that the account's own list came back without.
 *
 * the empty list is the state the console's payout box opens in — no key typed, so nothing to
 * choose between — and it is drawn with both the note that says why and the `disabled` that makes
 * it true.
 */
const COINS: readonly Coin[] = [
	{
		code: 'btc',
		ticker: 'btc',
		name: 'Bitcoin',
		network: 'btc',
		logo: 'https://nowpayments.io/images/coins/btc.svg'
	},
	{
		code: 'eth',
		ticker: 'eth',
		name: 'Ethereum',
		network: 'eth',
		logo: 'https://nowpayments.io/images/coins/eth.svg'
	},
	{ code: 'usdc', ticker: 'usdc', name: 'USD Coin', network: 'eth', logo: '' },
	{
		code: 'usdcmatic',
		ticker: 'usdc',
		name: 'USD Coin',
		network: 'matic',
		logo: 'https://nowpayments.io/images/coins/usdcmatic.svg'
	},
	{ code: 'usdttrc20', ticker: 'usdt', name: 'Tether', network: 'trx', logo: '' },
	{ code: 'usdcsol', ticker: 'usdc', name: 'USD Coin', network: 'sol', logo: '' },
	// a listed coin NOWPayments named no ticker for, which is the row's one fallback to the code.
	{ code: 'dai', ticker: '', name: 'Dai', network: 'eth', logo: '' },
	{
		code: 'sol',
		ticker: 'sol',
		name: 'Solana',
		network: 'sol',
		logo: 'https://nowpayments.io/images/coins/sol.svg'
	},
	{
		code: 'xmr',
		ticker: 'xmr',
		name: 'Monero',
		network: 'xmr',
		// a path that resolves to nothing, which is every way a picture fails to arrive: a request
		// refused, a file moved, a host this console cannot reach.
		logo: 'https://nowpayments.io/images/coins/no-such-coin.svg'
	},
	{
		code: 'arbeth',
		ticker: 'eth',
		name: 'Ethereum',
		network: 'arbitrum',
		logo: 'https://nowpayments.io/images/coins/eth.svg'
	}
];

/**
 * the stand-in the console builds for a stored value its listing does not name: a code, and nothing
 * else known about the coin, so the row falls back to it and draws no pill.
 */
const RETIRED: Coin = { code: 'lunc', ticker: '', name: 'lunc', network: '', logo: '' };

export default function FormsCoinPickerPreview() {
	return (
		<div className="adm-stack">
			<CoinPicker
				id="coins-plain"
				name="coin-plain"
				label="Payout currency"
				options={COINS}
				placeholder="Choose a coin"
			/>
			<CoinPicker
				id="coins-chosen"
				name="coin-chosen"
				label="Payout currency"
				options={COINS}
				defaultValue="usdcmatic"
				hint="Must match the outcome wallet set in your NOWPayments dashboard."
			/>
			<CoinPicker
				id="coins-retired"
				name="coin-retired"
				label="Payout currency"
				options={COINS}
				retired={RETIRED}
				defaultValue="lunc"
				placeholder="Choose a coin"
			/>
			<CoinPicker
				id="coins-error"
				name="coin-error"
				label="Payout currency"
				options={COINS}
				placeholder="Choose a coin"
				error="Not a coin NOWPayments offers."
			/>
			<CoinPicker
				id="coins-both"
				name="coin-both"
				label="Payout currency"
				options={COINS}
				placeholder="Choose a coin"
				error="Not a coin NOWPayments offers."
				note="A coin added to your account in the last minute may not be here yet."
			/>
			<CoinPicker
				id="coins-marked"
				name="coin-marked"
				label="Payout currency"
				options={COINS}
				placeholder="Choose a coin"
				aria-invalid="true"
			/>
			<CoinPicker
				id="coins-refused"
				name="coin-refused"
				label="Payout currency"
				placeholder="Choose a coin"
				note="NOWPayments turned that key down, so it lists no coins."
				disabled
			/>
			<CoinPicker
				id="coins-empty"
				name="coin-empty"
				label="Payout currency"
				placeholder="Choose a coin"
				note="Paste your API key to choose a coin."
				disabled
			/>
			<CoinPicker
				id="coins-held-disabled"
				name="coin-held-disabled"
				label="Payout currency"
				options={[{ code: 'usdcmatic', ticker: '', name: 'usdcmatic', network: '', logo: '' }]}
				defaultValue="usdcmatic"
				note="This NOWPayments account has no coin it can be paid out in."
				disabled
			/>
			<CoinPicker
				id="coins-hover"
				name="coin-hover"
				label="hover"
				options={COINS}
				placeholder="Choose a coin"
				state="hover"
			/>
			<CoinPicker
				id="coins-focus"
				name="coin-focus"
				label="focus"
				options={COINS}
				placeholder="Choose a coin"
				state="focus"
			/>
		</div>
	);
}
