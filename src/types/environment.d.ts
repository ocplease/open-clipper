declare namespace NodeJS {
	interface ProcessEnv {
		NODE_ENV?: string;
		TARGET_BROWSER?: 'chrome' | 'firefox' | 'safari';
		NEXT_PUBLIC_SUPABASE_URL?: string;
		NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
	}
}
