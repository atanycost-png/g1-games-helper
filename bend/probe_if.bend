import Base

# Probe 3: ordem dos parametros.
#   REGRA: o argumento que ENCOLHE vai primeiro na lista; os anteriores precisam
#   ser repassados INALTERADOS (por isso 'base+1' antes do decrescente quebra).

def atn(+xs: +List<U32>, i: Nat) -> U32:
  match xs:
    case Nil{}:
      0
    case h <> t:
      match i:
        case 0n:
          h
        case 1n+p:
          atn(t, p)          # arg1 = t (subtermo de xs) -> ok

def at32(+xs: +List<U32>, i: U32) -> U32:
  atn(xs, U32.to_nat(i))

# n (decrescente) PRIMEIRO
def hits(n: Nat, +xs: +List<U32>, +base: U32, +v: U32) -> U32:
  match n:
    case 0n:
      0
    case 1n+p:
      U32.add(Bool.to_u32(U32.is_eq(at32(xs, base), v)), hits(p, xs, U32.add(base, 1), v))

# decisao com law+def: n primero tambem
law pick_zero:
  for  n: Nat
  for +xs: +List<U32>
  for +i: U32
  Maybe<&2, U32>

def pick_zero.if(n: Nat, +xs: +List<U32>, +i: U32, z: Bool) -> Maybe<&2, U32>:
  match z:
    case True{}:
      Some{i}
    case False{}:
      pick_zero(n, xs, U32.add(i, 1))

def pick_zero(n, xs, i):
  match n:
    case 0n:
      None{}
    case 1n+p:
      pick_zero.if(p, xs, i, U32.is_eq(at32(xs, i), 0))

def main() -> IO(Unit):
  do IO<Unit>:
    xs : +List<U32> = [3, 0, 7, 1]
    IO.print("hits 3 em xs = " ++ U32.show(hits(4n, xs, 0, 3)))
    IO.print("hits 9 em xs = " ++ U32.show(hits(4n, xs, 0, 9)))
    IO.print("pick_zero    = " ++ U32.show(Maybe.default(&2, U32, pick_zero(4n, xs, 0), 99)))
    IO.print("pick_zero(3) = " ++ U32.show(Maybe.default(&2, U32, pick_zero(1n, xs, 3), 99)))
