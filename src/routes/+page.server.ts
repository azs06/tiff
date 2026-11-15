import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { sharedActions } from '$lib/server/actions';

export const load: PageServerLoad = () => {
	redirect(307, '/today');
};

export const actions = sharedActions satisfies Actions;
