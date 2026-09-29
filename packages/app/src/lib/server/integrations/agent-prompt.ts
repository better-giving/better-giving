import { WEBHOOK_EVENT_TYPES, WEBHOOK_EVENTS, WEBHOOK_TEST_TYPE } from '../../webhooks/catalog';
import {
	DESTINATION_PAUSE_AFTER_MS,
	PAUSED_AT_ONCE_ON,
	WEBHOOK_POST_TIMEOUT_MS
} from '../webhooks/deliver';
import {
	AGENT_PROMPT_PATH,
	OPENAPI_PATH,
	recordWords,
	retryScheduleWords,
	spokenDuration,
	WEBHOOK_ATTEMPTS,
	WEBHOOK_EVENT_DATA
} from './openapi';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_CEILING } from './paging';
import { ADDRESS_RATE_LIMIT, INTEGRATIONS_BASE_PATH, KEY_RATE_LIMIT } from './surface';

// the prompt an organisation's developer pastes into an AI coding agent to wire their own system
// to this deployment, served as markdown at `AGENT_PROMPT_PATH` and copied from the dashboard's API
// page.
//
// it is ./openapi.ts's document said as instructions, for a reader that acts on each sentence:
// short, imperative, and naming this deployment's own origin in every address, so an agent given
// nothing else can read a page of gifts with a key —
// src/routes/integrations.openapi[.]json.workers.spec.ts does exactly that with the curl line
// below. every number is read from the module that enforces it, as the document's are, and the
// document stays the contract: the prompt sends the agent there first.
//
// nothing about an organisation is in it, so it is served without a key.
//
// **it never has the agent hold a secret in the conversation.** the API key reads donors' names and
// addresses, and the signing secret forges posts: the developer exports each into the environment
// themselves, the agent reads them from there alone, and a variable that is unset is reported by
// name rather than asked for.

/** the environment variables the developer sets and the agent reads the two secrets from. */
export const API_KEY_VARIABLE = 'BETTER_GIVING_API_KEY';
export const WEBHOOK_SECRET_VARIABLE = 'BETTER_GIVING_WEBHOOK_SECRET';

/**
 * the prompt, with `origin` — `publishedOrigin`'s for the request — as this deployment's address.
 */
