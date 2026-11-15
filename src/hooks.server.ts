import type { Handle } from '@sveltejs/kit';
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose';
import { verifyApiToken } from '$lib/server/tokens';

const DEV_USER_EMAIL = 'dev@localhost';
const ACCESS_JWKS = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Paths authenticated with personal API tokens instead of Cloudflare Access. */
const TOKEN_AUTH_PATHS = new Set(['/mcp']);

function normalizeTeamDomain(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	const withScheme =
		trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`;
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
	if (typeof email === 'string' && email.length > 0) return email.toLowerCase();
	return null;
}

function unauthorized(message: string): Response {
	return new Response(JSON.stringify({ error: message }), {
		status: 401,
		headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="tiff"' }
	});
}

export const handle: Handle = async ({ event, resolve }) => {
	if (TOKEN_AUTH_PATHS.has(event.url.pathname)) {
		const db = event.platform?.env?.TIFF_DB;
		if (!db) return new Response('Storage is not configured', { status: 500 });

		const header = event.request.headers.get('authorization') ?? '';
		const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
		if (!token) return unauthorized('Missing bearer token. Create one in TIFF Settings → API tokens.');

		const identity = await verifyApiToken(db, token);
		if (!identity) return unauthorized('Invalid or revoked API token');

		event.locals.userEmail = identity.email;
		event.locals.apiTokenId = identity.tokenId;
		return resolve(event);
	}

	if (import.meta.env.DEV) {
		event.locals.userEmail = DEV_USER_EMAIL;
		return resolve(event);
	}

	const platformEnv = event.platform?.env;
	if (!platformEnv) return new Response('Platform bindings are unavailable', { status: 500 });

	const audience = platformEnv.CF_ACCESS_AUD?.trim();
	const issuer = normalizeTeamDomain(platformEnv.CF_ACCESS_TEAM_DOMAIN ?? '');
	if (!audience || !issuer) {
		return new Response('Cloudflare Access is not configured. Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD.', {
			status: 500
		});
	}

	const accessJwt = event.request.headers.get('CF-Access-JWT-Assertion');
	if (!accessJwt) return new Response('Authentication required.', { status: 401 });

	try {
		const { payload } = await jwtVerify(accessJwt, getAccessJwks(issuer), { issuer, audience });
		const email = getEmail(payload);
		if (!email) return new Response('Access token does not include an email claim.', { status: 403 });
		event.locals.userEmail = email;
	} catch (error) {
		const status = error instanceof errors.JWTExpired ? 401 : 403;
		return new Response('Invalid Cloudflare Access token.', { status });
	}

	return resolve(event);
};
