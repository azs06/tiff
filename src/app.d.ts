declare global {
	namespace App {
		interface Locals {
			userEmail: string;
		}

		interface Platform {
			env: {
				TIFF_KV: KVNamespace;
				TIFF_DB: D1Database;
				TIFF_ATTACHMENTS: R2Bucket;
				GITHUB_TOKEN?: string;
				CF_ACCESS_AUD?: string;
				CF_ACCESS_TEAM_DOMAIN?: string;
				STORAGE_READ_SOURCE?: 'kv' | 'd1';
				STORAGE_DUAL_WRITE?: 'true' | 'false';
				D1_CANARY_EMAILS?: string;
				MIGRATION_ADMIN_TOKEN?: string;
			};
		}
	}
}

export {};
