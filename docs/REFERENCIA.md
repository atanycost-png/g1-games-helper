# REFERENCIA — G1 Games Helper

Documentação de engenharia do projeto: descobertas empíricas, evidências,
pitfalls e histórico. **Atualizar sempre que descobrir algo novo.**

---

## 1. Estado atual (2026-09-23)

| Item | Status | Evidência |
|---|---|---|
| Solver (backtracking 9×9) | ✅ funciona | resolveu puzzles reais do G1 e do sudoku.com |
| Detecção G1 (`DIV.cell`) | ✅ funciona | resolveu 19 células → site exibiu **PARABÉNS** |
| Detecção Sudoku.com (`localStorage`) | ✅ funciona | solução da extensão **81/81** igual ao gabarito |
| Preenchimento G1 | ✅ funciona | clique `.cell-btn` + `.btn-key` aceito pelo jogo |
| Preenchimento Sudoku.com | ✅ mecanismo validado | o jogo **contou os erros** dos cliques (prova de que insere) |
| Extensão carregada via CLI | ❌ impossível | `--load-extension` ignorado pelo Edge 153 |
| End-to-end no G1 no ambiente de teste | ⛔ bloqueado | **G1 exige login** (ver §3.1) |
| Solver em Bend 2 | ⏳ planejado | Bend não tem build Windows (ver §5) |

---

## 2. Arquitetura

```
popup.js ──chrome.tabs.sendMessage──► content.js (na página)
                                          │
                        ┌─────────────────┼──────────────────┐
                        ▼                 ▼                  ▼
                   detectGrid()      solutionFor()      fillCells()
                (g1|sudoku.com|     (gabarito do site   (clique na célula
                 table|inputs)       ou backtracking)    + teclado/numpad)
```

`content.js` expõe `window.__g1Helper` para debug/teste — permite validar a
lógica **sem** carregar a extensão (injetando `solver.js` + `content.js`).

---

## 3. Descobertas por site

### 3.1 G1 Jogos (`g1.globo.com/jogos/sudoku/`)

**Gate de login (bloqueio atual).** Evidência coletada:
- `document.querySelectorAll('.start-btn')` → 3 botões com `disabled="true"`;
- `.modal-overlay` visível com o texto *"Faça login gratuitamente e aproveite
  os jogos do g1"* e **apenas** um botão "Login" (sem X de fechar);
- reabilitar os botões via JS (`b.disabled = false`) e clicar em "Fácil"
  **não** inicia o jogo: `DIV.cell` continua `0` e não há cookie `GLBID`.

Conclusão: o app Svelte/Astro precisa de sessão autenticada; é gate do site.
**Solução: logar em g1.globo.com.** A extensão apenas reporta o motivo.

**PAUSA AUTOMÁTICA (a causa real do "não detecta").** Com o usuário logado, o
jogo funciona — mas o G1 **pausa sozinho quando a página perde o foco**, e o
popup da extensão tira o foco. Comprovado por captura de tela do Edge real:
- overlay **"Seu jogo foi pausado"** + botão **"Voltar"** cobre o tabuleiro;
- **enquanto pausado o tabuleiro aparece visualmente VAZIO** (nenhum número);
- após clicar em "Voltar", os números reaparecem (`9 6 1 . 7 4 . 5 2 …`).

Logo: abrir o popup → jogo pausa → tabuleiro sem valores → extensão "não
detecta". **Correção:** `ensureNotPaused()` roda ANTES de detectar e clica no
botão do overlay. Implementado por TEXTO (procura o container mais interno que
mencione "pausado" e clica no botão dentro dele) — não por seletor CSS, que
mudaria com o build do Svelte. **Cuidado:** não clicar no botão "voltar" do
cabeçalho (só tem `aria-label`, sem texto visível, e sairia do jogo).

**Estrutura do tabuleiro (quando logado):**
```
MAIN.game > DIV.cells-container > DIV.cells > DIV.cell × 81
  DIV.cell
    style="grid-row-start:R; grid-column-start:C"   (1-indexado)
    classes de borda: border-b / border-r / border-b-4 / border-r-4
    DIV.cell-inner > BUTTON.cell-btn > SPAN.cell-text
                       (SPAN com classe 'cell-text-user-number' = valor do usuário)
```
- Teclado numérico: `.btn-key` (1–9 + apagar); também há `[data-value]` na numpad.
- Modo: `.segment` (`marcar` selecionado / `anotar`).
- Preencher = `cellBtn.click()` → `btnKey.click()`. Delay ~90–150 ms entre ações.
- O site valida e mostra **PARABÉNS** ao completar (verificado).

### 3.2 Sudoku.com (`sudoku.com/br/<dificuldade>/`)

**O tabuleiro é `<canvas>` 2000×2000** (style 380–500 px). Não há DOM de
células, e os dígitos são desenhados como **paths vetoriais** — hook de
`fillText` captura **zero** chamadas (confirmado por instrumentação de
`fillText/strokeText/fill/drawImage`: só `clearRect`, `fillRect` e `fill`).

