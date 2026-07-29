import type { Metadata } from "next";
import { Literata, Work_Sans } from "next/font/google";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import { AuthProvider } from "@/lib/auth/auth-provider";
import { ToastProvider } from "@/lib/toast/toast-provider";
import { DevicePrefsProvider } from "@/lib/data/device-prefs-provider";
import { ErrorMonitoringInit } from "@/lib/error-monitoring-init";
import "./globals.css";

const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const workSans = Work_Sans({
  variable: "--font-work-sans",
  subsets: ["latin"],
});

const DESCRIPTION = "Save articles, read them clean, and keep what you highlight.";

export const metadata: Metadata = {
  title: { default: "Booklet", template: "%s · Booklet" },
  description: DESCRIPTION,
  applicationName: "Booklet",
  openGraph: {
    title: "Booklet",
    description: DESCRIPTION,
    siteName: "Booklet",
    type: "website",
  },
  // Proprietary, not-yet-deployed software (see README's License section) --
  // nothing here should end up in a search index.
  robots: { index: false, follow: false },
};

const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('booklet-theme');
    var theme = stored === 'light' || stored === 'dark' || stored === 'sepia' || stored === 'kindle'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${literata.variable} ${workSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ErrorMonitoringInit />
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <DevicePrefsProvider>{children}</DevicePrefsProvider>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
