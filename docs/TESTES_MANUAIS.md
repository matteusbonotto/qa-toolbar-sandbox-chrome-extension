# Testes manuais locais (antes de aprovar uma publicação)

Roteiro curto para o fundador conferir no Chrome real o que os testes automáticos não provam
visualmente. Versão atual da main: 1.4.42.

## 1. Preparar (uma vez, 3 minutos)

1. Atualize o código: `git switch main && git pull`.
2. Crie um perfil de Chrome só para teste (ícone do perfil > Adicionar). Assim a versão da Chrome
   Web Store do seu perfil normal não aparece junto, e nada do seu Chrome pessoal é afetado.
3. Nesse perfil, abra `chrome://extensions`, ligue **Modo do desenvolvedor** (canto superior
   direito), clique em **Carregar sem compactação** e escolha a pasta
   `apps/extension` do repositório.
4. Clique no ícone da extensão > Configurações > Minha conta e entre com sua conta (o backend é o
   de produção).
5. Depois de puxar código novo: em `chrome://extensions`, botão de recarregar do card da extensão,
   e recarregue as abas abertas.

## 2. O que conferir

### Breakpoint Viewer (v1.4.40)
- [ ] Abra o site do Cinemark Cineclub, Tools > Breakpoint Viewer. Na pane de celular, os planos
      aparecem **empilhados** (versão mobile); na pane de computador, lado a lado.
- [ ] O botão "Emular celular" aparece ligado. Desligue: a pane de celular volta a mostrar a versão
      de computador. Ligue de novo.
- [ ] Feche o viewer: a página normal continua como computador.

### Cursor e mouse da Key View (v1.4.39 e v1.4.41)
- [ ] Tools > Key View, ligue "Visualizar mouse". Em Ponteiro, escolha "Padrão" e preencha
      "Nome no cursor": o ponteiro desenhado fica exatamente na ponta do mouse e o nome aparece ao
      lado. O ponteiro do sistema some na página e volta em cima da barra.
- [ ] Em Ao clicar > Desenho do mouse: troque os 8 modelos, Preenchido/Vazado e algumas artes.
      Clique com o botão esquerdo, o direito e role a roda: cada um acende na sua cor, e o desenho
      aparece ao lado do ponteiro (não no canto da tela).
- [ ] Teste Holofote e Ondas com os três botões.
- [ ] Repita nos temas claro e escuro (Configurações > Geral > Aparência).
- [ ] Abra o Breakpoint Viewer com "Zoom do site" diferente de 100% e confira que o cursor continua
      alinhado dentro das panes.

### Gravação (v1.4.39)
- [ ] Gravar tela: a janela de escolha é vertical; depois de escolher, vira um widget pequeno no
      canto superior direito com tempo, pausar, parar e cancelar.
- [ ] Grave alguns segundos com o holofote ligado e confira no vídeo que os efeitos aparecem.

### Multi Testador (v1.4.42, precisa de duas contas Release Manager)
- [ ] Configurações > Minha conta > "Apelido no Multi Testador": salve um apelido em cada conta.
- [ ] Use dois perfis de Chrome (um por conta), os dois com a extensão carregada (passo 1.3), no
      mesmo site.
- [ ] Conta A: Tools > Multi Testador > Criar sala. Copie o código.
- [ ] Conta B: Multi Testador > Entrar com código > Pedir para entrar. Aparece "Aguardando o host".
- [ ] Conta A aprova. Em até 6 segundos, a conta B entra; os dois veem "Conectado".
- [ ] Mexa o mouse em cada perfil: o cursor do outro aparece com o apelido e a cor dele, na mesma
      tela. Cliques do outro aparecem como ondas.
- [ ] Chat: mensagens chegam dos dois lados com o apelido certo.
- [ ] Conta A remove a conta B: B sai da sessão na hora e não consegue pedir de novo nesta sala.
- [ ] Conta A encerra a sessão: o código antigo deixa de funcionar ("Código inválido ou sala
      encerrada").
- [ ] Report Builder durante a sessão: aparece a linha "Participantes (Multi Testador)".

### Atualização sem reativação (antes de publicar)
- [ ] Em `chrome://extensions`, a extensão continua **ativada** depois de recarregar a versão nova
      (a permissão nova `declarativeNetRequestWithHostAccess` não deve pedir aceite).

## 3. Se algo falhar

Anote o passo, tire um print e mande. Erros técnicos: `chrome://extensions` > card da extensão >
"Erros" (e o link "service worker" para o console do background).

Testes automáticos, se quiser rodar: `npm test` (rápido) e `npm run test:chrome` (abre um Chrome
próprio por uns 10 minutos, não mexe no seu). Detalhes em `COMMANDS.md`.