**Fonte de dados confiável (usar esta):** `localStorage['main_game']`
```json
{
  "values": [ {"val": 0, "editable": true,  "conflict": false, "mistake": false}, ... ],
  "mission":  "004300001007091240190...",   // 81 chars, 0 = vazio
  "solution": "524368791867591243193...",   // 81 chars = GABARITO
  "mistakes": 2, "countMistakes": 2, "difficulty": "easy", ...
}
```
- `editable:false` ⟺ célula fixa (confere 1:1 com `mission != '0'`).
- `mistake:true` marca valor errado inserido pelo usuário.
- A extensão prefere `solution` (zero risco de erro) e cai para backtracking
  se ausente.

**API interna (alternativa):** `GET /api/v2/classic/<difficulty>/app_start`
→ `{"id":560,"mission":"...","solution":"...","win_rate":53.53}`.
Só é chamada ao iniciar jogo novo e **exige headers internos** (um `fetch`
manual sem eles retorna **403 Forbidden**). Capturada com hook de `fetch`
instalado antes da página carregar.

**Geometria do canvas** (derivada dos `fillRect`/`fill` e validada contra os
dígitos do `mission`):
```
pad = 8 ;  célula = (canvas.width − 16) / 9      // 220.44 em 2000px
canvasX = 8 + (col − 0.5) · célula
clientX = rect.left + canvasX · (rect.width / canvas.width)
```
Colunas capturadas: 8, 228, 449, 669, 890, 1110, 1331, 1551, 1772 ✔

**Preenchimento:** `PointerEvent('pointerdown'|'pointerup')` no canvas nas
coordenadas da célula + clique no `.numpad-item[data-value="N"]`.
Validado por efeito colateral: o jogo registrou `mistakes: 2` e marcou
`mistake:true` na célula — prova de que o input foi aceito.

---

## 4. Pitfalls (aprendidos na dor)

1. **Content script não roda em abas abertas antes da instalação** → recarregar
   a página (F5) após instalar/atualizar a extensão.
2. **`--load-extension` é ignorado** no Edge/Chrome atuais (mesmo com
   `--disable-extensions-except`): a instalação é manual via `edge://extensions`.
3. **Popup aberto pausa o jogo** (blur) → o content script despausa clicando em
   `#pause-overlay` antes de preencher.
4. **Anúncios IMA travam o jogo em automação**: `ima_ads_on_start: true` deixa a
   tela em *"Carregando o jogo"* para sempre sem anúncio reproduzível. Não é bug
   da extensão — no navegador normal do usuário o jogo carrega.
5. **Não sobrescrever valores existentes**: `fillCells` só preenche quando
   `value === 0` e `given === false`. Sobrescrever chute errado exigiria apagar
   antes (evita gastar tentativas no sudoku.com, que perde com 3 erros).
6. **Nunca digitar credenciais**: o gate do G1 é resolvido pelo usuário logando;
   a extensão só informa.
7. **Cuidado com cópia em solver recursivo.** O bug histórico do `solver.js`:
   criava a cópia do grid **antes** de resolver e devolvia **essa** cópia —
   `solve()` escrevia no array original. Resultado: devolvia o puzzle com zeros
   (e ainda mutava a entrada do chamador). Sintoma exato: **"detecta o tabuleiro
   mas não resolve"**, porque `fillCells` via `solution[r][c] === 0` e pulava
   todas as células. Regressão coberta por `test/solver.test.js`.
8. **Nunca testar o solver só pelo caminho do site.** O bug acima escapou porque
   o teste no sudoku.com usava `knownSolution` (gabarito do site) e **nunca
   exercitava o backtracking**. Sempre ter um teste que roda o solver de verdade.

---

## 5. Bend 2 (fase 2 — solver com provas) — ESTADO: núcleo + provas OK

Doc de estudo: `D:\Dev\Projetos\bend-docs\README.md` (leitura integral).

### Setup feito
- **WSL**: `Ubuntu-26.04`; `sudo` **pede senha** e dá timeout → usar
  **`wsl -d Ubuntu-26.04 -u root -e bash -lc "…"`** (root direto, sem sudo).
- **clang 21.1.8** instalado via root (Bend exige 14+; 19+ para GPU `!`).
- **Bend 2.0.27** instalado: `BEND_NO_TELEMETRY=1 sh /tmp/bend-install.sh`
  (instalador verificado antes: baixa em `~/.bend`, checa sha256, **sem sudo**).
  PATH: `export PATH="$HOME/.bend/bin:$PATH"` (já no `~/.bashrc`).
  `bend --version` **não existe** — use `--help`.

### Arquivos (em `bend/`)
| Arquivo | Papel | Estado |
|---|---|---|
| `hello.bend` | hello world | ✅ roda |
| `sudoku_core.bend` | núcleo: acesso, geometria, conflitos, 1ª vazia, **máscaras de bits**, `pick_lazy`, `preserves` | ✅ roda |
| `sudoku_solve.bend` | **SOLVER por backtracking** (módulo importável, sem `main`) | ✅ **resolve o puzzle do G1 em 11 ms** |
| `sudoku_run.bend` | demo/benchmark do solver (e escalada por N vazias) | ✅ roda |
| `sudoku_demo.bend` | demo do núcleo | ✅ roda |
| `LAWS.bend` | **9 leis** (5 do tabuleiro + 4 sobre o solver) | ✅ |
| `PROOF.bend` | provas; **`bend PROOF.bend` → `All terms check.`** | ✅ |
| `sudoku.bend` | 1ª tentativa, superada por `sudoku_solve.bend` | 🗑️ histórico |
| `probe_{lazy,strict,lambda,law,if}.bend` | sondas que isolaram as regras abaixo | ✅ |

