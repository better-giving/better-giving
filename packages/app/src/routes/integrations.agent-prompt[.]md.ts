import { publishedOrigin, readAuthEnv, readPin } from '$lib/server/auth';
import { agentPromptFor } from '$lib/server/integrations/agent-prompt';
import { DOCS_HEADERS } from '$lib/server/integrations/openapi';
import { platform } from '../context';
import type { Route } from './+types/integrations.agent-prompt[.]md';

// the prompt an organisation's developer hands an AI coding agent to wire their system to this
// deployment, built by $lib/server/integrations/agent-prompt.ts with this deployment's origin, as
// `publishedOrigin` reads it. served without a key, and readable from any page, for the reasons
// ./integrations.openapi[.]json.ts gives for the document.

export function loader({ context, url }: Route.LoaderArgs): Response {
	const origin = publishedOrigin(url, readPin(readAuthEnv(context.get(platform).env)));
	return new Response(agentPromptFor(origin), {
		headers: { ...DOCS_HEADERS, 'content-type': 'text/markdown; charset=utf-8' }
	});
}
