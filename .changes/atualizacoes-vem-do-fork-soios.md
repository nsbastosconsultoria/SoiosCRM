---
impacto: capacidade_nova
secao: alterado
titulo: As atualizações passam a vir das versões da Soios
---

O kit de instalação e atualização passa a apontar para o SoiosCRM: as imagens vêm de
`ghcr.io/nsbastosconsultoria` e as versões, das releases do repositório `nsbastosconsultoria/SoiosCRM`.
Com isso, o botão **"Atualizar agora"** e o `update.sh` levam o servidor para a última versão da
Soios, e não mais para a do DeskcommCRM original.

Numa instalação que já existia, falta um passo único: apontar o código do servidor para o
repositório da Soios (`git remote set-url origin …`), descrito em
`docs/runbooks/soios-atualizacao-do-fork.md`. Até lá, use a atualização manual do mesmo guia.
