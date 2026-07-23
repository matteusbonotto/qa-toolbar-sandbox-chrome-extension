import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useI18n } from "../i18n/I18nProvider";
import { supabase } from "../lib/supabaseClient";
import { openAccountModal } from "../lib/accountModal";

const STORE_URL = "https://chromewebstore.google.com/detail/ddaapjklnfjhjigeglgmjmadjnmdodfe";
const CAMPAIGN_KEY = "qa-rewards-2026-community";
const WHEEL_COLORS = ["#6c3df4", "#13a6a1", "#e6a817", "#d94c72", "#4187e8", "#8a4fff", "#0f8f8a", "#c2662f"];
const WHEEL_SPIN_MS = 3200;

// Synthesized (no audio assets to ship/load) — a short square-wave tick per call, and a 4-note
// ascending chime on a real win. One shared AudioContext, created lazily on first use since some
// browsers refuse to start one before a user gesture (the wheel is always click-triggered, so
// this is safe).
let sharedAudioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioCtx) sharedAudioCtx = new Ctor();
  return sharedAudioCtx;
}
function playWheelTick(volume: number) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 1500;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  } catch { /* audio is a nice-to-have, never block the spin over it */ }
}
function scheduleWheelTicks(totalMs: number) {
  const tickCount = 30;
  for (let i = 0; i < tickCount; i++) {
    const progress = i / (tickCount - 1);
    const eased = 1 - (1 - progress) * (1 - progress); // ease-out: ticks bunch up early, spread out near the stop
    window.setTimeout(() => playWheelTick(0.05 + 0.07 * (1 - progress)), eased * totalMs);
  }
}
function playWheelSuccessChime() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch { /* same as above */ }
}
// Lightweight canvas confetti burst — self-removing, no external library/dependency.
function fireWheelConfetti() {
  if (typeof document === "undefined") return;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;z-index:10001;pointer-events:none;";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) { canvas.remove(); return; }
  const particles = Array.from({ length: 140 }, () => ({
    x: canvas.width / 2, y: canvas.height / 2 - 60,
    vx: (Math.random() - 0.5) * 15, vy: -6 - Math.random() * 9,
    size: 4 + Math.random() * 5, color: WHEEL_COLORS[Math.floor(Math.random() * WHEEL_COLORS.length)] || "#6c3df4",
    rotation: Math.random() * 360, spin: (Math.random() - 0.5) * 22,
  }));
  let frame = 0;
  const maxFrames = 120;
  const step = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      p.vy += 0.32; p.x += p.vx; p.y += p.vy; p.rotation += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    frame += 1;
    if (frame < maxFrames) requestAnimationFrame(step);
    else canvas.remove();
  };
  requestAnimationFrame(step);
}
type Submission = { status:"pending"|"approved"|"rejected"; review_notes:string|null; review_criteria:Record<string,boolean>; resubmission_count:number };
type Wallet = { available_points:number; pending_points:number; lifetime_points:number; spent_points:number; debt_points:number };
type Prize = { id:string; key:string; label_pt:string; label_es:string; label_en:string; weight:number; minimum_lifetime_points:number; kind:"discount_percent"|"plan_days"; discount_percent:number|null; grant_days:number|null };
type Benefit = { id:string; kind:string; discount_percent:number|null; grant_days:number|null; status:string; expires_at:string; created_at:string };
type Entry = { id:string; event_kind:string; points:number; status:string; reason:string|null; created_at:string };
type SpinResult = { spin_id:string; prize_key:string; prize_label_pt:string; prize_label_es:string; prize_label_en:string; benefit_id:string; remaining_points:number };

