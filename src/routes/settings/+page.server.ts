import type { Actions, PageServerLoad } from './$types';
import { sharedActions } from '$lib/server/actions';
import { getContext } from '$lib/server/context';
import { listApiTokens } from '$lib/server/tokens';

export const load: PageServerLoad = async (event) => {
	const ctx = await getContext(event);
	return { tokens: await listApiTokens(ctx.db, ctx.user.email), mcpUrl: `${event.url.origin}/mcp` };
};

export const actions = sharedActions satisfies Actions;
