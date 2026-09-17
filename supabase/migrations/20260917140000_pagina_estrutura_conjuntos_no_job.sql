-- get_estrutura_conjuntos no job ganhava pagina omitida no schema. O handler
-- agora pagina e compacta; o modelo precisa ver o parametro para pedir folha 2
-- se a lista compacta ainda nao couber.

update public.agent_ferramentas
set parametros_omitidos = '{}'::jsonb
where chave = 'get_estrutura_conjuntos';
