import { majorText } from '../../forms/amounts';
import {
	failed,
	type AccountingFailure,
	type AccountingProvider,
	type AccountingResult,
	type CompanyIdentity,
	type ConnectionSnapshot,
	type ConnectionStore,
	type CorrectionRecord,
	type Donor,
	type GiftRecord,
	type LedgerAccount,
	type RemoteRecord,
	type TokenPair
} from './provider';

// the QuickBooks Online adapter: this deployment's books, posted into one company's.
//
// every call is `fetch` against Intuit's REST API with a bearer token. no Intuit package is
// installed and none may be — ./sole-importer.spec.ts keeps `intuit-oauth` and `node-quickbooks`
// out of the tree and this module is the one exemption, the same arrangement
// ../payments/nowpayments.ts stands in for NOWPayments.
//
// the wire this module speaks is its whole contract with Intuit, read from the Accounting API
// reference and the OAuth endpoints Intuit's own discovery document publishes
// (https://developer.api.intuit.com/.well-known/openid_configuration). nothing here has been run
// against a live company; the sandbox is a separate host and a separate company, chosen by which
// base url a deployment is built with.
//
// ---------------------------------------------------------------------------
// which record a gift becomes, and why it is not a sales receipt.
//
// a gift is a **Deposit** and a correction is a **JournalEntry**, and the reason for the first is
// that those are the two entities whose lines name an *account*. what this deployment holds for a
// company is three account ids an operator picked off their own chart — income, the processor's
// cut, and what the money landed in. a sales receipt's lines name an Item instead, and an item
// carries its own income account, so sending one would mean minting items in the operator's
// company and posting through whatever accounts those items point at: the three picks would decide
// nothing. the deposit puts the gift at face value against the income account, the processor's cut
// as a negative line against the fee account, and the net into the deposit account — which is the
// same three-way movement ../donations/entries.ts posts here.
//
// ---------------------------------------------------------------------------
// what is not built, because nothing sends it.
//
// no webhook listener and no change-data-capture read: this deployment writes its books into a
// company and reads nothing back out of one, so there is no edit made in QuickBooks for anything
// here to hear about. no update and no void arm either — `quickbooks_sync.remote_id` marks a row
// finished and it is never sent again (../db/schema.ts), so a record already in the company's books
// is a bookkeeper's to change. no batch endpoint: the delivery sends one queued entry at a time.
// each of those is an arm to add the day something asks for it, not a branch to leave unexercised.

/** the production Accounting API. a realm, an account and a token exist in one host or the other. */
export const QUICKBOOKS_PRODUCTION_URL = 'https://quickbooks.api.intuit.com';
/** the sandbox Accounting API, whose companies and tokens are not the production ones. */
export const QUICKBOOKS_SANDBOX_URL = 'https://sandbox-quickbooks.api.intuit.com';

/**
 * where a browser is sent to authorise, and where the two token calls go.
 *
 * one pair for both hosts, deliberately: Intuit's OAuth service is not split by environment the way
 * the Accounting API is — which host a token can be spent against is decided by the app's keys,
 * not by the endpoint it came from.
 */
export const INTUIT_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const INTUIT_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

/**
 * the scope an accounting connection asks for, and the only one this app asks for.
 *
 * `openid` and its siblings would make this a sign-in, which is a different grant held by a
 * different seat — a QuickBooks company is an integration this organisation connects, never an
 * identity anybody signs in with.
 */
export const INTUIT_ACCOUNTING_SCOPE = 'com.intuit.quickbooks.accounting';

/**
 * the minor version every call names.
 *
 * Intuit serves a request that names none, or names a retired one, as the floor — where a field
 * added since simply does not come back, with nothing in the answer saying so. 75 is the newest
 * published (https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/minor-versions),
 * and it is pinned rather than left off for exactly that reason.
 */
export const QUICKBOOKS_MINOR_VERSION = '75';

/** how long a call is given before it is treated as an answer that never came. */
const TIMEOUT_MS = 20_000;

