/** Approved single-day USWAG preset; private source paths stay outside git. */
import {readFileSync,existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {resolve} from 'node:path';
import {z} from 'zod';
import {executeSetup,SetupError} from './setup-db';
import {describeDatabaseUrl} from '../../globals/libs/dbConfig';
import {validateDatabaseUrl} from './reconcile';

const configSchema=z.object({v:z.literal(1),approved:z.literal(true),inputDir:z.string().min(1),groupApprovals:z.string().min(1)}).strict();
export function loadLocalSetupOptions(){
 let config:z.infer<typeof configSchema>;
 try{config=configSchema.parse(JSON.parse(readFileSync(resolve(process.env.USWAG_SETUP_CONFIG||'.env.uswag-setup.json'),'utf8')));}catch{throw new SetupError('USWAG_LOCAL_SETUP_NOT_CONFIGURED');}
 // The setup target is intentionally explicit and predictable: shell first,
 // otherwise .env. A stale development .env.local cannot redirect hosted setup.
 const fromShell=process.env.DATABASE_URL!==undefined;
 const environmentFile=process.env.USWAG_SETUP_ENV_FILE||'.env';
 if(existsSync(resolve(environmentFile)))loadEnvFile(resolve(environmentFile));
 else if(process.env.USWAG_SETUP_ENV_FILE)throw new SetupError('USWAG_ENV_FILE_NOT_FOUND');
 if(!process.env.DATABASE_URL)throw new SetupError('DATABASE_URL_NOT_CONFIGURED');
 try{validateDatabaseUrl(process.env.DATABASE_URL,true);}catch{throw new SetupError('INVALID_EXPLICIT_DATABASE_TARGET');}
 return {inputDir:config.inputDir,groupApprovals:config.groupApprovals,databaseUrl:process.env.DATABASE_URL,bootstrap:true as const,allowRemote:true,databaseSource:fromShell?'shell environment':environmentFile};
}
export async function runApprovedLocalSetup(dryRun=false){
 const options=loadLocalSetupOptions();
 console.log(`USWAG database: ${describeDatabaseUrl(options.databaseUrl)} (DATABASE_URL from ${options.databaseSource})`);
 const review=await executeSetup(options);
 if(dryRun||review.outcome==='blocked')return review;
 // The operator approved this exact event's definitions and one-command apply.
 // Retain source/state checks and one transaction without manual review flags.
 return executeSetup({...options,apply:true,approvalReport:review.reportPath,approvedEventSetup:true});
}
