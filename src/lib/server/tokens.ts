// Personal API tokens for the MCP endpoint. Only a SHA-256 hash is stored;
// the plaintext token is shown to the user once, when it is created.

import type { ApiToken } from '$lib/types';
import { invalid, notFound } from './errors';
import * as v from './validate';

const TOKEN_PREFIX = 'tiff_';
const MAX_ACTIVE_TOKENS = 20;
const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000;

function base64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createApiToken(
	db: D1Database,
	email: string,
	rawName: unknown
): Promise<{ token: string; record: ApiToken }> {
	const name = v.requiredText(rawName, 'Token name', v.LIMITS.tokenName);
	const active = await db
		.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE email = ? AND revoked_at IS NULL')
		.bind(email)
		.first<{ n: number }>();
	if ((active?.n ?? 0) >= MAX_ACTIVE_TOKENS) {
		throw invalid(`You can have at most ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.`);
	}

	const token = TOKEN_PREFIX + base64Url(crypto.getRandomValues(new Uint8Array(32)));
	const record: ApiToken = {
		id: crypto.randomUUID(),
		name,
		prefix: token.slice(0, 12),
		createdAt: Date.now(),
		lastUsedAt: null
	};
	await db
		.prepare(
			`INSERT INTO api_tokens (id, email, name, token_hash, token_prefix, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(record.id, email, name, await sha256Hex(token), record.prefix, record.createdAt)
		.run();
	return { token, record };
}

export async function listApiTokens(db: D1Database, email: string): Promise<ApiToken[]> {
	const rows = await db
		.prepare(
			`SELECT id, name, token_prefix, created_at, last_used_at FROM api_tokens
			 WHERE email = ? AND revoked_at IS NULL ORDER BY created_at DESC`
		)
		.bind(email)
		.all<{ id: string; name: string; token_prefix: string; created_at: number; last_used_at: number | null }>();
	return rows.results.map((row) => ({
		id: row.id,
		name: row.name,
		prefix: row.token_prefix,
		createdAt: row.created_at,
		lastUsedAt: row.last_used_at
	}));
}

export async function revokeApiToken(db: D1Database, email: string, tokenId: string): Promise<void> {
	const result = await db
		.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND email = ? AND revoked_at IS NULL')
		.bind(Date.now(), tokenId, email)
		.run();
	if (!result.meta.changes) throw notFound('Token');
}

/** Returns the token's owner, or null when the token is unknown or revoked. */
export async function verifyApiToken(
	db: D1Database,
	token: string
): Promise<{ tokenId: string; email: string } | null> {
	if (!token.startsWith(TOKEN_PREFIX) || token.length > 128) return null;

	const row = await db
		.prepare('SELECT id, email, last_used_at FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL')
		.bind(await sha256Hex(token))
		.first<{ id: string; email: string; last_used_at: number | null }>();
	if (!row) return null;

	const now = Date.now();
	if (!row.last_used_at || now - row.last_used_at > LAST_USED_RESOLUTION_MS) {
		await db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(now, row.id).run();
	}
	return { tokenId: row.id, email: row.email };
}
