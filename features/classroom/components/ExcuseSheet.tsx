'use client';
import AttendanceCorrectionSheet from './AttendanceCorrectionSheet';
import type { ComponentProps } from 'react';
export default function ExcuseSheet(props:Omit<ComponentProps<typeof AttendanceCorrectionSheet>,'status'>){return <AttendanceCorrectionSheet {...props} status="EXCUSED"/>;}
