import { ApiError } from '@/globals/utils/api';
export function definitiveCommandFailure(cause:unknown){
  return cause instanceof ApiError&&cause.hasValidResponse&&cause.status>=400&&cause.status<500;
}

/** A retry error alone cannot disprove an earlier uncertain commit. */
export function settledCommandFailure(cause:unknown,wasUnconfirmed:boolean){
 return definitiveCommandFailure(cause)&&(!wasUnconfirmed||(cause instanceof ApiError&&cause.details?.commandSettled===true));
}
