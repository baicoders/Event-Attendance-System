import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asCameraError,QrCameraError } from '@/globals/components/shared/qr/cameraError';
import { eventCameraFailureMessage } from './cameraFailure';
test('Events permission recovery recognizes errors normalized by the shared camera',()=>{
 for(const error of [new DOMException('Denied','NotAllowedError'),asCameraError(new DOMException('Denied','NotAllowedError')),new QrCameraError('PERMISSION')])assert.match(eventCameraFailureMessage(error),/^Camera permission denied\. Allow camera access/);
 assert.match(eventCameraFailureMessage(new QrCameraError('MISSING_CAMERA')),/No camera.*found/);
 assert.match(eventCameraFailureMessage(new QrCameraError('READER')),/manual entry/);
});