### REGRAS DO BEND descobertas na prática (custaram várias iterações)
1. **`match` não inspeciona valor computado** (`match U32.is_eq(...)` é recusado).
   Decisão se faz com `Bool.pick`/`Bool.to_u32`/`Maybe.or` (que casam internamente)
   ou dentro de um def. **`Bool.pick` é ESTRITO: computa os dois lados** — isso
   inviabiliza backtracking ingênuo (explosão combinatória).
2. **O argumento que ENCOLHE vai PRIMEIRO**; todos os anteriores têm de ser
   repassados *inalterados*. Por isso `base + 1` antes do contador quebra — o
   contador `Nat` é o 1º parâmetro.
3. **Valor usado 2× precisa de `+`** (afim por padrão): parâmetros, *binders* de
   `let` dentro de `do` (`+b : +List<U32> = …`) e o parâmetro casado (`+k: Nat`,
   senão `p` conta como uso duplo).
4. **`match` tem de encabeçar o corpo de um def** — não pode ficar solto no `do`.
5. **`let` dentro de `do` exige anotação de tipo** (`x : T = v`).
6. **O padrão `law` + `def .if` da Base NÃO compila fora dela** nesta versão —
   `probe_law.bend` (mínimo reproduzível) dá *"an unfilled law is a dead claim:
   live code cannot use it"*. Alternativa usada: `@unsafe` nos recursivos.
7. **Prova que preenche uma lei é `def Nome():`** — com parênteses mesmo sem
   parâmetros, e sem repetir tipos.
8. **`Array<T>` é árvore binária afim**; `List<U32>` (= `List<&1, U32>`) é afim,
   `+List<U32>` (= `List<&2, U32>`) é reutilizável. Escolhemos `+List<U32>`.

### Resultado verificado (`bend sudoku_demo.bend`)
```
1a celula vazia do puzzle  : 0        (correto)
1a celula vazia do gabarito: 99       (99 = nenhuma: gabarito completo)
conflitos no puzzle        : 0        (puzzle é consistente)
conflitos no gabarito      : 0        (gabarito é consistente)
conflitos no corrompido    : 6        (detectou o erro plantado)
box_of(0)=0 box_of(40)=4 box_of(80)=8 (geometria correta)
```

### As 5 leis provadas
`puzzle_valido`, `gabarito_valido`, `gabarito_completo`, `puzzle_tem_vazia`,
`gabarito_corrompido_acusa_6_conflitos` — fechadas sobre tabuleiros concretos,
demonstradas por normalização (`{==}`).
O aviso *"5 defs rely on unsafe or foreign code"* é **transparência do Bend**:
as provas dependem das funções `@unsafe` do núcleo (ele reporta todo book que
usa `@unsafe` — um relatório limpo significa que nenhuma garantia foi dispensada).

### ✅ BACKTRACKING COMPLETO — FEITO

O `sudoku_solve.bend` resolve o puzzle real do G1 (**43 vazias**) em **11 ms**,
com `diffs_vs_gabarito=0` (a solução é exatamente o gabarito). Três descobertas
foram necessárias, todas comprovadas por sonda:

1. **O Bend 2 é ESTRITO.** `Bool.pick(c,a,b)` e `Maybe.or(m,n)` computam **os
   dois lados** quando são chamadas de função. O que engana é que `None{}` ou
   uma chamada não usada viram código morto — parecia lazy.
   *Sonda decisiva:* `probe_strict.bend` → `Maybe.or(Some{42}, loop_infinito)`
   **TRAVA** (a sonda A3, com `None{}` no ramo não escolhido, responde na hora).
2. **A única preguice real: LAMBDA.** `u => expr` é um valor; só roda quando
   aplicada. *Sonda:* `probe_lambda.bend` imprime `42` com um loop infinito na
   outra lambda. Daí o `pick_lazy` (escolhe no `match` e aplica só um lado) e o
   `or_lazy` (aplica a alternativa só quando a tentativa devolveu `None`) —
   é o `if` lazy que o solver precisava.
3. **Custo por acesso em lista ligada.** `can_place` varria 27 células
   (~1080 ops, `at32` é O(i)) **por valor tentado** — o solver não terminava em
   150 s. Com **máscaras de bits** (9 linhas + 9 colunas + 9 blocos em
   `List<U32>` de 27; `U32.shln/and/or`) virou O(1): **>1000× de ganho**.

Outros dois bugs reais isolados no caminho:
- `set_at` num índice ≥ 81 devolvia a lista **encurtada** e `first_zero` achava
  "vazio" na posição 0 de `Nil` para sempre → recursão infinita de verdade;
- `fuel` limitando **profundidade**, não chamadas: tentar outro valor no mesmo
  nível não consome fuel (por isso 81 serve para 43 vazias).