/**
 * how far ahead of its stated expiry an access token is refreshed.
 *
 * the token is spent on a call that takes time to make, so a token that lapses in the next few
 * seconds is a call that arrives refused. refreshing early costs one token; not refreshing costs a
 * queued entry an attempt.
 */
const EXPIRY_SKEW_MS = 60_000;

/**
 * how many entities one page of a query asks for.
 *
 * Intuit returns at most 1000 whatever is asked for, and 100 where nothing is — so a read without
 * this is quietly the first hundred rows, which is a duplicate posted the day a company takes more
 * than that many of anything in one day.
 */
const QUERY_PAGE = 1000;

/**
 * the mark every record this app creates carries in its `PrivateNote`.
 *
 * it is how a post whose answer never arrived is found rather than made twice, and it is a prefix
 * rather than the whole note so the entry's own memo can sit under it where a bookkeeper reads it.
 */
const KEY_PREFIX = 'better-giving';

/** how much of a sentence Intuit wrote a message of ours may repeat. */
const PROVIDER_QUOTE_MAX = 200;

/** what the adapter needs before any company is named. */
export type QuickbooksCredentials = {
	/** the app's client id, from Intuit's developer portal. server-only. */
	readonly clientId: string;
	/** the app's client secret. server-only, sent only to Intuit's token endpoints, never logged. */
	readonly clientSecret: string;
	/** {@link QUICKBOOKS_PRODUCTION_URL} or {@link QUICKBOOKS_SANDBOX_URL}. */
	readonly apiBaseUrl: string;
};

/**
 * where a browser is sent to connect a company.
 *
 * built here rather than in the route that redirects, because ./sole-importer.spec.ts refuses an
 * Intuit address anywhere else — and because the scope and the response type are this module's
 * facts rather than a route's.
 *
 * `state` is the caller's to mint and to check on the way back: the callback verifies it before it
 * exchanges anything, and the `realmId` it reads off the redirect is what the connection is written
 * with.
 */
export function quickbooksConnectUrl(input: {
	readonly clientId: string;
	readonly redirectUri: string;
	readonly state: string;
}): string {
	const query = new URLSearchParams({
		client_id: input.clientId,
		response_type: 'code',
		scope: INTUIT_ACCOUNTING_SCOPE,
		redirect_uri: input.redirectUri,
		state: input.state
	});
	return `${INTUIT_AUTHORIZE_URL}?${query}`;
}

/** an answer Intuit gave, read as far as its status and its JSON. */
type Answer = { readonly status: number; readonly body: unknown };

