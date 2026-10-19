
/**
 * GERAR — CONTROLE DE VAGAS APRENDIZ
 * Fonte: public.vw_vagas_aprendiz_bi
 * Requer Chart.js, Supabase JS v2 e config.js.
 */

const VIEW = "vw_vagas_aprendiz_bi";
const PAGE_SIZE = 1000;

let registros = [];
let charts = {};

const $ = id => document.getElementById(id);

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

function formatarData(valor) {
  if (!valor) return "—";

  const data = new Date(valor);

  return Number.isNaN(data.getTime())
    ? String(valor)
    : data.toLocaleDateString("pt-BR");
}

/* =====================================================
   CARREGAMENTO PAGINADO DOS DADOS
===================================================== */

async function carregarDados() {
  const sb = obterSupabase();

  if (!sb || typeof sb.from !== "function") {
    throw new Error(
      "Cliente Supabase não encontrado. Confira config.js."
    );
  }

  const todos = [];

  for (let inicio = 0; ; inicio += PAGE_SIZE) {
    const { data, error } = await sb
      .from(VIEW)
      .select("*")
      .range(inicio, inicio + PAGE_SIZE - 1);

    if (error) {
      throw new Error(
        "Erro ao consultar os dados: " + error.message
      );
    }

    todos.push(...(data || []));

    if (!data || data.length < PAGE_SIZE) break;
  }

  return todos;
}

/* =====================================================
   PREENCHIMENTO DOS FILTROS
===================================================== */

function preencherFiltro(id, valores, textoInicial) {
  const select = $(id);
  if (!select) return;

  const anterior = select.value;

  const unicos = [...new Set(
    valores
      .map(v => String(v ?? "").trim())
      .filter(v => v && v !== "Não informado" && v !== "Não informada")
  )].sort((a, b) => a.localeCompare(b, "pt-BR"));

  select.replaceChildren(new Option(textoInicial, ""));

  unicos.forEach(valor => {
    select.add(new Option(valor, valor));
  });

  if (unicos.includes(anterior)) {
    select.value = anterior;
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
      r.empresa,
      r.razao_social,
      r.cidade_uf,
      r.subsede,
      r.curso,
      r.angariador,
      r.solicitado_por,
      r.status,
      r.status_simplificado,
      r.cnpj
    ].join(" "));

    if (busca && !textoBusca.includes(busca)) return false;

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

    const data = String(r.solicitado_em || "").slice(0, 10);

    if (inicial && (!data || data < inicial)) return false;
    if (final && (!data || data > final)) return false;

    return true;
  });
}

/* =====================================================
   AGRUPAMENTO PARA OS GRÁFICOS
===================================================== */

function contarPor(lista, obterValor) {
  const contagem = {};

  lista.forEach(r => {
    const chave = obterValor(r) || "Não informado";
    contagem[chave] = (contagem[chave] || 0) + 1;
  });

  return Object.entries(contagem)
    .sort((a, b) => b[1] - a[1]);
}

function destruirGraficos() {
  Object.values(charts).forEach(grafico => {
    if (grafico) grafico.destroy();
  });

  charts = {};
}

function criarGrafico(id, tipo, labels, valores, titulo) {
  const canvas = $(id);

  if (!canvas || typeof Chart === "undefined") return;

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
          ticks: { precision: 0 }
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

  // 1. Vagas por status
  const porStatus = contarPor(
    lista,
    statusRegistro
  ).slice(0, 12);

  criarGrafico(
    "graficoStatus",
    "doughnut",
    porStatus.map(x => x[0]),
    porStatus.map(x => x[1]),
    "Vagas por status"
  );

  // 2. Vagas por subsede
  const porSubsede = contarPor(
    lista,
    r => r.subsede || "Não informada"
  ).slice(0, 13).reverse();

  criarGrafico(
    "graficoSubsede",
    "bar",
    porSubsede.map(x => x[0]),
    porSubsede.map(x => x[1]),
    "Vagas por subsede"
  );

  // 3. Evolução mensal das solicitações
  // Usa ano_solicitacao e mes_solicitacao;
  // caso estejam vazios, utiliza solicitado_em.
  const meses = {};

  lista.forEach(r => {
    let ano = Number(r.ano_solicitacao);
    let mes = Number(r.mes_solicitacao);

    if (!ano || !mes || mes < 1 || mes > 12) {
      if (!r.solicitado_em) return;

      const data = new Date(r.solicitado_em);

      if (Number.isNaN(data.getTime())) return;

      ano = data.getFullYear();
      mes = data.getMonth() + 1;
    }

    const chave =
      `${ano}-${String(mes).padStart(2, "0")}`;

    meses[chave] = (meses[chave] || 0) + 1;
  });

  const mesesOrdenados = Object.entries(meses)
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
    ) && !s.includes("FECHAD") && !s.includes("CANCEL");
  });

  const andamento = lista.filter(r => {
    const s = normalizar(statusRegistro(r));

    return (
      s.includes("ANDAMENTO") ||
      s.includes("PROCESS") ||
      s.includes("SELECAO") ||
      s.includes("SELETIVO")
    ) && !s.includes("FECHAD") && !s.includes("CANCEL");
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
      new Set(lista.map(r => r.subsede).filter(Boolean)).size
        .toLocaleString("pt-BR");
  }
}

