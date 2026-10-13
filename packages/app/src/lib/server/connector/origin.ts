import { publishedOrigin, readAuthEnv, readPin } from '../auth';

/** the origin this deployment publishes its pages on, as the API page gives it. */
export function connectorOrigin(url: URL, env: Env): string {
	return publishedOrigin(url, readPin(readAuthEnv(env)));
}

/** the JSON body of a write, or `undefined` for one that is not JSON. */
export async function jsonBody(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return undefined;
	}
}
