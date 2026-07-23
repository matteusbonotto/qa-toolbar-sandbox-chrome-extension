import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useI18n } from "../i18n/I18nProvider";
import { supabase } from "../lib/supabaseClient";
import { openAccountModal } from "../lib/accountModal";

const STORE_URL =
  "https://chromewebstore.google.com/detail/ddaapjklnfjhjigeglgmjmadjnmdodfe";
const CAMPAIGN_KEY = "launch-2026-full-30d";
type Submission = {
  status: "pending" | "approved" | "rejected";
  review_notes: string | null;
  review_criteria: Record<string, boolean>;
  resubmission_count: number;
};

const copy = {
  "pt-BR": {
    eyebrow: "Comunidade pioneira",
    title: "Compartilhe sua experiência e conquiste 30 dias Full",
    lead: "Versão inicial liberada para uso e testes. As evidências são analisadas por uma pessoa e a recompensa pode ser recebida apenas uma vez por usuário.",
    affiliateTitle: "Programa de afiliados",
    affiliateBody:
      "Indique a QA Toolbar Sandbox para profissionais e times de QA usando seu link exclusivo.",
    affiliateOffers: "O que você oferece",
    affiliateOffersBody:
      "Seu indicado conhece a ferramenta, cria a própria conta e escolhe livremente um plano. O link não aumenta o preço da assinatura.",
    affiliateEarns: "O que você ganha",
    affiliateEarnsBody:
      "A cada indicado que concluir o primeiro pagamento válido, você recebe 30 dias adicionais do plano Regression Runner. Não é dinheiro nem comissão.",
    affiliateRules:
      "A recompensa é liberada após a confirmação do pagamento. Autoindicação, contas duplicadas, pagamentos reembolsados e spam não são elegíveis.",
    link: "Seu link exclusivo",
    copy: "Copiar",
    copied: "Link copiado.",
    signIn: "Entrar para participar",
    invited: "indicados",
    qualified: "recompensados",
    missionTitle: "Missão: +30 dias de acesso Full",
    missionBody:
      "Envie duas publicações públicas e um feedback útil. A equipe confere cada requisito antes da liberação.",
    social: "Publicação em uma rede social",
    linkedin: "Publicação no LinkedIn",
    feedback: "Feedback para o produto",
    url: "https://...",
    feedbackPlaceholder:
      "Conte o que ajudou no seu trabalho, o que atrapalhou e o que pode melhorar.",
    disclosure:
      "Confirmo que as publicações informam que participo de uma campanha que pode conceder 30 dias de acesso.",
    submit: "Enviar para análise",
    resubmit: "Reenviar evidências",
    pending: "Em análise",
    approved: "Aprovada: 30 dias Full liberados",
    rejected: "Ajustes necessários",
    pendingHelp:
      "Recebemos suas evidências. Você verá a decisão e o motivo aqui.",
    approvedHelp:
      "Todos os requisitos foram comprovados. Este benefício único já foi utilizado.",
    requirements: "O que será verificado",
    reqs: [
      "Os dois links abrem publicamente e pertencem ao participante.",
      "As publicações explicam como a ferramenta ajudou no trabalho.",
      "A divulgação da campanha está visível nas publicações.",
      "O feedback tem exemplos concretos e sugestões úteis.",
    ],
    notes: "Retorno da análise",
    saved: "Evidências enviadas. Acompanhe o resultado nesta página.",
    invalid:
      "Revise os campos: use links HTTPS públicos e diferentes, um deles do LinkedIn, aceite a divulgação e escreva ao menos 40 caracteres.",
    unavailable: "Não foi possível carregar a campanha agora.",
    optionalReview:
      "A avaliação na Chrome Web Store é voluntária, não faz parte da missão e não gera recompensa.",
    review: "Avaliar voluntariamente",
  },
  es: {
    eyebrow: "Comunidad pionera",
    title: "Comparte tu experiencia y consigue 30 días Full",
    lead: "Versión inicial disponible para pruebas. Una persona revisa las pruebas y la recompensa solo se concede una vez por usuario.",
    affiliateTitle: "Programa de afiliados",
    affiliateBody:
      "Recomienda QA Toolbar Sandbox a profesionales y equipos de QA con tu enlace exclusivo.",
    affiliateOffers: "Qué ofreces",
    affiliateOffersBody:
      "Tu referido conoce la herramienta, crea su cuenta y elige libremente un plan. El enlace no aumenta el precio.",
    affiliateEarns: "Qué recibes",
    affiliateEarnsBody:
      "Por cada referido que complete su primer pago válido, recibes 30 días adicionales de Regression Runner. No es dinero ni comisión.",
    affiliateRules:
      "La recompensa se libera tras confirmar el pago. No aplican autorreferidos, cuentas duplicadas, reembolsos ni spam.",
    link: "Tu enlace exclusivo",
    copy: "Copiar",
    copied: "Enlace copiado.",
    signIn: "Entrar para participar",
    invited: "referidos",
    qualified: "recompensados",
    missionTitle: "Misión: +30 días Full",
    missionBody:
      "Envía dos publicaciones públicas y feedback útil. El equipo verifica cada requisito.",
    social: "Publicación en una red social",
    linkedin: "Publicación en LinkedIn",
    feedback: "Feedback del producto",
    url: "https://...",
    feedbackPlaceholder:
      "Explica qué ayudó, qué dificultó y qué puede mejorar.",
    disclosure:
      "Confirmo que las publicaciones indican que participo en una campaña que puede conceder 30 días.",
    submit: "Enviar para revisión",
    resubmit: "Reenviar pruebas",
    pending: "En revisión",
    approved: "Aprobada: 30 días Full concedidos",
    rejected: "Se necesitan ajustes",
    pendingHelp: "Recibimos tus pruebas. La decisión aparecerá aquí.",
    approvedHelp:
      "Se comprobaron todos los requisitos. Este beneficio único ya fue utilizado.",
    requirements: "Qué verificaremos",
    reqs: [
      "Ambos enlaces son públicos y pertenecen al participante.",
      "Las publicaciones explican cómo ayudó la herramienta.",
      "La divulgación de la campaña está visible.",
      "El feedback contiene ejemplos y sugerencias útiles.",
    ],
    notes: "Respuesta de la revisión",
    saved: "Pruebas enviadas.",
    invalid:
      "Usa enlaces HTTPS públicos y distintos, uno de LinkedIn, acepta la divulgación y escribe al menos 40 caracteres.",
    unavailable: "Campaña no disponible.",
    optionalReview:
      "La reseña en Chrome Web Store es voluntaria y no genera recompensa.",
    review: "Valorar voluntariamente",
  },
  en: {
    eyebrow: "Pioneer community",
    title: "Share your experience and earn 30 Full days",
    lead: "Initial release open for testing. Evidence is reviewed by a person and the reward can only be granted once per user.",
    affiliateTitle: "Affiliate program",
    affiliateBody:
      "Recommend QA Toolbar Sandbox to QA professionals and teams with your unique link.",
    affiliateOffers: "What you offer",
    affiliateOffersBody:
      "Your referral can explore the tool, create an account, and freely choose a plan. The link never increases their price.",
    affiliateEarns: "What you earn",
    affiliateEarnsBody:
      "For every referral who completes a valid first payment, you receive 30 additional Regression Runner days. This is not cash or commission.",
    affiliateRules:
      "Rewards are granted after payment confirmation. Self-referrals, duplicate accounts, refunded payments, and spam are not eligible.",
    link: "Your unique link",
    copy: "Copy",
    copied: "Link copied.",
    signIn: "Sign in to participate",
    invited: "referrals",
    qualified: "rewarded",
    missionTitle: "Mission: +30 Full days",
    missionBody:
      "Submit two public posts and useful feedback. The team checks every requirement.",
    social: "Social network post",
    linkedin: "LinkedIn post",
    feedback: "Product feedback",
    url: "https://...",
    feedbackPlaceholder:
      "Explain what helped, what got in the way, and what could improve.",
    disclosure:
      "I confirm the posts disclose that I am taking part in a campaign that may grant 30 days.",
    submit: "Submit for review",
    resubmit: "Resubmit evidence",
    pending: "Under review",
    approved: "Approved: 30 Full days granted",
    rejected: "Changes required",
    pendingHelp: "We received your evidence. The decision will appear here.",
    approvedHelp:
      "Every requirement was verified. This one-time benefit has been used.",
    requirements: "What we verify",
    reqs: [
      "Both links are public and belong to the participant.",
      "Posts explain how the tool helped at work.",
      "Campaign disclosure is visible in the posts.",
      "Feedback includes concrete examples and useful suggestions.",
    ],
    notes: "Review feedback",
    saved: "Evidence submitted.",
    invalid:
      "Use different public HTTPS links, one from LinkedIn, accept disclosure, and write at least 40 characters.",
    unavailable: "Campaign unavailable.",
    optionalReview:
      "Chrome Web Store reviews are voluntary and do not earn rewards.",
    review: "Review voluntarily",
  },
};

