
/**
 * GERAR — CONTROLE DE VAGAS APRENDIZ
 * Fonte: public.vw_vagas_aprendiz_bi
 * Requer Chart.js, Supabase JS v2 e config.js.
 *
 * ATUALIZAÇÕES:
 * - Tabela com paginação de 20 registros.
 * - Botões para avançar e voltar entre páginas.
 * - Contador da página e total de registros filtrados.
 * - Valores visíveis diretamente nos três gráficos.
 * - Exportação CSV mantém todos os registros filtrados.
 * - Preserva filtros, indicadores e conexão com Supabase.
 */

"use strict";

const VIEW = "vw_vagas_aprendiz_bi";
const PAGE_SIZE = 1000;
const REGISTROS_POR_PAGINA = 20;

let registros = [];
let charts = {};
let carregamentoEmAndamento = false;
let paginaAtual = 1;

const $ = id => document.getElementById(id);

/* =====================================================
   CLIENTE E FUNÇÕES AUXILIARES
===================================================== */

function obterSupabase() {
  return window.sb || window.supabaseClient || null;
}

function normalizar(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function statusRegistro(r) {
  return String(r.status_simplificado || r.status || "Sem status");
}

function empresaRegistro(r) {
  return String(r.empresa || r.razao_social || "Não informada");
}

function solicitanteRegistro(r) {
  return String(r.solicitado_por || "Não informado");
}

function cursoRegistro(r) {
  return String(r.curso || r.tipo_curso || "Não informado");
}

function dataSolicitacaoRegistro(r) {
  return r.solicitado_em || r.data_solicitacao || null;
}

function formatarData(valor) {
  if (!valor) return "—";

  const texto = String(valor);
  const somenteData = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (somenteData) {
    return `${somenteData[3]}/${somenteData[2]}/${somenteData[1]}`;
  }

  const data = new Date(valor);

  if (Number.isNaN(data.getTime())) {
    return texto;
  }

  return data.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
}

function escaparHTML(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, caractere => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[caractere]);
}

function mostrarMensagem(texto, tipo = "info") {
  const elemento = $("mensagem");

  if (!elemento) return;

  elemento.textContent = texto;
  elemento.className = `message ${tipo}`;
}

function dataISO(valor) {
  if (!valor) return "";

  const texto = String(valor);
  const somenteData = texto.match(/^(\d{4}-\d{2}-\d{2})/);

  if (somenteData) {
    return somenteData[1];
  }

  const data = new Date(valor);

  if (Number.isNaN(data.getTime())) {
    return "";
  }

  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(data);

  const valores = {};

  partes.forEach(parte => {
    valores[parte.type] = parte.value;
  });

  return `${valores.year}-${valores.month}-${valores.day}`;
}

function formatarNumero(valor) {
  return Number(valor || 0).toLocaleString("pt-BR");
}

/* =====================================================
   CARREGAMENTO PAGINADO DO SUPABASE
===================================================== */

async function carregarDados() {
  const sb = obterSupabase();

  if (!sb || typeof sb.from !== "function") {
    throw new Error(
      "Cliente Supabase não encontrado. Confira se config.js inicializa window.sb ou window.supabaseClient."
    );
  }

  const todos = [];
  let inicio = 0;

  while (true) {
    const fim = inicio + PAGE_SIZE - 1;

    const { data, error } = await sb
      .from(VIEW)
      .select("*")
      .range(inicio, fim);

    if (error) {
      throw new Error(
        `Erro ao consultar a view ${VIEW}: ${error.message}`
      );
    }

    const lote = data || [];

    todos.push(...lote);

    if (lote.length < PAGE_SIZE) {
      break;
    }

    inicio += PAGE_SIZE;
  }

  return todos;
}

/* =====================================================
   PREENCHIMENTO DOS FILTROS
===================================================== */

function preencherFiltro(id, valores, textoInicial) {
  const select = $(id);

  if (!select) return;

  const valorAnterior = select.value;

  const unicos = [...new Set(
    valores
      .map(valor => String(valor ?? "").trim())
      .filter(valor =>
        valor &&
        valor !== "Não informado" &&
        valor !== "Não informada" &&
        valor !== "Sem status"
      )
  )].sort((a, b) => a.localeCompare(b, "pt-BR"));

  select.replaceChildren(new Option(textoInicial, ""));

  unicos.forEach(valor => {
    select.add(new Option(valor, valor));
  });

  if (unicos.includes(valorAnterior)) {
    select.value = valorAnterior;
  }
}