export function createQuickbooksProvider(
	credentials: QuickbooksCredentials,
	store: ConnectionStore
): AccountingProvider {
	const basic = `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`;

	/**
	 * one call to Intuit's token endpoint — the exchange and the refresh are the same request with
	 * a different grant, so they are one function rather than two that can drift.
	 *
	 * form-encoded with the app's keys in the `Authorization` header, which is what Intuit's own
	 * client sends (intuit/oauth-jsclient, `_tokenRequestHeaders`).
	 */
	async function tokenGrant(form: Record<string, string>): Promise<AccountingResult<TokenPair>> {
		let response: Response;
		try {
			response = await fetch(INTUIT_TOKEN_URL, {
				method: 'POST',
				headers: {
					authorization: basic,
					'content-type': 'application/x-www-form-urlencoded',
					accept: 'application/json'
				},
				body: new URLSearchParams(form).toString(),
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
		} catch (error) {
			return unreachable(error);
		}

		const body = await readJson(response);
		if (response.status === 429) {
			return failed('rate_limited', 'Intuit is throttling this app’s token requests.');
		}
		if (response.status >= 500) {
			return failed('provider_error', `Intuit answered ${response.status} on a token request.`);
		}
		if (!response.ok) {
			// a 4xx here is the credential itself: a code already spent, a refresh token retired or
			// rotated past, or keys the app no longer holds. none of them is answered differently by
			// asking again, and an attempt spent on one is an attempt not spent on the next gift.
			return failed(
				'reconnect_needed',
				`Intuit refused the credential (${response.status}${quoted(body)}). The QuickBooks company has to be connected again.`
			);
		}

		return tokenPairOf(body);
	}

	/**
	 * the refresh this provider makes, at most once, whatever asks for it.
	 *
	 * the latch is the whole of it: Intuit rotates the refresh token and retires the one presented,
	 * so two refreshes racing would have the second present a token the first had just retired —
	 * and the connection would be lost by two calls that each succeeded. reading, calling and
	 * writing is one serialized step, and a provider is built per request (CLAUDE.md -> Runtime), so
	 * the latch bounds the request that holds it.
	 *
	 * a failed refresh is latched too: every arm behind it gets the same refusal rather than
	 * presenting a dead token again.
	 */
	let refreshing: Promise<AccountingResult<TokenPair>> | null = null;
	function refresh(refreshToken: string): Promise<AccountingResult<TokenPair>> {
		refreshing ??= tokenGrant({
			grant_type: 'refresh_token',
			refresh_token: refreshToken
		}).then(async (issued) => {
			// persisted before the token is spent, and by the only writer this adapter has. a pair
			// obtained and dropped is the connection lost the next time the old one is presented.
			if (issued.ok) await store.saveTokens(issued.value);
			return issued;
		});
		return refreshing;
	}

	/** the connection to spend, with an access token that has not lapsed. */
	async function authorized(): Promise<
		AccountingResult<{ connection: ConnectionSnapshot; accessToken: string }>
	> {
		const connection = await store.read();
		if (connection === null) {
			return failed(
				'not_connected',
				'No QuickBooks company is connected to this deployment, so there is nothing to send to.'
			);
		}
		if (connection.accessTokenExpiresAt.getTime() - EXPIRY_SKEW_MS > Date.now()) {
			return { ok: true, value: { connection, accessToken: connection.accessToken } };
		}
		const issued = await refresh(connection.refreshToken);
		if (!issued.ok) return issued;
		return { ok: true, value: { connection, accessToken: issued.value.accessToken } };
	}

	/** one Accounting API call, answered with Intuit's status and body, or with a refusal. */
	async function send(
		accessToken: string,
		method: 'GET' | 'POST',
		path: string,
		params: Record<string, string>,
		body?: unknown
	): Promise<Answer | AccountingFailure> {
		const query = new URLSearchParams({ ...params, minorversion: QUICKBOOKS_MINOR_VERSION });
		let response: Response;
		try {
			response = await fetch(`${credentials.apiBaseUrl}${path}?${query}`, {
				method,
				headers: {
					authorization: `Bearer ${accessToken}`,
					accept: 'application/json',
					...(body === undefined ? {} : { 'content-type': 'application/json' })
				},
				body: body === undefined ? null : JSON.stringify(body),
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
		} catch (error) {
			return unreachable(error);
		}
		return { status: response.status, body: await readJson(response) };
	}

	/**
	 * a call, with the one refresh a rejected token is worth.
	 *
	 * an access token can lapse before the expiry this app holds for it — revoked from inside
	 * QuickBooks, or the company disconnected there — so a 401 is answered by refreshing once and
	 * making the call again. still refused after that, the credential is dead and no number of
	 * attempts revives it.
	 */
	async function request(
		auth: { connection: ConnectionSnapshot; accessToken: string },
		method: 'GET' | 'POST',
		path: string,
		params: Record<string, string> = {},
		body?: unknown
	): Promise<AccountingResult<unknown>> {
		let answer = await send(auth.accessToken, method, path, params, body);
		if ('ok' in answer) return answer;

		if (answer.status === 401) {
			const issued = await refresh(auth.connection.refreshToken);
			if (!issued.ok) return issued;
			answer = await send(issued.value.accessToken, method, path, params, body);
			if ('ok' in answer) return answer;
		}

		if (answer.status >= 200 && answer.status < 300) return { ok: true, value: answer.body };
		return classify(answer);
	}

	/** the query endpoint, which is how every read this adapter makes is made. */
	async function ask(
		auth: { connection: ConnectionSnapshot; accessToken: string },
		statement: string
	): Promise<AccountingResult<unknown>> {
		return request(auth, 'GET', `/v3/company/${auth.connection.realmId}/query`, {
			query: statement
		});
	}

	/** every page of a query, so a read is never quietly the first hundred rows. */
	async function askAll(
		auth: { connection: ConnectionSnapshot; accessToken: string },
		statement: string,
		entity: string
	): Promise<AccountingResult<unknown[]>> {
		const rows: unknown[] = [];
		for (let start = 1; ; start += QUERY_PAGE) {
			const answered = await ask(
				auth,
				`${statement} STARTPOSITION ${start} MAXRESULTS ${QUERY_PAGE}`
			);
			if (!answered.ok) return answered;
			const page = queryRows(answered.value, entity);
			rows.push(...page);
			if (page.length < QUERY_PAGE) return { ok: true, value: rows };
		}
	}

	/**
	 * the record this app already created for `key`, or null.
	 *
	 * the whole of the idempotency: QuickBooks takes no idempotency key, so every record carries the
	 * entry group's id in its `PrivateNote` and a send looks for it before creating anything. what
	 * this answers is the post whose reply never arrived — the delivery retries, and without this
	 * the company's books hold the gift twice with nothing saying which is which.
	 *
	 * bounded by the transaction's own date, which is the one field both a query can filter on and
	 * this app knows before the record exists. `PrivateNote` is not filterable, so the match is made
	 * here rather than by Intuit.
	 */
	async function alreadyPosted(
		auth: { connection: ConnectionSnapshot; accessToken: string },
		entity: 'Deposit' | 'JournalEntry',
		key: string,
		txnDate: string
	): Promise<AccountingResult<string | null>> {
		const rows = await askAll(auth, `select * from ${entity} where TxnDate = '${txnDate}'`, entity);
		if (!rows.ok) return rows;
		const mark = keyMark(key);
		for (const row of rows.value) {
			if (stringField(row, 'PrivateNote')?.startsWith(mark) === true) {
				const id = stringField(row, 'Id');
				if (id !== null) return { ok: true, value: id };
			}
		}
		return { ok: true, value: null };
	}

	/** the one customer query, asked with whatever predicate the ladder reached. */
	async function findCustomer(
		auth: { connection: ConnectionSnapshot; accessToken: string },
		predicate: string
	): Promise<AccountingResult<string | null>> {
		const answered = await ask(auth, `select * from Customer where ${predicate}`);
		if (!answered.ok) return answered;
		const [found] = queryRows(answered.value, 'Customer');
		return { ok: true, value: stringField(found, 'Id') };
	}

	/**
	 * the donor's customer in the company's books: found by email, then by name, then created.
	 *
	 * the name lookup is made even where the email one found nothing and the donor has an email,
	 * and that is not belt and braces: `DisplayName` is unique across every customer, vendor and
	 * employee in the company, so a create under a name already taken is refused outright — and the
	 * donor who gives twice under a name somebody typed into QuickBooks last year would never post
	 * at all.
	 */
	async function customerFor(
		auth: { connection: ConnectionSnapshot; accessToken: string },
		donor: Donor
	): Promise<AccountingResult<string>> {
		const displayName = quickbooksDisplayName(donor.displayName);

		if (donor.email !== null) {
			const byEmail = await findCustomer(auth, `PrimaryEmailAddr = '${escaped(donor.email)}'`);
			if (!byEmail.ok) return byEmail;
			if (byEmail.value !== null) return { ok: true, value: byEmail.value };
		}

		const byName = await findCustomer(auth, `DisplayName = '${escaped(displayName)}'`);
		if (!byName.ok) return byName;
		if (byName.value !== null) return { ok: true, value: byName.value };

		const created = await request(
			auth,
			'POST',
			`/v3/company/${auth.connection.realmId}/customer`,
			{},
			{
				DisplayName: displayName,
				...(donor.email === null ? {} : { PrimaryEmailAddr: { Address: donor.email } })
			}
		);
		if (!created.ok) return created;
		const id = stringField(field(created.value, 'Customer'), 'Id');
		return id === null
			? failed('provider_error', 'QuickBooks created a customer and named no id for it.')
			: { ok: true, value: id };
	}

	return {
		async exchangeCode(input: {
			readonly code: string;
			readonly redirectUri: string;
		}): Promise<AccountingResult<TokenPair>> {
			return tokenGrant({
				grant_type: 'authorization_code',
				code: input.code,
				redirect_uri: input.redirectUri
			});
		},

		async readCompany(): Promise<AccountingResult<CompanyIdentity>> {
			const auth = await authorized();
			if (!auth.ok) return auth;

			const answered = await ask(auth.value, 'select * from CompanyInfo');
			if (!answered.ok) return answered;

			const [info] = queryRows(answered.value, 'CompanyInfo');
			const companyName = stringField(info, 'CompanyName');
			if (companyName === null) {
				return failed('provider_error', 'QuickBooks named no company for this connection.');
			}
			return { ok: true, value: { realmId: auth.value.connection.realmId, companyName } };
		},

		/**
		 * the gift as one deposit: the money at face value into the income account, what the
		 * processor kept as a line against it, and the net landing in the deposit account.
		 *
		 * it is the same two entry groups the books hold (../donations/entries.ts), read as the one
		 * transaction they are — which is why ../accounting/outbox.ts queues the gift and not its fee.
		 */
		async sendGift(gift: GiftRecord): Promise<AccountingResult<RemoteRecord>> {
			const auth = await authorized();
			if (!auth.ok) return auth;
			const accounts = chosenAccounts(auth.value.connection);
			if (!accounts.ok) return accounts;

			const txnDate = transactionDate(gift.occurredAt);
			const posted = await alreadyPosted(auth.value, 'Deposit', gift.key, txnDate);
			if (!posted.ok) return posted;
			if (posted.value !== null) return { ok: true, value: { remoteId: posted.value } };

			const customerId = await customerFor(auth.value, gift.donor);
			if (!customerId.ok) return customerId;

			const lines: unknown[] = [
				{
					DetailType: 'DepositLineDetail',
					Amount: Number(majorText(gift.incomeMinor, gift.currency)),
					Description: `Donation from ${gift.donor.displayName}`,
					DepositLineDetail: {
						AccountRef: { value: accounts.value.income },
						Entity: { value: customerId.value, type: 'Customer' }
					}
				}
			];
			if (gift.feeMinor > 0) {
				// negative, because the processor never sent the fee — it withheld it, so the deposit is
				// the gift less what was kept, and the expense is recognised at face value beside it.
				lines.push({
					DetailType: 'DepositLineDetail',
					Amount: -Number(majorText(gift.feeMinor, gift.currency)),
					Description: 'Processing fee',
					DepositLineDetail: { AccountRef: { value: accounts.value.fee } }
				});
			}

			return createdRecord(
				await request(
					auth.value,
					'POST',
					`/v3/company/${auth.value.connection.realmId}/deposit`,
					{},
					{
						TxnDate: txnDate,
						PrivateNote: privateNote(gift.key, gift.memo),
						DepositToAccountRef: { value: accounts.value.deposit },
						Line: lines
					}
				),
				'Deposit'
			);
		},

		/**
		 * a correcting entry as one journal entry, each side in the account its role maps to.
		 *
		 * a journal entry is the one shape that takes both sides explicitly, which is what a
		 * correction is: ../ledger/correct.ts builds it as one figure moved between two accounts, and
		 * the debit and the credit are named here rather than signed.
		 */
		async sendCorrection(correction: CorrectionRecord): Promise<AccountingResult<RemoteRecord>> {
			const auth = await authorized();
			if (!auth.ok) return auth;
			const accounts = chosenAccounts(auth.value.connection);
			if (!accounts.ok) return accounts;

			const named = correction.lines.map((line) => accounts.value[line.role]);
			if (new Set(named).size === 1) {
				// two of this app's accounts can map to one of the company's — the gift's own asset
				// account and the bank it is swept into are both `deposit`. an entry naming the same
				// account on both sides balances and moves nothing, and it reads as a correction made.
				return failed(
					'invalid_record',
					`This correction moves money between two accounts that are both sent to the same QuickBooks account, so it would post an entry that changes nothing. Correct it in QuickBooks instead.`
				);
			}

			const txnDate = transactionDate(correction.occurredAt);
			const posted = await alreadyPosted(auth.value, 'JournalEntry', correction.key, txnDate);
			if (!posted.ok) return posted;
			if (posted.value !== null) return { ok: true, value: { remoteId: posted.value } };

			return createdRecord(
				await request(
					auth.value,
					'POST',
					`/v3/company/${auth.value.connection.realmId}/journalentry`,
					{},
					{
						TxnDate: txnDate,
						PrivateNote: privateNote(correction.key, correction.memo),
						Line: correction.lines.map((line) => ({
							DetailType: 'JournalEntryLineDetail',
							Amount: Number(majorText(line.amountMinor, correction.currency)),
							...(correction.memo === null ? {} : { Description: correction.memo }),
							JournalEntryLineDetail: {
								PostingType: line.posting === 'debit' ? 'Debit' : 'Credit',
								AccountRef: { value: accounts.value[line.role] }
							}
						}))
					}
				),
				'JournalEntry'
			);
		},

		async listAccounts(): Promise<AccountingResult<readonly LedgerAccount[]>> {
			const auth = await authorized();
			if (!auth.ok) return auth;

			const rows = await askAll(auth.value, 'select * from Account', 'Account');
			if (!rows.ok) return rows;

			const accounts: LedgerAccount[] = [];
			for (const row of rows.value) {
				// an inactive account cannot be posted to, so offering one is offering a choice that
				// refuses every gift afterwards.
				if (field(row, 'Active') === false) continue;
				const id = stringField(row, 'Id');
				const name = stringField(row, 'Name');
				if (id === null || name === null) continue;
				accounts.push({
					id,
					name,
					type: stringField(row, 'AccountType') ?? '',
					classification: stringField(row, 'Classification')
				});
			}
			return { ok: true, value: accounts };
		},

		async revokeTokens(): Promise<AccountingResult<null>> {
			const connection = await store.read();
			if (connection === null) {
				return failed('not_connected', 'No QuickBooks company is connected, so nothing is held.');
			}

			let response: Response;
			try {
				response = await fetch(INTUIT_REVOKE_URL, {
					method: 'POST',
					headers: {
						authorization: basic,
						'content-type': 'application/json',
						accept: 'application/json'
					},
					// the refresh token, because revoking it takes the access token with it.
					body: JSON.stringify({ token: connection.refreshToken }),
					signal: AbortSignal.timeout(TIMEOUT_MS)
				});
			} catch (error) {
				return unreachable(error);
			}

			if (response.ok) return { ok: true, value: null };
			if (response.status === 429) {
				return failed('rate_limited', 'Intuit is throttling this app’s token requests.');
			}
			if (response.status >= 500) {
				return failed('provider_error', `Intuit answered ${response.status} on the revoke.`);
			}
			// a credential Intuit will not revoke is one it no longer recognises, which is the state
			// the revoke was for. the caller deletes the stored row either way.
			return failed(
				'reconnect_needed',
				`Intuit refused the revoke (${response.status}${quoted(await readJson(response))}).`
			);
		}
	};
}

/**
 * the three accounts a send needs, or a refusal naming the ones nobody has picked.
 *
 * a connected company with no accounts chosen is an ordinary state rather than a fault: the
 * connection is made on one screen and the accounts on another, and a gift settling in between
 * arrives here. it is terminal, so the queued row waits for the sweep rather than spending its
 * attempts against a screen nobody has opened.
 */
function chosenAccounts(
	connection: ConnectionSnapshot
): AccountingResult<{ income: string; fee: string; deposit: string }> {
	const missing = [
		connection.incomeAccountId === null ? 'income' : null,
		connection.feeAccountId === null ? 'fee' : null,
		connection.depositAccountId === null ? 'deposit' : null
	].filter((role) => role !== null);

	if (
		connection.incomeAccountId === null ||
		connection.feeAccountId === null ||
		connection.depositAccountId === null
	) {
		return failed(
			'accounts_not_chosen',
			`No QuickBooks account is chosen for: ${missing.join(', ')}. Pick one for each on the QuickBooks screen before anything can be sent.`
		);
	}
	return {
		ok: true,
		value: {
			income: connection.incomeAccountId,
			fee: connection.feeAccountId,
			deposit: connection.depositAccountId
		}
	};
}

/** the id QuickBooks gave what it just created. */
function createdRecord(
	answered: AccountingResult<unknown>,
	entity: 'Deposit' | 'JournalEntry'
): AccountingResult<RemoteRecord> {
	if (!answered.ok) return answered;
	const remoteId = stringField(field(answered.value, entity), 'Id');
	return remoteId === null
		? failed('provider_error', `QuickBooks created a ${entity} and named no id for it.`)
		: { ok: true, value: { remoteId } };
}

/**
 * business time as QuickBooks dates a transaction: a plain UTC day.
 *
 * the ledger stores unix ms and reads them as UTC everywhere (`readRaisedByMonth` in
 * ../ledger/queries.ts), so this is the same day every figure in this app is bucketed under. a
 * company whose own books run in another time zone will see a gift made late in the UTC day dated
 * a day ahead of theirs, which is the one thing a plain date cannot carry both ways.
 */
function transactionDate(occurredAt: Date): string {
	return occurredAt.toISOString().slice(0, 10);
}

/** what marks a record as this app's, and which entry group it is. */
function keyMark(key: string): string {
	return `${KEY_PREFIX} ${key}`;
}

/** the note every record carries: the key that makes a retry land once, then the entry's memo. */
function privateNote(key: string, memo: string | null): string {
	return memo === null ? keyMark(key) : `${keyMark(key)}\n${memo}`;
}

/**
 * a donor's name as QuickBooks will take it.
 *
 * a `DisplayName` may hold no colon, tab or newline, and this app's `contact.display_name` is free
 * text an operator or a donor typed. the same spelling has to be used for the lookup and for the
 * create, or every repeat gift from one donor mints another customer — which is the whole reason it
 * is a function rather than two expressions.
 */
function quickbooksDisplayName(displayName: string): string {
	return displayName
		.replaceAll(/[:\t\r\n]+/g, ' ')
		.replaceAll(/\s+/g, ' ')
		.trim();
}

/**
 * a value inside a query's string literal.
 *
 * Intuit's query language escapes with a backslash
 * (https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries),
 * and the value here is a donor's own name or address: unescaped, an apostrophe ends the literal
 * mid-name and the read comes back refused — for exactly the donors a lookup by name exists for.
 */
function escaped(value: string): string {
	return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

/**
 * the rows a query answered with, under the entity's own key.
 *
 * an empty `QueryResponse` is what a query matching nothing returns — no key at all rather than an
 * empty array — so every caller reads the absence as none rather than as a fault.
 */
function queryRows(body: unknown, entity: string): unknown[] {
	const response = field(body, 'QueryResponse');
	const rows = field(response, entity);
	return Array.isArray(rows) ? rows : [];
}

/**
 * what a status Intuit answered with means for the entry that was being sent.
 *
 * the split that matters is retryable against terminal: a throttle and a fault of Intuit's own are
 * worth the same call later, and a payload Intuit refuses is refused identically every time until
 * the data or the mapping changes. a 401 reaches here only after the refresh above did not fix it.
 */
function classify(answer: Answer): AccountingFailure {
	const words = faultWords(answer.body);
	if (answer.status === 429) {
		return failed('rate_limited', 'QuickBooks is throttling this deployment’s calls.');
	}
	if (answer.status >= 500) {
		return failed('provider_error', `QuickBooks answered ${answer.status}${words}.`);
	}
	if (answer.status === 401 || answer.status === 403) {
		return failed(
			'reconnect_needed',
			`QuickBooks refused the credential (${answer.status}${words}). The company has to be connected again.`
		);
	}
	if (answer.status === 404) {
		return failed('not_found', `QuickBooks holds no such record (404${words}).`);
	}
	return failed('invalid_record', `QuickBooks refused the request (${answer.status}${words}).`);
}

/**
 * Intuit's own sentence about a refusal, bounded.
 *
 * the fault's code and detail are what say which field was wrong, and they are the whole reason an
 * operator can act on `quickbooks_sync.last_error` without a log.
 */
function faultWords(body: unknown): string {
	const errors = field(field(body, 'Fault'), 'Error');
	const [first] = Array.isArray(errors) ? errors : [];
	const message = stringField(first, 'Message');
	const detail = stringField(first, 'Detail');
	const code = stringField(first, 'code');
	const words = [message, detail].filter((part) => part !== null).join(' — ');
	if (words === '') return '';
	return `: ${words.slice(0, PROVIDER_QUOTE_MAX)}${code === null ? '' : ` (${code})`}`;
}

/**
 * the pair Intuit issued, dated from now.
 *
 * both lifetimes arrive as seconds from the moment of the answer rather than as instants, so the
 * clock is read here and nowhere else. `x_refresh_token_expires_in` is the rolling window on the
 * refresh token — Intuit does not always state one, and its absence is an expiry this app does not
 * know rather than one that has passed.
 */
function tokenPairOf(body: unknown): AccountingResult<TokenPair> {
	const accessToken = stringField(body, 'access_token');
	const refreshToken = stringField(body, 'refresh_token');
	const expiresIn = numberField(body, 'expires_in');
	if (accessToken === null || refreshToken === null || expiresIn === null) {
		return failed(
			'provider_error',
			'Intuit answered the token request without a token pair this app can read.'
		);
	}
	const refreshExpiresIn = numberField(body, 'x_refresh_token_expires_in');
	const now = Date.now();
	return {
		ok: true,
		value: {
			accessToken,
			accessTokenExpiresAt: new Date(now + expiresIn * 1000),
			refreshToken,
			refreshTokenExpiresAt:
				refreshExpiresIn === null ? null : new Date(now + refreshExpiresIn * 1000)
		}
	};
}

/** a body that is not JSON is read as nothing: every reader here checks the field it wants. */
async function readJson(response: Response): Promise<unknown> {
	try {
		return JSON.parse(await response.text()) as unknown;
	} catch {
		return null;
	}
}

function field(body: unknown, key: string): unknown {
	return typeof body === 'object' && body !== null
		? (body as Record<string, unknown>)[key]
		: undefined;
}

function stringField(body: unknown, key: string): string | null {
	const value = field(body, key);
	return typeof value === 'string' && value !== '' ? value : null;
}

function numberField(body: unknown, key: string): number | null {
	const value = field(body, key);
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Intuit's own words about a refusal, bounded and stripped of anything token-shaped.
 *
 * the sentence is read by an operator and lands in `quickbooks_sync.last_error`, and a refused
 * credential is described by quoting the credential — so the quote carries the code and the
 * message, never the body whole.
 */
function quoted(body: unknown): string {
	const words =
		stringField(body, 'error_description') ??
		stringField(body, 'error') ??
		stringField(body, 'Message');
	return words === null ? '' : `: ${words.slice(0, PROVIDER_QUOTE_MAX)}`;
}

/** no answer settled whether the call took effect. */
function unreachable(error: unknown): AccountingFailure {
	const named = error instanceof Error ? error.name : 'an unnamed fault';
	return failed('unreachable', `QuickBooks could not be reached (${named}).`);
}