/* =====================================================
   TABELA DETALHADA
===================================================== */

function atualizarTabela(lista) {
  const corpo = $("corpoTabela");
  if (!corpo) return;

  corpo.replaceChildren();

  if (!lista.length) {
    const linha = corpo.insertRow();
    const celula = linha.insertCell();
    celula.colSpan = 7;
    celula.textContent = "Nenhum registro encontrado.";
  } else {
    lista.slice(0, 500).forEach(r => {
      const linha = corpo.insertRow();

      [
        r.id_vaga ?? r.id_registro ?? "—",
        empresaRegistro(r),
        r.subsede || "—",
        cursoRegistro(r),
        statusRegistro(r),
        formatarData(r.solicitado_em),
        r.periodo || "—"
      ].forEach(valor => {
        linha.insertCell().textContent = String(valor);
      });
    });
  }

  if ($("contadorTabela")) {
    $("contadorTabela").textContent =
      `${lista.length.toLocaleString("pt-BR")} registros` +
      (lista.length > 500
        ? " (exibindo os primeiros 500)"
        : "");
  }
}

/* =====================================================
   ATUALIZAÇÃO GERAL DO PAINEL
===================================================== */

function atualizarPainel() {
  const lista = aplicarFiltros();

  atualizarIndicadores(lista);
  atualizarGraficos(lista);
  atualizarTabela(lista);

  if ($("mensagem")) {
    $("mensagem").textContent =
      `${registros.length.toLocaleString("pt-BR")} registros carregados; ` +
      `${lista.length.toLocaleString("pt-BR")} após os filtros.`;

    $("mensagem").className = "message success";
  }
}

/* =====================================================
   EXPORTAÇÃO CSV
===================================================== */

function exportarCSV() {
  const lista = aplicarFiltros();

  const colunas = [
    ["ID da vaga", r => r.id_vaga || r.id_registro],
    ["Empresa", empresaRegistro],
    ["Subsede", r => r.subsede],
    ["Cidade/UF", r => r.cidade_uf],
    ["Curso", cursoRegistro],
    ["Status", statusRegistro],
    ["Solicitado por", solicitanteRegistro],
    ["Angariador", r => r.angariador],
    ["Data da solicitação", r => r.solicitado_em],
    ["Período", r => r.periodo],
    ["Carga horária", r => r.carga_horaria],
    ["CNPJ", r => r.cnpj]
  ];

  const escapar = valor =>
    '"' + String(valor ?? "").replace(/"/g, '""') + '"';

  const conteudo = [
    colunas.map(c => escapar(c[0])).join(";"),
    ...lista.map(r =>
      colunas.map(c => escapar(c[1](r))).join(";")
    )
  ].join("\r\n");

  const blob = new Blob(["\uFEFF" + conteudo], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "vagas-aprendiz.csv";
  link.click();

  URL.revokeObjectURL(url);
}

/* =====================================================
   INICIALIZAÇÃO
===================================================== */

async function iniciarPainel() {
  if ($("mensagem")) {
    $("mensagem").textContent =
      "Carregando dados do Supabase...";
  }

  try {
    registros = await carregarDados();

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
      $(id)?.addEventListener(
        id === "busca" ? "input" : "change",
        atualizarPainel
      );
    });

    $("btnLimpar")?.addEventListener("click", () => {
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
        if ($(id)) $(id).value = "";
      });

      atualizarPainel();
    });

    $("btnExportar")?.addEventListener(
      "click",
      exportarCSV
    );

    $("btnAtualizar")?.addEventListener("click", async () => {
      $("btnAtualizar").disabled = true;

      try {
        if ($("mensagem")) {
          $("mensagem").textContent = "Atualizando dados...";
        }

        registros = await carregarDados();

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
      } catch (erro) {
        mostrarErro(erro);
      } finally {
        $("btnAtualizar").disabled = false;
      }
    });

    atualizarPainel();

  } catch (erro) {
    mostrarErro(erro);
  }
}

function mostrarErro(erro) {
  console.error("Painel Vagas Aprendiz:", erro);

  if ($("mensagem")) {
    $("mensagem").textContent =
      erro.message || "Não foi possível carregar os dados.";

    $("mensagem").className = "message error";
  }

  if ($("corpoTabela")) {
    $("corpoTabela").innerHTML =
      '<tr><td colspan="7">Erro ao carregar os dados.</td></tr>';
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", iniciarPainel);
} else {
  iniciarPainel();
}
