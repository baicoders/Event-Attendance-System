import { AuthError } from '@/globals/utils/authError';
export function classroomRouteBody(raw:unknown,ids:Record<string,string>){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AuthError('Use a JSON command object.',400,'INVALID_REQUEST');
 for(const [key,value] of Object.entries(ids))if(Object.hasOwn(raw,key)&&(raw as Record<string,unknown>)[key]!==value)throw new AuthError('The command identity does not match its route.',400,'ROUTE_ID_MISMATCH');
 return {...raw,...ids};
}
