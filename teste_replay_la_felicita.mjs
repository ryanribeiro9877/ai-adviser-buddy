// Replay do dia 02/10/2026 na conta La Felicita.
// Quinze operacoes. Para cada uma, o codigo tem ferramenta no catalogo
// ou modo no executor. Sem rede, sem Deno, sem credencial.
// Sai com codigo 1 enquanto houver buraco.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = dirname(fileURLToPath(import.meta.url));
const ler = (rel) => readFileSync(join(raiz, rel), "utf8");

const catalogo = ler("supabase/functions/_shared/ferramentas_base.ts");
const executor = ler("supabase/functions/meta-actions/index.ts");
const geo = ler("supabase/functions/_shared/geo_targeting.ts");
const releitura = ler("supabase/functions/_shared/releitura_pos_escrita.ts");
const prevoo = ler("supabase/functions/_shared/prevoo_meta.ts");

const tem = (texto, agulha) => texto.includes(agulha);

const operacoes = [
  {
    nome: "Ler promoted_object do conjunto",
    faz: tem(catalogo, "ler_objeto") && tem(catalogo, "promoted_object"),
  },
  {
    nome: "Ler object_story_spec do criativo",
    faz: tem(executor, "object_story_spec") || tem(catalogo, "object_story_spec"),
  },
  {
    nome: "Achar a chave de uma cidade na Meta",
    faz: tem(catalogo, "buscar_geolocalizacao"),
  },
  {
    nome: "Resolver comportamento com a classe certa",
    faz: tem(catalogo, "buscar_comportamentos") && tem(catalogo, "behaviors"),
  },
  {
    nome: "Validar o payload antes de agir",
    faz: tem(prevoo, "validate_only"),
  },
  {
    nome: "Conferir o gravado contra o enviado",
    faz: tem(executor, "relerDepoisDaEscrita") && tem(releitura, "compararEnviadoComGravado"),
  },
  {
    nome: "Aplicar comportamentos no conjunto",
    faz: tem(catalogo, "alterar_publico_do_conjunto"),
  },
  {
    nome: "Trocar as cidades do conjunto",
    faz: tem(catalogo, "alterar_geo_do_conjunto") && tem(executor, "alterar_geo_do_conjunto"),
  },
  {
    nome: "Geo com pinos (custom_locations)",
    faz: tem(geo, "custom_locations") && tem(catalogo, "custom_locations"),
  },
  {
    nome: "Criar anuncio a partir de molde",
    faz: tem(catalogo, "criar_anuncio_a_partir_de") && tem(executor, "criar_anuncio_a_partir_de"),
  },
  {
    nome: "Listar a biblioteca de videos da conta",
    faz: tem(catalogo, "get_acervo_para_anuncio") && tem(catalogo, "meta_video_id"),
  },
  {
    nome: "Excluir a geo de um conjunto dentro de outro",
    faz:
      tem(geo, "excluded_geo_locations") &&
      tem(executor, "aplicarExclusaoNoTargeting") &&
      tem(catalogo, "excluded_geo_locations"),
  },
  {
    nome: "Criar conjunto do zero com targeting novo",
    faz:
      tem(executor, 'acao === "criar_conjunto"') &&
      tem(catalogo, "criar_conjunto:") &&
      !tem(catalogo, "criar_conjunto: criar_conjunto_a_partir_de"),
  },
  {
    nome: "Criar criativo com mensagem de boas-vindas",
    faz:
      tem(catalogo, "criar_criativo:") &&
      tem(catalogo, "page_welcome_message") &&
      tem(executor, 'acao === "criar_criativo"'),
  },
  {
    nome: "Repontar anuncio para outro criativo",
    faz:
      tem(executor, 'acao === "trocar_criativo_do_anuncio"') &&
      tem(catalogo, "trocar_criativo_do_anuncio:"),
  },
];

const feitas = operacoes.filter((o) => o.faz);
const buracos = operacoes.filter((o) => !o.faz);

for (const o of operacoes) {
  console.log(`${o.faz ? "faz" : "NAO FAZ"}  ${o.nome}`);
}
console.log(`${feitas.length} de ${operacoes.length}`);

if (buracos.length) {
  console.error(`buracos: ${buracos.map((o) => o.nome).join(" | ")}`);
  process.exit(1);
}
