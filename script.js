
"use strict";

const sb = window.sb;
const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let allDashboards = [];
let adminUsers = [];

const SUB_VIEW = "vw_substituicoes_bi";

const SUB_FIELDS = [
  "id", "subsede", "cidade", "jovem", "empresa", "motivo",
  "situacao_substituicao", "status_da_substituicao",
  "jovem_foi_substituido", "jovem_substituto",
  "inicio_substituto", "fim_substituto",
  "data_desligamento", "mes_ano_desligamento", "periodo",
  "mes_da_substituicao", "dias_ate_substituicao",
  "dentro_do_prazo", "faixa_de_atraso", "prioridade",
  "inicio_fechamento", "fim_fechamento", "periodo_fechamento",
  "mes_fechamento", "numero_mes_fechamento", "ano_fechamento",
  "mes_fechamento_da_substituicao", "fechamento_da_substituicao",
  "dias_pendentes", "dias_em_aberto",
  "substituido_em_outro_fechamento", "ultima_atualizacao"
];

let subRegistros = [];
let subGraficos = {};
let subInicializado = false;

function showMessage(id, message, type = "error") {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.className = type === "success" ? "message-success" : "message-error";
}

function clearMessage(id) {
  const el = $(id);
  if (el) {
    el.textContent = "";
    el.className = "";
  }
}

function setLoading(button, loading, loadingText = "Aguarde...") {
  if (!button) return;
  if (loading) {
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
    delete button.dataset.originalText;
  }
}

function friendlyError(error) {
  const m = error?.message || "";
  if (/invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(m)) return "Seu e-mail ainda não foi confirmado.";
  if (/failed to fetch|networkerror/i.test(m)) return "Não foi possível conectar. Confira a internet e o Supabase.";
  if (/permission denied|row-level security|42501/i.test(m)) return "Acesso negado. Confira as políticas de acesso do Supabase.";
  return m || "Ocorreu um erro inesperado.";
}

function isSafeDashboardUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[🔴🟢🟠🔵🟡⚪]/g, "")
    .trim();
}

function valorTexto(value, fallback = "—") {
  return value === null || value === undefined || String(value).trim() === ""
    ? fallback : String(value).trim();
}

function numeroSeguro(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function ehSim(value) {
  return ["sim", "yes", "true", "1", "realizado", "substituido"].includes(normalize(value));
}

function ehNao(value) {
  return ["nao", "não", "no", "false", "0", "pendente", "nao substituido", "nao realizada"].includes(normalize(value));
}

function temValor(value) {
  const v = normalize(value);
  return !!v && !["—", "-", "null", "undefined", "nao", "false", "0", "pendente", "nao substituido", "nao realizada"].includes(v);
}

// ==================================================
// SESSÃO E LOGIN
// ==================================================

if (!sb) {
  showMessage("login-message", "O Supabase não foi configurado. Confira o arquivo config.js.");
} else {
  iniciarPortal();
}

async function iniciarPortal() {
  try {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    if (data.session) await atualizarPortal();
    else mostrarLogin();
  } catch (error) {
    console.error(error);
    mostrarLogin();
    showMessage("login-message", friendlyError(error));
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session) setTimeout(() => atualizarPortal(), 0);
    if (event === "SIGNED_OUT") {
      currentUser = null;
      currentProfile = null;
      allDashboards = [];
      adminUsers = [];
      subRegistros = [];
      subInicializado = false;
      destruirGraficosSubstituicoes();
      mostrarLogin();
    }
  });
}

function mostrarLogin() {
  ["portal-section", "admin-section", "admin-nav-link",
   "substituicoes-section", "substituicoes-nav-link"].forEach(id => {
    if ($(id)) $(id).hidden = true;
  });
  if ($("login-section")) $("login-section").hidden = false;
  if ($("user-email")) $("user-email").textContent = "";
}

