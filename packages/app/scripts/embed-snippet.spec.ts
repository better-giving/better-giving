import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRE_UPGRADE_RESERVATION } from '@better-giving/form/embed/reservation';

// the reservation the pasted snippet carries, held to the file that prints it — an app-side spec
// rather than one beside `formSnippet` (packages/form/src/embed/snippet.ts), because nothing under
// packages/form/** reads outside its own tree; reading docs/embed.md from inside the package would be
// exactly that.
//
// docs/embed.md prints the block. README.md and DEPLOY.md link to it and do not repeat the rule, so
// the constant and the way out below are both held to docs/embed.md.
//
// whitespace is squashed on the documented side alone: the file is formatted, and how deep a
// fenced block sits is the formatter's business rather than a change to the snippet.

// the workspace root, not packages/app — docs/embed.md stays under it.
const ROOT = resolve(import.meta.dirname, '../../..');

const squash = (value: string) => value.trim().replace(/\s+/g, ' ');

const doc = (name: string): string => readFileSync(resolve(ROOT, name), 'utf8');

describe('the reservation docs/embed.md documents', () => {
	it('is the reservation the snippet carries', () => {
		expect(squash(doc('docs/embed.md'))).toContain(squash(PRE_UPGRADE_RESERVATION));
	});

	// the paste that survives a CMS: a `<style>` element is not conforming in `<body>` and is exactly
	// what a content-block sanitizer strips, which would leave an operator with the reflow and no way
	// to tell. docs/embed.md names the stylesheet as the way out.
	it('tells an operator where the rule goes when their page strips the block', () => {
		expect(doc('docs/embed.md')).toContain('stylesheet');
	});
});
