# Política de Privacidade — G1 Games Helper

**Última atualização:** 23 de setembro de 2026

## Resumo

A extensão **não coleta, não armazena em servidores, não transmite e não vende
nenhum dado pessoal**. Não há telemetria, analytics, rastreadores, contas de
usuário ou servidor próprio.

## O que a extensão acessa

| Dado | Por quê | Onde fica |
|---|---|---|
| Conteúdo da página do jogo (DOM/SVG/canvas) | ler o tabuleiro e aplicar a jogada | só na aba aberta, em memória |
| `localStorage`/`sessionStorage` **do próprio site do jogo** | ler o gabarito que o site já publica ao cliente (ex.: `main_game`) e guardar a URL do chunk já identificado | no domínio do site, como qualquer script da página |
| `chrome.storage.local` | guardar **duas preferências suas**: o ritmo (Humano/Normal/Rápido) e a opção "fechar o popup ao agir" | localmente, no seu navegador |

## O que a extensão NÃO faz

- Não envia dados para nenhum servidor (não existe backend).
- Não lê, preenche nem armazena credenciais, senhas ou cookies de sessão.
- Não acessa histórico de navegação, abas em segundo plano, e-mail, arquivos
  locais ou dados de outros sites.
- Não injeta anúncios, não afilia, não redireciona e não monetiza.
- Não executa código remoto: todo o JavaScript vem empacotado na extensão
  (Manifest V3, sem `eval` e sem CDN).

## Requisições de rede

As únicas requisições são feitas **para o próprio site do jogo, na origem dele**,
para ler os arquivos que o site já entrega ao navegador (por exemplo
`https://g1.globo.com/jogos/static/soletra.json`). Nenhum outro domínio é contatado.

## Permissões declaradas e justificativa

| Permissão | Para quê |
|---|---|
| `activeTab` | agir apenas na aba em que você clicou no ícone |
| `scripting` | injetar os módulos do jogo quando a página já estava aberta antes da instalação |
| `storage` | guardar as duas preferências citadas acima |
| `debugger` | **apenas** nos jogos que são `<canvas>` e ignoram eventos sintéticos (Sudoku.com e o arrasto do Labirinto): é a única API de extensão que gera input real (`Input.dispatchMouseEvent`) |

> Enquanto a permissão `debugger` estiver em uso, o navegador mostra a faixa
> *"está sendo depurada"* — é esperado e temporário: a extensão se desconecta
> (`detach`) ao terminar a jogada.

## Remoção dos dados

Desinstalar a extensão apaga `chrome.storage.local` (as duas preferências).
Nada mais é retido, porque nada mais é guardado.

## Contato

Dúvidas ou pedidos de remoção: abra uma issue em
<https://github.com/atanycost-png/g1-games-helper/issues>.
