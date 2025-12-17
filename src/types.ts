export interface Activity {
	application_id?: string;
	name?: string;
	details?: string;
	state?: string;
	type?: number;
	timestamps?: {
		start?: number;
		end?: number;
	};
	assets?: {
		large_image?: string;
		large_text?: string;
		small_image?: string;
		small_text?: string;
	};
	buttons?: { url: string; label: string }[];
	instance?: boolean;
	flags?: number;
	metadata?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface BridgeMessage {
	socketId: string;
	activity: Activity | null;
	pid?: number;
	[key: string]: unknown;
}

export type ProcessEntry = [number, string, string[], string | undefined];
