import { route, HttpError } from '@/lib/session';
import { apiKeyOf, encryptKey, mask, readSettings, writeSettings } from '@/lib/settings';
import { credits } from '@/lib/altai';
import { LANGUAGES } from '@/lib/languages';

const languageOf = (value: unknown, fallback = 'english') =>
	typeof value === 'string' && LANGUAGES.some(([id]) => id === value) ? value : fallback;

export default route(['GET', 'POST'], async (auth, req) => {
	const settings = await readSettings(auth);
	const apiKey = apiKeyOf(settings);

	if (req.method === 'POST') {
		if (!auth.admin) throw new HttpError('Only space admins can change the settings.', 403);

		const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
		const language = languageOf(body.language, languageOf(settings.language));
		const newKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

		if (!newKey) {
			await writeSettings(auth, { language });
			return { hasKey: !!apiKey, keyHint: mask(apiKey), language, canEdit: true };
		}

		let left: number;
		try {
			left = await credits(newKey);
		} catch (e) {
			if (e instanceof HttpError && e.status === 401) {
				throw new HttpError('That API key was not recognised. Copy it again from your dashboard.', 400);
			}
			throw e;
		}
		await writeSettings(auth, { key: encryptKey(newKey), language });
		return { hasKey: true, keyHint: mask(newKey), language, canEdit: true, creditsLeft: left };
	}

	let creditsLeft: number | null = null;
	let creditsError: string | null = null;
	if (apiKey) {
		try {
			creditsLeft = await credits(apiKey);
		} catch (e) {
			creditsError = e instanceof HttpError ? e.message : 'Could not check the credits.';
		}
	}

	return {
		hasKey: !!apiKey,
		keyHint: mask(apiKey),
		language: languageOf(settings.language),
		canEdit: auth.admin,
		creditsLeft,
		creditsError,
	};
});
