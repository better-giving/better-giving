// what an outbox feed keeps of a receiver's refusal in `last_error`: the status line, and the head
// of the body. shared by ../zapier/deliver.ts and ../webhooks/deliver.ts.
//
// the body is a stranger's text, of any size, so no more of it is read than is kept, and the rest
// of the stream is cancelled. a body that breaks off mid-read keeps what arrived: the status line
// already came, and it is the part a failure must not lose.

/** how much of a refusal's body is kept. */
export const ERROR_BODY_CHARS = 200;

/** the status line and the head of the body `response` refused with. */
export async function refusal(response: Response): Promise<string> {
	const line = `${response.status} ${response.statusText}`.trim();
	const body = (await bodyHead(response)).slice(0, ERROR_BODY_CHARS).trim();
	return body === '' ? line : `${line} — ${body}`;
}

/** at least {@link ERROR_BODY_CHARS} of the body, or all of it where it is shorter or breaks off. */
async function bodyHead(response: Response): Promise<string> {
	const reader = response.body?.getReader();
	if (reader === undefined) return '';
	const decoder = new TextDecoder();
	let text = '';
	try {
		while (text.length < ERROR_BODY_CHARS) {
			const { done, value } = await reader.read();
			if (done) break;
			text += decoder.decode(value, { stream: true });
		}
	} catch {
		// what arrived stands; the rest is gone either way.
	}
	await reader.cancel().catch(() => undefined);
	return text;
}