/* =====================================================
   FILTROS COMBINADOS
===================================================== */

function aplicarFiltros() {
  const busca = normalizar($("busca")?.value);
  const subsede = $("filtroSubsede")?.value || "";
  const status = $("filtroStatus")?.value || "";
  const curso = $("filtroCurso")?.value || "";
  const empresa = $("filtroEmpresa")?.value || "";
  const solicitante = $("filtroSolicitante")?.value || "";
  const inicial = $("dataInicial")?.value || "";
  const final = $("dataFinal")?.value || "";

  return registros.filter(r => {
    const textoBusca = normalizar([
      r.id_vaga,
      r.id_registro,
      r.id,
      r.empresa,
      r.razao_social,
      r.cidade_uf,
      r.cidade,
      r.subsede,
      r.curso,
      r.tipo_curso,
      r.angariador,
      r.solicitado_por,
      r.status,
      r.status_simplificado,
      r.cnpj
    ].join(" "));

    if (busca && !textoBusca.includes(busca)) {
      return false;
    }

    if (subsede && String(r.subsede || "") !== subsede) {
      return false;
    }

    if (status && statusRegistro(r) !== status) {
      return false;
    }

    if (curso && cursoRegistro(r) !== curso) {
      return false;
    }

    if (empresa && empresaRegistro(r) !== empresa) {
      return false;
    }

    if (solicitante && solicitanteRegistro(r) !== solicitante) {
      return false;
    }

    const data = dataISO(dataSolicitacaoRegistro(r));

    if (inicial && (!data || data < inicial)) {
      return false;
    }

    if (final && (!data || data > final)) {
      return false;
    }

    return true;
  });
}

/* =====================================================
   AGRUPAMENTO DOS GRÁFICOS
===================================================== */

function contarPor(lista, obterValor) {
  const contagem = new Map();

  lista.forEach(registro => {
    const valor = String(
      obterValor(registro) || "Não informada"
    );

    contagem.set(
      valor,
      (contagem.get(valor) || 0) + 1
    );
  });

  return [...contagem.entries()]
    .sort((a, b) => b[1] - a[1]);
}

function destruirGraficos() {
  Object.values(charts).forEach(grafico => {
    if (grafico) {
      grafico.destroy();
    }
  });

  charts = {};
}

/* =====================================================
   PLUGIN: NÚMEROS VISÍVEIS NOS GRÁFICOS
   Não precisa instalar biblioteca adicional.
===================================================== */

const pluginRotulosValores = {
  id: "rotulosValoresGerar",

  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    const tipo = chart.config.type;

    ctx.save();

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);

      if (meta.hidden || !meta.data) return;

      meta.data.forEach((elemento, index) => {
        const valor = dataset.data[index];

        if (
          valor === null ||
          valor === undefined ||
          !Number.isFinite(Number(valor))
        ) {
          return;
        }

        const texto = formatarNumero(valor);

        ctx.save();

        ctx.font = "600 11px Arial, sans-serif";
        ctx.textBaseline = "middle";

        if (tipo === "doughnut" || tipo === "pie") {
          /*
           * Posiciona o número no centro de cada fatia.
           */
          const propriedades = elemento.getProps(
            [
              "x",
              "y",
              "startAngle",
              "endAngle",
              "innerRadius",
              "outerRadius"
            ],
            true
          );

          const angulo =
            (propriedades.startAngle + propriedades.endAngle) / 2;

          const raio =
            (propriedades.innerRadius + propriedades.outerRadius) / 2;

          const x = propriedades.x + Math.cos(angulo) * raio;
          const y = propriedades.y + Math.sin(angulo) * raio;

          ctx.textAlign = "center";
          ctx.fillStyle = "#FFFFFF";
          ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
          ctx.shadowBlur = 2;

          ctx.fillText(texto, x, y);
        } else {
          /*
           * Posiciona os números acima das barras
           * e dos pontos da linha mensal.
           */
          const posicao = elemento.tooltipPosition();

          ctx.textAlign = "center";
          ctx.fillStyle = "#263238";
          ctx.shadowColor = "rgba(255, 255, 255, 0.85)";
          ctx.shadowBlur = 2;

          ctx.fillText(
            texto,
            posicao.x,
            posicao.y - 10
          );
        }

        ctx.restore();
      });
    });

    ctx.restore();
  }
};

