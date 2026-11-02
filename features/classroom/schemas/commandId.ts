import { z } from 'zod';
export const commandIdSchema = z.uuid().transform(value => value.toLowerCase());
