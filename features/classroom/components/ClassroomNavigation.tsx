'use client';
import { BarChart3, BookOpen, GraduationCap, LayoutDashboard, QrCode, Settings, Users, Activity } from 'lucide-react';
import Sidebar, { type NavigationItem } from '@/globals/components/shared/Sidebar';
import MobileBottomNav, { type MobileNavigationItem } from '@/globals/components/shared/MobileBottomNav';
const teacherItems: NavigationItem[] = [
  { text: 'Dashboard', route: '/class', icon: LayoutDashboard },
  { text: 'My Classes', route: '/class/classes', icon: BookOpen },
  { text: 'Attendance', route: '/class/attendance', icon: QrCode },
  { text: 'Students', route: '/class/students', icon: Users },
  { text: 'Reports', route: '/class/reports', icon: BarChart3 },
  { text: 'Profile / Settings', route: '/class/settings', icon: Settings },
];
const adminItems: NavigationItem[] = [
  { text: 'Teacher Access', route: '/class/admin/teachers', icon: GraduationCap },
  { text: 'Classes', route: '/class/admin/classes', icon: BookOpen },
  { text: 'Activity', route: '/class/admin/activity', icon: Activity },
  { text: 'Profile / Settings', route: '/account/settings', icon: Settings },
];
const mobileItems: MobileNavigationItem[] = [
  { text: 'Home', route: '/class', icon: LayoutDashboard },
  { text: 'Classes', route: '/class/classes', icon: BookOpen },
  { text: 'Attendance', route: '/class/attendance', icon: QrCode, emphasized: true },
  { text: 'Students', route: '/class/students', icon: Users },
  { text: 'Reports', route: '/class/reports', icon: BarChart3 },
];
export function ClassroomSidebar({ admin = false }: { admin?: boolean }) { return <Sidebar items={admin ? adminItems : teacherItems} workspace="CLASS" />; }
export function ClassroomBottomNav({ admin = false }: { admin?: boolean }) { return <MobileBottomNav compact items={admin ? [...adminItems, { text: 'Attendance', route: '/class', icon: QrCode }] : mobileItems} />; }