/* =====================================================
   CRIAÇÃO DOS GRÁFICOS
===================================================== */

function criarGrafico(id, tipo, labels, valores, titulo) {
  const canvas = $(id);

  if (!canvas || typeof Chart === "undefined") {
    return;
  }

  charts[id] = new Chart(canvas, {
    type: tipo,

    data: {
      labels,

      datasets: [{
        label: titulo,
        data: valores,
        borderWidth: 2,
        borderRadius: tipo === "bar" ? 5 : 0,
        tension: 0.3,
        fill: false,

        /*
         * Mantém os gráficos legíveis.
         * As cores podem seguir o padrão do Chart.js
         * configurado no projeto.
         */
        pointRadius: tipo === "line" ? 3 : 0,
        pointHoverRadius: tipo === "line" ? 4 : 0
      }]
    },

    plugins: [pluginRotulosValores],

    options: {
      responsive: true,
      maintainAspectRatio: false,

      /*
       * Os números já ficam visíveis.
       * A interação por tooltip continua disponível.
       */
      plugins: {
        legend: {
          display: tipo === "doughnut",
          position: "bottom"
        },

        tooltip: {
          enabled: true
        }
      },

      layout: {
        padding: {
          top: 16,
          right: 8,
          bottom: 4,
          left: 4
        }
      },

      scales: tipo === "doughnut" ? {} : {
        y: {
          beginAtZero: true,

          ticks: {
            precision: 0
          }
        }
      }
    }
  });
}

/* =====================================================
   ATUALIZAÇÃO DOS GRÁFICOS
===================================================== */

function atualizarGraficos(lista) {
  destruirGraficos();

  const porStatus = contarPor(
    lista,
    statusRegistro
  ).slice(0, 12);

  criarGrafico(
    "graficoStatus",
    "doughnut",
    porStatus.map(item => item[0]),
    porStatus.map(item => item[1]),
    "Vagas por status"
  );

  const porSubsede = contarPor(
    lista,
    r => r.subsede || "Não informada"
  ).slice(0, 13).reverse();

  criarGrafico(
    "graficoSubsede",
    "bar",
    porSubsede.map(item => item[0]),
    porSubsede.map(item => item[1]),
    "Vagas por subsede"
  );

  const meses = new Map();

  lista.forEach(r => {
    const dataOriginal = dataSolicitacaoRegistro(r);
    const data = dataISO(dataOriginal);

    let ano;
    let mes;

    if (data) {
      ano = Number(data.slice(0, 4));
      mes = Number(data.slice(5, 7));
    } else {
      ano = Number(r.ano_solicitacao);
      mes = Number(r.mes_solicitacao);
    }

    if (
      !ano ||
      !mes ||
      mes < 1 ||
      mes > 12
    ) {
      return;
    }

    const chave = `${ano}-${String(mes).padStart(2, "0")}`;

    meses.set(
      chave,
      (meses.get(chave) || 0) + 1
    );
  });

  const mesesOrdenados = [...meses.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]));

  criarGrafico(
    "graficoMensal",
    "line",

    mesesOrdenados.map(([chave]) => {
      const [ano, mes] = chave.split("-");
      return `${mes}/${ano}`;
    }),

    mesesOrdenados.map(([, total]) => total),

    "Vagas solicitadas por mês"
  );
}

/* =====================================================
   INDICADORES
===================================================== */