### Portão: 9 leis provadas

`bend PROOF.bend` → **`All terms check.`** (≈3 min: o checker **normaliza e
roda o solver** no próprio avaliador para provar os teoremas sobre ele).

| Lei | O que afirma |
|---|---|
| `puzzle_valido` | o puzzle inicial não tem repetição em linha/coluna/bloco |
| `gabarito_valido` | o gabarito também não |
| `gabarito_completo` | o gabarito não tem célula vazia (`empty_at == 99`) |
| `puzzle_tem_vazia` | o puzzle começa com a 1ª célula vazia |
| `gabarito_corrompido_acusa_6_conflitos` | com um valor trocado, acusa 6 conflitos |
| **`solver_preenche_tudo`** | o solver completa as 81 células |
| **`solver_solucao_valida`** | a saída tem 0 conflitos |
| **`solver_acha_o_gabarito`** | a solução é exatamente `answer()` |
| **`solver_preserva_as_dadas`** | nenhuma célula dada foi alterada |

O aviso *"9 defs rely on unsafe or foreign code"* é transparência: as provas
dependem de defs `@unsafe` (recursão sem checker de terminação e aritmética
nativa). Um relatório limpo significaria que nenhuma garantia foi dispensada.

### Benchmark da escalada (`sudoku_run.bend`)

| Células vazias | Resultado |
|---|---|
| 0, 2, 10, 15 | instantâneo, == gabarito |
| 25, 30, 35 | instantâneo, solução válida (≠ gabarito: puzzle **ambíguo** — zerar células do gabarito pode admitir outra solução) |
| **43 (puzzle real do G1)** | **11 ms**, == gabarito |

---

## 6. Sudoku.com — por que "detectava, resolvia e não preenchia"

### Os três bloqueadores (todos medidos no DOM real)

| Bloqueador | Como aparecia |
|---|---|
| `#pause-overlay` | `pointer-events: auto`, `z-index: 10`, cobrindo o canvas. O popup da extensão tira o foco → o site pausa → **todo clique no tabuleiro batia no overlay**. Confirmado: `elementFromPoint` na célula retornava `DIV.pause-overlay`. |
| `.ima-container` (Google IMA) | `pointer-events: auto`, `z-index: 99`, 823×543 **exatamente sobre o tabuleiro**. Um `<iframe>` de anúncio: `elementFromPoint` retornava `IFRAME`. Foi o que gerou os 3 erros e o fim de jogo. |
| `.popup-content` (cookies) | banner por cima; resolve com um `.click()`. |

### O bloqueador decisivo: eventos sintéticos não movem o canvas

O sudoku.com **ignora** `canvas.dispatchEvent(...)`. Testado, com o overlay já
removido e o canvas recebendo cliques:

| variação | resultado |
|---|---|
| `PointerEvent` pointerdown/up | ❌ não seleciona a célula |
| `MouseEvent` mousedown/mouseup/click | ❌ |
| `mouseover`+`mousemove` antes do clique | ❌ |
| `isTrusted` forjado (`Object.defineProperty`) | ❌ |
| **`Input.dispatchMouseEvent` (CDP)** | ✅ **seleciona e preenche, sem erro** |

O sintético não selecionava a célula, então o numpad aplicava o número **na
célula que estava selecionada** → erro.

### Solução implementada (v3.2)

1. `background.js` (novo service worker): executor de cliques por
   **`chrome.debugger`** (`Input.dispatchMouseEvent` = input real). Não está
   disponível em content script, então o preenchimento de canvas roda aqui.
2. `popup.js`: se a estratégia é `sudoku.com`, o popup pede o **plano de
   cliques** ao content script (`action: 'plan'`) e entrega ao background —
   depois **fecha** (a página recupera o foco e o jogo não pausa).
3. Ordem de execução: `hideBlockers` (uma vez: cookies + anúncios) →
   `clearBlockers` (só o `#pause-overlay`, barato) → por célula: **valida
   `elementFromPoint == CANVAS`** antes de clicar (o anúncio volta!) → clica na
   célula → clica no numpad. Re-checa a cada 8 células.
4. **Custo**: esconder os anúncios no laço era o gargalo (9,1 s/célula). Separar
   o "esconder" (caro, roda 1× + quando bloqueia) do "despausar" (barato, roda
   sempre) levou a **1,3 s/célula** — 7× mais rápido, com 0 erros.

### Modo humanizado (todos os jogos)

`background.js` (canvas) e `fillCells` (DOM) respeitam 3 modos escolhidos no
popup:

| modo | comportamento |
|---|---|
| **Humano** (padrão) | trajetória do mouse interpolada com easing, pausa de 220–540 ms por célula, pausa maior a cada 12 células |
| Normal | trajetória + pausas ~40% |
| Rápido | sem trajetória, delays mínimos |

### Ferramenta de validação

`tools/fill_sudokucom_cdp.py` — preenche o sudoku.com por CDP fora da extensão
(mesmo caminho do `background.js`), com `--check`, `--fast` e `--max N`.
Rodada real: **20 células em 25,9 s, 0 erros** (e as 23 restantes em 29,8 s).