function mostrarPortal() {
  if ($("login-section")) $("login-section").hidden = true;
  if ($("portal-section")) $("portal-section").hidden = false;
  if ($("user-email")) $("user-email").textContent = currentUser?.email || "";
}

const loginForm = $("login-form");
if (loginForm) loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  clearMessage("login-message");
  const button = event.submitter;
  setLoading(button, true, "Entrando...");
  try {
    const email = $("email")?.value.trim();
    const password = $("password")?.value;
    if (!email || !password) throw new Error("Informe seu e-mail e sua senha.");
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await atualizarPortal();
  } catch (error) {
    showMessage("login-message", friendlyError(error));
  } finally {
    setLoading(button, false);
  }
});

const logoutButton = $("logout-btn");
if (logoutButton) logoutButton.addEventListener("click", async () => {
  try {
    const { error } = await sb.auth.signOut();
    if (error) throw error;
    mostrarLogin();
  } catch (error) {
    showMessage("dashboard-message", friendlyError(error));
  }
});

async function atualizarPortal() {
  try {
    const { data: { user }, error: userError } = await sb.auth.getUser();
    if (userError) throw userError;
    if (!user) return mostrarLogin();
    currentUser = user;

    const { data: profile, error: profileError } = await sb
      .from("profiles").select("id, email, role").eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile) throw new Error("Seu perfil não foi encontrado na tabela profiles.");

    currentProfile = profile;
    mostrarPortal();
    const isAdmin = profile.role === "admin";
    if ($("admin-section")) $("admin-section").hidden = !isAdmin;
    if ($("admin-nav-link")) $("admin-nav-link").hidden = !isAdmin;

    await carregarDashboards();
    if (isAdmin) await carregarAdministracao();
  } catch (error) {
    console.error(error);
    showMessage("dashboard-message", friendlyError(error));
  }
}

// ==================================================
// DASHBOARDS E FILTROS
// ==================================================

async function carregarDashboards() {
  clearMessage("dashboard-message");
  const grid = $("dashboard-grid");
  if (!grid) return;
  grid.replaceChildren();

  const { data, error } = await sb.from("dashboards")
    .select("id, name, description, category, url").order("name");
  if (error) throw error;
  allDashboards = data || [];

  allDashboards.forEach(d => {
    const card = document.createElement("article");
    card.className = "dashboard-card";
    const title = document.createElement("h3");
    title.textContent = d.name || "Dashboard sem nome";
    const desc = document.createElement("p");
    desc.textContent = d.description || "";
    const cat = document.createElement("p");
    cat.className = "card-category";
    cat.dataset.category = d.category || "outros";
    cat.textContent = "Categoria: " + (d.category || "Outros");
    card.append(title, desc, cat);

    if (isSafeDashboardUrl(d.url)) {
      const link = document.createElement("a");
      link.href = d.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Abrir dashboard";
      card.appendChild(link);
    } else {
      const warning = document.createElement("p");
      warning.textContent = "URL do dashboard inválida.";
      card.appendChild(warning);
    }
    grid.appendChild(card);
  });

  if ($("summary-total")) $("summary-total").textContent = String(allDashboards.length);
  if ($("summary-categories")) {
    $("summary-categories").textContent = String(new Set(allDashboards.map(d => normalize(d.category || "outros"))).size);
  }
  aplicarFiltrosDashboards();
  renderizarDashboardsAdministrativos();
  configurarAcessoSubstituicoes();
}

function aplicarFiltrosDashboards() {
  const grid = $("dashboard-grid");
  if (!grid) return;
  const term = normalize($("dashboard-search")?.value || "");
  const category = normalize($("category-filter")?.value || "");
  let visible = 0;
  [...grid.querySelectorAll(".dashboard-card")].forEach(card => {
    const matches = normalize(card.innerText).includes(term);
    const categoryMatches = !category || normalize(card.querySelector(".card-category")?.dataset.category) === category;
    card.hidden = !(matches && categoryMatches);
    if (!card.hidden) visible++;
  });
  if ($("filter-empty")) $("filter-empty").hidden = visible > 0;
}

