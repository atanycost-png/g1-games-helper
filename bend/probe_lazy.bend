import Base

# TESTE DECISIVO: o Bend 2 (estrito) avalia argumentos que a funcao NAO usa?
#   - se este arquivo TRAVAR/imprimir nada -> o compilador e ESTRITO
#     (call-by-value), e `Bool.pick`/`Maybe.or` computam os DOIS lados.
#   - se imprimir 42 -> e LAZY (call-by-need, celula memoizada), e o
#     backtracking funciona sem truques.

@unsafe def loop(n: Nat) -> U32:
  loop(n)

def ignore_first(x: U32, +y: U32) -> U32:
  x

def main() -> U32:
  ignore_first(42, loop(0n))