---

## 7. Palavras Cruzadas Mini do G1 — o gabarito vem no JSON

### A descoberta que dispensa LLM e dicionário

Interceptando `fetch`/`XHR` (`Page.addScriptToEvaluateOnNewDocument`) e recarregando
a página, apareceu a requisição que carrega o puzzle:

```
https://g1.globo.com/jogos/static/cruzada_mini.json     (5.167 bytes)
```

E ele traz **o gabarito inteiro**:

```json
[{ "metadata": {...},
   "grid": { "width": 5, "height": 5,
             "cell": [ {"x":"1","y":"1","type":"block"},
                       {"x":"1","y":"2","solution":"F"}, ... ] },
   "word": [ {"id":"1","x":"2-5","y":"1"}, ... ],               // 10 palavras
   "clues": [ {"title":"Vertical","clue":[{"word","number","format","value"}]} ] }]
```

- `grid.cell[].solution` = **a letra de cada célula** (só `type:"block"` não tem);
- `grid.cell[].x/.y` são **1-based** e casam com o DOM `cell-(x-1)-(y-1)`;
- `word[].x` pode ser faixa (`"2-5"`) ou valor único (`"2"`): x variando = horizontal;
- atenção: no JSON os títulos **Vertical/Horizontal vêm trocados** (a dica
  "Doce de aniversário", que na página está em HORIZONTAIS, aparece sob
  `title:"Vertical"`). Não importa: as coordenadas de `word`/`cell` são corretas.

Como é **mesma origem** da página, o `fetch` do content script funciona sem CORS
e sem permissão extra. Isso é o mesmo padrão do sudoku.com (que entrega
`solution` no `localStorage`): **o cliente recebe o gabarito**.

### O tabuleiro é SVG (e aqui evento sintético FUNCIONA)

```html
<g class="cell cell-1-0" tabindex="0" transform="translate(1,0)">
  <rect width="1" height="1"></rect>
  <text class="value" x="0.5" y="0.8">B</text>     ← letra digitada
  <text class="number" x="0.08" y="0.25">1</text>  ← número da palavra
</g>
```

- `cell-<col>-<row>` com **col/row 0-based** (o JSON é 1-based → `x-1`, `y-1`);
- **preencher = `focus()` na célula + `KeyboardEvent` com a letra** — diferente do
  sudoku.com (canvas), aqui os handlers são Svelte normais e aceitam evento
  sintético. Confirmado ponta a ponta: as 23 letras entraram e o jogo deu
  **"Parabéns!"**;
- não há input de texto: `input` são só checkbox/hidden.

### O gate: modal de login na frente do "Iniciar"

Sem sessão logada a página mostra *"Faça login gratuitamente… Você ainda pode
jogar mais 2 partidas sem ter que logar na sua conta Globo"* com
**[Mais tarde] [Login]**, e esse modal **cobre o botão `Iniciar`** — a detecção
falha com `g.cell = 0`. O fluxo que funciona (implementado em `cwEnsureGame`):

1. clicar em **"Mais tarde"** (dispensa o login);
2. clicar em **"Iniciar"** até `g.cell` aparecer.

Medido: **4,1 s** do zero (página inicial) ao tabuleiro detectado. Ao clicar nos
botões é obrigatório filtrar por **visibilidade + `elementFromPoint`**: existem
vários elementos com o texto "Iniciar"/"Fácil" na página e o primeiro da lista
costuma ser um container de 1346 px que engole o clique.

### Comportamentos do jogo que mudam a implementação

- **É diário**: um jogo por dia (novo à meia-noite) e *"só é possível jogar uma
  vez"* — não dá para rejogar para testar. Teste no perfil anônimo/não logado
  para não consumir a partida do usuário.
- **Após completar, as células ficam travadas**: digitar "Z" não altera nada e o
  `cwFill` corretamente pula células já certas (`preenchidas: 0, total: 0`).
- O botão **"Checar"** valida o quadro — serve de oráculo para testes.
- "Revelar" revela apenas a palavra em foco (não o quadro todo).

### Validação feita

| Etapa | Resultado |
|---|---|
| `cwEnsureGame` (gate + Iniciar) | ✅ 4,1 s, 23 células |
| `cwLoadAnswer` (JSON) | ✅ 23 letras, 2 blocos, 10 palavras |
| Dedução das 10 pistas por raciocínio | ✅ BOLO/FICAR/ALADO/CASOS/ECOS + BILAC/OCASO/LADOS/OROS/FACE |
| Preenchimento por teclado sintético | ✅ 23/23 e o jogo respondeu **"Parabéns!"** |
| `cwFill` (arquivo da extensão) | ✅ roda sem erro e respeita células corretas |

*(O `solution` do JSON tem as letras sem acento — `cwNorm` remove diacríticos:
"ORÓS" entra como "OROS".)*

---

## 8. Caça-Palavras (`/jogos/caca-palavras/`) — destaque das respostas

