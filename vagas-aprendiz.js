
/**
 * GERAR — CONTROLE DE VAGAS APRENDIZ
 * Fonte: public.vw_vagas_aprendiz_bi
 * Requer Chart.js, Supabase JS v2 e config.js.
 */

"use strict";

const VIEW = "vw_vagas_aprendiz_bi";
const PAGE_SIZE = 1000;
const MAX_REGISTROS_TABELA = 500;

let registros = [];
let charts = {};
let carregamentoEmAndamento = false;

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

  // Trata datas ISO sem horário como datas locais,
  // evitando que sejam exibidas no dia anterior.
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

/* =====================================================
   CARREGAMENTO PAGINADO
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
   AGRUPAMENTO PARA OS GRÁFICOS
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
        fill: false
      }]
    },

    options: {
      responsive: true,
      maintainAspectRatio: false,

      plugins: {
        legend: {
          display: tipo === "doughnut",
          position: "bottom"
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
   GRÁFICOS
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

    // Prioriza a data de solicitação para garantir
    // que a evolução represente a data real do pedido.
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
      lista.length.toLocaleString("pt-BR");
  }

  if ($("vagasAbertas")) {
    $("vagasAbertas").textContent =
      abertas.length.toLocaleString("pt-BR");
  }

  if ($("vagasAndamento")) {
    $("vagasAndamento").textContent =
      andamento.length.toLocaleString("pt-BR");
  }

  if ($("totalUnidades")) {
    $("totalUnidades").textContent =
      new Set(
        lista
          .map(r => String(r.subsede || "").trim())
          .filter(Boolean)
      ).size.toLocaleString("pt-BR");
  }
}

/* =====================================================
   TABELA DETALHADA
===================================================== */

function atualizarTabela(lista) {
  const corpo = $("corpoTabela");

  if (!corpo) return;

  if (!lista.length) {
    corpo.replaceChildren();

    const linha = document.createElement("tr");
    const celula = document.createElement("td");

    celula.colSpan = 7;
    celula.textContent = "Nenhuma vaga encontrada.";

    linha.appendChild(celula);
    corpo.appendChild(linha);
  } else {
    corpo.innerHTML = lista
      .slice(0, MAX_REGISTROS_TABELA)
      .map(r => `
        <tr>
          <td>${escaparHTML(r.id_vaga ?? r.id_registro ?? r.id ?? "—")}</td>
          <td>${escaparHTML(empresaRegistro(r))}</td>
          <td>${escaparHTML(r.subsede || "—")}</td>
          <td>${escaparHTML(cursoRegistro(r))}</td>
          <td>${escaparHTML(statusRegistro(r))}</td>
          <td>${escaparHTML(formatarData(dataSolicitacaoRegistro(r)))}</td>
          <td>${escaparHTML(r.periodo || "—")}</td>
        </tr>
      `)
      .join("");
  }

  if ($("contadorTabela")) {
    $("contadorTabela").textContent =
      `${lista.length.toLocaleString("pt-BR")} registros` +
      (
        lista.length > MAX_REGISTROS_TABELA
          ? ` (exibindo os primeiros ${MAX_REGISTROS_TABELA})`
          : ""
      );
  }
}

/* =====================================================
   ATUALIZAÇÃO GERAL
===================================================== */

function atualizarPainel() {
  const lista = aplicarFiltros();

  atualizarIndicadores(lista);
  atualizarGraficos(lista);
  atualizarTabela(lista);

  mostrarMensagem(
    `${registros.length.toLocaleString("pt-BR")} registros carregados; ` +
    `${lista.length.toLocaleString("pt-BR")} após os filtros.`,
    "success"
  );
}

/* =====================================================
   EXPORTAÇÃO CSV
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

  // Libera o recurso depois de o navegador iniciar o download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* =====================================================
   EVENTOS DOS FILTROS
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