const copy = {
  "pt-BR": { eyebrow:"QA Rewards",title:"Acumule pontos e desbloqueie benefícios",lead:"Atividades válidas geram pontos após confirmação. A cada 100 pontos, você libera um giro seguro.",how:"Como funciona",steps:["Indique alguém: o primeiro pagamento válido vale 100 pontos.","Relato público aprovado vale 40 pontos e feedback útil vale 20.","Use 100 pontos para girar. O prêmio é definido com segurança no servidor."],affiliate:"Seu link de indicação",offers:"O indicado conhece a ferramenta e escolhe livremente um plano, sem pagar mais por usar seu link.",rules:"Autoindicação, duplicidade, spam, estorno e chargeback não pontuam. Pontos indevidos podem ser revertidos.",signIn:"Entrar para participar",copy:"Copiar",copied:"Link copiado.",invited:"indicados",qualified:"pagamentos válidos",balance:"Saldo disponível",pending:"Pontos pendentes",lifetime:"Pontos acumulados",spins:"Giros disponíveis",progress:"Progresso para o próximo giro",wheel:"Roleta de benefícios",tryLuck:"Tentar a sorte",tryLuckHint:"Cada giro custa 100 pontos. Você tem",random:"O resultado é aleatório, definido no servidor e registrado no seu histórico.",spin:"Girar por 100 pontos",spinning:"Processando giro...",confirm:"Este giro consumirá 100 pontos. Deseja continuar?",notEnough:"Você ainda não tem 100 pontos disponíveis.",odds:"Chances disponíveis para sua faixa",benefits:"Seus benefícios",ledger:"Extrato de pontos",emptyBenefits:"Nenhum benefício conquistado ainda.",emptyLedger:"Seu extrato aparecerá aqui.",mission:"Atividades da comunidade: até 60 pontos",missionBody:"Envie um relato público com divulgação da campanha e um feedback útil. A equipe valida as provas antes de creditar 40 + 20 pontos.",social:"Relato público",linkedin:"Publicação no LinkedIn",feedback:"Feedback do produto",feedbackPlaceholder:"Explique o que ajudou, o que atrapalhou e o que pode melhorar.",disclosure:"Confirmo que as publicações informam que participo de uma campanha de pontos.",submit:"Enviar para análise",resubmit:"Reenviar evidências",missionPending:"Em análise",missionApproved:"Aprovada: 60 pontos creditados",missionRejected:"Ajustes necessários",invalid:"Use links HTTPS públicos e diferentes, um do LinkedIn, confirme a divulgação e escreva ao menos 40 caracteres.",saved:"Evidências enviadas. Acompanhe a análise aqui.",unavailable:"Não foi possível carregar o programa agora.",reviewSuggestion:"Está gostando da QA Toolbar Sandbox? Considere deixar uma avaliação — isso ajuda outros times de QA a encontrar a ferramenta.",reviewNotice:"Avaliações na Chrome Web Store são voluntárias, não precisam ser positivas e não geram pontos.",review:"Avaliar voluntariamente",result:"Benefício conquistado",close:"Fechar",status:{available:"Disponível",reserved:"Reservado",applied:"Aplicado",consumed:"Utilizado",expired:"Expirado",revoked:"Revogado",superseded:"Substituído"} },
  es: { eyebrow:"QA Rewards",title:"Acumula puntos y desbloquea beneficios",lead:"Las actividades válidas generan puntos tras su confirmación. Cada 100 puntos desbloquean un giro seguro.",how:"Cómo funciona",steps:["Una referencia con primer pago válido vale 100 puntos.","Un relato público aprobado vale 40 puntos y feedback útil vale 20.","Usa 100 puntos para girar. El premio se decide de forma segura en el servidor."],affiliate:"Tu enlace de referencia",offers:"La persona conoce la herramienta y elige libremente un plan sin pagar más.",rules:"Autorreferencias, duplicados, spam, reembolsos y contracargos no suman puntos.",signIn:"Entrar para participar",copy:"Copiar",copied:"Enlace copiado.",invited:"referidos",qualified:"pagos válidos",balance:"Saldo disponible",pending:"Puntos pendientes",lifetime:"Puntos acumulados",spins:"Giros disponibles",progress:"Progreso al próximo giro",wheel:"Ruleta de beneficios",tryLuck:"Probar suerte",tryLuckHint:"Cada giro cuesta 100 puntos. Tienes",random:"El resultado es aleatorio, se decide en el servidor y queda registrado.",spin:"Girar por 100 puntos",spinning:"Procesando giro...",confirm:"Este giro consumirá 100 puntos. ¿Continuar?",notEnough:"Todavía no tienes 100 puntos disponibles.",odds:"Probabilidades para tu nivel",benefits:"Tus beneficios",ledger:"Extracto de puntos",emptyBenefits:"Aún no tienes beneficios.",emptyLedger:"Tu extracto aparecerá aquí.",mission:"Actividades de comunidad: hasta 60 puntos",missionBody:"Envía un relato público con divulgación y feedback útil. El equipo valida las pruebas antes de acreditar 40 + 20 puntos.",social:"Relato público",linkedin:"Publicación en LinkedIn",feedback:"Feedback del producto",feedbackPlaceholder:"Explica qué ayudó, qué dificultó y qué puede mejorar.",disclosure:"Confirmo que las publicaciones informan que participo en una campaña de puntos.",submit:"Enviar para revisión",resubmit:"Reenviar pruebas",missionPending:"En revisión",missionApproved:"Aprobada: 60 puntos acreditados",missionRejected:"Cambios necesarios",invalid:"Usa enlaces HTTPS públicos y distintos, uno de LinkedIn, confirma la divulgación y escribe al menos 40 caracteres.",saved:"Pruebas enviadas.",unavailable:"Programa no disponible.",reviewSuggestion:"¿Te está gustando QA Toolbar Sandbox? Considera dejar una reseña — ayuda a que otros equipos de QA encuentren la herramienta.",reviewNotice:"Las reseñas en Chrome Web Store son voluntarias, no tienen que ser positivas y no generan puntos.",review:"Valorar voluntariamente",result:"Beneficio obtenido",close:"Cerrar",status:{available:"Disponible",reserved:"Reservado",applied:"Aplicado",consumed:"Utilizado",expired:"Expirado",revoked:"Revocado",superseded:"Sustituido"} },
  en: { eyebrow:"QA Rewards",title:"Earn points and unlock benefits",lead:"Eligible activities earn points after verification. Every 100 points unlocks one secure spin.",how:"How it works",steps:["A referral's valid first payment earns 100 points.","An approved public story earns 40 points and useful feedback earns 20.","Spend 100 points to spin. The prize is securely decided on the server."],affiliate:"Your referral link",offers:"Your referral explores the product and freely chooses a plan without paying more.",rules:"Self-referrals, duplicates, spam, refunds, and chargebacks do not earn points.",signIn:"Sign in to participate",copy:"Copy",copied:"Link copied.",invited:"referrals",qualified:"valid payments",balance:"Available balance",pending:"Pending points",lifetime:"Lifetime points",spins:"Available spins",progress:"Progress to next spin",wheel:"Benefits wheel",tryLuck:"Try your luck",tryLuckHint:"Each spin costs 100 points. You have",random:"The result is random, determined on the server, and recorded in your history.",spin:"Spin for 100 points",spinning:"Processing spin...",confirm:"This spin will use 100 points. Continue?",notEnough:"You do not have 100 available points yet.",odds:"Odds available for your tier",benefits:"Your benefits",ledger:"Points statement",emptyBenefits:"No benefits earned yet.",emptyLedger:"Your statement will appear here.",mission:"Community activities: up to 60 points",missionBody:"Submit a public story with campaign disclosure and useful feedback. The team verifies proof before crediting 40 + 20 points.",social:"Public story",linkedin:"LinkedIn post",feedback:"Product feedback",feedbackPlaceholder:"Explain what helped, what got in the way, and what could improve.",disclosure:"I confirm the posts disclose that I am participating in a points campaign.",submit:"Submit for review",resubmit:"Resubmit evidence",missionPending:"Under review",missionApproved:"Approved: 60 points credited",missionRejected:"Changes required",invalid:"Use distinct public HTTPS links, one from LinkedIn, confirm disclosure, and write at least 40 characters.",saved:"Evidence submitted.",unavailable:"Rewards are unavailable right now.",reviewSuggestion:"Enjoying QA Toolbar Sandbox? Consider leaving a review — it helps other QA teams find the tool.",reviewNotice:"Chrome Web Store reviews are voluntary, do not need to be positive, and do not earn points.",review:"Review voluntarily",result:"Benefit earned",close:"Close",status:{available:"Available",reserved:"Reserved",applied:"Applied",consumed:"Used",expired:"Expired",revoked:"Revoked",superseded:"Replaced"} },
};

