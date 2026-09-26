import zapier, { defineApp } from 'zapier-platform-core';
import packageJson from '../package.json' with { type: 'json' };
import authentication from './authentication.js';
import { addBearerKey, expireRefusedKey } from './middleware.js';
import giftRefunded from './triggers/gift-refunded.js';
import newDonor from './triggers/new-donor.js';
import newGift from './triggers/new-gift.js';

export default defineApp({
	version: packageJson.version,
	platformVersion: zapier.version,
	authentication,
	beforeRequest: [addBearerKey],
	afterResponse: [expireRefusedKey],
	triggers: { [newGift.key]: newGift, [newDonor.key]: newDonor, [giftRefunded.key]: giftRefunded }
});
