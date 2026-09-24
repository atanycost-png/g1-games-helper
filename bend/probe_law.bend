import Base

# Probe 4 (minimo): o padrao law + def .if + def, igual ao Array.swap da Base.
# Serve para descobrir se o padrao funciona isolado ou se o problema e outro.

law f:
  for n: Nat
  U32

def f.if(n: Nat, z: Bool) -> U32:
  match z:
    case True{}:
      0
    case False{}:
      f(n)

def f(n):
  match n:
    case 0n:
      9
    case 1n+p:
      f.if(p, Nat.is_eq(p, 0n))

def main() -> U32:
  f(3n)
