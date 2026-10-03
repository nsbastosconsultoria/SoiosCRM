---
impacto: nada_mudou
secao: corrigido
titulo: Criações protegidas contra duplicação param quando a reserva falha
---
Nas criações com chave de idempotência (respostas rápidas, mensagens, rascunhos, agendamentos e pagamento de parcelas), uma falha ao ler, reservar ou retomar a chave agora interrompe a operação antes do efeito. Isso evita criar sem a proteção contra duplicação quando o banco recusa a reserva. Crédito: @nsbastosconsultoria.
