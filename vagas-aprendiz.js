
const VIEW = "vw_vagas_aprendiz_bi";
const PAGE_SIZE = 1000;

let registros = [];
let charts = {};

const $ = id => document.getElementById(id);

function supabaseClient() {
  return window.sb || window.supabaseClient;
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

async function carregarDados() {
  const sb = supabaseClient();

  if (!sb || typeof sb.from !== "function") {
    throw new Error(
      "Cliente Supabase não encontrado. Confira se config.js inicializa window.sb."
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
        "Erro ao consultar a view: " + error.message +
        ". Confira as permissões de leitura no Supabase."
      );
    }

    todos.push(...(data || []));

    if (!data || data.length < PAGE_SIZE) break;
  }

  return todos;
}

function preencherFiltro(id, valores, textoInicial) {
  const select = $(id);
  if (!select) return;

  const valorAnterior = select.value;
  const valoresUnicos = [...new Set(valores)]
    .filter(v => v && v !== "Não informado")
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  select.replaceChildren(new Option(textoInicial, ""));

  valoresUnicos.forEach(valor => {
    select.add(new Option(valor, valor));
  });

  if (valoresUnicos.includes(valorAnterior)) {
    select.value = valorAnterior;
  }
}

function aplicarFiltros() {
  const busca = normalizar($("busca")?.value);
  const subsede = $("filtroSubsede")?.value || "";
  const status = $("filtroStatus")?.value || "";
  const curso = $("filtroCurso")?.value || "";
  const inicial = $("dataInicial")?.value || "";
  const final = $("dataFinal")?.value || "";

  return registros.filter(r => {
    const texto = normalizar([
      r.id_vaga, r.id_registro, r.empresa, r.razao_social,
      r.cidade_uf, r.subsede, r.curso, r.angariador,
      r.status, r.status_simplificado, r.cnpj
    ].join(" "));

    if (busca && !texto.includes(busca)) return false;
    if (subsede && r.subsede !== subsede) return false;
    if (status && statusRegistro(r) !== status) return false;
    if (curso && cursoRegistro(r) !== curso) return false;

    const data = String(r.solicitado_em || "").slice(0, 10);
    if (inicial && (!data || data < inicial)) return false;
    if (final && (!data || data > final)) return false;

    return true;
  });
}

function contarPor(lista, obterValor) {
  const contagem = {};

  lista.forEach(r => {
    const chave = obterValor(r) || "Não informado";
    contagem[chave] = (contagem[chave] || 0) + 1;
  });

  return Object.entries(contagem).sort((a, b) => b[1] - a[1]);
}

function destruirGraficos() {
  Object.values(charts).forEach(grafico => grafico.destroy());
  charts = {};
}

