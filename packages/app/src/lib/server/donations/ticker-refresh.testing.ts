import { EXCHANGE_FILE_URL } from './ticker-refresh';

// sec.gov's two ticker files, stood in for by a function that answers each from what a case hands
// it (./ticker-refresh.ts).

/** the exchange file as sec.gov writes it, `count` companies after the ones given. */
export function exchangeFile(count: number, first: unknown[][] = []) {
	const data = [...first];
	for (let n = 0; n < count; n += 1) data.push([n + 1, `Company ${n}`, `C${n}`, 'NYSE']);
	return { fields: ['cik', 'name', 'ticker', 'exchange'], data };
}

/** the fund file as sec.gov writes it, `count` fund classes after the ones given. */
export function fundFile(count: number, first: unknown[][] = []) {
	const data = [...first];
	for (let n = 0; n < count; n += 1) data.push([n + 1, `S${n}`, `C${n}`, `F${n}X`]);
	return { fields: ['cik', 'seriesId', 'classId', 'symbol'], data };
}

export type SecAnswer = { status: number; body: unknown };

export const ok = (body: unknown): SecAnswer => ({ status: 200, body });

/** a stand-in fetch: each file's answer, and every request it was handed. */
export function secStandIn(answers: { exchange: SecAnswer; fund: SecAnswer }) {
	const requests: Request[] = [];
	const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		requests.push(request);
		const answer = request.url === EXCHANGE_FILE_URL ? answers.exchange : answers.fund;
		return Response.json(answer.body, { status: answer.status });
	}) as typeof globalThis.fetch;
	return { fetch, requests };
}

/** both files at about half the rows sec.gov lists. */
export const wholeFiles = () =>
	secStandIn({ exchange: ok(exchangeFile(6_000)), fund: ok(fundFile(15_000)) });
