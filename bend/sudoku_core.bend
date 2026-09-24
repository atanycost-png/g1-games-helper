import Base

# ============================================================================
# Sudoku em Bend 2 — NUCLEO (validação de tabuleiro)
#   Tabuleiro: List<U32> de 81 posicoes, linha por linha (0 = vazio).
#   Indice i = linha*9 + coluna.
#
#   Regras do Bend aprendidas na pratica (detalhadas em docs/REFERENCIA.md):
#   R1. `match` nao inspeciona valor computado; decisao se faz com Bool.pick
#       (que e ESTRITO: computa os dois lados) ou dentro de um def.
#   R2. O argumento que ENCOLHE vai primeiro; os anteriores passam inalterados.
#   R3. Valor usado 2x precisa de `+` (afim por padrao); idem o binder de um let
#       (`+b : +List<U32> = ...`) e o parametro casado (`+k: Nat`).
#   R4. O padrao `law` + `def .if` usado na Base NAO compila fora dela nesta
#       versao (probe_law.bend prova); por isso recursao usa @unsafe aqui.
# ============================================================================

def puzzle() -> +List<U32>:
  [0,0,4, 3,0,0, 0,0,1,
   0,0,7, 0,9,1, 2,4,0,
   1,9,0, 0,4,0, 8,0,0,
   7,0,9, 2,0,0, 5,0,6,
   0,0,2, 0,5,0, 0,3,0,
   0,0,0, 0,7,6, 9,1,2,
   4,0,5, 0,8,0, 0,0,0,
   2,7,0, 0,0,0, 1,5,8,
   0,0,0, 6,2,5, 3,7,0]

def answer() -> +List<U32>:
  [5,2,4, 3,6,8, 7,9,1,
   8,6,7, 5,9,1, 2,4,3,
   1,9,3, 7,4,2, 8,6,5,
   7,4,9, 2,1,3, 5,8,6,
   6,1,2, 8,5,9, 4,3,7,
   3,5,8, 4,7,6, 9,1,2,
   4,3,5, 1,8,7, 6,2,9,
   2,7,6, 9,3,4, 1,5,8,
   9,8,1, 6,2,5, 3,7,4]

# gabarito com um erro plantado na posicao 0 (5 -> 9): linha 0 fica com dois 9
def broken() -> +List<U32>:
  [9,2,4, 3,6,8, 7,9,1,
   8,6,7, 5,9,1, 2,4,3,
   1,9,3, 7,4,2, 8,6,5,
   7,4,9, 2,1,3, 5,8,6,
   6,1,2, 8,5,9, 4,3,7,
   3,5,8, 4,7,6, 9,1,2,
   4,3,5, 1,8,7, 6,2,9,
   2,7,6, 9,3,4, 1,5,8,
   9,8,1, 6,2,5, 3,7,4]

# --------------------------------------------------------------------------
# acesso a lista
# --------------------------------------------------------------------------

def atn(+xs: +List<U32>, i: Nat) -> U32:
  match xs:
    case Nil{}:
      0
    case h <> t:
      match i:
        case 0n:
          h
        case 1n+p:
          atn(t, p)

def at32(+xs: +List<U32>, i: U32) -> U32:
  atn(xs, U32.to_nat(i))

# --------------------------------------------------------------------------
# geometria
# --------------------------------------------------------------------------

def row_of(i: U32) -> U32:
  (i / 9 : U32)

def col_of(i: U32) -> U32:
  (i % 9 : U32)

def box_of(+i: U32) -> U32:
  U32.add(U32.mul((row_of(i) / 3 : U32), 3), (col_of(i) / 3 : U32))

# --------------------------------------------------------------------------
# contagem de ocorrencias (sem branch: Bool.to_u32)
# --------------------------------------------------------------------------

def hits(n: Nat, +xs: +List<U32>, +base: U32, +step: U32, +v: U32) -> U32:
  match n:
    case 0n:
      0
    case 1n+p:
      U32.add(Bool.to_u32(U32.is_eq(at32(xs, base), v)),
              hits(p, xs, U32.add(base, step), step, v))

def line_hits(+xs: +List<U32>, +i: U32, +v: U32) -> U32:
  hits(9n, xs, U32.sub(i, col_of(i)), 1, v)

def col_hits(+xs: +List<U32>, +i: U32, +v: U32) -> U32:
  hits(9n, xs, col_of(i), 9, v)

def box_rows(n: Nat, +xs: +List<U32>, +base: U32, +v: U32) -> U32:
  match n:
    case 0n:
      0
    case 1n+p:
      U32.add(hits(3n, xs, base, 1, v), box_rows(p, xs, U32.add(base, 9), v))

def box_hits(+xs: +List<U32>, +i: U32, +v: U32) -> U32:
  box_rows(3n, xs,
           U32.add(U32.mul(U32.div(box_of(i), 3), 27), U32.mul((box_of(i) % 3 : U32), 3)),
           v)

# --------------------------------------------------------------------------
# pode colocar v na posicao i? (nenhuma ocorrencia em linha, coluna ou bloco)
# --------------------------------------------------------------------------

def can_place(+xs: +List<U32>, +i: U32, +v: U32) -> Bool:
  U32.is_zero(U32.add(U32.add(line_hits(xs, i, v), col_hits(xs, i, v)), box_hits(xs, i, v)))

# --------------------------------------------------------------------------
# escrita numa posicao
# --------------------------------------------------------------------------

def set_atn(+xs: +List<U32>, i: Nat, +v: U32) -> +List<U32>:
  match xs:
    case Nil{}:
      Nil{}
    case h <> t:
      match i:
        case 0n:
          v <> t
        case 1n+p:
          h <> set_atn(t, p, v)