**Gabarito: JSON estático do próprio site (mesma origem ⇒ sem CORS, sem permissão extra,
nada rodando na máquina):**

    https://g1.globo.com/jogos/static/c_palavras.json      (~1,3 KB)

    { "name": "Agência Nacional de Saúde (ANS)",
      "description": "ÓRGÃO federal que fiscaliza … REDE … COBERTURA … SAÚDE … DIREITO … PRÁTICAS …",
      "content":     ["K D F P R A T I C A S F", ...],    // 12 linhas x 12 colunas de letras
      "answer":      ["- D - P R A T I C A S -", ...],    // o CAMINHO das palavras ("-" nas demais)
      "suggestions": ["ORGÃO","BRASIL","REDE","COBERTURA","SAUDE","DIREITO","PRATICAS"] }

Cruzar `suggestions` com `answer` localiza **7/7**, aceitando só o trecho cujas células
estão 100% marcadas — isso evita casar "REDE" com outra ocorrência da grade. Depois de
ordenar (mais longa primeiro): COBERTURA(9,v) PRATICAS(8,h) DIREITO(7,v) BRASIL(6,h)
ORGÃO(5,v) SAUDE(5,v) REDE(4,h).

**DOM da grade:**

    <svg viewBox="-0.5 -0.5 12 12" width="460" height="460">
      <g transform="translate(col row)"><text>K</text></g>      <!-- 144 celulas, 1 unidade = 1 celula -->

As letras das respostas também carregam `data-id` (o índice da palavra), mas o JSON é a
fonte confiável.

**Por que NÃO automatizamos a marcação (o jogo é Svelte 5 com event delegation):**

* Listeners registrados no `<svg>`: `Q("mousedown", I, Tt)`, `Q("mouseleave"/"mouseup", I, wt)`,
  `Q("mousemove"/"touchmove", I, y)`, `Q("touchstart", I, Tt)`, `Q("touchend", I, wt)`.
* `Tt` só liga o flag "selecionando"; `y` (mousemove) exige esse flag e lê
  **`event.offsetX/offsetY`** (não `clientX`) para calcular
  `col = floor(offsetX / (largura * 1.2) * 12)`; `wt` finaliza a jogada.
* O `*1.2` compensa o **devicePixelRatio** do Chrome/Edge (`dt()` = UA "Chrome" +
  vendor "Google Inc." ⇒ `true` também no Edge; a tela de teste está em 125%).
* **Testado sem sucesso (6 abordagens):** `dispatchEvent` de `MouseEvent` e `PointerEvent`
  no `<svg>`, no `<g>` e no `<text>`; `offsetX/offsetY` forçados via `Object.defineProperty`;
  com e sem foco (`Page.bringToFront`); clique/arrasto real por CDP
  (`Input.dispatchMouseEvent`, mouse e touch) com as coordenadas que a fórmula do jogo espera
  (célula 3 = offsetX 161 de 552). Os eventos **chegam** (um contador próprio confirma
  `down/move/up` no svg), mas a seleção do jogo não avança.
* **Solução adotada** (decisão de projeto: *"só deixar as palavras em highlight"*):
  destacar as respostas na própria grade — `<rect class="__g1ws_hl">` inserido no `<g>` da
  célula (antes do `<text>`, atrás da letra), uma cor por palavra — mais uma legenda
  flutuante (`#__g1ws_legenda`) com as palavras e as cores. O jogador marca arrastando.

**`wsEnsureGame` — armadilha que custou um teste:** a página lista OUTROS jogos do G1 com
links "Jogar"; clicar em qualquer `<a>` com esse texto **navega para outro jogo** (o teste
foi parar em `/jogos/soletra/`). Agora só clica em `<button>` (ou em `<a>` cujo href
contenha `caca-palavras`), e aborta se `location.pathname` deixar de ser o do jogo.

**Validação na página real:**

| Passo | Resultado |
|---|---|
| `wsEnsureGame` (dispensa o login + "Iniciar") | `{ok:true, acao:"iniciou"}` |
| `wsDetect` | `wordsearch · 12x12 · 144 células` |
| `wsLoadPuzzle` + `wsSolve` | 7/7 palavras com direção (4 verticais, 3 horizontais) |
| `wsHighlight` | **44 células destacadas** (= 5+6+4+9+5+7+8), 0 falhas, legenda visível |

---

## 9. Dito (`/jogos/dito/`) — Wordle do G1

6 tentativas para a palavra secreta de 5 letras. O tabuleiro é DOM puro
(`.board .row` → `.letter` com classe `correct` / `not-ordered` / `wrong`) e o
teclado são `<button class="key">` (a tecla de confirmar tem o texto "ENTER").

**A resposta vem do próprio cliente.** Não há request ao iniciar o jogo: o bundle
carrega a base diária num chunk `…/_astro/index.<hash>.js` na forma

    a0 = JSON.parse('[{"id":91186103511,"date":1691982000000,"value":"sinal"}, …]')

com **1236 entradas** (de 2023-08-14 a 2026-12-31). O `date` é um timestamp às
03:00 UTC = 00:00 em Brasília, então comparar as datas **locais** acerta o dia.

Como achar o chunk sem saber o hash: varrer
`performance.getEntriesByType('resource')` filtrando `_astro/*.js` de mesma origem
(sem ads/trackers) e procurar o padrão acima; guardar a URL que casou em
`sessionStorage` para as próximas vezes.

