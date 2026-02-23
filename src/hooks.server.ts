import type { Handle } from '@sveltejs/kit';
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose';

const DEV_USER_EMAIL = 'dev@localhost';
const ACCESS_JWKS = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

type AccessEnv = {
	CF_ACCESS_AUD?: string;
	CF_ACCESS_TEAM_DOMAIN?: string;
};

function normalizeTeamDomain(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	const withScheme = trimmed.startsWith('http://') || trimmed.startsWith('https://')
		? trimmed
		: `https://${trimmed}`;
	return withScheme.replace(/\/+$/, '');
}

function getAccessJwks(issuer: string) {
	const existing = ACCESS_JWKS.get(issuer);
	if (existing) return existing;

	const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
	ACCESS_JWKS.set(issuer, jwks);
	return jwks;
}

function getEmail(payload: JWTPayload): string | null {
	const email = payload.email;
	if (typeof email === 'string' && email.length > 0) return email;
	return null;
}

export const handle: Handle = async ({ event, resolve }) => {
	const platformEnv = event.platform?.env as AccessEnv | undefined;
	if (import.meta.env.DEV || !platformEnv) {
		event.locals.userEmail = DEV_USER_EMAIL;
		return resolve(event);
	}

	const { CF_ACCESS_AUD, CF_ACCESS_TEAM_DOMAIN } = platformEnv;
	const audience = CF_ACCESS_AUD?.trim();
	const issuer = normalizeTeamDomain(CF_ACCESS_TEAM_DOMAIN ?? '');

	if (!audience || !issuer) {
		return new Response(
			'Cloudflare Access is not configured. Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD.',
			{ status: 500 }
		);
	}

	const accessJwt = event.request.headers.get('CF-Access-JWT-Assertion');
	if (!accessJwt) {
		return new Response('Authentication required.', { status: 401 });
	}

	try {
		const { payload } = await jwtVerify(accessJwt, getAccessJwks(issuer), {
			issuer,
			audience
		});

		const email = getEmail(payload);
		if (!email) {
			return new Response('Access token does not include an email claim.', { status: 403 });
		}

		event.locals.userEmail = email;
	} catch (error) {
		const status = error instanceof errors.JWTExpired ? 401 : 403;
		return new Response('Invalid Cloudflare Access token.', { status });
	}

	return resolve(event);
};
