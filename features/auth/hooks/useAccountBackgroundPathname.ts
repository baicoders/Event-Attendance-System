'use client';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
/** Retained workspace navigation keeps its originating selection under account overlays. */
export function useAccountBackgroundPathname() {
 const pathname = usePathname();
 const [background, setBackground] = useState(pathname);
 const overlay = pathname === '/account/settings' || pathname === '/account/events-access';
 if (!overlay && background !== pathname) setBackground(pathname);
 return overlay ? background : pathname;
}
