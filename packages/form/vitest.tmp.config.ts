import { mergeConfig } from 'vitest/config';
import base from './vitest.browser.config';
export default mergeConfig(base, { server: { host: '127.0.0.1' }, test: { browser: { api: { host: '127.0.0.1' } } } });
