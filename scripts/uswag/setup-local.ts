/** Approved single-day USWAG preset; private source paths stay outside git. */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {z} from 'zod';
import {executeSetup,SetupError} from './setup-db';

const configSchema=z.object({v:z.literal(1),approved:z.literal(true),inputDir:z.string().min(1),groupApprovals:z.string().min(1)}).strict();
export async function runApprovedLocalSetup(dryRun=false){
 let config:z.infer<typeof configSchema>;
 try{config=configSchema.parse(JSON.parse(readFileSync(resolve(process.env.USWAG_SETUP_CONFIG||'.env.uswag-setup.json'),'utf8')));}catch{throw new SetupError('USWAG_LOCAL_SETUP_NOT_CONFIGURED');}
 // Use the same environment loading/precedence as the local Next.js server.
 const ownRequire=createRequire(import.meta.url);
 const nextRequire=createRequire(ownRequire.resolve('next/package.json'));
 const {loadEnvConfig}=nextRequire('@next/env') as {loadEnvConfig:(directory:string,dev:boolean,logger:{info:()=>void;error:()=>void})=>unknown};
 loadEnvConfig(process.cwd(),process.env.NODE_ENV!=='production',{info:()=>undefined,error:()=>undefined});
 if(!process.env.DATABASE_URL)throw new SetupError('DATABASE_URL_NOT_CONFIGURED');
 const options={inputDir:config.inputDir,groupApprovals:config.groupApprovals,databaseUrl:process.env.DATABASE_URL};
 const review=await executeSetup(options);
 if(dryRun||review.outcome==='blocked')return review;
 // The operator approved this exact event's definitions and one-command apply.
 // Retain source/state checks and one transaction without manual review flags.
 return executeSetup({...options,apply:true,approvalReport:review.reportPath,approvedEventSetup:true});
}