export function CommunityCampaignSection() {
  const { locale } = useI18n();
  const t = copy[locale as keyof typeof copy] || copy.en;
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<{
    referral_code: string;
    qualified_referrals: number;
  } | null>(null);
  const [referralCount, setReferralCount] = useState(0);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [socialUrl, setSocialUrl] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [feedback, setFeedback] = useState("");
  const [disclosure, setDisclosure] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const affiliateLink = useMemo(
    () =>
      profile
        ? `${location.origin}${import.meta.env.BASE_URL}?ref=${profile.referral_code}#comunidade`
        : "",
    [profile],
  );
  useEffect(() => {
    const incoming = new URLSearchParams(location.search)
      .get("ref")
      ?.toUpperCase();
    if (/^QTS-[A-F0-9]{8}$/.test(incoming || ""))
      localStorage.setItem("qts-referral-code", incoming!);
    if (!supabase) return;
    void supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session || !supabase) return;
    const client = supabase;
    const code = localStorage.getItem("qts-referral-code");
    if (code)
      void client.functions
        .invoke("referral-track", { body: { referralCode: code } })
        .finally(() => localStorage.removeItem("qts-referral-code"));
    void Promise.all([
      client
        .from("referral_profiles")
        .select("referral_code,qualified_referrals")
        .eq("user_id", session.user.id)
        .maybeSingle(),
      client
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("referrer_user_id", session.user.id),
      client
        .from("engagement_campaign_submissions")
        .select("status,review_notes,review_criteria,resubmission_count")
        .eq("user_id", session.user.id)
        .eq("campaign_key", CAMPAIGN_KEY)
        .maybeSingle(),
    ]).then(([p, r, s]) => {
      if (p.data) setProfile(p.data);
      setReferralCount(r.count || 0);
      if (s.data) setSubmission(s.data as Submission);
    });
  }, [session]);
  const submit = async () => {
    if (!session) {
      openAccountModal();
      return;
    }
    let social: URL, linked: URL;
    try {
      social = new URL(socialUrl);
      linked = new URL(linkedinUrl);
    } catch {
      setMessage(t.invalid);
      return;
    }
    const valid =
      social.protocol === "https:" &&
      linked.protocol === "https:" &&
      social.href !== linked.href &&
      /(^|\.)linkedin\.com$/i.test(linked.hostname) &&
      feedback.trim().length >= 40 &&
      disclosure;
    if (!valid || !supabase) {
      setMessage(t.invalid);
      return;
    }
    setBusy(true);
    setMessage("");
    const payload = {
      user_id: session.user.id,
      campaign_key: CAMPAIGN_KEY,
      social_post_url: social.href,
      linkedin_post_url: linked.href,
      product_feedback: feedback.trim(),
      disclosure_confirmed: true,
      status: "pending",
      submitted_at: new Date().toISOString(),
      review_notes: null,
      review_criteria: {},
      resubmission_count:
        (submission?.resubmission_count || 0) +
        (submission?.status === "rejected" ? 1 : 0),
    };
    const { error } = await supabase
      .from("engagement_campaign_submissions")
      .upsert(payload, { onConflict: "user_id,campaign_key" });
    setBusy(false);
    if (error) {
      setMessage(t.unavailable);
      return;
    }
    setSubmission({ ...payload, review_notes: null } as Submission);
    setMessage(t.saved);
  };
  const locked =
    submission?.status === "pending" || submission?.status === "approved";
  return (
    <section id="comunidade" className="qts-section qts-community">
      <div className="qts-container">
        <p className="qts-eyebrow">{t.eyebrow}</p>
        <h2>{t.title}</h2>
        <p className="qts-section-lead">{t.lead}</p>
        <div className="qts-community-grid">
          <article className="qts-community-card">
            <h3>{t.affiliateTitle}</h3>
            <p>{t.affiliateBody}</p>
            <dl className="qts-affiliate-value">
              <div>
                <dt>{t.affiliateOffers}</dt>
                <dd>{t.affiliateOffersBody}</dd>
              </div>
              <div>
                <dt>{t.affiliateEarns}</dt>
                <dd>{t.affiliateEarnsBody}</dd>
              </div>
            </dl>
            <p className="qts-affiliate-rules">{t.affiliateRules}</p>
            {!session ? (
              <button
                className="qts-button qts-button-primary"
                onClick={openAccountModal}
              >
                {t.signIn}
              </button>
            ) : profile ? (
              <>
                <label>
                  {t.link}
                  <div className="qts-copy-field">
                    <input readOnly value={affiliateLink} />
                    <button
                      type="button"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(affiliateLink)
                          .then(() => setMessage(t.copied))
                      }
                    >
                      {t.copy}
                    </button>
                  </div>
                </label>
                <p className="qts-campaign-stats">
                  <b>{referralCount}</b> {t.invited} ·{" "}
                  <b>{profile.qualified_referrals}</b> {t.qualified}
                </p>
              </>
            ) : (
              <p>{t.unavailable}</p>
            )}
          </article>
          <article className="qts-community-card">
            <h3>{t.missionTitle}</h3>
            <p>{t.missionBody}</p>
            <div className="qts-requirements">
              <strong>{t.requirements}</strong>
              <ul>
                {t.reqs.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <fieldset className="qts-mission-list" disabled={locked}>
              <label>
                <b>{t.social}</b>
                <input
                  value={socialUrl}
                  onChange={(e) => setSocialUrl(e.target.value)}
                  placeholder={t.url}
                />
              </label>
              <label>
                <b>{t.linkedin}</b>
                <input
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  placeholder={t.url}
                />
              </label>
              <label>
                <b>{t.feedback}</b>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={4}
                  placeholder={t.feedbackPlaceholder}
                />
              </label>
              <label className="qts-disclosure">
                <input
                  type="checkbox"
                  checked={disclosure}
                  onChange={(e) => setDisclosure(e.target.checked)}
                />
                <span>{t.disclosure}</span>
              </label>
            </fieldset>
            <button
              className="qts-button qts-button-primary"
              disabled={busy || locked}
              onClick={submit}
            >
              {!session
                ? t.signIn
                : submission?.status === "rejected"
                  ? t.resubmit
                  : t.submit}
            </button>
            {submission && (
              <div
                className={`qts-campaign-status is-${submission.status}`}
                role="status"
              >
                <strong>
                  {submission.status === "approved"
                    ? t.approved
                    : submission.status === "rejected"
                      ? t.rejected
                      : t.pending}
                </strong>
                <p>
                  {submission.review_notes ||
                    (submission.status === "approved"
                      ? t.approvedHelp
                      : t.pendingHelp)}
                </p>
              </div>
            )}
          </article>
        </div>
        <p className="qts-optional-review">
          {t.optionalReview}{" "}
          <a href={STORE_URL} target="_blank" rel="noreferrer">
            {t.review}
          </a>
        </p>
        {message && (
          <p role="status" className="qts-form-status">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
