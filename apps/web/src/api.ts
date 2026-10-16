export class ApiError extends Error {
  constructor(message: string, public status: number, public fields: Record<string, string[]> = {}, public issues: { field: string; message: string }[] = []) { super(message); }
}
let csrfToken = '';
export function setCsrfToken(value: string) { csrfToken = value; }
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  let response: globalThis.Response;
  try { response = await fetch(`/api/v1${url}`, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...options.headers } }); }
  catch { throw new ApiError('Não foi possível conectar. Confira sua conexão e tente novamente; os campos foram preservados.', 0); }
  if (response.status === 204) return undefined as T;
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error?.message || 'Não foi possível concluir a ação.', response.status, body.error?.fields, body.error?.issues);
  return body as T;
}
