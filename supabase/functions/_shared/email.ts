import { requiredEnv } from "./config.ts";

// Resend's own onboarding sender works immediately, with no domain verification, which is exactly
// what's needed the first time this runs. Once a real domain is verified in the Resend dashboard,
// change this to send from that domain instead (e.g. "QA Toolbar Sandbox <contato@matteusbonotto.dev>").
const FROM_ADDRESS = "QA Toolbar Sandbox <onboarding@resend.dev>";

export async function sendPaymentFailedEmail(toEmail: string): Promise<void> {
  const apiKey = requiredEnv("RESEND_API_KEY");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [toEmail],
      subject: "Pagamento não foi processado — QA Toolbar Sandbox",
      html: "<p>Olá,</p>"
        + "<p>Não conseguimos processar o pagamento da sua assinatura do QA Toolbar Sandbox. "
        + "O acesso aos recursos pagos foi bloqueado temporariamente até a fatura ser regularizada.</p>"
        + "<p>Verifique se o cartão cadastrado está válido e com limite disponível, ou atualize o "
        + "método de pagamento pelo mesmo link de checkout usado na assinatura.</p>"
        + "<p>Se precisar de ajuda, escreva para contato@matheusbonotto.com.br.</p>",
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend request failed (${response.status}): ${body.slice(0, 300)}`);
  }
}
