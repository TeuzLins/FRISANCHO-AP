export function canonicalJSON(value: unknown): string;
export function payloadHash(value: unknown): string;
export function databaseErrorCategory(error: unknown): string;
export function prepareDatabase(env?: Record<string, string | undefined>): { url: string; local: boolean; cleanup(): void };
export function restrictPrivateFile(file: string): void;
