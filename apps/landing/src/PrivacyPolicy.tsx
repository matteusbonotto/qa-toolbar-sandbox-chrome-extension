import { FiArrowLeft, FiExternalLink, FiLock, FiShield } from "react-icons/fi";
import logoWhite from "./assets/images/logo-branco.png";

const homeUrl = import.meta.env.BASE_URL;
const policyVersion = "2026-07-13";

export function PrivacyPolicy() {
  return (
    <div className="privacy-shell">
      <header className="privacy-nav">
        <div className="container privacy-nav-inner">
          <a className="brand" href={homeUrl} aria-label="Voltar para QA Sandbox Toolbar">
            <img className="brand-logo" src={logoWhite} alt="QA Sandbox Toolbar" />
          </a>
          <a className="button button-ghost privacy-back" href={homeUrl}><FiArrowLeft /> Voltar para a página inicial</a>
        </div>
      </header>

      <main className="privacy-main container">
        <section className="privacy-hero">
          <span className="kicker"><FiShield /> Privacidade e transparência</span>
          <h1>Política de Privacidade</h1>
          <p>Esta política explica, de forma objetiva, como o <strong>QA Toolbar Sandbox</strong>, sua extensão para Chrome e sua página pública tratam dados pessoais.</p>
          <div className="privacy-meta"><span>Vigência: 13 de julho de 2026</span><span>Versão: {policyVersion}</span></div>
        </section>

        <div className="privacy-layout">
          <aside className="privacy-summary" aria-label="Resumo da política">
            <FiLock />
            <h2>Resumo rápido</h2>
            <ul>
              <li>Configurações de QA ficam no navegador por padrão.</li>
              <li>Domínios são acessados somente após sua autorização.</li>
              <li>Dados de cartão vão diretamente para o Stripe.</li>
              <li>Não vendemos dados nem fazemos publicidade comportamental.</li>
              <li>Você pode solicitar acesso, correção ou exclusão.</li>
            </ul>
          </aside>

          <article className="privacy-document">
            <section id="controlador">
              <h2>1. Quem é responsável pelo tratamento</h2>
              <p>O controlador dos dados descritos nesta política é <strong>Matheus Bonotto</strong>, desenvolvedor do QA Toolbar Sandbox. Solicitações de privacidade podem ser enviadas pelos canais disponíveis em <a href="https://matheusbonotto.com.br/#contato" target="_blank" rel="noreferrer">matheusbonotto.com.br/contato <FiExternalLink /></a>.</p>
            </section>

            <section id="escopo">
              <h2>2. Escopo e finalidade única</h2>
              <p>O QA Toolbar Sandbox tem como finalidade única oferecer ferramentas de observabilidade e produtividade para atividades de Quality Assurance diretamente no navegador. Os dados são tratados somente para fornecer, proteger, licenciar, cobrar e melhorar essas funcionalidades.</p>
            </section>

            <section id="dados">
              <h2>3. Dados tratados</h2>
              <h3>3.1 Dados mantidos localmente</h3>
              <ul>
                <li>nome do projeto, ambiente, domínios e configurações informadas pelo usuário;</li>
                <li>workspaces importados, preferências da toolbar e identificador aleatório da instalação;</li>
                <li>URL da página atual, processada localmente para identificar o ambiente configurado;</li>
                <li>cache temporário de plano e permissões da conta.</li>
              </ul>
              <p>Esses dados permanecem em <code>browser.storage.local</code> e não são enviados ao servidor, salvo quando uma funcionalidade indicar expressamente o contrário ou quando o usuário realizar uma exportação. O identificador aleatório de instalação é enviado ao autenticar/licenciar o produto para aplicar limites e impedir uso indevido.</p>

              <h3>3.2 Dados de conta e serviço</h3>
              <ul>
                <li>e-mail, identificador interno do usuário e registros de aceite desta política/termos;</li>
                <li>identificador e rótulo da instalação, plano, trial, limites, licenças e benefícios;</li>
                <li>código e estado de indicação, quando o programa de indicação for utilizado;</li>
                <li>eventos técnicos mínimos de segurança, auditoria, prevenção de abuso e limitação de requisições.</li>
              </ul>
              <p>Endereço IP, data/hora, agente do navegador e metadados técnicos da requisição podem ser processados automaticamente pela infraestrutura de hospedagem para entrega, diagnóstico e segurança. Eles não são usados para criar perfil publicitário.</p>
              <p>A senha é encaminhada por conexão HTTPS ao serviço de autenticação do Supabase. O desenvolvedor não recebe nem armazena a senha em texto legível. Tokens de sessão ficam em armazenamento de sessão do navegador e são removidos ao sair ou encerrar a sessão aplicável.</p>

              <h3>3.3 Dados de pagamento</h3>
              <p>O Stripe recebe diretamente dados de cartão, faturamento e transação. O QA Toolbar Sandbox recebe apenas identificadores do cliente/assinatura, plano, situação da cobrança, datas e eventos necessários para liberar ou revogar o acesso. Números completos de cartão e códigos de segurança não são recebidos nem armazenados pelo QA Toolbar Sandbox.</p>

              <h3>3.4 Conteúdo de sites e navegação</h3>
              <p>A extensão solicita acesso somente aos domínios escolhidos pelo usuário para inserir a toolbar e executar as ferramentas solicitadas. A versão atual não coleta automaticamente histórico completo de navegação, cookies, senhas, campos de formulário, comunicações pessoais ou conteúdo de páginas para envio ao desenvolvedor. O observatório de rede permanece desativado nesta versão.</p>
              <p>Capturas de tela, gravações, anotações ou exportações, quando disponibilizadas e acionadas pelo usuário, serão processadas para entregar a funcionalidade escolhida. A interface deverá informar antes de qualquer transmissão futura que altere esta prática.</p>
            </section>

            <section id="finalidades">
              <h2>4. Como e por que usamos os dados</h2>
              <ul>
                <li>criar e autenticar a conta;</li>
                <li>salvar configurações, reconhecer a instalação e fornecer a toolbar;</li>
                <li>administrar trial, plano, assinatura, indicação e download protegido;</li>
                <li>processar pagamentos e disponibilizar o portal do cliente;</li>
                <li>prevenir fraude, abuso, invasões e uso não autorizado;</li>
                <li>cumprir obrigações legais e atender direitos dos titulares;</li>
                <li>diagnosticar falhas e melhorar o produto com dados agregados ou minimizados.</li>
              </ul>
              <p>As bases legais aplicáveis podem incluir execução de contrato e procedimentos preliminares, consentimento quando solicitado, cumprimento de obrigação legal e legítimo interesse em segurança e melhoria do serviço, sempre com avaliação de necessidade e proporcionalidade.</p>
            </section>

            <section id="compartilhamento">
              <h2>5. Operadores e compartilhamento</h2>
              <p>Dados são compartilhados somente na medida necessária com:</p>
              <ul>
                <li><strong>Supabase:</strong> autenticação, banco de dados, funções de backend e armazenamento privado do pacote;</li>
                <li><strong>Stripe:</strong> checkout, assinatura, pagamentos, faturas e prevenção a fraude;</li>
                <li><strong>GitHub Pages e Chrome Web Store/Google:</strong> hospedagem da página pública e distribuição da extensão, sujeitos às políticas próprias dessas plataformas;</li>
                <li>autoridades ou terceiros quando exigido por lei, necessário para segurança ou para proteção de direitos.</li>
              </ul>
              <p>Não vendemos dados pessoais. Não usamos nem transferimos dados para publicidade personalizada, retargeting, avaliação de crédito ou finalidades incompatíveis com a função declarada da extensão.</p>
            </section>

            <section id="limited-use">
              <h2>6. Declaração de Limited Use da Chrome Web Store</h2>
              <p>O uso e a transferência de informações recebidas das APIs do Google Chrome seguem a <a href="https://developer.chrome.com/docs/webstore/program-policies/user-data-faq/" target="_blank" rel="noreferrer">Política de Dados do Usuário da Chrome Web Store <FiExternalLink /></a>, incluindo os requisitos de Limited Use.</p>
              <p>O acesso a dados do navegador é limitado à entrega ou melhoria da finalidade única da extensão. Pessoas não leem esses dados, exceto com consentimento específico para suporte, quando necessário para segurança, para cumprimento legal, ou quando os dados estiverem agregados e anonimizados para operações internas.</p>
            </section>

            <section id="transferencias">
              <h2>7. Transferências internacionais</h2>
              <p>Alguns fornecedores podem processar dados fora do Brasil. Quando isso ocorrer, serão adotadas medidas compatíveis com a LGPD, como contratos, controles de acesso, minimização, criptografia em trânsito e salvaguardas oferecidas pelos operadores.</p>
            </section>

            <section id="retencao">
              <h2>8. Retenção e exclusão</h2>
              <ul>
                <li>dados locais permanecem até serem apagados pelo usuário, pelos controles do navegador ou pela desinstalação;</li>
                <li>tokens de sessão permanecem somente durante a sessão aplicável ou até o logout;</li>
                <li>dados de conta, licença e assinatura permanecem enquanto a conta estiver ativa;</li>
                <li>após exclusão da conta, dados podem ser mantidos apenas pelo prazo necessário para obrigações legais, fiscais, chargebacks, prevenção a fraude, segurança e exercício de direitos.</li>
              </ul>
              <p>Quando o prazo ou a finalidade terminar, os dados serão eliminados ou anonimizados, ressalvadas as hipóteses legais de conservação.</p>
            </section>

            <section id="seguranca">
              <h2>9. Segurança</h2>
              <p>São adotadas medidas como HTTPS, Manifest V3, permissões mínimas e sob demanda, validação de entradas, autenticação, Row Level Security, segregação de chaves, webhooks assinados, limitação de requisições, storage privado e links temporários de download. Nenhum sistema é invulnerável; incidentes confirmados serão tratados conforme a legislação aplicável.</p>
            </section>

            <section id="direitos">
              <h2>10. Seus direitos</h2>
              <p>Nos termos da LGPD, o titular pode solicitar, conforme aplicável:</p>
              <ul>
                <li>confirmação e acesso aos dados;</li>
                <li>correção de dados incompletos, inexatos ou desatualizados;</li>
                <li>anonimização, bloqueio ou eliminação de dados desnecessários ou irregulares;</li>
                <li>informações sobre compartilhamento e portabilidade, quando cabível;</li>
                <li>eliminação de dados tratados com consentimento e revogação do consentimento;</li>
                <li>oposição a tratamento irregular e revisão de decisões automatizadas, quando aplicável.</li>
              </ul>
              <p>Solicitações podem ser feitas pelo <a href="https://matheusbonotto.com.br/#contato" target="_blank" rel="noreferrer">canal de contato do controlador <FiExternalLink /></a>. Poderá ser solicitada confirmação de identidade para proteger a conta e os dados do titular.</p>
            </section>

            <section id="menores">
              <h2>11. Crianças e adolescentes</h2>
              <p>O serviço é direcionado a profissionais e equipes de tecnologia e não é destinado a crianças. Não coletamos conscientemente dados de crianças sem a base legal e os cuidados exigidos pela legislação.</p>
            </section>

            <section id="alteracoes">
              <h2>12. Alterações desta política</h2>
              <p>Esta política poderá ser atualizada para refletir mudanças no produto, na legislação ou nos fornecedores. Alterações relevantes de tratamento serão informadas de forma destacada antes de entrarem em vigor e, quando necessário, exigirão novo consentimento. A data e a versão no início da página identificam o texto vigente.</p>
            </section>

            <section id="referencias">
              <h2>13. Referências</h2>
              <ul>
                <li><a href="https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares" target="_blank" rel="noreferrer">ANPD — Direitos dos Titulares <FiExternalLink /></a></li>
                <li><a href="https://developer.chrome.com/docs/webstore/program-policies/user-data-faq/" target="_blank" rel="noreferrer">Chrome Web Store — User Data FAQ <FiExternalLink /></a></li>
                <li><a href="https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements" target="_blank" rel="noreferrer">Chrome Web Store — Disclosure Requirements <FiExternalLink /></a></li>
              </ul>
            </section>
          </article>
        </div>
      </main>

      <footer className="privacy-footer"><div className="container"><span>© 2026 QA Toolbar Sandbox</span><a href={homeUrl}>Página inicial</a><a href="https://matheusbonotto.com.br" target="_blank" rel="noreferrer">Desenvolvido por Matheus Bonotto</a></div></footer>
    </div>
  );
}
