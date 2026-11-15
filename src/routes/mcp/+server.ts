import { createMcpHandler } from '@modelcontextprotocol/server';
import type { RequestHandler } from './$types';
import { getContext } from '$lib/server/context';
import { createMcpServer } from '$lib/server/mcp';

// Streamable HTTP MCP endpoint. hooks.server.ts has already verified the Bearer token.
export const fallback: RequestHandler = async (event) => {
	// MCP servers must reject cross-site browser requests (DNS rebinding protection).
	const origin = event.request.headers.get('origin');
	if (origin && origin !== event.url.origin) {
		return new Response('Origin not allowed', { status: 403 });
	}
	if (!event.locals.apiTokenId) return new Response('Unauthorized', { status: 401 });

	const ctx = await getContext(event);
	const handler = createMcpHandler(() => createMcpServer(ctx, event.url.origin), {
		onerror: (err) => console.error('MCP error', err)
	});

	return handler.fetch(event.request, {
		authInfo: { token: 'redacted', clientId: event.locals.apiTokenId, scopes: ['tasks'] }
	});
};
