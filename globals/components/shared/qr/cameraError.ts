const messages={
 PERMISSION:'Camera unavailable. Camera permission was denied. Allow it in this browser’s site settings, then retry or use manual attendance.',
 MISSING_CAMERA:'Camera unavailable. No camera was found. Enable a camera, or use manual attendance.',
 INSECURE:'Camera unavailable. Open the school’s HTTPS website to use the camera, or use manual attendance.',
 API_UNAVAILABLE:'Camera unavailable. Try the school’s website in a supported browser, or use manual attendance.',
 STREAM:'Camera unavailable. Close other camera apps and try again, or use manual attendance.',
 READER:'QR reader unavailable. Reconnect and try the camera again, or use manual attendance.',
} as const;
export class QrCameraError extends Error{constructor(readonly kind:keyof typeof messages){super(messages[kind]);this.name='QrCameraError';}}
export function asCameraError(cause:unknown):QrCameraError{if(cause instanceof QrCameraError)return cause;const name=cause&&typeof cause==='object'&&'name' in cause?String(cause.name):'';return new QrCameraError(['NotAllowedError','SecurityError','PermissionDeniedError'].includes(name)?'PERMISSION':['NotFoundError','DevicesNotFoundError'].includes(name)?'MISSING_CAMERA':'STREAM');}
export function cameraFailureMessage(cause:unknown){return asCameraError(cause).message;}
