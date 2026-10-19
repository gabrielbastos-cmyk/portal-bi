```javascript
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

function escaparHTML(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, caractere => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[caractere]);
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
        "Erro ao consultar a view: " + error.message
      );
    }

    const lote = data || [];
    todos.push(...lote);

    if (lote.length < PAGE_SIZE) break;

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
        valor !== "Não informada"
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
      r.empresa,
      r.razao_social,
      r.cidade_uf,
      r.subsede,
      r.curso,
      r.tipo_curso,
      r.angariador,
      r.solicitado_por,
      r.status,
      r.status_simplificado,
      r.cnpj
    ].join(" "));

    if (busca && !textoBusca.includes(busca)) return false;
    if (subsede && String(r.subsede || "") !== subsede) return false;
    if (status && statusRegistro(r) !== status) return false;
    if (curso && cursoRegistro(r) !== curso) return false;
    if (empresa && empresaRegistro(r) !== empresa) return false;
    if (solicitante && solicitanteRegistro(r) !== solicitante) return false;

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

  lista.forEach(registro => {
    const chave = String(
      obterValor(registro) || "Não informada"
    );

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

    const chave = `${ano}-${String(mes).padStart(2, "0")}`;

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
      new Set(
        lista.map(r => r.subsede).filter(Boolean)
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
    corpo.innerHTML =
      '<tr><td colspan="7">Nenhuma vaga encontrada.</td></tr>';
  } else {
    corpo.innerHTML = lista.slice(0, 500).map(r => `
      <tr>
        <td>${escaparHTML(r.id_vaga ?? r.id_registro ?? "—")}</td>
        <td>${escaparHTML(empresaRegistro(r))}</td>
        <td>${escaparHTML(r.subsede || "—")}</td>
        <td>${escaparHTML(cursoRegistro(r))}</td>
        <td>${escaparHTML(statusRegistro(r))}</td>
        <td>${escaparHTML(formatarData(r.solicitado_em))}</td>
        <td>${escaparHTML(r.periodo || "—")}</td>
      </tr>
    `).join("");
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
   ATUALIZAÇÃO GERAL
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
    `"${String
