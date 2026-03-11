import type { Actions } from './$types';
import { sharedActions } from '$lib/server/shared-actions';

export const actions = sharedActions satisfies Actions;
