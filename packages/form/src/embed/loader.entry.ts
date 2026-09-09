// what `/embed.js` is built from.
//
// one statement, because everything this file could grow into belongs in the runtime instead: this
// is the short-cached half of the pair and the only file every already-pasted snippet re-reads.
// see ./loader.ts for what that split buys and `packages/app/_headers` for the two tiers.
//
// the placeholder is replaced with the runtime's real path by vite.embed.config.ts as the bundle is
// written, so the loader ships already knowing where the runtime is and fetches no manifest to find
// out. it is imported rather than written out here so that the token the loader carries and the
// token the build looks for cannot drift apart — from ./loader.ts rather than from ./stamp.ts,
// which is a build-time module whose top-level `new RegExp` rollup cannot drop from this bundle.

import { bootLoader, RUNTIME_PATH_PLACEHOLDER } from './loader';

bootLoader(document, RUNTIME_PATH_PLACEHOLDER);