function atualizarIndicadores(lista) {
  const abertas = lista.filter(r => {
    const s = normalizar(statusRegistro(r));

    return (
      s.includes("ABERTA") ||
      s.includes("ABERTO") ||
      s.includes("AGUARDANDO") ||
      s.includes("PENDENTE")
    ) &&
    !s.includes("FECHAD") &&
    !s.includes("CANCEL");
  });

  const andamento = lista.filter(r => {
    const s = normalizar(statusRegistro(r));

    return (
      s.includes("ANDAMENTO") ||
      s.includes("PROCESS") ||
      s.includes("SELECAO") ||
      s.includes("SELETIVO")
    ) &&
    !s.includes("FECHAD") &&
    !s.includes("CANCEL");
  });

  if ($("totalVagas")) {
    $("totalVagas").textContent =
      formatarNumero(lista.length);
  }

  if ($("vagasAbertas")) {
    $("vagasAbertas").textContent =
      formatarNumero(abertas.length);
  }

  if ($("vagasAndamento")) {
    $("vagasAndamento").textContent =
      formatarNumero(andamento.length);
  }

  if ($("totalUnidades")) {
    $("totalUnidades").textContent =
      formatarNumero(
        new Set(
          lista
            .map(r => String(r.subsede || "").trim())
            .filter(Boolean)
        ).size
      );
  }
}

/* =====================================================
   PAGINAÇÃO DA TABELA
===================================================== */

function obterControlesPaginacao() {
  let controles = $("paginacaoTabela");

  if (controles) return controles;

  const corpo = $("corpoTabela");
  const tabela = corpo?.closest("table");
  const areaTabela = tabela?.closest(".table-scroll");

  if (!areaTabela) return null;

  controles = document.createElement("div");
  controles.id = "paginacaoTabela";

  controles.style.display = "flex";
  controles.style.alignItems = "center";
  controles.style.justifyContent = "space-between";
  controles.style.flexWrap = "wrap";
  controles.style.gap = "10px";
  controles.style.padding = "12px 0 2px";
  controles.style.marginTop = "8px";

  const informacao = document.createElement("span");
  informacao.id = "informacaoPaginacao";

  informacao.style.fontSize = "13px";
  informacao.style.color = "#64748b";

  const botoes = document.createElement("div");

  botoes.style.display = "flex";
  botoes.style.alignItems = "center";
  botoes.style.gap = "8px";

  const anterior = document.createElement("button");
  anterior.id = "paginaAnterior";
  anterior.type = "button";
  anterior.textContent = "← Anterior";

  const proximo = document.createElement("button");
  proximo.id = "paginaProxima";
  proximo.type = "button";
  proximo.textContent = "Próxima →";

  [anterior, proximo].forEach(botao => {
    botao.style.padding = "8px 12px";
    botao.style.border = "1px solid #d1d5db";
    botao.style.borderRadius = "6px";
    botao.style.background = "#ffffff";
    botao.style.color = "#263238";
    botao.style.fontSize = "13px";
    botao.style.cursor = "pointer";
  });

  anterior.addEventListener("click", () => {
    if (paginaAtual > 1) {
      paginaAtual--;
      atualizarTabela(aplicarFiltros());
    }
  });

  proximo.addEventListener("click", () => {
    const lista = aplicarFiltros();
    const totalPaginas = Math.max(
      1,
      Math.ceil(lista.length / REGISTROS_POR_PAGINA)
    );

    if (paginaAtual < totalPaginas) {
      paginaAtual++;
      atualizarTabela(lista);
    }
  });

  botoes.append(anterior, proximo);
  controles.append(informacao, botoes);

  areaTabela.insertAdjacentElement("afterend", controles);

  return controles;
}

/* =====================================================
   RENDERIZAÇÃO DA TABELA
===================================================== */

