# G1 Games Helper

Extensão de navegador (Manifest V3) que **resolve os jogos de lógica e palavras do
G1** — e também o Sudoku.com — com **ritmo humanizado** e um painel de
acompanhamento na própria página.

Não depende de nenhum serviço local, chave de API ou modelo de linguagem: os
gabaritos vêm dos **JSONs estáticos que o próprio site já envia ao navegador**, ou
da base de palavras embutida no bundle do jogo. Tudo roda no cliente.

## Jogos suportados

| Jogo | Como resolve | Status |
|---|---|---|
| 🔢 **Sudoku (G1)** | lê a grade `DIV.cell` e resolve por backtracking | ✅ validado |
| 🐴 **Dito** (Wordle) | palavra do dia lida da base embutida no bundle do site | ✅ validado |
| 🔤 **Soletra** (Spelling Bee) | digita as palavras do `soletra.json` | ✅ validado (12 palavras/rodada) |
| 🧩 **Combinado** (Connections) | agrupa pelas `groups` + `words` do `combinado.json` | ✅ validado |
| 🌀 **Labirinto** | traça o `solution_path` do `labirinto.json` com arrasto real | ✅ validado |
| 🔎 **Caça-Palavras** | **destaca** as respostas na grade (`answer` + `suggestions`) | ✅ validado |
| ⬜ **Palavras Cruzadas** (mini e grande) | preenche pelo `cruzada_mini.json` / `cruzada.json` | ✅ validado (74/74 células) |
| 🌐 **Sudoku.com** | lê `localStorage['main_game']` e preenche o canvas | ✅ validado (43 células, 0 erros) |
| 📋 **Grade HTML 9×9** / **Formulário 9×9** | fallbacks genéricos | nunca exercitados em site real |

## Instalação

1. Abra `edge://extensions/` (ou `chrome://extensions/`)
2. Ative **Developer mode**
3. **Load unpacked** → selecione a pasta `extension/`
4. Abra o jogo e clique no ícone da extensão

> A extensão precisa ser recarregada (**Reload**) no `edge://extensions/` depois de
> qualquer atualização dos arquivos — content scripts só entram em páginas abertas
> *depois* da instalação/atualização.

## Uso

O popup detecta o jogo da aba e mostra **um botão de ação** já com o que vai fazer
(*Resolver a palavra do dia*, *Digitar as palavras*, *Traçar o caminho*, …). Ao lado
do botão:

- **Ritmo** — `Humano` (pausas e movimento naturais), `Normal` ou `Rápido`;
- **Fechar o popup ao agir** — deixando marcado, a página recupera o foco (o G1
  pausa o jogo quando a janela perde o foco) e você acompanha o robô trabalhando;
- **Jogos suportados** — chips; clicar abre o jogo numa aba nova.

Durante a execução aparece um **painel flutuante** na página com o passo a passo do
jogo (lista de palavras, grupos, trajeto em setas, legenda de cores…), que pode ser
fechado no ✕ ou pelo botão *Fechar painel*.

## Como cada jogo é resolvido

Nenhum gabarito é embutido na extensão: ela lê o que o site já manda.

| Jogo | Fonte | Campo usado |
|---|---|---|
| Dito | chunk `_astro/index.*.js` | `JSON.parse('[{"date":…,"value":"moeda"}, …]')` — base diária |
| Soletra | `/jogos/static/soletra.json` | `word_list`, `pangram_list` |
| Combinado | `/jogos/static/combinado.json` | `words` (em blocos de 4), `groups`, `order` |
| Labirinto | `/jogos/static/labirinto.json` | `solution_path`, `letter_positions` |
| Caça-Palavras | `/jogos/static/c_palavras.json` | `answer` (caminho) + `suggestions` |
| Cruzadas / Mini | `/jogos/static/cruzada.json` · `cruzada_mini.json` | `grid.cell[].solution` |
| Sudoku.com | `localStorage['main_game']` | `mission`, `solution` |

Detalhes, evidências e armadilhas de cada um estão em [`docs/REFERENCIA.md`](docs/REFERENCIA.md).

## Modo humanizado

O ritmo é aplicado em todos os jogos:

