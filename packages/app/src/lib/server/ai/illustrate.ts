import type { Db } from '../db/client';
import { IMAGE_BYTES_MAX } from '../db/schema';
import { createImage } from '../images/queries';
import { sniffImage } from '../images/sniff';
import { aiBinding, isLocalStandIn } from './generate';

// the one way this deployment asks a model for a picture, stored as an `illustration` image.
//
// the model is `MODEL`, a Workers AI model billed in neurons against the account's own Workers AI
// allocation (https://developers.cloudflare.com/workers-ai/platform/pricing/).
// it is fixed here: `AI_MODEL` is the console's choice of chat model and has no say over this one.
// the call goes through AI Gateway's `default` gateway, as ./generate.ts's does.
//
// the binding is read off the env each call is handed, by the same rules as ./generate.ts: none,
// or the local dev server's stand-in, is `unbound`.
//
// nothing here throws: the caller is a chat turn, and a picture that did not arrive is a sentence
// in it rather than a 500. a model that threw or answered with no picture is `failed`, and so is a
// write D1 refused. a picture no image header opens is `unreadable`, and one past
// `IMAGE_BYTES_MAX` — the cap an upload is held to — is `too-large`, refused before the table's
// own check would. the type and size stored are what the bytes declare (../images/sniff.ts), never
// the model's documented format.

export interface IllustrateRequest {
	readonly prompt: string;
	readonly alt: string;
}

export type IllustrateResult =
	| { readonly ok: true; readonly imageId: string }
	| { readonly ok: false; readonly reason: 'unbound' | 'failed' | 'unreadable' | 'too-large' };

/** https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/ */
const MODEL = '@cf/black-forest-labs/flux-1-schnell';

const GATEWAY = { gateway: { id: 'default' } } as const;

export async function illustrate(
	source: unknown,
	db: Db,
	request: IllustrateRequest
): Promise<IllustrateResult> {
	const binding = aiBinding(source);
	if (!binding) return { ok: false, reason: 'unbound' };

	let reply: unknown;
	try {
		reply = await binding.run(MODEL, { prompt: request.prompt }, GATEWAY);
	} catch (error) {
		if (isLocalStandIn(error)) return { ok: false, reason: 'unbound' };
		console.error(`${MODEL} did not draw:`, error);
		return { ok: false, reason: 'failed' };
	}
	const encoded = imageField(reply);
	if (!encoded) {
		console.error(`${MODEL} answered with no image:`, reply);
		return { ok: false, reason: 'failed' };
	}

	const bytes = decodeBase64(encoded);
	if (!bytes) return { ok: false, reason: 'unreadable' };
	if (bytes.byteLength > IMAGE_BYTES_MAX) return { ok: false, reason: 'too-large' };
	const sniffed = sniffImage(bytes);
	if (!sniffed) return { ok: false, reason: 'unreadable' };

	try {
		const imageId = await createImage(
			db,
			{ kind: 'illustration', alt: request.alt, ...sniffed },
			bytes
		);
		return { ok: true, imageId };
	} catch (error) {
		console.error(`${MODEL}'s picture was not stored:`, error);
		return { ok: false, reason: 'failed' };
	}
}

/** the model's base64 picture, or null where the answer holds none. */
function imageField(reply: unknown): string | null {
	const image =
		typeof reply === 'object' && reply !== null ? (reply as { image?: unknown }).image : null;
	return typeof image === 'string' && image.length > 0 ? image : null;
}

function decodeBase64(encoded: string): Uint8Array | null {
	try {
		return Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
	} catch {
		return null;
	}
}