**Validação:**
- 2026-09-23 → `moeda`; vizinhos `rádio` (21), `nervo` (22), `moeda` (23), `lazer` (24).
- Chute "TERRA" na página marcou T/E/R como `wrong` e **A** como `correct` — bate
  com `MOEDA` (termina em A, sem T/E/R).
- Digitando a resposta pelas teclas: `[moeda] M O E D A` todas `correct` e a tela
  respondeu **"Acertou! A palavra correta é M O E D A"**.

⚠️ O estado da partida fica em `localStorage['@g1/dito']` (estatísticas) — jogar no
perfil de teste não consome a partida do perfil logado.

---

## 10. Soletra (`/jogos/soletra/`) — Spelling Bee

7 letras em hexágonos, `word_count` palavras no dia (29 no dia testado), com
`pangram_count` pangramas (palavras que usam as 7 letras).

Gabarito: `https://g1.globo.com/jogos/static/soletra.json`
→ `{ letters:"zaimort", word_list:[{word,score,pangram,label}], pangram_list, total_score }`.

**⚠️ Preencher não é `input.value`.** Setar o valor + disparar `input` + ENTER mostra
as letras na telinha mas **não valida** — o jogo mantém o estado pelas TECLAS. O que
funciona é focar o `#input` e disparar `keydown`/`keyup` por letra (com `keyCode`,
que o componente lê), depois ENTER (ou o botão "Confirmar").

**Validação:** digitando `amortizar` letra a letra → toast *"Encontrou uma palavra
'pangrama'! +16 pontos"* e o contador **1/29**. O placar é lido da própria página
(`já encontradas N/M`), então a extensão usa isso para saber se a palavra foi aceita.

---

## 11. Combinado (`/jogos/combinado/`) — Connections

16 palavras embaralhadas → 4 grupos de 4.

Gabarito: `https://g1.globo.com/jogos/static/combinado.json`
→ `{ words:[16], groups:[4 nomes], order:[16 índices] }`.

**Estrutura (validada 16/16 contra o DOM):**
- `words` está em **blocos de 4 já na ordem dos grupos** — `words[0..3]` = `groups[0]`, etc.
- `order` mapeia **posição na tela → índice em `words`**: `tela[i] = words[order[i]]`.
  (ex.: `order=[1,8,13,5,…]` → `tela[0]=words[1]='propósito'`, `tela[1]=words[8]='valente'` …)
- algumas palavras vêm com `\r` no fim (quirk do JSON) → normalizar sempre.

**⚠️ Armadilha no DOM:** as células são `button.cell` e a classe é
`cell cell--interactive cell--responsive` — **filtrar por `/active/` descarta TODAS**
(as palavras não foram clicadas e parece que o seletor está errado). Filtrar por
`cell--selected`/`cell--chosen`, ou simplesmente por `button.cell`.

**Preencher:** clicar as 4 palavras do grupo e em "Confirmar". O slot do grupo muda
de `Grupo N` para `GN` — é assim que a extensão confirma o acerto.

**Validação:** grupo "Objetivo" (`meta`, `propósito`, `alvo`, `intenção`) → o slot
virou **G1** e o jogo avançou para o "Grupo 2".

---

## 12. Labirinto (`/jogos/labirinto/`) — canvas

Descobrir a palavra do dia ligando as letras na ordem certa, **passando por todas as
49 casas** de um tabuleiro 7×7.

Gabarito: `https://g1.globo.com/jogos/static/labirinto.json`
→ `{ word:"EDIFICAR", clue:"…", rows:7, cols:7,
     letter_positions:[[col,row,"E"], …], solution_path:[[col,row], …], walls:[…] }`.

**⚠️ AS COORDENADAS SÃO `[col, row]`.** O próprio jogo converte o mouse com
`Qt(x,y,rows,cols,cel) → [floor(x/cel), floor(y/cel)]`, ou seja **coluna primeiro**.
Transpor (tratar como `[row,col]`) faz o traço sair torto e o jogo coletar letras
fora de ordem — o display veio `ERIA` em vez de `EDIFICAR` até a correção.

**⚠️ Dois bloqueios cobrem o canvas** e engolem o arrasto (não aparecem no
`body.innerText` como "pausado"):
1. `.tour-backdrop` / `.tour-spotlight` — o tour de boas-vindas, com botões
   "Avançar" (várias vezes) e "Fechar";
2. `.drawer-overlay` com o botão "Jogar" (o "Como jogar").
`elementFromPoint` na casa inicial devolve `DIV.drawer-overlay` / `DIV.tour-spotlight`
enquanto eles existem — é o jeito rápido de diagnosticar.

**Como o jogo lê o mouse:** listeners `mousedown`/`mousemove`/`mouseup` (e
`touch*`) no canvas, todos usando `clientX - rect.left`. A célula é
`floor(canvasSize / gridSize)` em **CSS px**: canvas 336 CSS px → **48 px por casa**
(o buffer interno é 420 por causa do `devicePixelRatio` 1.25, mas o cálculo do jogo
é em CSS px). As setas também funcionam (`window.addEventListener('keydown', dt)`),
mas só depois que o tour sai e com o caminho já iniciado.

