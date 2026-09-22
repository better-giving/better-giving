import type { AfterResponseMiddleware, BeforeRequestMiddleware } from 'zapier-platform-core';

export const addBearerKey: BeforeRequestMiddleware = (request, _z, bundle) => {
	request.headers = { ...request.headers, Authorization: `Bearer ${bundle.authData.key}` };
	return request;
};

/**
 * a 401 is the deployment refusing the key — replaced in the console, or never made. expiring the
 * connection makes Zapier ask the user to reconnect. every trigger is a REST hook whose perform
 * makes no request, so that ask comes on the next connect, Zap turn-on or sample load.
 */
export const expireRefusedKey: AfterResponseMiddleware = (response, z) => {
	if (response.status !== 401) return response;
	const { message, fix } = (response.data ?? {}) as { message?: string; fix?: string };
	throw new z.errors.ExpiredAuthError(
		[message, fix].filter(Boolean).join(' ') || 'The deployment refused the Zapier key.'
	);
};