function criarGrafico(id, tipo, labels, dados, titulo) {
  const canvas = $(id);
  if (!canvas || typeof Chart === "undefined") return;

  charts[id] = new Chart(canvas, {
    type: tipo,
    data: {
      labels,
      datasets: [{
        label: titulo,
        data: dados,
        borderWidth: 2,
        borderRadius: tipo === "bar" ? 5 : 0,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: tipo === "doughnut", position: "bottom" }
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

function atualizarGraficos(lista) {
  destruirGraficos();

  const status = contarPor(lista, statusRegistro).slice(0, 12);
  criarGrafico(
    "graficoStatus", "doughnut",
    status.map(x => x[0]),
    status.map(x => x[1]),
    "Vagas"
  );

  const subsedes = contarPor(lista, r => r.subsede).slice(0, 13).reverse();
  criarGrafico(
    "graficoSubsede", "bar",
    subsedes.map(x => x[0]),
    subsedes.map(x => x[1]),
    "Vagas por subsede"
  );

  const meses = {};

  lista.forEach(r => {
    if (!r.solicitado_em) return;

    const data = new Date(r.solicitado_em);
    if (Number.isNaN(data.getTime())) return;

    const chave =
      data.getFullYear() + "-" +
      String(data.getMonth() + 1).padStart(2, "0");

    meses[chave] = (meses[chave] || 0) + 1;
  });

  const mesesOrdenados = Object.entries(meses).sort(
    (a, b) => a[0].localeCompare(b[0])
  );

  criarGrafico(
    "graficoMensal", "line",
    mesesOrdenados.map(([mes]) => {
      const [ano, numeroMes] = mes.split("-");
      return numeroMes + "/" + ano;
    }),
    mesesOrdenados.map(x => x[1]),
    "Vagas solicitadas"
  );
}

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
        r.empresa || r.razao_social || "—",
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
      lista.length.toLocaleString("pt-BR") + " registros" +
      (lista.length > 500 ? " (exibindo os primeiros 500)" : "");
  }
}

function atualizarPainel() {
  const lista = aplicarFiltros();

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
    $("totalVagas").textContent = lista.length.toLocaleString("pt-BR");
  }

  if ($("vagasAbertas")) {
    $("vagasAbertas").textContent = abertas.length.toLocaleString("pt-BR");
  }

  if ($("vagasAndamento")) {
    $("vagasAndamento").textContent = andamento.length.toLocaleString("pt-BR");
  }

  if ($("totalUnidades")) {
    $("totalUnidades").textContent =
      new Set(lista.map(r => r.subsede).filter(Boolean)).size;
  }

  atualizarGraficos(lista);
  atualizarTabela(lista);

  if ($("mensagem")) {
    $("mensagem").textContent =
      `${registros.length.toLocaleString("pt-BR")} registros carregados; ` +
      `${lista.length.toLocaleString("pt-BR")} após os filtros.`;
    $("mensagem").className = "message success";
  }
}

function exportarCSV() {
  const lista = aplicarFiltros();

  const colunas = [
    ["ID da vaga", r => r.id_vaga || r.id_registro],
    ["Empresa", r => r.empresa || r.razao_social],
    ["Subsede", r => r.subsede],
    ["Cidade/UF", r => r.cidade_uf],
    ["Curso", r => r.curso],
    ["Status", statusRegistro],
    ["Data da solicitação", r => r.solicitado_em],
    ["Período", r => r.periodo],
    ["Angariador", r => r.angariador],
    ["Carga horária", r => r.carga_horaria],
    ["CNPJ", r => r.cnpj]
  ];

  const escapar = valor =>
    '"' + String(valor ?? "").replace(/"/g, '""') + '"';

  const conteudo = [
    colunas.map(c => escapar(c[0])).join(";"),
    ...lista.map(r => colunas.map(c => escapar(c[1](r))).join(";"))
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

async function iniciarPainel() {
  const mensagem = $("mensagem");
  if (mensagem) mensagem.textContent = "Carregando dados do Supabase...";

  try {
    registros = await carregarDados();

    preencherFiltro(
      "filtroSubsede",
      registros.map(r => r.subsede).filter(Boolean),
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

    ["busca", "filtroSubsede", "filtroStatus", "filtroCurso",
      "dataInicial", "dataFinal"].forEach(id => {
      $(id)?.addEventListener(
        id === "busca" ? "input" : "change",
        atualizarPainel
      );
    });

    $("btnLimpar")?.addEventListener("click", () => {
      ["busca", "filtroSubsede", "filtroStatus", "filtroCurso",
        "dataInicial", "dataFinal"].forEach(id => {
        if ($(id)) $(id).value = "";
      });
      atualizarPainel();
    });

    $("btnExportar")?.addEventListener("click", exportarCSV);

    $("btnAtualizar")?.addEventListener("click", async () => {
      $("btnAtualizar").disabled = true;
      try {
        if ($("mensagem")) $("mensagem").textContent = "Atualizando dados...";
        registros = await carregarDados();
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
  console.error("Erro no painel de Vagas Aprendiz:", erro);

  if ($("mensagem")) {
    $("mensagem").textContent = erro.message || "Não foi possível carregar os dados.";
    $("mensagem").className = "message error";
  }

  if ($("corpoTabela")) {
    $("corpoTabela").innerHTML =
      '<tr><td colspan="7">Não foi possível carregar os dados.</td></tr>';
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", iniciarPainel);
} else {
  iniciarPainel();
}
