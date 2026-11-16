import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * The API key is saved in the space's plugin settings, which Storyblok shows to space admins
 * and tells apps not to use for secrets. So the key is encrypted here first, with a secret
 * that only this server has. Storyblok only ever holds the encrypted text.
 */
const key = () => {
	const secret = process.env.ENCRYPTION_SECRET;
	if (!secret) {
		throw new Error('Environment variable "ENCRYPTION_SECRET" is missing.');
	}
	return createHash('sha256').update(secret).digest();
};

export const encrypt = (plain: string): string => {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(), iv);
	const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
};

export const decrypt = (value: string): string | null => {
	try {
		const [iv, tag, data] = value.split('.').map((p) => Buffer.from(p, 'base64'));
		const decipher = createDecipheriv('aes-256-gcm', key(), iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
	} catch {
		return null;
	}
};
