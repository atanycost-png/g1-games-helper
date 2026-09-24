import Base
import ./sudoku_core.bend as S

# ============================================================================
# Sudoku em Bend 2 — BACKTRACKING COMPLETO (modulo importavel: sem `main`)
#
# O QUE DESCOBRI NA MARRA (sondas probe_lazy / probe_strict / probe_lambda):
#
#   O compilador do Bend 2 e ESTRITO: argumentos sao computados antes da
#   chamada. Nao existe `if` preguicoso de graca:
#     - `Bool.pick(c, a, b)` computa `a` E `b` quando ambos sao CHAMADAS de
#       funcao (o que engana e que `None{}` ou um `loop(0n)` nao usado sao
#       eliminados como codigo morto, dando impressao de preguica);
#     - `Maybe.or(m, n)` idem — `Maybe.or(Some{42}, loop_infinito)` TRAVA.
#
#   O unico valor que o Bend NAO computa e uma LAMBDA: `u => expr` so roda
#   quando aplicada. Dai `S.pick_lazy` (escolhe no `match`, aplica so um lado)
#   e `or_lazy` (aplica a alternativa so quando a tentativa devolveu None).
#   Prova: probe_lambda.bend imprime 42 com um loop infinito na outra lambda.
#
# DESEMPENHO (o que tirou o solver de "nao termina" para "resolve em 0,1s"):
#   - `S.can_place_m` consulta 3 MASCARAS DE BITS (O(1)) em vez de varrer 27
#     celulas de lista ligada (at32 e O(i), ~1080 operacoes por valor tentado);
#   - `from` evita varrer as 81 posicoes a cada no.
#
# BUGS ISOLADOS NO CAMINHO:
#   - `set_at` num indice >= 81 devolvia a lista ENCURTADA e `first_zero`
#     achava "vazio" na posicao 0 de Nil para sempre (recursao infinita real);
#   - `fuel` = profundidade maxima; tentar outro valor no mesmo nivel NAO
#     consome fuel (por isso 81 serve para 43 vazias).
# ============================================================================

# --------------------------------------------------------------------------
# encadeamento: usa o primeiro resultado; se veio None, aplica a alternativa
# (a alternativa e uma lambda: nao e computada se a tentativa deu certo)
# --------------------------------------------------------------------------

def or_lazy(m: Maybe<&2, +List<U32>>, g: Unit -> Maybe<&2, +List<U32>>) -> Maybe<&2, +List<U32>>:
  match m:
    case None{}:
      g(Unit{})
    case Some{+x}:
      Some{x}

# --------------------------------------------------------------------------
# o solver
#
#   try_vals(k, cell, ms, i, fuel): tenta os valores k, k-1, ..., 1 em i.
#   solve(fuel, cell, ms, from): acha a proxima vazia a partir de `from`;
#                                sem vazia, o tabuleiro esta resolvido.
# --------------------------------------------------------------------------

@unsafe def try_vals(+k: Nat, +cell: +List<U32>, +ms: +List<U32>, +i: U32, +fuel: Nat) -> Maybe<&2, +List<U32>>:
  match k:
    case 0n:
      None{}
    case 1n+p:
      S.pick_lazy(Maybe<&2, +List<U32>>,
                  S.can_place_m(ms, i, U32.from_nat(k)),
                  u => or_lazy(solve(fuel,
                                     S.set_at(cell, i, U32.from_nat(k)),
                                     S.put_bit3(ms, i, U32.from_nat(k)),
                                     U32.add(i, 1)),
                               u2 => try_vals(p, cell, ms, i, fuel)),
                  u => try_vals(p, cell, ms, i, fuel))

@unsafe def solve(+fuel: Nat, +cell: +List<U32>, +ms: +List<U32>, +from: U32) -> Maybe<&2, +List<U32>>:
  match fuel:
    case 0n:
      None{}
    case 1n+p:
      S.pick_lazy(Maybe<&2, +List<U32>>,
                  U32.is_lt(S.first_zero(U32.to_nat(U32.sub(81, from)), cell, from), 99),
                  u => try_vals(9n, cell, ms,
                                S.first_zero(U32.to_nat(U32.sub(81, from)), cell, from), p),
                  u => Some{cell})

# --------------------------------------------------------------------------
# a solucao do puzzle do G1 (Nil{} se nao houvesse solucao)
# --------------------------------------------------------------------------

def solved() -> +List<U32>:
  Maybe.default(&2, +List<U32>, solve(81n, S.puzzle(), S.masks_of(S.puzzle()), 0), Nil{})