if ($("dashboard-search")) $("dashboard-search").addEventListener("input", aplicarFiltrosDashboards);
if ($("category-filter")) $("category-filter").addEventListener("change", aplicarFiltrosDashboards);

// ==================================================
// ADMINISTRAÇÃO E PERMISSÕES
// ==================================================

async function adminCall(action, payload = {}) {
  const { data, error } = await sb.functions.invoke("portal-admin", { body: { action, ...payload } });
  if (error) throw new Error("Falha na operação administrativa. Confira a função portal-admin.");
  if (data?.error) throw new Error(data.error);
  return data;
}

async function carregarAdministracao() {
  try {
    const result = await adminCall("list_users");
    adminUsers = result.users || [];
    preencherListaUsuarios();
    renderizarDashboardsAdministrativos();
  } catch (error) {
    showMessage("permission-message", friendlyError(error));
  }
}

function preencherListaUsuarios() {
  const select = $("permission-user");
  if (!select) return;
  const previous = select.value;
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Selecione um usuário";
  select.appendChild(placeholder);
  adminUsers.forEach(user => {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = `${user.email || "Sem e-mail"} — ${user.role || "user"}`;
    select.appendChild(option);
  });
  if (adminUsers.some(u => u.id === previous)) select.value = previous;
  if (select.value) carregarPermissoesUsuario();
}

if ($("user-create-form")) $("user-create-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  setLoading(button, true, "Criando usuário...");
  try {
    const email = $("new-user-email")?.value.trim();
    const password = $("new-user-password")?.value;
    const role = $("new-user-role")?.value;
    if (!email || !password || !role) throw new Error("Preencha todos os campos do usuário.");
    await adminCall("create_user", { email, password, role });
    $("user-create-form").reset();
    showMessage("user-create-message", "Usuário criado com sucesso!", "success");
    await carregarAdministracao();
  } catch (error) {
    showMessage("user-create-message", friendlyError(error));
  } finally {
    setLoading(button, false);
  }
});

if ($("permission-user")) $("permission-user").addEventListener("change", carregarPermissoesUsuario);

async function carregarPermissoesUsuario() {
  clearMessage("permission-message");
  const userId = $("permission-user")?.value;
  const container = $("permission-dashboard-list");
  if (!container) return;
  container.replaceChildren();
  if (!userId) return;
  const user = adminUsers.find(u => u.id === userId);
  if (!user) return;
  if (user.role === "admin") {
    showMessage("permission-message", "Administradores possuem acesso a todos os dashboards.", "success");
    return;
  }
  try {
    const { data: permissions, error } = await sb.from("dashboard_permissions")
      .select("dashboard_id").eq("user_id", userId);
    if (error) throw error;
    const ids = new Set((permissions || []).map(p => p.dashboard_id));
    const { data: dashboards, error: dError } = await sb.from("dashboards")
      .select("id, name, description, category, url").order("name");
    if (dError) throw dError;
    (dashboards || []).forEach(d => {
      const label = document.createElement("label");
      label.className = "permission-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = d.id;
      input.checked = ids.has(d.id);
      const span = document.createElement("span");
      span.textContent = d.name || "Dashboard sem nome";
      label.append(input, span);
      container.appendChild(label);
    });
  } catch (error) {
    showMessage("permission-message", friendlyError(error));
  }
}