- **Dito** — digita letra a letra com pausa variável e confirma com ENTER;
- **Soletra** — digita cada palavra tecla a tecla, com pausa maior a cada 4;
- **Combinado** — clica as 4 palavras com pausa entre elas e confirma o grupo;
- **Labirinto** — arrasta o mouse casa por casa, com movimento interpolado;
- **Caça-Palavras** — revela uma palavra por vez;
- **Sudoku / Cruzadas** — pausa de 220–540 ms por célula e pausa maior a cada ~12.

## Quando é preciso `chrome.debugger`

Dois jogos são `<canvas>` e **ignoram eventos sintéticos** (testado com
`PointerEvent`, `MouseEvent`, `mousemove` prévio, `isTrusted` forjado e
`dispatchEvent` em todos os alvos):

- **Sudoku.com** — cliques por coordenada + teclado numérico;
- **Labirinto** — arrasto contínuo pelo caminho.

Nesses casos o plano é enviado ao service worker, que usa a API `debugger`
(mesmo caminho do DevTools, `Input.dispatchMouseEvent`). É por isso que o manifest
pede a permissão `debugger` e aparece a faixa *"está sendo depurada"* durante a
execução. Nos demais jogos **nada disso é usado** — o content script resolve com
DOM normal.

Também entram no caminho CDP os *blockers* que cobrem o tabuleiro:
`#pause-overlay`, o iframe de anúncio `.ima-container` (sudoku.com) e o
tour/drawer de boas-vindas do G1 (`.tour-spotlight`, `.drawer-overlay`).

## Estrutura

```
extension/
├── manifest.json       # MV3; permissões: activeTab, scripting, debugger, tabs
├── g1common.js         # base compartilhada: gates, ritmo, painel, teclado
├── content.js          # detecção (10 estratégias) + ações
├── dito.js             # Wordle: base diária
├── soletra.js          # Spelling Bee
├── combinado.js        # Connections
├── labirinto.js        # labirinto (canvas)
├── wordsearch.js       # caça-palavras (destaque)
├── crossword.js        # palavras cruzadas (mini e grande)
├── solver.js           # backtracking 9×9 (com teste unitário)
├── background.js       # executor CDP (cliques e arrasto) + modo humanizado
├── popup.html/js/css   # o menu
└── icons/
tools/                  # scripts CDP standalone (validação fora da extensão)
bend/                   # solver de sudoku em Bend 2, com leis provadas
test/                   # teste unitário, fixture e integração
docs/REFERENCIA.md      # descobertas, evidências, pitfalls e histórico
```

## Testes

```bash
npm test                   # unitário do solver (offline, sem browser)
npm run test:integration   # integração com fixture do G1 via CDP (precisa do Edge em 9222)

python tools/test_jogos_cdp.py              # todos os jogos (injeta a extensão real)
python tools/test_jogos_cdp.py dito soletra # só alguns
python tools/solve_labirinto_cdp.py         # labirinto ponta a ponta (arrasto real)
python tools/fill_sudokucom_cdp.py --check  # sudoku.com: estado + plano
```

Os scripts em `tools/` existem para validar **fora** da extensão o mesmo caminho
que o `background.js` usa — inclusive quando a instalação da extensão não é prática.

## Bend 2 (`bend/`)

O solver de sudoku também foi escrito em **Bend 2** (bendlang), com **9 leis
provadas** (`bend PROOF.bend` → `All terms check.`): o solver completa o
tabuleiro, a saída tem 0 conflitos, casa com o gabarito e preserva as células
dadas. Roda via WSL (Bend não tem build nativo no Windows) e resolve o puzzle do
G1 em ~0,1 s.

## Privacidade e uso

- A extensão **não envia nada para fora**: não há telemetria, analytics, servidor
  próprio ou chave de API. As únicas requisições são para o próprio site do jogo,
  na origem dele.
- Ela **não automatiza login nem lê credenciais**. Se o site exigir sessão, faça
  login você mesmo — a extensão usa a sessão que já existe no navegador.
- Projeto **educacional e de uso pessoal**. Os gabaritos são dados que o site
  publica no próprio cliente; o objetivo é estudar extração de estado em jogos de
  navegador (DOM, JSON estático, canvas, event delegation). Use por sua conta e
  respeite os termos de uso dos sites.

## Licença

MIT — veja [`LICENSE`](LICENSE). © 2026 [atanycost-png](https://github.com/atanycost-png)
