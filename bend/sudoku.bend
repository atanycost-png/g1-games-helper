import Base

# ============================================================================
# Sudoku em Bend 2 — solver
#   Tabuleiro: List<U32> de 81 posicoes, linha por linha (0 = vazio).
#   Indice i = linha*9 + coluna.
#
#   Notas de sintaxe aprendidas (ver docs/REFERENCIA.md):
#   1. `match` NAO inspeciona valor computado -> decidimos com Bool.pick/Maybe.or,
#      que fazem o match internamente (Bool.pick e estrito: ambos os lados sao
#      computados; as recursões sempre encolhem, entao isso so custa trabalho).
#   2. O argumento que ENCOLHE vai primeiro; os anteriores tem de passar
#      inalterados (por isso o contador Nat e o 1o parametro).
#   3. Valor usado 2x precisa ser marcado `+` (afim por padrao).
#   4. O padrao `law` + `def .if` (usado na Base) NAO compila fora dela nesta
#      versao, por isso usamos @unsafe nos defs recursivos (a terminação aqui e
#      garantida por construcao: o contador sempre decresce).
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

# --------------------------------------------------------------------------
# acesso
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
# geometria
# --------------------------------------------------------------------------

def row_of(i: U32) -> U32:
  (i / 9 : U32)

def col_of(i: U32) -> U32:
  (i % 9 : U32)

def box_of(+i: U32) -> U32:
  U32.add(U32.mul((row_of(i) / 3 : U32), 3), (col_of(i) / 3 : U32))

# --------------------------------------------------------------------------
# validacao (sem branch: conta ocorrencias com Bool.to_u32)
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

# bloco 3x3: linhas em passo 9, 3 linhas
def box_rows(n: Nat, +xs: +List<U32>, +base: U32, +v: U32) -> U32:
  match n:
    case 0n:
      0
    case 1n+p:
      U32.add(hits(3n, xs, base, 1, v), box_rows(p, xs, U32.add(base, 9), v))

def box_hits(+xs: +List<U32>, +i: U32, +v: U32) -> U32:
  # origem: (bloco/3)*27 + (bloco%3)*3
  box_rows(3n, xs,
           U32.add(U32.mul(U32.div(box_of(i), 3), 27), U32.mul((box_of(i) % 3 : U32), 3)),
           v)

def can_place(+xs: +List<U32>, +i: U32, +v: U32) -> Bool:
  Bool.and(U32.is_eq(line_hits(xs, i, v), 0),
           Bool.and(U32.is_eq(col_hits(xs, i, v), 0),
                    U32.is_eq(box_hits(xs, i, v), 0)))

# --------------------------------------------------------------------------
# primeira posicao vazia a partir de base; 99 = nenhuma
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
# backtracking
#   solve(fuel, xs)        : resolve xs (fuel = quantas celulas ainda pode preencher)
#   try_vals(k, xs, i)     : tenta os valores k, k-1, ..., 1 na posicao i
# --------------------------------------------------------------------------

@unsafe def try_one(+xs: +List<U32>, +i: U32, +v: U32, fuel: Nat) -> Maybe<&2, +List<U32>>:
  Maybe.or(&2, +List<U32>,
           Bool.pick(Maybe<&2, +List<U32>>,
                     can_place(xs, i, v),
                     solve(fuel, set_at(xs, i, v)),
                     None{}),
           None{})

@unsafe def try_vals(+k: Nat, +xs: +List<U32>, +i: U32, +fuel: Nat) -> Maybe<&2, +List<U32>>:
  match k:
    case 0n:
      None{}
    case 1n+p:
      Maybe.or(&2, +List<U32>,
               try_one(xs, i, U32.from_nat(k), fuel),
               try_vals(p, xs, i, fuel))

@unsafe def solve(fuel: Nat, +xs: +List<U32>) -> Maybe<&2, +List<U32>>:
  match fuel:
    case 0n:
      None{}
    case 1n+p:
      Bool.pick(Maybe<&2, +List<U32>>,
                U32.is_ge(empty_at(xs), 99),
                Some{xs},
                try_vals(9n, xs, empty_at(xs), p))

# --------------------------------------------------------------------------
# impressao
# --------------------------------------------------------------------------

def show_row(n: Nat, +xs: +List<U32>, +base: U32, acc: String) -> String:
  match n:
    case 0n:
      acc
    case 1n+p:
      show_row(p, xs, U32.add(base, 1), acc ++ U32.show(at32(xs, base)) ++ " ")

def show_grid(n: Nat, +xs: +List<U32>, +base: U32, acc: String) -> String:
  match n:
    case 0n:
      acc
    case 1n+p:
      show_grid(p, xs, U32.add(base, 9),
                acc ++ show_row(9n, xs, base, "") ++ "\n")

def show_result(r: Maybe<&2, +List<U32>>) -> String:
  match r:
    case None{}:
      "SEM SOLUCAO"
    case Some{s}:
      show_grid(9n, s, 0, "")

def main() -> IO(Unit):
  do IO<Unit>:
    +b : +List<U32> = puzzle()
    IO.print("puzzle tem " ++ U32.show(empty_at(b)) ++ " como 1a vazia")
    IO.print(show_result(solve(81n, b)))
