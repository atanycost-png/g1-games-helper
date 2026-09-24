import Base

# Sonda final: uma lambda passada como argumento e computada SO quando aplicada?
#   pick_lazy escolhe o lado `match c` e aplica apenas ele.
#   Se as lambdas forem valores (nao computados), imprime 42.
#   Se o Bend computar as duas (estrito), trava.

@unsafe def loop_maybe(n: Nat) -> Maybe<&2, U32>:
  loop_maybe(n)

def pick_lazy(-A: Type, c: Bool, f: Unit -> A, g: Unit -> A) -> A:
  match c:
    case True{}:
      f(Unit{})
    case False{}:
      g(Unit{})

def main() -> U32:
  Maybe.default(&2, U32,
               pick_lazy(Maybe<&2, U32>, True{}, u => Some{42}, u => loop_maybe(0n)),
               0)
