declare global {
	namespace App {
		interface Locals {
			userEmail: string;
		}
		interface Platform {
			env: {
				TIFF_KV: KVNamespace;
			};
		}
	}
}

export {};
