import { featureGroups } from "../data/featureGroups";
import { useI18n } from "../i18n/I18nProvider";
import { Icon } from "../components/Icon";
import { Reveal } from "../components/Reveal";

export function FeaturesSection() {
  const { t } = useI18n();

  return (
    <section className="qts-section qts-zone-tint" id="ferramentas">
      <div className="qts-container">
        <Reveal className="qts-section-head">
          <div className="qts-section-head-main">
            <span className="qts-eyebrow">{t.features.eyebrow}</span>
            <h2>{t.features.title}</h2>
          </div>
          <p className="qts-section-head-lead">{t.features.lead}</p>
        </Reveal>

        <div className="qts-feature-groups">
          {featureGroups.map((group, index) => {
            const groupText = t.features.groups[group.key]!;
            return (
              <Reveal key={group.key} delay={Math.min(index * 0.05, 0.3)} className="qts-feature-group">
                <div className="qts-feature-group-head">
                  <span className="qts-feature-group-icon">
                    <Icon name={group.icon} />
                  </span>
                  <div>
                    <h3>{groupText.title}</h3>
                    <p>{groupText.description}</p>
                  </div>
                </div>
                {group.items.length === 1 ? (
                  <p className="qts-feature-item-details qts-feature-item-details-solo">{t.features.items[group.items[0]!.key]!.details}</p>
                ) : (
                  <div className="qts-feature-items">
                    {group.items.map((item) => {
                      const itemText = t.features.items[item.key]!;
                      return (
                        <details key={item.key} className="qts-feature-item">
                          <summary>
                            <span className="qts-feature-item-icon">
                              <Icon name={item.icon} />
                            </span>
                            <span className="qts-feature-item-heading">
                              <b>{itemText.title}</b>
                              <small>{itemText.short}</small>
                            </span>
                            <span className="qts-feature-item-chevron">
                              <Icon name="chevronDown" />
                            </span>
                          </summary>
                          <p className="qts-feature-item-details">{itemText.details}</p>
                        </details>
                      );
                    })}
                  </div>
                )}
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
