import { AccountDialogNavigation } from "@/features/auth/components/AccountDialog";
import type { Metadata } from "next";
import { Geist_Mono, Poppins } from "next/font/google";
import "./globals.css";
import QueryProvider from "@/globals/providers/QueryProvider";
import { Toaster } from "@/globals/components/shad-cn/sonner";
import { AuthProvider } from "@/globals/contexts/AuthContext";
import { ConfirmProvider } from "@/globals/contexts/ConfirmModalContext";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Event Attendance System",
  description: "Made by ACLC Programmer Guild",
};

export default function RootLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  modal: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${poppins.variable} ${geistMono.variable} antialiased`}>
        <ConfirmProvider>
          <AuthProvider>
            <QueryProvider><AccountDialogNavigation>{children}{modal}</AccountDialogNavigation></QueryProvider>
          </AuthProvider>
        </ConfirmProvider>
        <Toaster />
      </body>
    </html>
  );
}
