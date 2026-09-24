import Base
import ./sudoku_core.bend as S

# Sonda: Bool.pick / Maybe.or sao de fato LAZY (nao computam o lado nao usado)?
#   B  = Maybe.or(Some{42}, loop_infinito)  -> 42 = lazy ; travar = ESTRITO
#   A3 = solve com o ramo de busca trocado por None{} (sem trabalho nenhum)
#        -> None = ok ; travar = o lado nao escolhido do Bool.pick foi computado

@unsafe def loop_maybe(n: Nat) -> Maybe<&2, U32>:
  loop_maybe(n)

@unsafe def solve_teste(+fuel: Nat, +xs: +List<U32>) -> Maybe<&2, +List<U32>>:
  match fuel:
    case 0n:
      None{}
    case 1n+p:
      Bool.pick(Maybe<&2, +List<U32>>,
                U32.is_lt(S.first_zero(81n, xs, 0), 99),
                None{},          # ramo "tem vazia": nenhum trabalho
                Some{xs})        # ramo "completo"

def show_u32m(r: Maybe<&2, U32>) -> String:
  match r:
    case None{}:
      "None"
    case Some{+v}:
      "Some(" ++ U32.show(v) ++ ")"

def show_lstm(r: Maybe<&2, +List<U32>>) -> String:
  match r:
    case None{}:
      "None"
    case Some{+s}:
      "Some(1a vazia = " ++ U32.show(S.first_zero(81n, s, 0)) ++ ")"

def main() -> IO(Unit):
  do IO<Unit>:
    +a : +List<U32> = S.answer()
    IO.print("A1 is_lt(99,99)         : " ++ U32.show(Bool.to_u32(U32.is_lt(99, 99))))
    IO.print("A2 first_zero(gabarito) : " ++ U32.show(S.first_zero(81n, a, 0)))
    IO.print("A3 solve sem busca      : " ++ show_lstm(solve_teste(81n, a)))
    IO.print("B  Maybe.or lazy?       : " ++ show_u32m(Maybe.or(&2, U32, Some{42}, loop_maybe(0n))))
