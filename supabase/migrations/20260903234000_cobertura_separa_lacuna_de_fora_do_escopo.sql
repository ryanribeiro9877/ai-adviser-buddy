-- O vigia de cobertura estava chamando de "lacuna" campanha que esta classificada certo.
--
-- O ERRO QUE ESTA MIGRATION CONSERTA e meu, da entrega anterior. `vigiar_cobertura_das_regras`
-- media a lacuna como `coalesce(category,'') not in ('leadgen','mensagem')`. Enquanto todas
-- as ativas estavam nulas isso batia por acidente. Depois da derivacao da configuracao, tres
-- campanhas passaram a ser `trafego` -- classificadas corretamente, e por natureza fora do
-- alcance das regras de custo por resultado: uma campanha de visita a perfil do Instagram nao
-- tem formulario nem conversa para dividir o gasto. Pela conta antiga elas continuariam
-- aparecendo como lacuna para sempre, e a acao sugerida seria "classifique como formulario ou
-- mensagem" -- ou seja, o alerta pediria para o gestor classificar ERRADO. Alerta que ensina o
-- erro e pior que alerta nenhum.
--
-- A distincao correta tem tres estados, nao dois:
--   1. sem classificacao (category nula)  -> lacuna real, o sistema nao sabe o que contar;
--   2. dentro do escopo (leadgen/mensagem) -> as regras de custo avaliam;
--   3. fora do escopo (trafego/engajamento) -> as regras nao se aplicam, e isso esta certo.
-- So o estado 1 vira alerta pedindo acao. O estado 3 entra no alerta como CONTEXTO, para o
-- gestor nao interpretar o silencio das regras de custo como "custo esta bom".
--
-- SEGUNDO ACHADO, que vale mais que o caso que o originou: existe campanha ATIVA que o
-- sistema nao consegue atribuir a nenhuma marca. As tres campanhas "Publicacao do Instagram:
-- ..." nasceram de impulsionamento de post e chegaram sem NENHUM vinculo estruturado -- sem
-- promoted_object, sem UTM, sem url de destino, sem titulo, sem corpo, com segmentacao
-- generica (Brasil, 18-65) e compartilhando conta de anuncio, pagina e company_id com todas
-- as outras marcas. O unico texto que menciona marca esta no NOME, que e exatamente a fonte
-- que quebrou a protecao contra contaminacao antes.
--
-- Como as quatro marcas dividem um company_id, campanha nao atribuida e risco concreto: um
-- alerta sobre ela pode aparecer no contexto da marca errada. Entao, em vez de chutar para a
-- primeira marca que casar, isso passa a ser um achado explicito com nome e numero. O alerta
-- carrega `linha_produto = 'nao atribuida'` de forma deliberada, e nao um palpite.

create or replace function public.vigiar_cobertura_das_regras()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_c          record;
  v_lacunas    int := 0;
  v_alertas    int := 0;
  v_orfas      int := 0;
  v_exemplos   text;
  v_linhas     text;
  v_fora_txt   text;