function atualizarTabela(lista) {
  const corpo = $("corpoTabela");

  if (!corpo) return;

  const total = lista.length;
  const totalPaginas = Math.max(
    1,
    Math.ceil(total / REGISTROS_POR_PAGINA)
  );

  /*
   * Garante que a página atual exista após a aplicação
   * dos filtros ou a atualização dos dados.
   */
  paginaAtual = Math.min(
    Math.max(1, paginaAtual),
    totalPaginas
  );

  const inicio = (paginaAtual - 1) * REGISTROS_POR_PAGINA;
  const fim = Math.min(inicio + REGISTROS_POR_PAGINA, total);

  const pagina = lista.slice(inicio, fim);

  if (!pagina.length) {
    corpo.replaceChildren();

    const linha = document.createElement("tr");
    const celula = document.createElement("td");

    celula.colSpan = 7;
    celula.textContent = "Nenhuma vaga encontrada.";
    celula.style.textAlign = "center";
    celula.style.padding = "20px";

    linha.appendChild(celula);
    corpo.appendChild(linha);
  } else {
    corpo.innerHTML = pagina.map(r => `
      <tr>
        <td>${escaparHTML(r.id_vaga ?? r.id_registro ?? r.id ?? "—")}</td>
        <td>${escaparHTML(empresaRegistro(r))}</td>
        <td>${escaparHTML(r.subsede || "—")}</td>
        <td>${escaparHTML(cursoRegistro(r))}</td>
        <td>${escaparHTML(statusRegistro(r))}</td>
        <td>${escaparHTML(formatarData(dataSolicitacaoRegistro(r)))}</td>
        <td>${escaparHTML(r.periodo || "—")}</td>
      </tr>
    `).join("");
  }

  /*
   * Contador do cabeçalho da tabela.
   */
  if ($("contadorTabela")) {
    if (total === 0) {
      $("contadorTabela").textContent = "0 registros";
    } else {
      $("contadorTabela").textContent =
        `Exibindo ${formatarNumero(inicio + 1)}–${formatarNumero(fim)} de ${formatarNumero(total)} registros`;
    }
  }

  /*
   * Controles de navegação criados automaticamente.
   */
  const controles = obterControlesPaginacao();

  if (controles) {
    const informacao = $("informacaoPaginacao");
    const anterior = $("paginaAnterior");
    const proximo = $("paginaProxima");

    if (informacao) {
      informacao.textContent =
        total === 0
          ? "Nenhum registro"
          : `Página ${formatarNumero(paginaAtual)} de ${formatarNumero(totalPaginas)}`;
    }

    if (anterior) {
      anterior.disabled = paginaAtual <= 1 || total === 0;
      anterior.style.opacity = anterior.disabled ? "0.45" : "1";
      anterior.style.cursor = anterior.disabled ? "not-allowed" : "pointer";
    }

    if (proximo) {
      proximo.disabled = paginaAtual >= totalPaginas || total === 0;
      proximo.style.opacity = proximo.disabled ? "0.45" : "1";
      proximo.style.cursor = proximo.disabled ? "not-allowed" : "pointer";
    }

    controles.style.display =
      total > REGISTROS_POR_PAGINA ? "flex" : "none";
  }
}

/* =====================================================
   ATUALIZAÇÃO GERAL
===================================================== */

function atualizarPainel() {
  /*
   * Ao alterar filtros, volta para a primeira página
   * para evitar mostrar uma página vazia por engano.
   */
  paginaAtual = 1;

  const lista = aplicarFiltros();

  atualizarIndicadores(lista);
  atualizarGraficos(lista);
  atualizarTabela(lista);

  mostrarMensagem(
    `${formatarNumero(registros.length)} registros carregados; ` +
    `${formatarNumero(lista.length)} após os filtros.`,
    "success"
  );
}

/* =====================================================
   EXPORTAÇÃO CSV
   Exporta TODOS os registros filtrados, não apenas
   os 20 que aparecem na página atual.
===================================================== */

