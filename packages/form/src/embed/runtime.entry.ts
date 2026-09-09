// what `/embed/<contenthash>.js` is built from.
//
// registered at once rather than on a ready event: the element's own lifecycle is what waits. a
// `<bg-donate-form>` the parser has already built is upgraded by this registration, and one the
// parser has not reached yet is constructed already upgraded.

import { startRuntime } from './runtime';

startRuntime(document);
