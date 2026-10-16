
/* =====================================================
   GERAR - PORTAL BI
   PAINEL DE VAGAS APRENDIZ
   Fonte: vw_vagas_aprendiz_bi
===================================================== */

(() => {
  "use strict";

  const FONTE = "vw_vagas_aprendiz_bi";

  let dadosOriginais = [];
  let dadosFiltrados = [];
  let graficos = {};

  const $ = (id) => document.getElementById(id);

  function normalizar(valor) {
    return String(valor ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function primeiroValor(registro, alternativas) {
    for (const chave of alternativas) {
      const valor = registro[chave];
      if (valor !== undefined && valor !== null && valor !== "") {
        return valor;
      }
    }

    const chaves = Object.keys(registro);
    for (const alternativa of alternativas) {
      const encontrada = chaves.find(
        (chave) => normalizar(chave) === normalizar(alternativa)
      );

      if (encontrada && registro[encontrada] != null) {
        return registro[encontrada];
      }
    }

    return "";
  }

  function campo(registro, tipo) {
    const aliases = {
      id: ["id", "ID", "id_vaga", "codigo", "Código"],
      unidade: [
        "unidade", "Unidade", "nome_unidade", "empresa",
        "empresa_unidade", "cliente", "razao_social"
      ],
      subsede: [
        "subsede", "Subsede", "unidade_gerar",
        "regional", "regional_responsavel"
      ],
      curso: [
        "curso", "Curso", "area", "área", "cargo",
        "nome_vaga", "vaga", "titulo_vaga", "funcao", "função"
      ],
      status: [
        "status_simplificado", "Status Simplificado",
        "status", "Status", "situacao", "situação"
      ],
      solicitacao: [
        "data_solicitacao", "Data Solicitado", "data_solicitado",
        "data_abertura", "data_criacao", "created_at"
      ],
      inicio: [
        "data_inicio", "Data Início", "data_inicio_contrato",
        "data_inicio_prevista"
      ]
    };

    return primeiroValor(registro, aliases[tipo] || []);
  }

  function texto(valor) {
    return String(valor ?? "").trim();
  }

  function dataValida(valor) {
    if (!valor) return null;

    const resultado = new Date(valor);
    return Number.isNaN(resultado.getTime()) ? null : resultado;
  }

  function dataFormatada(valor) {
    const data = dataValida(valor);
    return data ? data.toLocaleDateString("pt-BR") : "—";
  }

  function dataISO(valor) {
    const data = dataValida(valor);
    if (!data) return "";

    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, "0");
    const dia = String(data.getDate()).padStart(2, "0");

    return `${ano}-${mes}-${dia}`;
  }

  function mostrarMensagem(mensagem, tipo = "") {
    const elemento = $("mensagem");
    if (!elemento) return;

    elemento.textContent = mensagem;
    elemento.className = `message ${tipo}`.trim();
  }

  async function buscarTodosRegistros() {
    if (!window.sb) {
      throw new Error(
        "O cliente Supabase não foi inicializado. Verifique o config.js."
      );
    }

    const registros = [];
    const tamanhoPagina = 1000;

    for (let inicio = 0; ; inicio += tamanhoPagina) {
      const fim = inicio + tamanhoPagina - 1;

      const { data, error } = await window.sb
        .from(FONTE)
        .select("*")
        .range(inicio, fim);

      if (error) throw error;

      registros.push(...(data || []));

      if (!data || data.length < tamanhoPagina) break;
    }

    return registros;
  }

  function preencherFiltro(id, valores, textoPadrao) {
    const select = $(id);
    if (!select) return;

    const selecionado = select.value;

    select.innerHTML = "";

    const opcaoInicial = document.createElement("option");
    opcaoInicial.value = "";
    opcaoInicial.textContent = textoPadrao;
    select.appendChild(opcaoInicial);

    const unicos = [...new Set(
      valores.map(texto).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, "pt-BR"));

    unicos.forEach((valor) => {
      const opcao = document.createElement("option");
      opcao.value = valor;
      opcao.textContent = valor;
      select.appendChild(opcao);
    });

    if (unicos.includes(selecionado)) {
      select.value = selecionado;
    }
  }

  function prepararFiltros() {
    preencherFiltro(
      "filtroSubsede",
      dadosOriginais.map((r) => campo(r, "subsede")),
      "Todas as subsedes"
    );

    preencherFiltro(
      "filtroStatus",
      dadosOriginais.map((r) => campo(r, "status")),
      "Todos os status"
    );

    preencherFiltro(
      "filtroCurso",
      dadosOriginais.map((r) => campo(r, "curso")),
      "Todas as áreas"
    );
  }

  function aplicarFiltros() {
    const busca = normalizar($("busca")?.value);
    const subsede = $("filtroSubsede")?.value || "";
    const status = $("filtroStatus")?.value || "";
    const curso = $("filtroCurso")?.value || "";
    const inicial = $("dataInicial")?.value || "";
    const final = $("dataFinal")?.value || "";

    dadosFiltrados = dadosOriginais.filter((r) => {
      const data = dataISO(campo(r, "solicitacao"));

      const textoPesquisa = normalizar([
        campo(r, "id"),
        campo(r, "unidade"),
        campo(r, "subsede"),
        campo(r, "curso"),
        campo(r, "status"),
        JSON.stringify(r)
      ].join(" "));

      if (busca && !textoPesquisa.includes(busca)) return false;
      if (subsede && texto(rSubsede(r)) !== subsede) return false;
      if (status && texto(campo(r, "status")) !== status) return false;
      if (curso && texto(campo(r, "curso")) !== curso) return false;

      if (inicial && (!data || data < inicial)) return false;
      if (final && (!data || data > final)) return false;

      return true;
    });

    atualizarPainel();
  }

  function rSubsede(registro) {
    return campo(registro, "subsede");
  }

  function contarUnicos(registros, tipo) {
    return new Set(
      registros.map((r) => texto(campo(r, tipo))).filter(Boolean)
    ).size;
  }

  function atualizarKPIs() {
    const total = dadosFiltrados.length;

    const abertas = dadosFiltrados.filter((r) => {
      const status = normalizar(campo(r, "status"));
      return status.includes("aberta") ||
        status.includes("aberto") ||
        status.includes("aguardando") ||
        status.includes("pendente");
    }).length;

    const andamento = dadosFiltrados.filter((r) => {
      const status = normalizar(campo(r, "status"));
      return status.includes("andamento") ||
        status.includes("selecao") ||
        status.includes("recrutamento") ||
        status.includes("processo seletivo");
    }).length;

    $("totalVagas").textContent = total.toLocaleString("pt-BR");
    $("vagasAbertas").textContent = abertas.toLocaleString("pt-BR");
    $("vagasAndamento").textContent = andamento.toLocaleString("pt-BR");
    $("totalUnidades").textContent =
      contarUnicos(dadosFiltrados, "unidade").toLocaleString("pt-BR");
  }

  function agrupar(registros, obterChave) {
    const contagem = {};

    registros.forEach((registro) => {
      const chave = texto(obterChave(registro)) || "Não informado";
      contagem[chave] = (contagem[chave] || 0) + 1;
    });

    return Object.entries(contagem).sort((a, b) => b[1] - a[1]);
  }

  function desenharGrafico(id, tipo, labels, valores, opcoes = {}) {
    const canvas = $(id);
    if (!canvas || !window.Chart) return;

    if (graficos[id]) graficos[id].destroy();

    graficos[id] = new Chart(canvas, {
      type: tipo,
      data: {
        labels,
        datasets: [{
          label: opcoes.label || "Quantidade de vagas",
          data: valores,
          borderWidth: 2,
          borderRadius: tipo === "bar" ? 5 : 0,
          tension: 0.3,
          fill: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: opcoes.horizontal ? "y" : "x",
        plugins: {
          legend: {
            display: tipo === "doughnut"
          }
        },
        scales: tipo === "doughnut" ? {} : {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 }
          }
        }
      }
    });
  }

  function atualizarGraficos() {
    const porStatus = agrupar(dadosFiltrados, (r) =>
      campo(r, "status") || "Não informado"
    );

    desenharGrafico(
      "graficoStatus",
      "doughnut",
      porStatus.map((item) => item[0]),
      porStatus.map((item) => item[1])
    );

    const porSubsede = agrupar(dadosFiltrados, (r) =>
      campo(r, "subsede") || "Não informado"
    ).slice(0, 12);

    desenharGrafico(
      "graficoSubsede",
      "bar",
      porSubsede.map((item) => item[0]),
      porSubsede.map((item) => item[1]),
      { horizontal: true }
    );

    const porMes = {};

    dadosFiltrados.forEach((r) => {
      const data = dataValida(campo(r, "solicitacao"));
      if (!data) return;

      const chave = `${data.getFullYear()}-${String(
        data.getMonth() + 1
      ).padStart(2, "0")}`;

      porMes[chave] = (porMes[chave] || 0) + 1;
    });

    const meses = Object.keys(porMes).sort();

    desenharGrafico(
      "graficoMensal",
      "line",
      meses.map((mes) => {
        const [ano, numeroMes] = mes.split("-");
        return new Date(Number(ano), Number(numeroMes) - 1, 1)
          .toLocaleDateString("pt-BR", {
            month: "short",
            year: "numeric"
          });
      }),
      meses.map((mes) => porMes[mes]),
      { label: "Vagas solicitadas" }
    );
  }

  function criarCelula(linha, valor) {
    const td = document.createElement("td");
    td.textContent = texto(valor) || "—";
    linha.appendChild(td);
    return td;
  }

  function renderizarTabela() {
    const corpo = $("corpoTabela");
    corpo.innerHTML = "";

    $("contadorTabela").textContent =
      `${dadosFiltrados.length.toLocaleString("pt-BR")} registros`;

    if (!dadosFiltrados.length) {
      const linha = document.createElement("tr");
      const celula = document.createElement("td");
      celula.colSpan = 7;
      celula.textContent = "Nenhuma vaga encontrada com os filtros selecionados.";
      linha.appendChild(celula);
      corpo.appendChild(linha);
      return;
    }

    dadosFiltrados.forEach((r) => {
      const linha = document.createElement("tr");

      criarCelula(linha, campo(r, "id"));
      criarCelula(linha, campo(r, "unidade"));
      criarCelula(linha, campo(r, "subsede"));
      criarCelula(linha, campo(r, "curso"));
      criarCelula(linha, campo(r, "status"));
      criarCelula(linha, dataFormatada(campo(r, "solicitacao")));
      criarCelula(linha, dataFormatada(campo(r, "inicio")));

      corpo.appendChild(linha);
    });
  }

  function atualizarPainel() {
    atualizarKPIs();
    atualizarGraficos();
    renderizarTabela();
  }

  async function carregarDados() {
    const botao = $("btnAtualizar");
    if (botao) botao.disabled = true;

    mostrarMensagem("Carregando dados do Supabase...");

    try {
      dadosOriginais = await buscarTodosRegistros();
      prepararFiltros();
      aplicarFiltros();

      mostrarMensagem(
        `Dados carregados com sucesso: ${dadosOriginais.length.toLocaleString("pt-BR")} registros.`,
        "success"
      );
    } catch (erro) {
      console.error("Erro ao carregar Vagas Aprendiz:", erro);

      mostrarMensagem(
        `Não foi possível carregar os dados. Verifique a view "${FONTE}", as permissões do Supabase e o config.js. Detalhe: ${erro.message || erro}`,
        "error"
      );
    } finally {
      if (botao) botao.disabled = false;
    }
  }

  function exportarCSV() {
    if (!dadosFiltrados.length) {
      mostrarMensagem("Não há registros para exportar.", "error");
      return;
    }

    const colunas = [
      ["ID", (r) => campo(r, "id")],
      ["Unidade", (r) => campo(r, "unidade")],
      ["Subsede", (r) => campo(r, "subsede")],
      ["Vaga ou curso", (r) => campo(r, "curso")],
      ["Status", (r) => campo(r, "status")],
      ["Data de solicitação", (r) => dataFormatada(campo(r, "solicitacao"))],
      ["Data de início", (r) => dataFormatada(campo(r, "inicio"))]
    ];

    const escapar = (valor) =>
      `"${String(valor ?? "").replace(/"/g, '""')}"`;

    const linhas = [
      colunas.map(([titulo]) => escapar(titulo)).join(";"),
      ...dadosFiltrados.map((registro) =>
        colunas.map(([, obter]) => escapar(obter(registro))).join(";")
      )
    ];

    const arquivo = new Blob(
      ["\uFEFF" + linhas.join("\r\n")],
      { type: "text/csv;charset=utf-8;" }
    );

    const url = URL.createObjectURL(arquivo);
    const link = document.createElement("a");
    link.href = url;
    link.download = "vagas-aprendiz.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function limparFiltros() {
    [
      "busca",
      "filtroSubsede",
      "filtroStatus",
      "filtroCurso",
      "dataInicial",
      "dataFinal"
    ].forEach((id) => {
      const elemento = $(id);
      if (elemento) elemento.value = "";
    });

    aplicarFiltros();
  }

  function iniciar() {
    $("btnAtualizar")?.addEventListener("click", carregarDados);
    $("btnLimpar")?.addEventListener("click", limparFiltros);
    $("btnExportar")?.addEventListener("click", exportarCSV);

    [
      "busca",
      "filtroSubsede",
      "filtroStatus",
      "filtroCurso",
      "dataInicial",
      "dataFinal"
    ].forEach((id) => {
      $(id)?.addEventListener("input", aplicarFiltros);
      $(id)?.addEventListener("change", aplicarFiltros);
    });

    carregarDados();
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
