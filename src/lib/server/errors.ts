export type ServiceErrorCode = 'not_found' | 'forbidden' | 'invalid' | 'conflict';

/** An expected failure whose message is safe to show to the user or MCP client. */
export class ServiceError extends Error {
	constructor(
		readonly code: ServiceErrorCode,
		message: string
	) {
		super(message);
		this.name = 'ServiceError';
	}

	get status(): number {
		switch (this.code) {
			case 'not_found':
				return 404;
			case 'forbidden':
				return 403;
			case 'conflict':
				return 409;
			default:
				return 400;
		}
	}
}

export const notFound = (what: string) => new ServiceError('not_found', `${what} not found`);
export const forbidden = (message: string) => new ServiceError('forbidden', message);
export const invalid = (message: string) => new ServiceError('invalid', message);
