import { HeroSection } from "./sections/HeroSection";
import { AboutSection } from "./sections/AboutSection";
import { SemiAutoSection } from "./sections/SemiAutoSection";
import { PricingSection } from "./sections/PricingSection";
import { SupportSection } from "./sections/SupportSection";
import { Footer } from "./sections/Footer";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicyPage";
import { ParticleBackground } from "./components/ParticleBackground";
import { SiteNavToolbar } from "./components/SiteNavToolbar";

export default function App() {
  const isPrivacyPage = window.location.pathname === "/privacidade";

  if (isPrivacyPage) {
    return (
      <>
        <ParticleBackground />
        <div className="qts-page-content">
          <PrivacyPolicyPage />
          <Footer />
        </div>
      </>
    );
  }

  return (
    <>
      <ParticleBackground />
      <SiteNavToolbar />
      <div className="qts-page-content">
        <main>
          <HeroSection />
          <AboutSection />
          <SemiAutoSection />
          <PricingSection />
          <SupportSection />
        </main>
        <Footer />
      </div>
    </>
  );
}
