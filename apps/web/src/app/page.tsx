import type { Metadata } from "next";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingHero } from "@/components/landing/landing-hero";
import { LandingLoop } from "@/components/landing/landing-loop";
import { LandingShowcase } from "@/components/landing/landing-showcase";
import { LandingLocalFirst } from "@/components/landing/landing-local-first";
import { LandingFeatures } from "@/components/landing/landing-features";
import { LandingDevelopers } from "@/components/landing/landing-developers";
import { LandingFaq } from "@/components/landing/landing-faq";
import { LandingCta } from "@/components/landing/landing-cta";

/**
 * The marketing page. Deliberately a server component all the way down
 * except for the theme switcher in the nav -- there's no state on this page,
 * so shipping JS for it would only slow down the one screen a first-time
 * visitor judges the app by.
 *
 * Section order follows the argument rather than a feature inventory: what
 * the product is (hero), the loop that makes it different (loop), the three
 * things done properly that competitors don't (showcase), the objection
 * everyone has about read-it-later apps -- "do I have to sign up"
 * (local-first), then the long tail of features, then the API for the people
 * who read this far.
 */
export const metadata: Metadata = {
  description:
    "Booklet saves articles, PDFs, and EPUBs, renders them properly, and brings your highlights back on a real spaced-repetition schedule. Works offline. No account required.",
};

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <LandingNav />
      <main className="flex-1">
        <LandingHero />
        <LandingLoop />
        <LandingShowcase />
        <LandingLocalFirst />
        <LandingFeatures />
        <LandingDevelopers />
        <LandingFaq />
        <LandingCta />
      </main>
    </div>
  );
}
