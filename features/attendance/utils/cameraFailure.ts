import { asCameraError } from '@/globals/components/shared/qr/cameraError';
/** Preserve Events recovery copy while accepting the shared capture error contract. */
export function eventCameraFailureMessage(error:unknown){
 const {kind}=asCameraError(error);
 return kind==='PERMISSION'?'Camera permission denied. Allow camera access in your browser, then retry.':kind==='MISSING_CAMERA'?'No camera was found on this device.':'Camera unavailable. Close it and try again, or use manual entry.';
}
