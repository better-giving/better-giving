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

async function shippedCode(mode: 'runtime' | 'loader'): Promise<string> {
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
	return outputs
		.flatMap(({ output }) => output)
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
