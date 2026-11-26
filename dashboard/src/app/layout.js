import { Manrope } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const manrope = Manrope({
  variable: "--font-kreo",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#09090f",
  colorScheme: "dark",
};

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "MOON Dashboard | Discord Music Dashboard",
    template: "%s | MOON",
  },
  description:
    "MOON Dashboard is a real-time Discord music dashboard for controlling playback, queue, and server music settings with a modern web interface.",
  applicationName: "MOON Dashboard",
  keywords: [
    "MOON",
    "MOON Dashboard",
    "Discord music bot",
    "Discord music dashboard",
    "music bot dashboard",
    "Discord queue control",
    "Discord playback control",
    "Discord server music",
    "real-time music dashboard",
  ],
  authors: [{ name: "MOON" }],
  creator: "MOON",
  publisher: "MOON",
  category: "technology",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "MOON Dashboard",
    title: "MOON Dashboard | Discord Music Dashboard",
    description:
      "Control music, queue, playback, and server music settings from a fast real-time Discord dashboard built for MOON.",
    images: [
      {
        url: "/branding/kreo-banner-v2.webp",
        width: 1600,
        height: 640,
        alt: "MOON Dashboard preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "MOON Dashboard | Discord Music Dashboard",
    description:
      "Real-time Discord music control with MOON Dashboard.",
    images: ["/branding/kreo-banner-v2.webp"],
  },
  appleWebApp: {
    capable: true,
    title: "MOON Dashboard",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/branding/kreo-icon-192-v2.png",
    shortcut: "/branding/kreo-icon-192-v2.png",
    apple: "/branding/kreo-icon-192-v2.png",
  },
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
