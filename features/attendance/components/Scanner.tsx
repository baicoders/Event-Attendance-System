"use client";
import { Button } from "@/globals/components/shad-cn/button";
import React, { useState } from "react";
import dynamic from "next/dynamic";
import { IoCameraOutline } from "react-icons/io5";
import { surface } from "@/globals/constants/designTokens";
import { cn } from "@/globals/libs/shad-cn";

// The camera surface (and its ~170KB QR-scanner dependency) is only loaded
// once the user opens the camera, not on the attendance page's first paint.
const ScannerCamera = dynamic(
  () => import("@/features/attendance/components/ScannerCamera"),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[380px] items-center justify-center sm:min-h-[440px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" />
      </div>
    ),
  }
);

type ScannerProps = {
  /** Callback when a text is found by the scanner in a QR or Barcode */
  onRead: (id: string) => void;
  /** Whether a record is currently being saved */
  isPending?: boolean;
  /** The event scans are currently being recorded against, if any. */
  eventId?: string;
  mode?: "TIME_IN" | "TIME_OUT";
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  large?: boolean;
};

/**
 * Camera off state
 */
const CameraOffState = ({ onOpen, disabled = false }: { onOpen: () => void; disabled?: boolean }) => (
  <div className="flex flex-col items-center justify-center px-4 py-6 sm:py-8">
    <IoCameraOutline className="size-16 text-slate-400 mb-4 sm:size-24 sm:mb-6 md:size-28" />
    <p className="text-base font-medium text-slate-600 mb-4 text-center sm:text-lg sm:mb-6">
      {disabled ? "Scanning paused until this result is reviewed" : "Turn on camera to start attendance"}
    </p>
    <Button
      onClick={onOpen}
      disabled={disabled}
      size="lg"
      className="text-sm px-6 py-4 sm:text-base sm:px-8 sm:py-6"
    >
      Open Camera
    </Button>
  </div>
);

/**
 * Scanner component for QR code and barcode scanning
 */
const Scanner = ({ onRead, isPending = false, eventId, mode, isOpen, onOpenChange, large = false }: ScannerProps) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const cameraOpen = isOpen ?? internalOpen;
  const setCameraOpen = (open: boolean) => {
    if (open) setCameraError(null);
    onOpenChange?.(open);
    if (isOpen === undefined) setInternalOpen(open);
  };

  const handleCameraError = (error: unknown) => {
    const name = error instanceof Error ? error.name : "";
    setCameraError(name === "NotAllowedError" || name === "PermissionDeniedError"
      ? "Camera permission denied. Allow camera access in your browser, then retry."
      : name === "NotFoundError" || name === "DevicesNotFoundError"
      ? "No camera was found on this device."
      : "Camera unavailable. Close it and try again, or use manual entry.");
    setCameraOpen(false);
  };

  return (
    <div
      className={cn(
        surface.card,
        large ? "flex h-[420px] flex-col items-center justify-center overflow-hidden p-4 sm:h-[540px]" :
        "flex h-[380px] flex-col items-center justify-center overflow-hidden p-4 sm:h-[440px]"
      )}
    >
      {cameraOpen ? (
        <ScannerCamera
          onRead={onRead}
          isPending={isPending}
          onClose={() => setCameraOpen(false)}
          eventId={eventId}
          mode={mode}
          onError={handleCameraError}
        />
      ) : (
        <div className="text-center">
          {cameraError && <p role="alert" className="mb-3 text-sm font-medium text-rose-700">{cameraError}</p>}
          <CameraOffState onOpen={() => setCameraOpen(true)} disabled={isPending} />
        </div>
      )}
    </div>
  );
};

export default Scanner;
