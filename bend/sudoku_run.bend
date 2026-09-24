import Base
import ./sudoku_core.bend as S
import ./sudoku_solve.bend as V

# ============================================================================
# Sudoku em Bend 2 — demo/benchmark do solver (roda com `bend sudoku_run.bend`)
# ============================================================================

def digits(n: Nat, +xs: +List<U32>, +acc: String) -> String:
  match n:
    case 0n:
      acc
    case 1n+p:
      match xs:
        case Nil{}:
          acc
        case h <> t:
          digits(p, t, acc ++ U32.show(h))

@unsafe def diffs(n: Nat, +a: +List<U32>, +b: +List<U32>, +i: U32) -> U32:
  match n:
    case 0n:
      0
    case 1n+p:
      U32.add(Bool.to_u32(U32.is_ne(S.at32(a, i), S.at32(b, i))),
              diffs(p, a, b, U32.add(i, 1)))

def result_info(r: Maybe<&2, +List<U32>>) -> String:
  match r:
    case None{}:
      "SEM SOLUCAO"
    case Some{+s}:
      "conflitos=" ++ U32.show(S.total_conflicts(s)) ++
      "  vazias_restantes=" ++ U32.show(S.empty_at(s)) ++
      "  diffs_vs_gabarito=" ++ U32.show(diffs(81n, s, S.answer(), 0)) ++ "\n" ++
      digits(81n, s, "")

# zera as N primeiras celulas (mede a escalada da busca)
def zero_first(n: Nat, +xs: +List<U32>) -> +List<U32>:
  match n:
    case 0n:
      xs
    case 1n+p:
      match xs:
        case Nil{}:
          Nil{}
        case h <> t:
          0 <> zero_first(p, t)

def test_n(+n: Nat, +base: +List<U32>) -> IO(Unit):
  do IO<Unit>:
    +z : +List<U32> = zero_first(n, base)
    IO.print("  N=" ++ U32.show(U32.from_nat(n)) ++ " -> " ++
             result_info(V.solve(81n, z, S.masks_of(z), 0)))

def main() -> IO(Unit):
  do IO<Unit>:
    +p : +List<U32> = S.puzzle()
    +a : +List<U32> = S.answer()
    IO.print("puzzle  : " ++ digits(81n, p, ""))
    IO.print("gabarito: " ++ digits(81n, a, ""))
    IO.print("T1 tabuleiro completo (0 vazias): " ++ result_info(V.solve(81n, a, S.masks_of(a), 0)))
    IO.print("escalada (vazias zeradas no gabarito):")
    test_n(15n, a)
    test_n(30n, a)
    IO.print("T3 PUZZLE REAL do G1 (43 vazias):")
    IO.print("... " ++ result_info(V.solve(81n, p, S.masks_of(p), 0)))
