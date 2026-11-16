import { decrypt, encrypt } from './crypto';
import { HttpError, type Authed } from './session';

/**
 * Space-level plugin settings: one small record per space, kept by Storyblok itself, so this
 * app needs no database. It holds the encrypted API key and the default language.
 */
export type Settings = { key?: string; language?: string };

const path = ({ spaceId, appId }: Authed) => `spaces/${spaceId}/app_provisions/${appId}`;

const cache = new Map<number, { at: number; value: Settings }>();
const CACHE_MS = 30_000;

export const readSettings = async (auth: Authed): Promise<Settings> => {
	const hit = cache.get(auth.spaceId);
	if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

	try {
		const { data } = await auth.client.get(path(auth));
		const provision = data?.app_provision ?? data;
		const value: Settings = provision?.space_level_settings ?? {};
		cache.set(auth.spaceId, { at: Date.now(), value });
		return value;
	} catch (e) {
		console.error('Could not read the space settings:', e);
		throw new HttpError('Could not read the plugin settings for this space.', 502);
	}
};

export const writeSettings = async (auth: Authed, change: Settings) => {
	const next = { ...(await readSettings(auth)), ...change };
	try {
		await auth.client.put(path(auth), { app_provision: { space_level_settings: next } } as never);
	} catch (e) {
		console.error('Could not save the space settings:', e);
		throw new HttpError(
			'Could not save the settings. In the extension details, turn on "Enable settings on space level".',
			502,
		);
	}
	cache.set(auth.spaceId, { at: Date.now(), value: next });
	return next;
};

export const apiKeyOf = (settings: Settings): string => (settings.key ? decrypt(settings.key) || '' : '');

export const encryptKey = encrypt;

export const mask = (apiKey: string) => (apiKey.length > 4 ? `••••••••${apiKey.slice(-4)}` : '');