if ($("save-permissions-btn")) $("save-permissions-btn").addEventListener("click", async () => {
  const userId = $("permission-user")?.value;
  if (!userId) return showMessage("permission-message", "Selecione um usuário primeiro.");
  const user = adminUsers.find(u => u.id === userId);
  if (user?.role === "admin") return showMessage("permission-message", "Administradores já possuem acesso a todos os dashboards.");
  const button = $("save-permissions-btn");
  setLoading(button, true, "Salvando...");
  try {
    const ids = [...$("permission-dashboard-list").querySelectorAll('input[type="checkbox"]:checked')].map(i => i.value);
    await adminCall("set_permissions", { user_id: userId, dashboard_ids: ids });
    showMessage("permission-message", "Permissões salvas com sucesso!", "success");
  } catch (error) {
    showMessage("permission-message", friendlyError(error));
  } finally {
    setLoading(button, false);
  }
});

function renderizarDashboardsAdministrativos() {
  const container = $("admin-dashboard-list");
  if (!container) return;
  container.replaceChildren();
  allDashboards.forEach(d => {
    const item = document.createElement("article");
    item.className = "admin-dashboard-item";
    const title = document.createElement("strong");
    title.textContent = d.name || "Dashboard sem nome";
    const desc = document.createElement("p");
    desc.textContent = `${d.category || "outros"} — ID: ${d.id}`;
    item.append(title, desc);
    container.appendChild(item);
  });
}

if ($("dashboard-form")) $("dashboard-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  setLoading(button, true, "Salvando...");
  try {
    const d = {
      id: $("dashboard-id").value.trim(),
      name: $("dashboard-name").value.trim(),
      description: $("dashboard-description").value.trim(),
      category: $("dashboard-category").value,
      url: $("dashboard-url").value.trim()
    };
    if (!d.id || !d.name || !d.description || !isSafeDashboardUrl(d.url)) {
      throw new Error("Preencha todos os campos e informe uma URL válida.");
    }
    const { error } = await sb.from("dashboards").upsert(d, { onConflict: "id" });
    if (error) throw error;
    showMessage("dashboard-form-message", "Dashboard salvo com sucesso!", "success");
    $("dashboard-form").reset();
    await carregarDashboards();
    if (currentProfile?.role === "admin") await carregarAdministracao();
  } catch (error) {
    showMessage("dashboard-form-message", friendlyError(error));
  } finally {
    setLoading(button, false);
  }
});

// ==================================================
// SUBSTITUIÇÕES — ACESSO E CARREGAMENTO
// ==================================================

function dashboardEhSubstituicoes(d) {
  const nome = normalize(d?.name);
  const id = normalize(d?.id);
  return nome.includes("bi de substituicoes") || nome.includes("bi substituicoes") ||
    id === "bi_substituicoes" || id === "bi-substituicoes";
}

function configurarAcessoSubstituicoes() {
  const section = $("substituicoes-section");
  const nav = $("substituicoes-nav-link");
  if (!section || !nav) return;
  const allowed = currentProfile?.role === "admin" || allDashboards.some(dashboardEhSubstituicoes);
  section.hidden = !allowed;
  nav.hidden = !allowed;
  if (allowed && !subInicializado) {
    subInicializado = true;
    prepararInterfaceSubstituicoes();
    carregarSubstituicoes().catch(e => mostrarErroSubstituicoes(friendlyError(e)));
  }
}

function prepararInterfaceSubstituicoes() {
  if ($("substituicoes-atualizar")) $("substituicoes-atualizar").addEventListener("click", async () => {
    const b = $("substituicoes-atualizar");
    setLoading(b, true, "Atualizando...");
    try { await carregarSubstituicoes(); }
    catch (e) { mostrarErroSubstituicoes(friendlyError(e)); }
    finally { setLoading(b, false); }
  });
  ["sub-filtro-subsede", "sub-filtro-ano", "sub-filtro-situacao"].forEach(id => {
    if ($(id)) $(id).addEventListener("change", renderizarBISelecionado);
  });
}

function mostrarErroSubstituicoes(message) {
  if (!$("substituicoes-message")) return;
  $("substituicoes-message").textContent = message;
  $("substituicoes-message").className = "message-error";
}