def set_at(+xs: +List<U32>, +i: U32, +v: U32) -> +List<U32>:
  set_atn(xs, U32.to_nat(i), v)

# --------------------------------------------------------------------------
# MAQUINA DE ESTADOS PARA O BRANCH: o Bend 2 e ESTRITO (computa os argumentos
# antes da chamada), mas uma LAMBDA e um valor que so roda quando aplicada.
# `pick_lazy` escolhe o lado no `match` e aplica apenas ele -> o ramo nao
# escolhido nunca e computado. E o unico branching realmente preguicoso.
# (Prova: probe_lambda.bend imprime 42 com um loop infinito na outra lambda.)
# --------------------------------------------------------------------------

def pick_lazy(-A: Type, c: Bool, f: Unit -> A, g: Unit -> A) -> A:
  match c:
    case True{}:
      f(Unit{})
    case False{}:
      g(Unit{})

# --------------------------------------------------------------------------
# MASCARAS DE BITS: can_place em O(1) em vez de varrer 27 celulas.
#   posicao r     (0..8)  = valores usados na linha r
#   posicao 9+c   (9..17) = valores usados na coluna c
#   posicao 18+b  (18..26)= valores usados no bloco b
#   bit (v-1) ligado = valor v ja usado.
# --------------------------------------------------------------------------

def zero27() -> +List<U32>:
  [0,0,0,0,0,0,0,0,0,
   0,0,0,0,0,0,0,0,0,
   0,0,0,0,0,0,0,0,0]

def bit_of(v: U32) -> U32:
  U32.shln(1, U32.to_nat(U32.sub(v, 1)))

def row_idx(i: U32) -> U32:
  row_of(i)

def col_idx(i: U32) -> U32:
  U32.add(9, col_of(i))

def box_idx(i: U32) -> U32:
  U32.add(18, box_of(i))

# liga o bit de v nas tres mascaras (v == 0 nao mexe em nada)
def put_bit3(+ms: +List<U32>, +i: U32, +v: U32) -> +List<U32>:
  pick_lazy(+List<U32>, U32.is_zero(v),
            u => ms,
            u => set_at(
                   set_at(
                     set_at(ms, row_idx(i), U32.or(at32(ms, row_idx(i)), bit_of(v))),
                     col_idx(i), U32.or(at32(ms, col_idx(i)), bit_of(v))),
                   box_idx(i), U32.or(at32(ms, box_idx(i)), bit_of(v))))

def mk_masks(n: Nat, +cell: +List<U32>, +i: U32, +ms: +List<U32>) -> +List<U32>:
  match n:
    case 0n:
      ms
    case 1n+p:
      mk_masks(p, cell, U32.add(i, 1), put_bit3(ms, i, at32(cell, i)))

def masks_of(+cell: +List<U32>) -> +List<U32>:
  mk_masks(81n, cell, 0, zero27())

# pode colocar v em i? (consulta 3 mascaras, O(1))
def can_place_m(+ms: +List<U32>, +i: U32, +v: U32) -> Bool:
  U32.is_zero(U32.or(U32.or(U32.and(at32(ms, row_idx(i)), bit_of(v)),
                           U32.and(at32(ms, col_idx(i)), bit_of(v))),
                     U32.and(at32(ms, box_idx(i)), bit_of(v))))

# --------------------------------------------------------------------------
# validacao: um tabuleiro completo tem 0 conflitos
#   para cada celula preenchida, conta repeticoes dela em linha/coluna/bloco
#   (a propria celula conta 1 em cada, entao subtraimos 3)
# --------------------------------------------------------------------------

@unsafe def dups(+xs: +List<U32>, +i: U32) -> U32:
  U32.add(U32.sub(line_hits(xs, i, at32(xs, i)), 1),
          U32.sub(U32.add(col_hits(xs, i, at32(xs, i)), box_hits(xs, i, at32(xs, i))), 2))

@unsafe def conflicts(n: Nat, +xs: +List<U32>, +i: U32) -> U32:
  match n:
    case 0n:
      0
    case 1n+p:
      U32.add(Bool.pick(U32, U32.is_eq(at32(xs, i), 0), 0, dups(xs, i)),
              conflicts(p, xs, U32.add(i, 1)))

def total_conflicts(+xs: +List<U32>) -> U32:
  conflicts(81n, xs, 0)

# --------------------------------------------------------------------------
# o puzzle esta preservado na solucao? (toda celula dada mantem o valor)
# --------------------------------------------------------------------------

@unsafe def preserves_go(n: Nat, +p: +List<U32>, +s: +List<U32>, +i: U32) -> Bool:
  match n:
    case 0n:
      True{}
    case 1n+q:
      Bool.and(Bool.or(U32.is_eq(at32(p, i), 0), U32.is_eq(at32(p, i), at32(s, i))),
               preserves_go(q, p, s, U32.add(i, 1)))

def preserves(+p: +List<U32>, +s: +List<U32>) -> Bool:
  preserves_go(81n, p, s, 0)

# --------------------------------------------------------------------------
# primeira posicao vazia (99 = nenhuma)
# --------------------------------------------------------------------------

@unsafe def first_zero(n: Nat, +xs: +List<U32>, +i: U32) -> U32:
  match n:
    case 0n:
      99
    case 1n+p:
      Bool.pick(U32, U32.is_eq(at32(xs, i), 0), i, first_zero(p, xs, U32.add(i, 1)))

def empty_at(+xs: +List<U32>) -> U32:
  first_zero(81n, xs, 0)

# --------------------------------------------------------------------------
# demonstracao movida para sudoku_demo.bend (o core nao tem main, para poder
# ser importado por LAWS.bend / PROOF.bend)
# --------------------------------------------------------------------------
