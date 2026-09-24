# Checklist de lançamento em lojas (Chrome Web Store / Edge Add-ons)

Auditoria feita em 2026-09-23 sobre a **v4.0.0**. Cada linha tem a evidência, não
a impressão.

## Veredito

**Não está pronta para submeter ainda.** Dois impedimentos são de *política* (não
se resolve com código) e três são técnicos (estes eu resolvo).

## ✅ O que já está conforme

| Item | Evidência |
|---|---|
| Manifest V3 | `manifest_version: 3` |
| Sem código remoto | 0 ocorrências de `eval(`/`new Function(`; nenhum CDN no código |
| Sem script inline (CSP do MV3) | `popup.html` só usa `<script src="popup.js">`; 0 `onclick=` |
| Ícones nos três tamanhos | PNGs válidos 16×16, 48×48, 128×128 |
| `version` semântica | `4.0.0` |
| `name` dentro do limite | 15 chars (limite 75) |
| `description` dentro do limite | **122 chars** (era 173 — a loja recusaria o upload) |
| Permissões todas em uso | `activeTab`, `scripting`, `storage`, `debugger` |
| Permissão morta removida | `tabs` saiu: o código nunca lê `tab.url` |
| Política de privacidade | [`PRIVACY.md`](../PRIVACY.md) escrito e publicado |
| Sem coleta de dados | nada sai do navegador; só requisições para a origem do jogo |

## 🔴 Bloqueadores (precisam de decisão)

| # | Item | Situação | Impacto |
|---|---|---|---|
| 1 | **Permissão `debugger`** | usada no Sudoku.com (canvas) e no arrasto do Labirinto | É a permissão mais fiscalizada da CWS. Para extensão de consumidor a aprovação é improvável e a remoção pós-publicação é comum. Além disso o navegador mostra **"está sendo depurada"** — assusta quem instala. |
| 2 | **`<all_urls>`** | content script em toda a web | Classifica como *broad host permission*: revisão estendida e exigência de justificativa. O correto é declarar só `https://g1.globo.com/*` e `https://sudoku.com/*`. |
| 3 | **Marca no nome/descrição** | "G1 Games Helper", "do G1" | Marca de terceiro: é o motivo mais rápido de takedown por reclamação do titular. |
| 4 | **Risco de política de conteúdo** | extensão que automatiza jogos | A CWS remove com frequência extensões que "interferem em serviços" ou burlam mecânicas de jogo, mesmo com finalidade única bem definida. Risco real, não teórico. |
| 5 | **Assets de loja** | não existem | Exige 1–5 screenshots (1280×800 ou 640×400) e recomenda tile promocional 440×280. |

## 🟡 Lacunas menores

- Ícone é um PNG chapado de 343 bytes — funcional, mas não vende.
- `background.js` (executor CDP) não faz sentido num build sem `debugger`.
- O formulário *Privacy practices* da CWS precisa ser preenchido (declarar "nenhum
  dado coletado" e o uso por permissão).

## Caminhos possíveis

### A) Só GitHub (é o que está no ar hoje)

Zero risco de loja, instalação por "Load unpacked". Já funciona:
<https://github.com/atanycost-png/g1-games-helper>

### B) Build de loja (perde 2 recursos, ganha submetibilidade)

Mudanças necessárias, todas mapeadas:

1. **Remover `debugger`** do manifest → o Sudoku.com sai e o **Labirinto passa a
   modo assistido** (o painel mostra a palavra, a dica e o trajeto em setas para o
   jogador traçar — o caminho já é calculado hoje, só não é "arrastado").
2. **Restringir hosts** para `https://g1.globo.com/*` + `https://sudoku.com/*`
   (ou remover o Sudoku.com de vez e ficar só no G1, bem mais defensável).
3. **Renomear** para algo sem marca — ex.: *Logic Games Helper* ou
   *Word & Logic Puzzle Helper*.
4. **Assets**: 3 screenshots 1280×800 (popup/menu, painel do jogo, antes-depois),
   tile 440×280, ícone redesenhado.
5. **`background.js`** reduzido ao que sobra (ou removido, que aí a extensão vira
   100% content script + popup — o cenário mais limpo para revisão).
6. Preencher a ficha da loja: categoria *Fun/Ferramentas*, idioma pt-BR, o link da
   política de privacidade, e o formulário de práticas de dados.

> Mesmo no caminho B o item 4 da tabela de bloqueadores (risco de política) não
> desaparece: continua sendo uma extensão que resolve jogos por você. É
> distribuição de risco baixo e reversível — não é certeza de aprovação.

## Recomendação

Se o objetivo é **compartilhar com amigos**: caminho A (GitHub) resolve hoje e sem
exposição. Se o objetivo é **ter na loja**: fazer o caminho B, e publicar primeiro
no **Edge Add-ons** — a Microsoft é bem mais permissiva que o Google com esse tipo
de extensão e o mesmo pacote serve.