async function carregarSubstituicoes() {
  if (!sb || !currentUser || !currentProfile) return;
  const msg = $("substituicoes-message");
  if (msg) {
    msg.textContent = "Carregando dados de substituições...";
    msg.className = "";
  }

  const all = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await sb.from(SUB_VIEW)
      .select(SUB_FIELDS.join(","))
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  subRegistros = all.map(normalizarRegistroSubstituicao);
  preencherFiltrosSubstituicoes();
  if (msg) {
    msg.textContent = `${subRegistros.length.toLocaleString("pt-BR")} registros carregados.`;
    msg.className = "message-success";
  }
  renderizarBISelecionado();
}

// ==================================================
// CLASSIFICAÇÃO CORRIGIDA
// ==================================================

function normalizarRegistroSubstituicao(row) {
  const situacao = normalize(row.situacao_substituicao);
  const status = normalize(row.status_da_substituicao);
  const jovemFoiSubstituido = normalize(row.jovem_foi_substituido);
  const outroRaw = normalize(row.substituido_em_outro_fechamento);
  const faixa = normalize(row.faixa_de_atraso);
  const prazo = normalize(row.dentro_do_prazo);
  const prioridade = normalize(row.prioridade);

  const outroFechamento = ehSim(outroRaw);
  const sinalRealizada =
    situacao.includes("substituido realizado") ||
    status.includes("realizado") ||
    (temValor(jovemFoiSubstituido) && !ehNao(jovemFoiSubstituido)) ||
    temValor(row.jovem_substituto) ||
    outroFechamento ||
    (temValor(row.fechamento_da_substituicao) &&
      !ehNao(row.fechamento_da_substituicao));

  // A situação "Não substituído" prevalece quando não há evidência
  // confiável de substituição concluída.
  const declaradaPendente =
    situacao.includes("nao substituido") ||
    status.includes("nao substituido");

  const realizada = sinalRealizada && !declaradaPendente;
  const dias = numeroSeguro(row.dias_pendentes) ??
    numeroSeguro(row.dias_em_aberto) ??
    numeroSeguro(row.dias_ate_substituicao);

  // "No fechamento" não é atraso. Faixas a partir de 31 dias são atraso.
  const faixaNoFechamento = faixa.includes("no fechamento");
  const faixaAtrasada =
    /31 a 60|61 a 90|mais de 90|acima de 90|acima de 60|mais de 60|atraso/.test(faixa);

  const atrasada = !realizada && !faixaNoFechamento && (
    faixaAtrasada ||
    (!faixa && (dias !== null && dias > 30)) ||
    (prazo === "nao" && dias !== null && dias > 30) ||
    prioridade.includes("atras")
  );

  const periodoOutroConhecido = ["sim", "nao"].includes(outroRaw);
  const realizadaOutro = realizada && outroFechamento;
  const realizadaCerta = realizada && !outroFechamento;

  const mes = valorTexto(
    row.mes_fechamento ||
    row.periodo_fechamento ||
    row.mes_fechamento_da_substituicao ||
    row.mes_ano_desligamento ||
    row.mes_da_substituicao,
    "Sem mês"
  );

  const anoInformado = valorTexto(row.ano_fechamento, "");
  const anoExtraido = String(
    row.periodo_fechamento || row.mes_fechamento ||
    row.mes_ano_desligamento || row.data_desligamento || ""
  ).match(/20\d{2}/)?.[0] || "Sem ano";

  return {
    ...row,
    _realizada: realizada,
    _realizadaCerta: realizadaCerta,
    _realizadaOutro: realizadaOutro,
    _periodoOutroConhecido: periodoOutroConhecido,
    _atrasada: atrasada,
    _situacao: realizada ? "realizada" : atrasada ? "atrasada" : "pendente",
    _dias: dias,
    _mes: mes,
    _ano: anoInformado || anoExtraido,
    _prioridade: realizada ? "🟢 Resolvida" : valorTexto(row.prioridade)
  };
}

