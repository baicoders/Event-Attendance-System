export class AuthError extends Error {
  constructor(message: string, public status = 401, public code?: string) {
    super(message); this.name = 'AuthError';
  }
}
