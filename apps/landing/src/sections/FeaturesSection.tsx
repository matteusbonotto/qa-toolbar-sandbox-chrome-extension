import { featureGroups } from "../data/featureGroups";
import { useI18n } from "../i18n/I18nProvider";
import { Icon } from "../components/Icon";

export function FeaturesSection() {
  const { t } = useI18n();

  return (
    <section className="qts-section" id="ferramentas">
      <div className="qts-container">
        <span className="qts-eyebrow">{t.features.eyebrow}</span>
        <h2>{t.features.title}</h2>
        <p className="qts-section-lead">{t.features.lead}</p>

        <div className="qts-feature-groups">
          {featureGroups.map((group) => {
            const groupText = t.features.groups[group.key]!;
            return (
              <div key={group.key} className="qts-feature-group">
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
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
