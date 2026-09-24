# ============================================================================
# PROOF.bend — demonstracao das leis de LAWS.bend.
#
# Cada lei vira um `def` de mesmo nome. As leis daqui sao proposicoes fechadas
# sobre tabuleiros concretos, entao a prova e a reflexividade `{==}`: o checker
# normaliza cada lado e confere que sao o mesmo termo.
#
# Rodar:  bend PROOF.bend      (o portao imprime "All terms check." quando passa)
# ============================================================================

import ./LAWS.bend as Laws

def Laws.puzzle_valido():
  {==}

def Laws.gabarito_valido():
  {==}

def Laws.gabarito_completo():
  {==}

def Laws.puzzle_tem_vazia():
  {==}

def Laws.gabarito_corrompido_acusa_6_conflitos():
  {==}

# --- teoremas sobre o solver ---
# As provas sao reflexividade: o checker NORMALIZA `V.solved()` (roda o solver
# no proprio avaliador) e confere que os dois lados viram o mesmo termo.

def Laws.solver_preenche_tudo():
  {==}

def Laws.solver_solucao_valida():
  {==}

def Laws.solver_acha_o_gabarito():
  {==}

def Laws.solver_preserva_as_dadas():
  {==}
