import { Reveal } from "../components/Reveal";
import { Icon } from "../components/Icon";
import { tutorialVideos } from "../data/tutorialVideos";
import { useI18n } from "../i18n/I18nProvider";

export function TutorialVideosSection() {
  const { t } = useI18n();
  const base = import.meta.env.BASE_URL;

  return (
    <section className="qts-section qts-tutorials" id="tutoriais">
      <div className="qts-container">
        <Reveal className="qts-section-head">
          <div className="qts-section-head-main">
            <span className="qts-eyebrow">{t.tutorials.eyebrow}</span>
            <h2>{t.tutorials.title}</h2>
          </div>
          <p className="qts-section-head-lead">{t.tutorials.lead}</p>
        </Reveal>

        <div className="qts-tutorial-grid">
          {tutorialVideos.map((tutorial, index) => {
            const item = t.features.items[tutorial.key];
            if (!item) return null;
            return (
              <Reveal key={tutorial.key} delay={Math.min(index * 0.05, 0.25)} className="qts-tutorial-card">
                <video
                  className="qts-tutorial-video"
                  controls
                  preload="none"
                  poster={`${base}tutorial-videos/${tutorial.file}.png`}
                  aria-label={item.title}
                >
                  <source src={`${base}tutorial-videos/${tutorial.file}.webm`} type="video/webm" />
                </video>
                <div className="qts-tutorial-card-body">
                  <span className="qts-tutorial-card-icon">
                    <Icon name={tutorial.icon} />
                  </span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.short}</p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
