declare global {
	namespace App {
		interface Locals {
			userEmail: string;
			/** Set when the request was authenticated with a personal API token (MCP). */
			apiTokenId?: string;
		}

		interface Error {
			message: string;
		}

		interface Platform {
			env: {
				TIFF_DB: D1Database;
				TIFF_ATTACHMENTS: R2Bucket;
				CF_ACCESS_AUD?: string;
				CF_ACCESS_TEAM_DOMAIN?: string;
			};
			context?: ExecutionContext;
		}
	}
}

export {};
