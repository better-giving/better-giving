/**
 * how far in from a rail's padding edge the provider starts the rail's name, in px, at a 16px root.
 *
 * read off a rendered Payment Element to a pixel either way: the frame is cross-origin, so no script
 * of ours can query it, and no appearance variable reaches the icon column that sets it
 * (https://docs.stripe.com/elements/appearance-api). the rows ../styles/rows.css draws beside the
 * frame are held within a pixel of it by ./rows.dom.spec.ts and ../styles/parts.browser.spec.ts.
 */
export const PROVIDER_NAME_OFFSET_PX = 37;
