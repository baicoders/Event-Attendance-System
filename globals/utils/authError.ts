export class AuthError extends Error {
  constructor(message: string, public status = 401, public code?: string, public details?: Record<string, unknown>) {
    super(message); this.name = 'AuthError';
  }
}
