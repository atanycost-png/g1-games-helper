# ============================================================================
# LAWS.bend — as leis do tabuleiro de sudoku.
#
# Convencao do Bend: ESTE arquivo e escrito pelo humano e a IA nao mexe nele.
# Cada `law` e uma afirmacao que precisa ser demonstrada em PROOF.bend por um
# `def` de mesmo nome. `bend PROOF.bend` e o portao.
#
# Aqui as leis sao proposicoes FECHADAS (sem quantificador) para que o checker
# possa demonstra-las por normalizacao — ou seja, elas checam um tabuleiro
# concreto: o puzzle, o gabarito e um gabarito com erro plantado.
# ============================================================================

import ./sudoku_core.bend as S
import ./sudoku_solve.bend as V

# O puzzle inicial e consistente: nenhuma repeticao em linha, coluna ou bloco.
law puzzle_valido:
  {S.total_conflicts(S.puzzle()) == 0 : U32}

# O gabarito e consistente.
law gabarito_valido:
  {S.total_conflicts(S.answer()) == 0 : U32}

# O gabarito nao tem nenhuma celula vazia (99 = "nenhuma vazia").
law gabarito_completo:
  {S.empty_at(S.answer()) == 99 : U32}

# O puzzle comeca com a primeira celula vazia (tem espaco para jogar).
law puzzle_tem_vazia:
  {S.empty_at(S.puzzle()) == 0 : U32}

# PROPRIEDADE DE DETECCAO: um gabarito com um valor trocado e acusado.
# (a posicao 0 virou 9, criando dois 9 na linha 0)
law gabarito_corrompido_acusa_6_conflitos:
  {S.total_conflicts(S.broken()) == 6 : U32}

# ============================================================================
# TEOREMAS SOBRE O SOLVER — o caso de uso do LAWS.bend: o humano enuncia o que
# o programa DEVE fazer e a prova e obrigacao do implementador.
# ============================================================================

# O solver completa o tabuleiro: nao sobra nenhuma celula vazia.
law solver_preenche_tudo:
  {S.empty_at(V.solved()) == 99 : U32}

# ... e o resultado e um sudoku valido (nenhum conflito em linha/coluna/bloco).
law solver_solucao_valida:
  {S.total_conflicts(V.solved()) == 0 : U32}

# ... e ele acha exatamente o gabarito do puzzle (nao qualquer solucao).
law solver_acha_o_gabarito:
  {V.solved() == S.answer() : +List<U32>}

# O solver preserva as celulas dadas do puzzle (nao mexe nas fixas).
law solver_preserva_as_dadas:
  {S.preserves(S.puzzle(), V.solved()) == True{} : Bool}
