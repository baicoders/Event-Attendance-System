export class ImportError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
    this.name = 'ImportError';
  }
}