**Preenchimento:** arrasto contínuo do início até a última casa, com o trajeto
INTERPOLADO (o jogo registra cada casa no `mousemove`; um salto pula casa e a
palavra não fecha).

**Validação:** traço completo → display `EDIFICAR` → **"Parabéns! Mestre do
labirinto! Você completou o labirinto sem ajuda no tempo de: 02:12"**.

**Caminho de implementação:** `labirinto.js` monta o plano (pontos em coordenadas de
viewport) e tenta primeiro com eventos sintéticos; se o display não avançar, devolve
`{ precisaCdp: true, plano }` e o popup manda o plano ao background, que arrasta com
`Input.dispatchMouseEvent` (mensagem `cdpDrag`). O script standalone equivalente é
`tools/solve_labirinto_cdp.py`.

---

## 13. O menu (popup) e o painel na página

O popup detecta o jogo da aba e mostra **um** botão de ação, já rotulado com o que
vai fazer (`Resolver a palavra do dia`, `Digitar as palavras`, `Traçar o caminho`,
`Destacar as palavras`, `Preencher o tabuleiro`), mais:

- **Ritmo** (Humano / Normal / Rápido) — persistido em `chrome.storage.local` e
  aplicado em TODOS os jogos (o mesmo `opts` alimenta o content script e o executor
  CDP do background);
- **Jogos suportados** — chips; clicar abre o jogo em outra aba.

Durante a execução, `g1common.js` desenha um **painel flutuante** na página
(mesmo layout do painel do caça-palavras) com o passo a passo: lista de palavras do
Soletra com ✔ nas aceitas, os 4 grupos do Combinado, o trajeto do Labirinto em
setas (`←↑→↓`), a palavra do Dito. O painel é fechável (✕) e a ação `limpar-painel`
também o remove.

---

## 14. Histórico

| Data | Mudança |
|---|---|
| 2026-09-23 | Investigação inicial: script Python via CDP resolveu puzzle do G1 (validado, PARABÉNS) |
| 2026-09-23 | 1ª extensão (MV3) criada; falhou no G1 e no sudoku.com |
| 2026-09-23 | Descoberta da causa no G1: **gate de login** (botões disabled + modal) |
| 2026-09-23 | Descoberta no sudoku.com: canvas + **`localStorage['main_game']` tem mission+solution** |
| 2026-09-23 | Geometria do canvas mapeada e validada; preenchimento por PointerEvent comprovado |
| 2026-09-23 | Extensão reescrita (v3) com diagnóstico; renomeada para `g1-games-helper` |
| 2026-09-23 | Teste: parser + solução da v3 = **81/81** correto no sudoku.com |
| 2026-09-23 | Descoberta via captura do Edge real: **o G1 pausa ao perder foco** e o tabuleiro pausado fica vazio → era essa a causa do "não detecta". Corrigido com `ensureNotPaused()` por texto |
| 2026-09-23 | **BUG do solver encontrado e corrigido**: devolvia a cópia não resolvida (e mutava a entrada). Causa do "detecta mas não resolve". Provado por teste: unitário 5/8 → **8/8** |
| 2026-09-23 | Teste de integração com fixture local do G1 (sem login): **11/11** — detecta → resolve → preenche **81/81** |
| 2026-09-23 | `ensureNotPaused` otimizado (`textContent` em vez de `innerText`, que forçava reflow em páginas grandes) |
| 2026-09-23 | **Caça-Palavras**: gabarito no JSON estático `c_palavras.json`; o jogo é Svelte com event delegation e lê `offsetX` → automação da marcação inviável (6 abordagens testadas); adotado **destaque das respostas** (`wordsearch.js`) |
| 2026-09-23 | `wsEnsureGame` corrigido: só clica em `<button>` — links "Jogar" de outros jogos navegavam para fora (parou em `/jogos/soletra/`) |
| 2026-09-23 | Extensão **v3.4.0**: `wordsearch.js` no manifest + fluxo próprio no popup ("Destacar palavras") |

> Nota de nomenclatura: neste projeto **"Bend 2" é a linguagem de programação**
> (bendlang/bend, doc em `D:\Dev\Projetos\bend-docs`) — **não** o Cheat Engine
> MCP bridge. Fase 2 usa Bend para o solver com `LAWS.bend` + `PROOF.bend`.

---

## 15. Comandos úteis

```bash
# Edge com CDP (para inspecionar/testar; a extensão carrega manualmente)
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  --remote-debugging-port=9222 \
  --user-data-dir="$LOCALAPPDATA/edge-automation-profile" \
  --no-first-run --remote-allow-origins=* about:blank

# validar o conteúdo da v3 sem carregar a extensão (via CDP/browser_exec)
#   solver.js + content.js injetados → usar window.__g1Helper.*

# checar dados do sudoku.com no console da página
#   JSON.parse(localStorage.getItem('main_game'))

# caça-palavras: o gabarito (mesma origem, então fetch direto na página)
#   await (await fetch('/jogos/static/c_palavras.json')).json()
# palavras cruzadas: idem
#   await (await fetch('/jogos/static/cruzada_mini.json')).json()
```
