import { agentPromptFor } from '$lib/server/integrations/agent-prompt';
import { DOCS_HEADERS, publishedOrigin } from '$lib/server/integrations/openapi';
import type { Route } from './+types/integrations.agent-prompt[.]md';

// the prompt an organisation's developer hands an AI coding agent to wire their system to this
// deployment, built by $lib/server/integrations/agent-prompt.ts with the address it was asked at.
// served without a key, and readable from any page, for the reasons
// ./integrations.openapi[.]json.ts gives for the document.

export function loader({ url }: Route.LoaderArgs): Response {
	return new Response(agentPromptFor(publishedOrigin(url)), {
		headers: { ...DOCS_HEADERS, 'content-type': 'text/markdown; charset=utf-8' }
	});
}
