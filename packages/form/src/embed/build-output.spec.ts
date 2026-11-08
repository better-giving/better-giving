import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { build, type Rollup } from 'vite';
import { describe, expect, it } from 'vitest';
import { embedConfig } from '../../vite.embed.config';

// the two halves built in memory and read as shipped bytes, for what no assertion about the config
// can see: what a dependency's own source leaves in the bundle.
//
// `write: false` keeps this off disk, so it neither needs a build ordered ahead of it nor disturbs
// the dist/ that scripts/stage-embed.js copies. the loader is built without
// `bg-donate-stamp-runtime-path`, which reads the runtime's name off disk; stamping replaces one
// string literal (./stamp.ts) and introduces no read this check looks for.

const STAMP_PLUGIN = 'bg-donate-stamp-runtime-path';

async function shipped(
	mode: 'runtime' | 'loader'
): Promise<readonly (Rollup.OutputChunk | Rollup.OutputAsset)[]> {
	const config = embedConfig({ mode });
	const result = await build({
		...config,
		configFile: false,
		logLevel: 'silent',
		plugins: (config.plugins ?? []).filter(
			(plugin) =>
				!(
					typeof plugin === 'object' &&
					plugin !== null &&
					'name' in plugin &&
					plugin.name === STAMP_PLUGIN
				)
		),
		build: { ...config.build, write: false }
	});
	const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
	return outputs.flatMap(({ output }) => output);
}

async function shippedCode(mode: 'runtime' | 'loader'): Promise<string> {
	return (await shipped(mode))
		.filter((item): item is Rollup.OutputChunk => item.type === 'chunk')
		.map((chunk) => chunk.code)
		.join('\n');
}

// a surviving read is a ReferenceError on a page where `process` is undefined — why the config
// sets `define` is beside it in ../../vite.embed.config.ts. `this._process.bind` is xstate's own
// actor method and is not a match.
const PROCESS_ENV_READ = /\bprocess\.env\b/g;

describe('the shipped bytes', () => {
	for (const mode of ['runtime', 'loader'] as const) {
		it(`leave no process.env read in the ${mode}`, async () => {
			const code = await shippedCode(mode);
			expect(code.length).toBeGreaterThan(0);
			expect(code.match(PROCESS_ENV_READ) ?? []).toEqual([]);
		}, 60_000);
	}
});

// the registry's faces travel inside the runtime rather than beside it: a file beside it is a second
// request from the host page to this deployment, made in cors mode for a font, and one more thing a
// host's policy or this server's headers can refuse. library mode inlines every asset it meets, so
// what this holds is which faces it met — the six fonts-core ships (the alias in
// ../../vite.registry-faces.ts), each byte for byte the copied file, and no file emitted beside the
// script.
describe('the faces the runtime carries', () => {
	const FONTS = new URL('../registry/styles/fonts/', import.meta.url);
	const CORE = [
		'RedHatRoundDisplay-Bold.woff2',
		'RedHatRoundDisplay-SemiBold.woff2',
		'RedHatRoundText-Bold.woff2',
		'RedHatRoundText-Medium.woff2',
		'RedHatRoundText-Regular.woff2',
		'RedHatRoundText-SemiBold.woff2'
	];
	const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

	it('takes the six core faces and no other, inline', async () => {
		const output = await shipped('runtime');
		const code = output
			.filter((item): item is Rollup.OutputChunk => item.type === 'chunk')
			.map((chunk) => chunk.code)
			.join('\n');
		const inlined = [...code.matchAll(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g)].map(
			([, base64]) => digest(Buffer.from(base64 ?? '', 'base64'))
		);

		expect(output.filter((item) => item.type === 'asset')).toEqual([]);
		expect(inlined.sort()).toEqual(
			CORE.map((name) => digest(readFileSync(new URL(name, FONTS)))).sort()
		);
	}, 60_000);
});
