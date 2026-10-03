import { describe, expect, it } from "vitest";
import { caminhoNosso, textoSemMiniatura, urlDoDrive } from "./miniatura";

describe("caminho nosso", () => {
  it("aceita o arquivo da empresa", () => {
    expect(caminhoNosso("57f755b9-c23d-4f58-a488-8173d697c010/123456.jpg")).toBe(
      "57f755b9-c23d-4f58-a488-8173d697c010/123456.jpg",
    );
  });

  it("recusa a URL assinada da Meta", () => {
    expect(caminhoNosso("https://scontent.xx.fbcdn.net/v/t15/capa.jpg")).toBeNull();
  });

  it("recusa caminho sem a empresa na frente", () => {
    expect(caminhoNosso("123456.jpg")).toBeNull();
  });
});

describe("lugar vazio", () => {
  it("diz que ainda não coletou", () => {
    expect(textoSemMiniatura(null)).toBe("Miniatura ainda não coletada");
  });

  it("diz quando a Meta não tem imagem", () => {
    expect(textoSemMiniatura("sem_imagem:999")).toBe("A Meta não devolveu imagem deste criativo");
  });

  it("diz quando a conta não está no token", () => {
    expect(textoSemMiniatura("sem_acesso:946388181625874")).toBe(
      "A conta deste anúncio não está no token da empresa",
    );
  });

  it("diz que a falha vai ser tentada de novo", () => {
    expect(textoSemMiniatura("tentar_de_novo: download http 403")).toBe(
      "A coleta da miniatura falhou e será tentada de novo",
    );
  });
});

describe("Drive", () => {
  it("monta o link do arquivo", () => {
    expect(urlDoDrive("1abCDefghij")).toBe("https://drive.google.com/file/d/1abCDefghij/view");
  });

  it("não monta link com id curto", () => {
    expect(urlDoDrive("abc")).toBeNull();
  });
});
