# Análise sanitizada do legado

O protótipo anterior era um userscript com acesso amplo à página, timers, observers, patches de Fetch/XHR, HTML dinâmico e armazenamento local sem schema. O arquivo-fonte e os detalhes de ambientes/hosts foram deliberadamente excluídos do Git público.

## Decisões de migração

| Risco legado | Controle na extensão |
| --- | --- |
| CSS/DOM compartilhado | UI isolada em Shadow DOM |
| Hosts fixos e acesso amplo | permissões opcionais por domínio |
| Captura de rede sem limites | bridge tipada, opt-in, limite e retenção |
| Configuração sem schema | validação, preview, checksum e rollback |
| Dados sensíveis em storage/export | redaction e vault opt-in antes de produção |
| Dependência de código/serviço remoto | módulos empacotados no build; sem código remoto |

Exports do legado podem conter contas, tokens, payloads e dados pessoais. Eles devem ser tratados como confidenciais, nunca usados como fixtures e nunca adicionados ao Git.