begin
  -- (1) Lacuna real: campanha ativa SEM classificacao nenhuma.
  for v_c in
    select c.company_id,
           count(*) filter (where c.category is null)::int as sem_categoria,
           count(*) filter (where coalesce(c.category,'') in ('leadgen','mensagem'))::int as no_escopo,
           count(*) filter (where c.category is not null
                              and c.category not in ('leadgen','mensagem'))::int as fora_do_escopo,
           count(*)::int as ativas
      from public.campaigns c
     where c.status = 'active'
     group by c.company_id
    having count(*) filter (where c.category is null) > 0
  loop
    v_lacunas := v_lacunas + 1;

    -- Nome legivel, nao id: o gestor precisa saber QUAL campanha abrir.
    select string_agg(nome, '; ' order by nome) into v_exemplos
      from (select c2.name as nome
              from public.campaigns c2
             where c2.company_id = v_c.company_id
               and c2.status = 'active'
               and c2.category is null
             order by c2.name
             limit 5) amostra;

    -- As marcas dividem company_id, entao a linha sai do nome da campanha.
    select string_agg(distinct linha, ', ') into v_linhas
      from (select public.linha_de_produto_do_nome(c3.name, c3.company_id) as linha
              from public.campaigns c3
             where c3.company_id = v_c.company_id
               and c3.status = 'active'
               and c3.category is null) l
     where linha is not null;

    v_fora_txt := case when v_c.fora_do_escopo > 0
      then format(' Outras %s campanhas ativas estao classificadas como trafego ou engajamento: essas nao tem formulario nem conversa para dividir o gasto, entao as regras de custo nao se aplicam a elas e o silencio ali e esperado.',
                  v_c.fora_do_escopo)
      else '' end;

    perform public.emitir_alerta(
      p_company_id    => v_c.company_id,
      p_severidade    => 'high'::alert_severity,
      p_titulo        => 'O sistema nao consegue avaliar o custo por resultado',
      p_o_que         => format('%s de %s campanhas ativas estao sem classificacao de objetivo, e a configuracao delas nao permite derivar com seguranca. Sem saber se o resultado e formulario ou conversa, o sistema nao tem denominador para o custo, entao as regras de custo por lead e de custo por conversa nao avaliam essas campanhas -- e o silencio delas parece "nada a relatar" quando na verdade e "nao tenho como olhar".%s',
                                v_c.sem_categoria, v_c.ativas, v_fora_txt),
      p_onde          => case when v_c.sem_categoria <= 5 then v_exemplos
                              else v_exemplos || ' (e outras ' || (v_c.sem_categoria - 5) || ')' end,
      p_quanto        => format('%s de %s campanhas ativas sem classificacao (%s dentro do escopo das regras de custo)',
                                v_c.sem_categoria, v_c.ativas, v_c.no_escopo),
      p_acao          => 'Abrir cada campanha citada e classificar o resultado que ela persegue. Se a configuracao na Meta estiver incompleta (objetivo de engajamento sem meta de otimizacao no conjunto, ou metas divergentes entre conjuntos), corrigir la resolve automaticamente: a classificacao passa a ser derivada na proxima sincronizacao.',
      p_janela        => 'estado atual das campanhas ativas',
      p_tarefa        => 'cobertura-das-regras',
      p_linha_produto => coalesce(v_linhas, 'nao atribuida'),
      p_chave_dedupe  => 'cobertura_categoria:' || v_c.company_id,
      p_valor         => v_c.sem_categoria);

    v_alertas := v_alertas + 1;
  end loop;

  -- (2) Campanha ativa que o sistema nao consegue atribuir a nenhuma marca.
  for v_c in
    select c.company_id,
           count(*)::int as orfas,
           (select count(*)::int from public.campaigns x
             where x.company_id = c.company_id and x.status = 'active') as ativas
      from public.campaigns c
     where c.status = 'active'
       and public.linha_de_produto_do_nome(c.name, c.company_id) is null
     group by c.company_id
  loop
    v_orfas := v_orfas + 1;

    select string_agg(nome, '; ' order by nome) into v_exemplos
      from (select c2.name as nome
              from public.campaigns c2
             where c2.company_id = v_c.company_id
               and c2.status = 'active'
               and public.linha_de_produto_do_nome(c2.name, c2.company_id) is null
             order by c2.name
             limit 5) amostra;

    perform public.emitir_alerta(
      p_company_id    => v_c.company_id,
      p_severidade    => 'medium'::alert_severity,
      p_titulo        => 'Campanha ativa que o sistema nao sabe de qual marca e',
      p_o_que         => format('%s de %s campanhas ativas nao podem ser atribuidas a uma marca. Elas nasceram de impulsionamento de publicacao e chegaram sem vinculo estruturado: sem numero de WhatsApp, sem parametro de origem na url, sem url de destino e com segmentacao generica. Como as marcas dividem a mesma conta de anuncio e a mesma pagina, nao existe caminho no dado que separe uma da outra. O sistema NAO chuta: trata como "nao atribuida", para que nenhum alerta sobre elas apareca no contexto da marca errada.',
                                v_c.orfas, v_c.ativas),
      p_onde          => case when v_c.orfas <= 5 then v_exemplos
                              else v_exemplos || ' (e outras ' || (v_c.orfas - 5) || ')' end,
      p_quanto        => v_c.orfas || ' de ' || v_c.ativas || ' campanhas ativas sem marca identificavel',
      p_acao          => 'Para passar a atribuir sem depender do nome, incluir na campanha um vinculo que o sistema le: parametro de origem na url do anuncio (url_tags) ou url de destino da marca. Renomear a campanha no padrao com a tag da marca entre colchetes tambem resolve, mas continua sendo nome. Enquanto nao houver vinculo, ler qualquer alerta dessas campanhas sem assumir marca.',
      p_janela        => 'estado atual das campanhas ativas',
      p_tarefa        => 'cobertura-das-regras',
      p_linha_produto => 'nao atribuida',
      p_chave_dedupe  => 'cobertura_atribuicao:' || v_c.company_id,
      p_valor         => v_c.orfas);

    v_alertas := v_alertas + 1;
  end loop;

  -- Encerra o que foi resolvido, por tipo de lacuna, sem apagar historico. Cada laco tem
  -- sua chave: um nao pode encerrar o alerta do outro.
  update public.alerts a
     set resolved = true
   where a.resolved = false
     and a.tarefa = 'cobertura-das-regras'
     and a.chave_dedupe like 'cobertura_categoria:%'
     and not exists (
       select 1 from public.campaigns c
        where c.company_id = a.company_id
          and c.status = 'active'
          and c.category is null);

  update public.alerts a
     set resolved = true
   where a.resolved = false
     and a.tarefa = 'cobertura-das-regras'
     and a.chave_dedupe like 'cobertura_atribuicao:%'
     and not exists (
       select 1 from public.campaigns c
        where c.company_id = a.company_id
          and c.status = 'active'
          and public.linha_de_produto_do_nome(c.name, c.company_id) is null);

  return jsonb_build_object(
    'verificado_em', now(),
    'empresas_com_lacuna_de_classificacao', v_lacunas,
    'empresas_com_campanha_nao_atribuida', v_orfas,
    'alertas_emitidos', v_alertas);
end
$function$;

revoke all on function public.vigiar_cobertura_das_regras() from public, anon, authenticated;
grant execute on function public.vigiar_cobertura_das_regras() to service_role;
