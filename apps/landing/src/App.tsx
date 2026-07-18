import { HeroSection } from "./sections/HeroSection";
import { AboutSection } from "./sections/AboutSection";
import { SemiAutoSection } from "./sections/SemiAutoSection";
import { FeaturesSection } from "./sections/FeaturesSection";
import { PricingSection } from "./sections/PricingSection";
import { SupportSection } from "./sections/SupportSection";
import { Footer } from "./sections/Footer";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicyPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { ParticleBackground } from "./components/ParticleBackground";
import { SiteNavToolbar } from "./components/SiteNavToolbar";

function matchesPath(pathname: string, routeName: string): boolean {
  const route = `${import.meta.env.BASE_URL}${routeName}`;
  return pathname === route || pathname === `${route}/`;
}

export default function App() {
  const pathname = window.location.pathname;
  const isPrivacyPage = matchesPath(pathname, "privacidade");
  const isResetPasswordPage = matchesPath(pathname, "redefinir-senha");

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

  if (isResetPasswordPage) {
    return (
      <>
        <ParticleBackground />
        <div className="qts-page-content">
          <ResetPasswordPage />
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
          <FeaturesSection />
          <PricingSection />
          <SupportSection />
        </main>
        <Footer />
      </div>
    </>
  );
}