const fmtDate=(value:string,locale:string)=>new Intl.DateTimeFormat(locale,{dateStyle:"short"}).format(new Date(value));
const entryLabel=(kind:string,locale:string)=>({
  "pt-BR":{referral_paid:"Indicação com pagamento",community_social:"Relato público aprovado",product_feedback:"Feedback aprovado",spin_debit:"Giro da roleta",reversal:"Estorno",admin_adjustment:"Ajuste administrativo"},
  es:{referral_paid:"Referencia con pago",community_social:"Relato público aprobado",product_feedback:"Feedback aprobado",spin_debit:"Giro de la ruleta",reversal:"Reversión",admin_adjustment:"Ajuste administrativo"},
  en:{referral_paid:"Paid referral",community_social:"Approved public story",product_feedback:"Approved feedback",spin_debit:"Wheel spin",reversal:"Reversal",admin_adjustment:"Admin adjustment"},
}[locale as "pt-BR"|"es"|"en"]?.[kind as "referral_paid"]||kind.replaceAll("_"," "));
export function CommunityCampaignSection(){
  const {locale}=useI18n(); const t=copy[locale as keyof typeof copy]||copy.en; const resultButton=useRef<HTMLButtonElement>(null);
  const [session,setSession]=useState<Session|null>(null),[profile,setProfile]=useState<{referral_code:string;qualified_referrals:number}|null>(null);
  const [wallet,setWallet]=useState<Wallet|null>(null),[prizes,setPrizes]=useState<Prize[]>([]),[benefits,setBenefits]=useState<Benefit[]>([]),[entries,setEntries]=useState<Entry[]>([]);
  const [referralCount,setReferralCount]=useState(0),[submission,setSubmission]=useState<Submission|null>(null),[socialUrl,setSocialUrl]=useState(""),[linkedinUrl,setLinkedinUrl]=useState(""),[feedback,setFeedback]=useState(""),[disclosure,setDisclosure]=useState(false),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[spinBusy,setSpinBusy]=useState(false),[spinResult,setSpinResult]=useState<SpinResult|null>(null),[rotation,setRotation]=useState(0),[wheelOpen,setWheelOpen]=useState(false);
  const affiliateLink=useMemo(()=>profile?`${location.origin}${import.meta.env.BASE_URL}?ref=${profile.referral_code}#comunidade`:"",[profile]);
  const eligiblePrizes=useMemo(()=>prizes.filter(p=>p.minimum_lifetime_points<=(wallet?.lifetime_points||0)),[prizes,wallet]);
  const totalWeight=eligiblePrizes.reduce((sum,p)=>sum+p.weight,0); const available=wallet?.available_points||0;
  // Wheel wedges are drawn equal-sized (one per unlocked prize) for readable labels -- the real
  // odds stay driven by `weight` server-side and are shown as their own list below the wheel, same
  // as before; the wedges are a themed reveal animation, not a literal probability chart.
  const wheelPrizes=eligiblePrizes.length?eligiblePrizes:prizes;
  const wheelSegmentAngle=wheelPrizes.length?360/wheelPrizes.length:360;
  const wheelBackground=wheelPrizes.length?`conic-gradient(${wheelPrizes.map((_,i)=>`${WHEEL_COLORS[i%WHEEL_COLORS.length]} ${i*wheelSegmentAngle}deg ${(i+1)*wheelSegmentAngle}deg`).join(",")})`:undefined;
  const load=async(current:Session)=>{if(!supabase)return;const [p,r,s,w,ps,b,e]=await Promise.all([
    supabase.from("referral_profiles").select("referral_code,qualified_referrals").eq("user_id",current.user.id).maybeSingle(),
    supabase.from("referrals").select("id",{count:"exact",head:true}).eq("referrer_user_id",current.user.id),
    supabase.from("engagement_campaign_submissions").select("status,review_notes,review_criteria,resubmission_count").eq("user_id",current.user.id).eq("campaign_key",CAMPAIGN_KEY).maybeSingle(),
    supabase.from("reward_wallets").select("available_points,pending_points,lifetime_points,spent_points,debt_points").eq("user_id",current.user.id).maybeSingle(),
    supabase.from("reward_prizes").select("id,key,label_pt,label_es,label_en,weight,minimum_lifetime_points,kind,discount_percent,grant_days").eq("enabled",true).order("display_order"),
    supabase.from("reward_benefits").select("id,kind,discount_percent,grant_days,status,expires_at,created_at").eq("user_id",current.user.id).order("created_at",{ascending:false}).limit(10),
    supabase.from("reward_point_entries").select("id,event_kind,points,status,reason,created_at").eq("user_id",current.user.id).order("created_at",{ascending:false}).limit(12),
  ]); if(p.data)setProfile(p.data);setReferralCount(r.count||0);if(s.data)setSubmission(s.data as Submission);setWallet((w.data as Wallet)||{available_points:0,pending_points:0,lifetime_points:0,spent_points:0,debt_points:0});setPrizes((ps.data as Prize[])||[]);setBenefits((b.data as Benefit[])||[]);setEntries((e.data as Entry[])||[]);};
  useEffect(()=>{const incoming=new URLSearchParams(location.search).get("ref")?.toUpperCase();if(/^QTS-[A-F0-9]{8}$/.test(incoming||""))localStorage.setItem("qts-referral-code",incoming!);if(!supabase)return;void supabase.auth.getSession().then(({data})=>setSession(data.session));const {data}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>data.subscription.unsubscribe();},[]);
  useEffect(()=>{if(!session||!supabase)return;const code=localStorage.getItem("qts-referral-code");if(code)void supabase.functions.invoke("referral-track",{body:{referralCode:code}}).finally(()=>localStorage.removeItem("qts-referral-code"));void load(session);},[session]);
  const submit=async()=>{if(!session){openAccountModal();return;}let social:URL,linked:URL;try{social=new URL(socialUrl);linked=new URL(linkedinUrl);}catch{setMessage(t.invalid);return;}if(social.protocol!=="https:"||linked.protocol!=="https:"||social.href===linked.href||!/(^|\.)linkedin\.com$/i.test(linked.hostname)||feedback.trim().length<40||!disclosure||!supabase){setMessage(t.invalid);return;}setBusy(true);const payload={user_id:session.user.id,campaign_key:CAMPAIGN_KEY,social_post_url:social.href,linkedin_post_url:linked.href,product_feedback:feedback.trim(),disclosure_confirmed:true,status:"pending",submitted_at:new Date().toISOString(),review_notes:null,review_criteria:{},resubmission_count:(submission?.resubmission_count||0)+(submission?.status==="rejected"?1:0)};const {error}=await supabase.from("engagement_campaign_submissions").upsert(payload,{onConflict:"user_id,campaign_key"});setBusy(false);if(error){setMessage(t.unavailable);return;}setSubmission(payload as Submission);setMessage(t.saved);};
  const spin=async()=>{if(!session){openAccountModal();return;}if(available<100){setMessage(t.notEnough);return;}if(!window.confirm(t.confirm)||!supabase)return;setSpinBusy(true);setMessage("");const requestId=crypto.randomUUID();const {data,error}=await supabase.functions.invoke("rewards-spin",{body:{requestId}});if(error||!data){setSpinBusy(false);setMessage(data?.error||error?.message||t.unavailable);return;}const won=data as SpinResult;scheduleWheelTicks(WHEEL_SPIN_MS);setRotation(v=>v+1440+Math.floor(Math.random()*300));window.setTimeout(()=>{setSpinBusy(false);setWheelOpen(false);setSpinResult(won);playWheelSuccessChime();fireWheelConfetti();resultButton.current?.focus();},WHEEL_SPIN_MS);await load(session);};
  const label=(p:Prize)=>locale==="pt-BR"?p.label_pt:locale==="es"?p.label_es:p.label_en; const locked=submission?.status==="pending"||submission?.status==="approved";
  return <section id="comunidade" className="qts-section qts-community"><div className="qts-container"><p className="qts-eyebrow">{t.eyebrow}</p><h2>{t.title}</h2><p className="qts-section-lead">{t.lead}</p>
    <div className="qts-rewards-how"><h3>{t.how}</h3><ol>{t.steps.map(item=><li key={item}>{item}</li>)}</ol></div>
    <div className="qts-community-grid"><article className="qts-community-card"><h3>{t.affiliate}</h3><p>{t.offers}</p><p className="qts-affiliate-rules">{t.rules}</p>{!session?<button className="qts-btn qts-btn-primary" onClick={openAccountModal}>{t.signIn}</button>:profile?<><div className="qts-copy-field"><input aria-label={t.affiliate} readOnly value={affiliateLink}/><button type="button" onClick={()=>navigator.clipboard.writeText(affiliateLink).then(()=>setMessage(t.copied))}>{t.copy}</button></div><p className="qts-campaign-stats"><b>{referralCount}</b> {t.invited} · <b>{profile.qualified_referrals}</b> {t.qualified}</p></>:<p>{t.unavailable}</p>}</article>
      <article className="qts-community-card qts-reward-summary" aria-live="polite"><h3>{t.balance}</h3><strong className="qts-points-total">{available}</strong><div className="qts-reward-metrics"><span><b>{wallet?.pending_points||0}</b>{t.pending}</span><span><b>{wallet?.lifetime_points||0}</b>{t.lifetime}</span><span><b>{Math.floor(available/100)}</b>{t.spins}</span></div><label>{t.progress}<progress max="100" value={available%100}/><small>{available%100}/100</small></label>{wallet?.debt_points?<p className="qts-form-status" role="alert">{wallet.debt_points} pontos aguardam compensação por estorno.</p>:null}</article></div>
    <div className="qts-community-grid qts-wheel-grid"><article className="qts-community-card qts-wheel-card"><h3>{t.wheel}</h3><p>{t.random}</p>
      <div className={`qts-reward-wheel qts-reward-wheel-preview ${wheelPrizes.length?"":"is-empty"}`} style={{background:wheelBackground}} aria-hidden="true"><span className="qts-wheel-hub">QA</span></div>
      <button type="button" className="qts-btn qts-btn-primary" disabled={available<100} onClick={()=>setWheelOpen(true)}>{t.tryLuck}</button>
      <p className="qts-wheel-trigger-hint">{t.tryLuckHint} <b>{available}</b>.</p>
      <div className="qts-odds"><strong>{t.odds}</strong>{eligiblePrizes.map(p=><div key={p.id}><span>{label(p)}</span><b>{totalWeight?((p.weight/totalWeight)*100).toFixed(1):"0"}%</b></div>)}</div></article>
      <article className="qts-community-card"><h3>{t.mission}</h3><p>{t.missionBody}</p><fieldset className="qts-mission-list" disabled={locked}><label><b>{t.social}</b><input value={socialUrl} onChange={e=>setSocialUrl(e.target.value)} placeholder="https://..."/></label><label><b>{t.linkedin}</b><input value={linkedinUrl} onChange={e=>setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/..."/></label><label><b>{t.feedback}</b><textarea value={feedback} onChange={e=>setFeedback(e.target.value)} rows={4} placeholder={t.feedbackPlaceholder}/></label><label className="qts-disclosure"><input type="checkbox" checked={disclosure} onChange={e=>setDisclosure(e.target.checked)}/><span>{t.disclosure}</span></label></fieldset><button className="qts-btn qts-btn-primary" disabled={busy||locked} onClick={()=>void submit()}>{!session?t.signIn:submission?.status==="rejected"?t.resubmit:t.submit}</button>{submission&&<div className={`qts-campaign-status is-${submission.status}`} role="status"><strong>{submission.status==="approved"?t.missionApproved:submission.status==="rejected"?t.missionRejected:t.missionPending}</strong><p>{submission.review_notes}</p></div>}</article></div>
    {session&&<div className="qts-community-grid"><article className="qts-community-card"><h3>{t.benefits}</h3>{benefits.length?<div className="qts-reward-list">{benefits.map(b=><div key={b.id}><b>{b.kind==="discount_percent"?`${b.discount_percent}%`:`${b.grant_days} dias`}</b><span>{t.status[b.status as keyof typeof t.status]||b.status}</span><small>{fmtDate(b.expires_at,locale)}</small></div>)}</div>:<p>{t.emptyBenefits}</p>}</article><article className="qts-community-card"><h3>{t.ledger}</h3>{entries.length?<div className="qts-reward-list">{entries.map(e=><div key={e.id}><b className={e.points>0?"is-credit":"is-debit"}>{e.points>0?"+":""}{e.points}</b><span>{entryLabel(e.event_kind,locale)}</span><small>{fmtDate(e.created_at,locale)}</small></div>)}</div>:<p>{t.emptyLedger}</p>}</article></div>}
    <p className="qts-optional-review">{t.reviewSuggestion} {t.reviewNotice} <a href={STORE_URL} target="_blank" rel="noreferrer">{t.review}</a></p>{message&&<p role="status" className="qts-form-status">{message}</p>}
    {wheelOpen&&<div className="qts-reward-dialog-backdrop" role="presentation" onClick={()=>{if(!spinBusy)setWheelOpen(false);}}><div className="qts-reward-dialog qts-wheel-dialog" role="dialog" aria-modal="true" aria-labelledby="reward-wheel-title" onClick={e=>e.stopPropagation()}>
      <h3 id="reward-wheel-title">{t.wheel}</h3><p>{t.random}</p>
      <div className={`qts-reward-wheel qts-reward-wheel-live ${spinBusy?"is-spinning":""}`} style={{transform:`rotate(${rotation}deg)`,background:wheelBackground}} aria-hidden="true">
        {wheelPrizes.map((p,i)=><div key={p.id} className="qts-wheel-segment" style={{transform:`rotate(${i*wheelSegmentAngle+wheelSegmentAngle/2}deg)`}}><span className="qts-wheel-segment-label">{label(p)}</span></div>)}
        <span className="qts-wheel-hub">QA</span>
      </div>
      <button type="button" className="qts-btn qts-btn-primary" disabled={spinBusy||available<100} onClick={()=>void spin()}>{spinBusy?t.spinning:t.spin}</button>
      <button type="button" className="qts-btn qts-wheel-dialog-close" disabled={spinBusy} onClick={()=>setWheelOpen(false)}>{t.close}</button>
    </div></div>}
    {spinResult&&<div className="qts-reward-dialog-backdrop" role="presentation"><div className="qts-reward-dialog qts-reward-result-dialog" role="dialog" aria-modal="true" aria-labelledby="reward-result-title"><h3 id="reward-result-title">{t.result}</h3><strong>{locale==="pt-BR"?spinResult.prize_label_pt:locale==="es"?spinResult.prize_label_es:spinResult.prize_label_en}</strong><p>{spinResult.remaining_points} {t.balance.toLowerCase()}</p><button ref={resultButton} className="qts-btn qts-btn-primary" onClick={()=>setSpinResult(null)}>{t.close}</button></div></div>}
  </div></section>;
}
