import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	if (import.meta.env.DEV) {
		event.locals.userEmail = 'dev@localhost';
	} else {
		const jwt = event.request.headers.get('CF-Access-JWT-Assertion');
		if (jwt) {
			const payload = JSON.parse(atob(jwt.split('.')[1]));
			event.locals.userEmail = payload.email;
		}
	}

	return resolve(event);
};