// ==================================================
// FILTROS E RENDERIZAÇÃO
// ==================================================

function preencherFiltrosSubstituicoes() {
  const subsedeSelect = $("sub-filtro-subsede");
  if (subsedeSelect) {
    const current = subsedeSelect.value;
    const values = [...new Set(subRegistros.map(r => String(r.subsede || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    subsedeSelect.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "Todas as subsedes";
    subsedeSelect.appendChild(all);
    values.forEach(v => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      subsedeSelect.appendChild(o);
    });
    if (values.includes(current)) subsedeSelect.value = current;
  }

  const anoSelect = $("sub-filtro-ano");
  if (anoSelect) {
    const current = anoSelect.value;
    const values = [...new Set(subRegistros.map(r => r._ano).filter(a => a && a !== "Sem ano"))]
      .sort((a, b) => b.localeCompare(a, "pt-BR", { numeric: true }));
    anoSelect.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "Todos os anos";
    anoSelect.appendChild(all);
    values.forEach(v => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      anoSelect.appendChild(o);
    });
    if (values.includes(current)) anoSelect.value = current;
  }
}

function obterRegistrosFiltrados() {
  const subsede = $("sub-filtro-subsede")?.value || "";
  const ano = $("sub-filtro-ano")?.value || "";
  const situacao = $("sub-filtro-situacao")?.value || "";
  return subRegistros.filter(r =>
    (!subsede || String(r.subsede || "") === subsede) &&
    (!ano || r._ano === ano) &&
    (!situacao || r._situacao === situacao)
  );
}

function renderizarBISelecionado() {
  const rows = obterRegistrosFiltrados();
  atualizarIndicadoresSubstituicoes(rows);
  renderizarGraficosSubstituicoes(rows);
  renderizarTabelaSubstituicoes(rows);
}

function atualizarIndicadoresSubstituicoes(rows) {
  const total = rows.length;
  const realizadas = rows.filter(r => r._realizada).length;
  const pendentes = rows.filter(r => !r._realizada).length;
  const atrasadas = rows.filter(r => r._atrasada).length;
  const certas = rows.filter(r => r._realizadaCerta).length;
  const outras = rows.filter(r => r._realizadaOutro).length;

  const values = {
    "sub-total": total,
    "sub-realizadas": realizadas,
    "sub-pendentes": pendentes,
    "sub-atrasadas": atrasadas,
    "sub-periodo-certo": certas,
    "sub-outro-periodo": outras
  };

  Object.entries(values).forEach(([id, value]) => {
    if ($(id)) $(id).textContent = value.toLocaleString("pt-BR");
  });
}

// ==================================================
// GRÁFICOS CHART.JS
// ==================================================

function destruirGraficosSubstituicoes() {
  Object.values(subGraficos).forEach(c => c?.destroy?.());
  subGraficos = {};
}

function criarGraficoSubstituicoes(id, config) {
  const canvas = $(id);
  if (!canvas || typeof Chart === "undefined") return;
  if (subGraficos[id]) subGraficos[id].destroy();
  subGraficos[id] = new Chart(canvas, config);
}

function agruparContagem(rows, keyFn) {
  const map = new Map();
  rows.forEach(r => {
    const label = String(keyFn(r) || "Não informado").trim();
    map.set(label, (map.get(label) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function opcoesGraficoSubstituicoes() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: "index" },
    plugins: { legend: { position: "bottom" } },
    scales: {
      x: { ticks: { maxRotation: 45, minRotation: 0 }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { precision: 0 } }
    }
  };
}

function renderizarGraficosSubstituicoes(rows) {
  if (typeof Chart === "undefined") {
    mostrarErroSubstituicoes("A biblioteca Chart.js não carregou.");
    return;
  }

  const meses = agruparContagem(rows, r => r._mes);
  const datasets = [
    { label: "Fechadas no período correto", key: r => r._realizadaCerta, color: "#16835b" },
    { label: "Fechadas em outro período", key: r => r._realizadaOutro, color: "#7b61a8" },
    { label: "Pendentes", key: r => !r._realizada && !r._atrasada, color: "#3678c8" },
    { label: "Em atraso", key: r => r._atrasada, color: "#c94c4c" }
  ];

  criarGraficoSubstituicoes("sub-grafico-mensal", {
    type: "line",
    data: {
      labels: meses.map(m => m[0]),
      datasets: datasets.map(d => ({
        label: d.label,
        data: meses.map(([mes]) => rows.filter(r => r._mes === mes && d.key(r)).length),
        borderColor: d.color,
        backgroundColor: d.color + "20",
        tension: 0.25
      }))
    },
    options: opcoesGraficoSubstituicoes()
  });

  const subsedes = agruparContagem(rows, r => r.subsede).slice(0, 12);
  criarGraficoSubstituicoes("sub-grafico-subsede", {
    type: "bar",
    data: {
      labels: subsedes.map(x => x[0]),
      datasets: [{ label: "Registros", data: subsedes.map(x => x[1]), backgroundColor: "#3678c8", borderRadius: 5 }]
    },
    options: { ...opcoesGraficoSubstituicoes(), indexAxis: "y" }
  });

  const motivos = agruparContagem(rows, r => r.motivo || "Não informado").slice(0, 10);
  criarGraficoSubstituicoes("sub-grafico-motivos", {
    type: "bar",
    data: {
      labels: motivos.map(x => x[0]),
      datasets: [{ label: "Registros", data: motivos.map(x => x[1]), backgroundColor: "#244b78", borderRadius: 5 }]
    },
    options: { ...opcoesGraficoSubstituicoes(), indexAxis: "y" }
  });

  const certas = rows.filter(r => r._realizadaCerta).length;
  const outras = rows.filter(r => r._realizadaOutro).length;
  const pendentes = rows.filter(r => !r._realizada && !r._atrasada).length;
  const atrasadas = rows.filter(r => r._atrasada).length;

  criarGraficoSubstituicoes("sub-grafico-situacao", {
    type: "doughnut",
    data: {
      labels: ["Fechadas no período correto", "Fechadas em outro período", "Pendentes", "Em atraso"],
      datasets: [{
        data: [certas, outras, pendentes, atrasadas],
        backgroundColor: ["#16835b", "#7b61a8", "#3678c8", "#c94c4c"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } }
    }
  });
}

// ==================================================
// TABELA DE DETALHAMENTO
// ==================================================

function renderizarTabelaSubstituicoes(rows) {
  const tbody = $("sub-tabela-corpo");
  const contagem = $("sub-tabela-contagem");
  if (!tbody) return;
  tbody.replaceChildren();
  if (contagem) contagem.textContent = `${rows.length.toLocaleString("pt-BR")} registros`;

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.textContent = "Nenhum registro encontrado para os filtros selecionados.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  const sorted = [...rows].sort((a, b) => (b._dias ?? -1) - (a._dias ?? -1));
  sorted.slice(0, 500).forEach(r => {
    const tr = document.createElement("tr");
    const situacao = r._realizada
      ? (r._realizadaOutro ? "Fechada em outro período" : "Fechada no período correto")
      : r._atrasada ? "Em atraso" : "Pendente";

    const cells = [
      r.subsede, r.jovem, r.empresa, r.motivo,
      r.mes_fechamento || r.periodo_fechamento || r.mes_da_substituicao,
      r._dias, situacao, r._prioridade
    ];

    cells.forEach((value, index) => {
      const td = document.createElement("td");
      td.textContent = index === 5 && (value === null || value === undefined)
        ? "—" : valorTexto(value);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  if (sorted.length > 500) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.textContent = `Exibindo 500 de ${sorted.length.toLocaleString("pt-BR")} registros. Use os filtros para refinar a consulta.`;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}