function exportarCSV() {
  const lista = aplicarFiltros();

  const colunas = [
    ["ID da vaga", r => r.id_vaga || r.id_registro || r.id],
    ["Empresa", empresaRegistro],
    ["Subsede", r => r.subsede],
    ["Cidade/UF", r => r.cidade_uf || r.cidade],
    ["Curso", cursoRegistro],
    ["Status", statusRegistro],
    ["Solicitado por", solicitanteRegistro],
    ["Angariador", r => r.angariador],
    ["Data da solicitação", dataSolicitacaoRegistro],
    ["Período", r => r.periodo],
    ["Carga horária", r => r.carga_horaria],
    ["CNPJ", r => r.cnpj]
  ];

  const escaparCSV = valor =>
    `"${String(valor ?? "").replace(/"/g, '""')}"`;

  const conteudo = [
    colunas
      .map(([titulo]) => escaparCSV(titulo))
      .join(";"),

    ...lista.map(registro =>
      colunas
        .map(([, obterValor]) => escaparCSV(obterValor(registro)))
        .join(";")
    )
  ].join("\r\n");

  const blob = new Blob(
    ["\uFEFF" + conteudo],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "controle-vagas-aprendiz.csv";
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* =====================================================
   EVENTOS DOS FILTROS E BOTÕES
===================================================== */

function configurarEventos() {
  [
    ["busca", "input"],
    ["filtroSubsede", "change"],
    ["filtroStatus", "change"],
    ["filtroCurso", "change"],
    ["filtroEmpresa", "change"],
    ["filtroSolicitante", "change"],
    ["dataInicial", "change"],
    ["dataFinal", "change"]
  ].forEach(([id, evento]) => {
    const elemento = $(id);

    if (elemento) {
      elemento.addEventListener(evento, atualizarPainel);
    }
  });

  [
    "btnAtualizar",
    "atualizarBtn",
    "btnRecarregar"
  ].forEach(id => {
    const botao = $(id);

    if (botao) {
      botao.addEventListener("click", iniciarCarregamento);
    }
  });

  [
    "btnExportarCSV",
    "exportarCSV",
    "btnExportar"
  ].forEach(id => {
    const botao = $(id);

    if (botao) {
      botao.addEventListener("click", exportarCSV);
    }
  });

  const botaoLimpar = $("btnLimpar");

  if (botaoLimpar) {
    botaoLimpar.addEventListener("click", () => {
      [
        "busca",
        "filtroSubsede",
        "filtroStatus",
        "filtroCurso",
        "filtroEmpresa",
        "filtroSolicitante",
        "dataInicial",
        "dataFinal"
      ].forEach(id => {
        const elemento = $(id);

        if (elemento) {
          elemento.value = "";
        }
      });

      atualizarPainel();
    });
  }
}

/* =====================================================
   CARREGAMENTO INICIAL E ATUALIZAÇÃO
===================================================== */

async function iniciarCarregamento() {
  if (carregamentoEmAndamento) return;

  carregamentoEmAndamento = true;

  const botaoAtualizar = $("btnAtualizar");

  if (botaoAtualizar) {
    botaoAtualizar.disabled = true;
    botaoAtualizar.dataset.textoOriginal =
      botaoAtualizar.textContent;
    botaoAtualizar.textContent = "Atualizando...";
  }

  mostrarMensagem("Carregando informações...", "info");

  try {
    const novosRegistros = await carregarDados();

    registros = novosRegistros;
    paginaAtual = 1;

    preencherFiltro(
      "filtroSubsede",
      registros.map(r => r.subsede),
      "Todas as subsedes"
    );

    preencherFiltro(
      "filtroStatus",
      registros.map(statusRegistro),
      "Todos os status"
    );

    preencherFiltro(
      "filtroCurso",
      registros.map(cursoRegistro),
      "Todas as áreas"
    );

    preencherFiltro(
      "filtroEmpresa",
      registros.map(empresaRegistro),
      "Todas as empresas"
    );

    preencherFiltro(
      "filtroSolicitante",
      registros.map(solicitanteRegistro),
      "Todos os solicitantes"
    );

    atualizarPainel();

    if (registros.length === 0) {
      mostrarMensagem(
        "A consulta terminou, mas a view não retornou registros. Verifique a view e as permissões do Supabase.",
        "error"
      );
    }
  } catch (error) {
    console.error(
      "Erro ao carregar o Controle de Vagas Aprendiz:",
      error
    );

    registros = [];
    paginaAtual = 1;

    atualizarIndicadores([]);
    atualizarGraficos([]);
    atualizarTabela([]);

    mostrarMensagem(
      "Não foi possível carregar os dados: " +
      (error.message || "erro desconhecido."),
      "error"
    );
  } finally {
    carregamentoEmAndamento = false;

    if (botaoAtualizar) {
      botaoAtualizar.disabled = false;
      botaoAtualizar.textContent =
        botaoAtualizar.dataset.textoOriginal || "Atualizar dados";
    }
  }
}

/* =====================================================
   INICIALIZAÇÃO
===================================================== */

function inicializarPainel() {
  configurarEventos();
  iniciarCarregamento();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    inicializarPainel,
    { once: true }
  );
} else {
  inicializarPainel();
}
