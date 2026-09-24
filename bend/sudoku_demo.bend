import Base
import ./sudoku_core.bend as S

# Demonstracao do nucleo do sudoku em Bend 2 (roda com: bend sudoku_demo.bend)

def main() -> IO(Unit):
  do IO<Unit>:
    +p : +List<U32> = S.puzzle()
    +a : +List<U32> = S.answer()
    +k : +List<U32> = S.broken()
    IO.print("1a celula vazia do puzzle  : " ++ U32.show(S.empty_at(p)))
    IO.print("1a celula vazia do gabarito: " ++ U32.show(S.empty_at(a)) ++ "  (99 = nenhuma)")
    IO.print("conflitos no puzzle        : " ++ U32.show(S.total_conflicts(p)) ++ "  (esperado 0)")
    IO.print("conflitos no gabarito      : " ++ U32.show(S.total_conflicts(a)) ++ "  (esperado 0)")
    IO.print("conflitos no corrompido    : " ++ U32.show(S.total_conflicts(k)) ++ "  (esperado > 0)")
    IO.print("box_of(0)=" ++ U32.show(S.box_of(0)) ++
             "  box_of(40)=" ++ U32.show(S.box_of(40)) ++
             "  box_of(80)=" ++ U32.show(S.box_of(80)))
