declare global {
	namespace App {
		interface Locals {
			userEmail: string;
		}
		interface Platform {
			env: {
				TIFF_KV: KVNamespace;
				TIFF_ATTACHMENTS: R2Bucket;
				GITHUB_TOKEN?: string;
				CF_ACCESS_AUD?: string;
				CF_ACCESS_TEAM_DOMAIN?: string;
			};
		}
	}
}

export {};
