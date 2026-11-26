import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getDirectDatabaseUrl,getPgPoolConfig } from '../globals/libs/dbConfig';
/** Operator commands own and close their pool; the web singleton stays server-owned. */
export function createQrReservationDb(){
 const pool=new Pool({...getPgPoolConfig(getDirectDatabaseUrl()),max:1,connectionTimeoutMillis:5000,idleTimeoutMillis:1000});
 const db=new PrismaClient({adapter:new PrismaPg(pool)});
 return {db,close:async()=>{await db.$disconnect();await pool.end();}};
}
