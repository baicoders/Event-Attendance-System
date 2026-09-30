import { importHash } from './stateHash';
import type { ImportCommitRequest } from './contract';

/** Mutable roster state is bound by the exact signed review, never read on replay. */
export function hashImportCommand(input: ImportCommitRequest, actorId: string, prepared: {sourceHash:string;normalizedInputHash:string}) {
  return importHash({
    v:input.v, actorId, commandId:input.commandId, fileName:input.fileName,
    previewToken:input.previewToken, sourceFileHash:prepared.sourceHash,
    normalizedInputHash:prepared.normalizedInputHash,
  });
}