export function agentPromptFor(origin: string): string {
	const api = `${origin}${INTEGRATIONS_BASE_PATH}`;
	const events = WEBHOOK_EVENT_TYPES.map(
		(type) =>
			`- \`${type}\` — ${WEBHOOK_EVENTS[type]}; \`data\` is \`${WEBHOOK_EVENT_DATA[type].schema}\`. ${recordWords(type)}`
	).join('\n');

	return `# Connect a system to the donation deployment at ${origin}

You are wiring a system to a self-hosted donation deployment at ${origin}. It serves one organisation's gifts, donors and recurring gifts through a read-only API, and posts signed webhooks when they change.

Fetch the OpenAPI 3.1 document at ${origin}${OPENAPI_PATH} first. It is the whole contract — every field, refusal and event — and where it and this prompt differ, it wins. This prompt is served at ${origin}${AGENT_PROMPT_PATH}.

## Secrets stay out of this conversation

The API key and the webhook signing secret are read from the environment, and only from there:

- The developer sets both themselves, outside this conversation — in their own terminal or the app's secret store: \`export ${API_KEY_VARIABLE}=bgk_…\` and \`export ${WEBHOOK_SECRET_VARIABLE}=whsec_…\`.
- Read \`${API_KEY_VARIABLE}\` and \`${WEBHOOK_SECRET_VARIABLE}\` from the environment. Never ask for either in this conversation, and never print, log or commit one.
- Where one is unset, stop and say which variable is unset, and that the developer sets it themselves.

## Authenticate

- Send \`Authorization: Bearer <key>\` on every request to ${api}.
- The organisation makes the key on its dashboard, under Integrations → API, one per system, and it is shown once. It reaches your code as \`${API_KEY_VARIABLE}\`; never invent one.
- The key reads donors' names and email addresses. Keep it on a server — in a secret store or an environment variable, never in a browser, a mobile app or a repository. The API sends no CORS headers, so a browser cannot use it anyway.

## Read a list

The three lists are \`GET ${api}/gifts\`, \`GET ${api}/donors\` and \`GET ${api}/recurring-gifts\`. Read the first page of gifts like this:

\`\`\`sh
curl -H "Authorization: Bearer $${API_KEY_VARIABLE}" "${api}/gifts"
\`\`\`

- Each answer is \`{ "data": [...], "next_cursor": ..., "resume_updated_since": ... }\`.
- \`limit\` is 1 to ${PAGE_SIZE_CEILING}, ${DEFAULT_PAGE_SIZE} when absent. Send nothing else the document does not name: an unknown parameter is refused.
- While \`next_cursor\` is not null, send it back as \`cursor\` with the same other parameters for the next page.

## Keep a copy in sync

1. Walk each list with \`updated_since=1970-01-01T00:00:00Z\` to copy everything, oldest change first.
2. Upsert each entry by \`id\`. The same entry can be served more than once; keep the answer with the latest \`updated_at\`.
3. On the last page, store \`resume_updated_since\`, and send it as \`updated_since\` on the next sync. Never compute it yourself: it overlaps on purpose.
4. Link gifts to donors by \`donor_id\`. What a donor has given is the sum of their gifts.

## Limits and refusals

- ${KEY_RATE_LIMIT.requests} requests a minute per key, and ${ADDRESS_RATE_LIMIT.requests} a minute per calling address. On a 429, wait the \`Retry-After\` seconds and send it again.
- A refusal is \`{ "error", "message", "fix" }\`. Switch on \`error\`; \`message\` and \`fix\` say what to change. A 401 means the key is missing, malformed, unknown or revoked: say so, and that the developer makes a new key and sets \`${API_KEY_VARIABLE}\` again.
- An object may gain fields, and never loses or renames one. Let a field, an enum value or an event type you do not know pass rather than failing on it.

## Webhooks

The organisation adds each destination on its dashboard, under Integrations → Webhooks, and chooses its events. Each destination has its own signing secret, \`whsec_\` followed by base64, on that destination's page; it reaches your code as \`${WEBHOOK_SECRET_VARIABLE}\`.

Verify every post before acting on it — the Standard Webhooks scheme (https://www.standardwebhooks.com/); a Standard Webhooks library in your language does all of it:

1. Read the \`webhook-id\`, \`webhook-timestamp\` and \`webhook-signature\` headers, and the raw body exactly as received. Never re-serialize parsed JSON to verify it.
2. Reject a \`webhook-timestamp\` (seconds since the Unix epoch) more than 5 minutes from now.
3. Base64-decode the secret after \`whsec_\` into bytes: those bytes are the key, never the \`whsec_…\` text.
4. Compute HMAC-SHA256 over \`{webhook-id}.{webhook-timestamp}.{body}\` and base64-encode it.
5. \`webhook-signature\` is a space-separated list of \`v1,<base64>\`. Accept the post if any \`v1\` entry equals yours, compared in constant time.

Then:

- Answer with any 2xx within ${WEBHOOK_POST_TIMEOUT_MS / 1_000} seconds and do the work after. Anything else, a redirect or no answer in time is a failed post, retried after ${retryScheduleWords()} — ${WEBHOOK_ATTEMPTS} attempts in all — then given up.
- Delivery is at least once and unordered. Dedupe on \`webhook-id\`, which is the same on every attempt. Each event below names its record — \`data\`, \`data.gift\` or \`data.recurring_gift\` — carried as it stands when posted: keep the latest per that record's \`id\` by that record's \`updated_at\`.
- A destination whose every post fails for ${spokenDuration(DESTINATION_PAUSE_AFTER_MS)} is paused, and one answering ${PAUSED_AT_ONCE_ON} is paused at once; what it missed is sent when the organisation resumes it.
- The body is \`{ "type", "timestamp", "data" }\`. Acknowledge a \`type\` you do not know — including \`${WEBHOOK_TEST_TYPE}\`, sent from the destination's page with \`data\` of \`{ "test": true, "message" }\` — and act on nothing in it.

The events:

${events}
`;
}
