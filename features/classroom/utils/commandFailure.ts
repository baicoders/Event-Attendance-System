import { ApiError } from '@/globals/utils/api';
export function definitiveCommandFailure(cause:unknown){
  return cause instanceof ApiError&&cause.status>=400&&cause.status<500;
}
