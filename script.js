"use strict";

const sb = window.sb;
const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let allDashboards = [];
let adminUsers = [];

const SUB_VIEW = "vw_substituicoes_bi";
const SUB_PAGE_SIZE = 20;
const EAD_TABLE = "ead_analise_geografica";
const EAD_PAGE_SIZE = 20;

const SUB_FIELDS = [
  "id", "subsede", "cidade", "angariador", "jovem", "empresa", "motivo",
  "situacao_substituicao", "status_da_substituicao", "jovem_foi_substituido",
  "jovem_substituto", "inicio_substituto", "fim_substituto",
  "data_desligamento", "mes_ano_desligamento", "periodo",
  "mes_da_substituicao", "dias_ate_substituicao", "dentro_do_prazo",
  "faixa_de_atraso", "prioridade", "inicio_fechamento", "fim_fechamento",
  "periodo_fechamento", "mes_fechamento", "numero_mes_fechamento",
  "ano_fechamento", "mes_fechamento_da_substituicao",
  "fechamento_da_substituicao", "dias_pendentes", "dias_em_aberto",
  "substituido_em_outro_fechamento", "ultima_atualizacao"
];

const EAD_FIELDS = [
  "id", "municipio", "uf", "potencial_cota", "latitude_municipio",
  "longitude_municipio", "ponto_mais_proximo", "uf_ponto", "tipo_ponto",
  "subsede_responsavel", "distancia_km", "classificacao_distancia",
  "classificacao_potencial", "status_calculo", "atualizado_em",
  "cursos_validados", "protocolos"
];

let subRegistros = [];
let subGraficos = {};
let subInicializado = false;
let subPaginaAtual = 1;

let eadRegistros = [];
let eadInicializado = false;
let eadPaginaAtual = 1;

// ==================================================
// FUNÇÕES GERAIS
// ==================================================

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
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }
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
    .replace(/[🔴🟢🟠🔵🟡⚪]/g, "")
    .toLowerCase()
    .trim();
}

function valorTexto(value, fallback = "—") {
  return value === null || value === undefined || String(value).trim() === ""
    ? fallback
    : String(value).trim();
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
  return ["nao", "no", "false", "0", "pendente", "nao substituido", "nao realizada"].includes(normalize(value));
}

function temValor(value) {
  const v = normalize(value);
  return !!v && ![
    "—", "-", "null", "undefined", "nao", "false", "0",
    "pendente", "nao substituido", "nao realizada"
  ].includes(v);
}

function definirMensagemSubstituicoes(message, type = "success") {
  const el = $("substituicoes-message");
  if (!el) return;
  el.textContent = message;
  el.className = type === "error" ? "message-error" : "message-success";
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
    if (event === "SIGNED_IN" && session) {
      setTimeout(() => atualizarPortal(), 0);
    }

    if (event === "SIGNED_OUT") {
      currentUser = null;
      currentProfile = null;
      allDashboards = [];
      adminUsers = [];

      subRegistros = [];
      subInicializado = false;
      subPaginaAtual = 1;

      eadRegistros = [];
      eadInicializado = false;
      eadPaginaAtual = 1;

      destruirGraficosSubstituicoes();
      destruirMapaEaD();
      mostrarLogin();
    }
  });
}

function mostrarLogin() {
  [
    "portal-section", "admin-section", "admin-nav-link",
    "substituicoes-section", "substituicoes-nav-link",
    "ead-section", "ead-nav-link"
  ].forEach(id => {
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

if ($("login-form")) {
  $("login-form").addEventListener("submit", async event => {
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
}

if ($("logout-btn")) {
  $("logout-btn").addEventListener("click", async () => {
    try {
      const { error } = await sb.auth.signOut();
      if (error) throw error;
      mostrarLogin();
    } catch (error) {
      showMessage("dashboard-message", friendlyError(error));
    }
  });
}

async function atualizarPortal() {
  try {
    const { data: { user }, error: userError } = await sb.auth.getUser();
    if (userError) throw userError;
    if (!user) return mostrarLogin();

    currentUser = user;

    const { data: profile, error: profileError } = await sb
      .from("profiles")
      .select("id, email, role")
      .eq("id", user.id)
      .maybeSingle();

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

  const { data, error } = await sb
    .from("dashboards")
    .select("id, name, description, category, url")
    .order("name");

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
      card.append(link);
    } else {
      const warning = document.createElement("p");
      warning.textContent = "URL do dashboard inválida.";
      card.appendChild(warning);
    }

    grid.appendChild(card);
  });

  if ($("summary-total")) $("summary-total").textContent = String(allDashboards.length);

  if ($("summary-categories")) {
    $("summary-categories").textContent = String(
      new Set(allDashboards.map(d => normalize(d.category || "outros"))).size
    );
  }

  aplicarFiltrosDashboards();
  renderizarDashboardsAdministrativos();
  configurarAcessoSubstituicoes();
  configurarAcessoEaD();
}

function aplicarFiltrosDashboards() {
  const grid = $("dashboard-grid");
  if (!grid) return;

  const term = normalize($("dashboard-search")?.value || "");
  const category = normalize($("category-filter")?.value || "");
  let visible = 0;

  [...grid.querySelectorAll(".dashboard-card")].forEach(card => {
    const matches = normalize(card.innerText).includes(term);
    const categoryMatches = !category ||
      normalize(card.querySelector(".card-category")?.dataset.category) === category;

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
  const { data, error } = await sb.functions.invoke("portal-admin", {
    body: { action, ...payload }
  });

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

if ($("user-create-form")) {
  $("user-create-form").addEventListener("submit", async event => {
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
}

if ($("permission-user")) {
  $("permission-user").addEventListener("change", carregarPermissoesUsuario);
}

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
    const { data: permissions, error } = await sb
      .from("dashboard_permissions")
      .select("dashboard_id")
      .eq("user_id", userId);

    if (error) throw error;
    const ids = new Set((permissions || []).map(p => p.dashboard_id));

    const { data: dashboards, error: dError } = await sb
      .from("dashboards")
      .select("id, name, description, category, url")
      .order("name");

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

if ($("save-permissions-btn")) {
  $("save-permissions-btn").addEventListener("click", async () => {
    const userId = $("permission-user")?.value;

    if (!userId) {
      return showMessage("permission-message", "Selecione um usuário primeiro.");
    }

    const user = adminUsers.find(u => u.id === userId);
    if (user?.role === "admin") {
      return showMessage("permission-message", "Administradores já possuem acesso a todos os dashboards.");
    }

    const button = $("save-permissions-btn");
    setLoading(button, true, "Salvando...");

    try {
      const ids = [...$("permission-dashboard-list").querySelectorAll('input[type="checkbox"]:checked')]
        .map(i => i.value);

      await adminCall("set_permissions", { user_id: userId, dashboard_ids: ids });
      showMessage("permission-message", "Permissões salvas com sucesso!", "success");
    } catch (error) {
      showMessage("permission-message", friendlyError(error));
    } finally {
      setLoading(button, false);
    }
  });
}

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

if ($("dashboard-form")) {
  $("dashboard-form").addEventListener("submit", async event => {
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
}

// ==================================================
// SUBSTITUIÇÕES — ACESSO
// ==================================================

function dashboardEhSubstituicoes(d) {
  const nome = normalize(d?.name);
  const id = normalize(d?.id);
  return nome.includes("bi de substituicoes") ||
    nome.includes("bi substituicoes") ||
    id === "bi_substituicoes" ||
    id === "bi-substituicoes";
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
    carregarSubstituicoes().catch(error => mostrarErroSubstituicoes(friendlyError(error)));
  }
}

function prepararInterfaceSubstituicoes() {
  if ($("substituicoes-atualizar")) {
    $("substituicoes-atualizar").addEventListener("click", async () => {
      const button = $("substituicoes-atualizar");
      setLoading(button, true, "Atualizando...");
      try {
        await carregarSubstituicoes();
      } catch (error) {
        mostrarErroSubstituicoes(friendlyError(error));
      } finally {
        setLoading(button, false);
      }
    });
  }

  [
    "sub-filtro-subsede", "sub-filtro-angariador", "sub-filtro-ano",
    "sub-filtro-periodo-fechamento", "sub-filtro-situacao"
  ].forEach(id => {
    if ($(id)) $(id).addEventListener("change", () => {
      subPaginaAtual = 1;
      renderizarBISelecionado();
    });
  });

  if ($("sub-pagina-anterior")) {
    $("sub-pagina-anterior").addEventListener("click", () => {
      if (subPaginaAtual > 1) {
        subPaginaAtual--;
        renderizarBISelecionado();
      }
    });
  }

  if ($("sub-pagina-proxima")) {
    $("sub-pagina-proxima").addEventListener("click", () => {
      const totalPaginas = Math.max(1, Math.ceil(obterRegistrosFiltrados().length / SUB_PAGE_SIZE));
      if (subPaginaAtual < totalPaginas) {
        subPaginaAtual++;
        renderizarBISelecionado();
      }
    });
  }
}

function mostrarErroSubstituicoes(message) {
  definirMensagemSubstituicoes(message, "error");
}

async function carregarSubstituicoes() {
  if (!sb || !currentUser || !currentProfile) return;
  definirMensagemSubstituicoes("Carregando dados de substituições...");

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
  subPaginaAtual = 1;
  preencherFiltrosSubstituicoes();

  definirMensagemSubstituicoes(`${subRegistros.length.toLocaleString("pt-BR")} registros carregados.`);
  renderizarBISelecionado();
}

function normalizarRegistroSubstituicao(row) {
  const situacao = normalize(row.situacao_substituicao);
  const status = normalize(row.status_da_substituicao);
  const jovemFoiSubstituido = normalize(row.jovem_foi_substituido);
  const outroFechamento = ehSim(row.substituido_em_outro_fechamento);
  const faixa = normalize(row.faixa_de_atraso);
  const prazo = normalize(row.dentro_do_prazo);

  const sinalRealizada =
    situacao.includes("substituido realizado") ||
    status.includes("realizado") ||
    (temValor(jovemFoiSubstituido) && !ehNao(jovemFoiSubstituido)) ||
    temValor(row.jovem_substituto) ||
    outroFechamento ||
    (temValor(row.fechamento_da_substituicao) && !ehNao(row.fechamento_da_substituicao));

  const declaradaPendente =
    situacao.includes("nao substituido") ||
    status.includes("nao substituido") ||
    situacao.includes("nao realizada") ||
    status.includes("nao realizada");

  const realizada = sinalRealizada && !declaradaPendente;

  const dias = numeroSeguro(row.dias_pendentes) ??
    numeroSeguro(row.dias_em_aberto) ??
    numeroSeguro(row.dias_ate_substituicao);

  const faixaNoFechamento = faixa.includes("no fechamento");
  const faixaAtrasada = /31 a 60|61 a 90|mais de 90|acima de 90|acima de 60|mais de 60|atraso/.test(faixa);

  const atrasada = !realizada && !faixaNoFechamento &&
    ((dias !== null && dias > 30) || (dias === null && faixaAtrasada && prazo !== "sim"));

  const periodoFechamento = valorTexto(row.periodo_fechamento, "");
  const mes = valorTexto(
    row.mes_fechamento || periodoFechamento || row.mes_fechamento_da_substituicao ||
    row.mes_ano_desligamento || row.mes_da_substituicao,
    "Sem mês"
  );

  const anoExtraido = String(
    periodoFechamento || row.mes_fechamento || row.mes_ano_desligamento ||
    row.data_desligamento || ""
  ).match(/20\d{2}/)?.[0] || "Sem ano";

  return {
    ...row,
    _realizada: realizada,
    _realizadaCerta: realizada && !outroFechamento,
    _realizadaOutro: realizada && outroFechamento,
    _atrasada: atrasada,
    _situacao: realizada ? "realizada" : atrasada ? "atrasada" : "pendente",
    _dias: dias,
    _mes: mes,
    _ano: valorTexto(row.ano_fechamento, "") || anoExtraido,
    _periodoFechamento: periodoFechamento,
    _prioridade: realizada ? "Resolvida" : atrasada ? "Atrasada" : valorTexto(row.prioridade, "Normal")
  };
}

// ==================================================
// FILTROS DINÂMICOS
// ==================================================

function preencherSelectDinamico({ id, values, placeholder, preserveValue = true, descending = false }) {
  const select = $(id);
  if (!select) return;

  const current = preserveValue ? select.value : "";
  const unique = [...new Set(values.map(v => String(v ?? "").trim()).filter(Boolean))];

  unique.sort((a, b) => descending
    ? b.localeCompare(a, "pt-BR", { numeric: true })
    : a.localeCompare(b, "pt-BR", { numeric: true }));

  select.replaceChildren();

  const optionAll = document.createElement("option");
  optionAll.value = "";
  optionAll.textContent = placeholder;
  select.appendChild(optionAll);

  unique.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });

  if (unique.includes(current)) select.value = current;
}

function preencherFiltrosSubstituicoes() {
  preencherSelectDinamico({ id: "sub-filtro-subsede", values: subRegistros.map(r => r.subsede), placeholder: "Todas as subsedes" });
  preencherSelectDinamico({ id: "sub-filtro-angariador", values: subRegistros.map(r => r.angariador), placeholder: "Todos os angariadores" });
  preencherSelectDinamico({ id: "sub-filtro-ano", values: subRegistros.map(r => r._ano).filter(a => a && a !== "Sem ano"), placeholder: "Todos os anos", descending: true });
  preencherSelectDinamico({ id: "sub-filtro-periodo-fechamento", values: subRegistros.map(r => r._periodoFechamento), placeholder: "Todos os períodos", descending: true });
}

function obterRegistrosFiltrados() {
  const subsede = $("sub-filtro-subsede")?.value || "";
  const angariador = $("sub-filtro-angariador")?.value || "";
  const ano = $("sub-filtro-ano")?.value || "";
  const periodo = $("sub-filtro-periodo-fechamento")?.value || "";
  const situacao = $("sub-filtro-situacao")?.value || "";

  return subRegistros.filter(r =>
    (!subsede || String(r.subsede || "").trim() === subsede) &&
    (!angariador || String(r.angariador || "").trim() === angariador) &&
    (!ano || r._ano === ano) &&
    (!periodo || r._periodoFechamento === periodo) &&
    (!situacao || r._situacao === situacao)
  );
}

function renderizarBISelecionado() {
  const rows = obterRegistrosFiltrados();
  const totalPaginas = Math.max(1, Math.ceil(rows.length / SUB_PAGE_SIZE));
  if (subPaginaAtual > totalPaginas) subPaginaAtual = totalPaginas;

  atualizarIndicadoresSubstituicoes(rows);
  renderizarGraficosSubstituicoes(rows);
  renderizarTabelaSubstituicoes(rows);
}

function atualizarIndicadoresSubstituicoes(rows) {
  const values = {
    "sub-total": rows.length,
    "sub-realizadas": rows.filter(r => r._realizada).length,
    "sub-pendentes": rows.filter(r => !r._realizada && !r._atrasada).length,
    "sub-atrasadas": rows.filter(r => r._atrasada).length
  };

  Object.entries(values).forEach(([id, value]) => {
    if ($(id)) $(id).textContent = value.toLocaleString("pt-BR");
  });
}

// ==================================================
// GRÁFICOS DE SUBSTITUIÇÕES
// ==================================================

function destruirGraficosSubstituicoes() {
  Object.values(subGraficos).forEach(chart => chart?.destroy?.());
  subGraficos = {};
}

const pluginRotulosSubstituicoes = {
  id: "rotulosSubstituicoes",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = "600 11px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (meta.hidden) return;

      meta.data.forEach((element, index) => {
        const value = dataset.data[index];
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
        if (chart.config.type === "doughnut" && Number(value) === 0) return;

        const position = element.tooltipPosition();
        const isHorizontal = chart.options.indexAxis === "y";

        ctx.fillStyle = chart.config.type === "doughnut" ? "#ffffff" : "#263746";
        ctx.textAlign = isHorizontal ? "left" : "center";

        const x = isHorizontal ? position.x + 7 : position.x;
        const y = isHorizontal ? position.y : position.y - 10;
        ctx.fillText(Number(value).toLocaleString("pt-BR"), x, y);
      });
    });

    ctx.restore();
  }
};

function criarGraficoSubstituicoes(id, config) {
  const canvas = $(id);
  if (!canvas || typeof Chart === "undefined") return;

  if (subGraficos[id]) subGraficos[id].destroy();

  subGraficos[id] = new Chart(canvas, {
    ...config,
    plugins: [...(config.plugins || []), pluginRotulosSubstituicoes]
  });
}

function agruparContagem(rows, keyFn) {
  const map = new Map();

  rows.forEach(row => {
    const label = String(keyFn(row) || "Não informado").trim();
    map.set(label, (map.get(label) || 0) + 1);
  });

  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function ordenarPeriodosMensais(periodos) {
  const meses = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

  return [...periodos].sort((a, b) => {
    const anoA = Number(String(a[0]).match(/20\d{2}/)?.[0] || 0);
    const anoB = Number(String(b[0]).match(/20\d{2}/)?.[0] || 0);
    if (anoA !== anoB) return anoA - anoB;

    const mesA = normalize(a[0]);
    const mesB = normalize(b[0]);
    const indexA = meses.findIndex(m => mesA.includes(m));
    const indexB = meses.findIndex(m => mesB.includes(m));

    if (indexA !== -1 && indexB !== -1 && indexA !== indexB) return indexA - indexB;
    return String(a[0]).localeCompare(String(b[0]), "pt-BR", { numeric: true });
  });
}

function opcoesGraficoSubstituicoes() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: "index" },
    plugins: { legend: { position: "bottom" }, tooltip: { enabled: true } },
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

  const meses = ordenarPeriodosMensais(agruparContagem(rows, r => r._mes));
  const datasets = [
    { label: "Fechadas no período correto", key: r => r._realizadaCerta, color: "#16835b" },
    { label: "Fechadas em outro período", key: r => r._realizadaOutro, color: "#7b61a8" },
    { label: "Pendentes", key: r => !r._realizada && !r._atrasada, color: "#3678c8" },
    { label: "Em atraso", key: r => r._atrasada, color: "#c94c4c" }
  ];

  criarGraficoSubstituicoes("sub-grafico-mensal", {
    type: "line",
    data: {
      labels: meses.map(item => item[0]),
      datasets: datasets.map(d => ({
        label: d.label,
        data: meses.map(([mes]) => rows.filter(r => r._mes === mes && d.key(r)).length),
        borderColor: d.color,
        backgroundColor: d.color + "20",
        pointBackgroundColor: d.color,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
        tension: 0.25
      }))
    },
    options: opcoesGraficoSubstituicoes()
  });

  const subsedes = agruparContagem(rows, r => r.subsede).slice(0, 12);
  criarGraficoSubstituicoes("sub-grafico-subsede", {
    type: "bar",
    data: {
      labels: subsedes.map(i => i[0]),
      datasets: [{ label: "Registros", data: subsedes.map(i => i[1]), backgroundColor: "#3678c8", borderRadius: 5 }]
    },
    options: { ...opcoesGraficoSubstituicoes(), indexAxis: "y" }
  });

  const motivos = agruparContagem(rows, r => r.motivo || "Não informado").slice(0, 10);
  criarGraficoSubstituicoes("sub-grafico-motivos", {
    type: "bar",
    data: {
      labels: motivos.map(i => i[0]),
      datasets: [{ label: "Registros", data: motivos.map(i => i[1]), backgroundColor: "#244b78", borderRadius: 5 }]
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
      plugins: { legend: { position: "bottom" }, tooltip: { enabled: true } }
    }
  });
}

// ==================================================
// TABELA E PAGINAÇÃO DE SUBSTITUIÇÕES
// ==================================================

function criarCelulaTabela(value, row) {
  const td = document.createElement("td");
  td.textContent = valorTexto(value);
  if (row) td.title = String(value ?? "");
  return td;
}

function renderizarTabelaSubstituicoes(rows) {
  const tbody = $("sub-tabela-corpo");
  const contagem = $("sub-tabela-contagem");
  if (!tbody) return;
  tbody.replaceChildren();

  if (contagem) contagem.textContent = `${rows.length.toLocaleString("pt-BR")} registros`;

  const sorted = [...rows].sort((a, b) => (b._dias ?? -1) - (a._dias ?? -1));
  const totalPaginas = Math.max(1, Math.ceil(sorted.length / SUB_PAGE_SIZE));
  if (subPaginaAtual > totalPaginas) subPaginaAtual = totalPaginas;
  if (subPaginaAtual < 1) subPaginaAtual = 1;

  if (!sorted.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.textContent = "Nenhum registro encontrado para os filtros selecionados.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    atualizarPaginacaoSubstituicoes(0, 0, 0, 1);
    return;
  }

  const inicio = (subPaginaAtual - 1) * SUB_PAGE_SIZE;
  const fim = Math.min(inicio + SUB_PAGE_SIZE, sorted.length);

  sorted.slice(inicio, fim).forEach(r => {
    const tr = document.createElement("tr");

    const situacao = r._realizada
      ? (r._realizadaOutro ? "Fechada em outro período" : "Fechada no período correto")
      : r._atrasada ? "Em atraso" : "Pendente";

    const fechamento = valorTexto(
      r.periodo_fechamento || r.mes_fechamento || r.fim_fechamento ||
      r.inicio_fechamento || r.mes_da_substituicao
    );

    [
      r.subsede, r.jovem, r.empresa, r.motivo, fechamento,
      r._dias, situacao, r._prioridade
    ].forEach((value, index) => {
      tr.appendChild(criarCelulaTabela(index === 5 && value == null ? "—" : value, r));
    });

    tbody.appendChild(tr);
  });

  atualizarPaginacaoSubstituicoes(sorted.length, inicio + 1, fim, totalPaginas);
}

function atualizarPaginacaoSubstituicoes(total, primeiro, ultimo, totalPaginas) {
  const info = $("sub-paginacao-info");
  const anterior = $("sub-pagina-anterior");
  const proxima = $("sub-pagina-proxima");
  const container = $("sub-paginacao");

  if (info) {
    info.textContent = total
      ? `Exibindo ${primeiro}–${ultimo} de ${total.toLocaleString("pt-BR")} registros · Página ${subPaginaAtual} de ${totalPaginas}`
      : "Nenhum registro para exibir.";
  }

  if (anterior) anterior.disabled = subPaginaAtual <= 1;
  if (proxima) proxima.disabled = subPaginaAtual >= totalPaginas || total === 0;
  if (container) container.hidden = false;
}

// ==================================================
// EaD — ACESSO E INTERFACE
// ==================================================

function dashboardEhEaD(d) {
  const nome = normalize(d?.name);
  const id = normalize(d?.id);
  return nome.includes("analise geografica ead") ||
    nome.includes("analise geografica") ||
    id === "analise_geografica_ead" ||
    id === "analise-geografica-ead" ||
    id === "bi_ead" ||
    id === "bi-ead";
}

function configurarAcessoEaD() {
  const section = $("ead-section");
  const nav = $("ead-nav-link");
  if (!section || !nav) return;

  const allowed = currentProfile?.role === "admin" || allDashboards.some(dashboardEhEaD);
  section.hidden = !allowed;
  nav.hidden = !allowed;

  if (allowed && !eadInicializado) {
    eadInicializado = true;
    prepararInterfaceEaD();
    carregarAnaliseEaD().catch(error => mostrarMensagemEaD(friendlyError(error), "error"));
  }
}

function prepararInterfaceEaD() {
  if ($("ead-atualizar")) {
    $("ead-atualizar").addEventListener("click", async () => {
      const button = $("ead-atualizar");
      setLoading(button, true, "Atualizando...");
      try {
        await carregarAnaliseEaD();
      } catch (error) {
        mostrarMensagemEaD(friendlyError(error), "error");
      } finally {
        setLoading(button, false);
      }
    });
  }

  ["ead-filtro-uf", "ead-filtro-distancia", "ead-filtro-potencial"].forEach(id => {
    if ($(id)) $(id).addEventListener("change", () => {
      eadPaginaAtual = 1;
      renderizarAnaliseEaD();
    });
  });

  if ($("ead-filtro-municipio")) {
    $("ead-filtro-municipio").addEventListener("input", () => {
      eadPaginaAtual = 1;
      renderizarAnaliseEaD();
    });
  }

  if ($("ead-pagina-anterior")) {
    $("ead-pagina-anterior").addEventListener("click", () => {
      if (eadPaginaAtual > 1) {
        eadPaginaAtual--;
        renderizarAnaliseEaD();
      }
    });
  }

  if ($("ead-pagina-proxima")) {
    $("ead-pagina-proxima").addEventListener("click", () => {
      const totalPaginas = Math.max(1, Math.ceil(obterRegistrosEaDFiltrados().length / EAD_PAGE_SIZE));
      if (eadPaginaAtual < totalPaginas) {
        eadPaginaAtual++;
        renderizarAnaliseEaD();
      }
    });
  }
}

function mostrarMensagemEaD(message, type = "success") {
  const el = $("ead-message");
  if (!el) return;
  el.textContent = message;
  el.className = type === "error" ? "message-error" : "message-success";
}

async function carregarAnaliseEaD() {
  if (!sb || !currentUser || !currentProfile) return;
  mostrarMensagemEaD("Carregando análise geográfica EaD...");

  const registros = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await sb.from(EAD_TABLE)
      .select(EAD_FIELDS.join(","))
      .order("municipio")
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    const pagina = data || [];
    registros.push(...pagina);

    if (pagina.length < pageSize) break;
    offset += pageSize;
  }

  eadRegistros = registros;
  eadPaginaAtual = 1;
  preencherFiltrosEaD();
  renderizarAnaliseEaD();

  mostrarMensagemEaD(`${eadRegistros.length.toLocaleString("pt-BR")} municípios carregados.`);
}

function preencherFiltrosEaD() {
  preencherSelectDinamico({ id: "ead-filtro-uf", values: eadRegistros.map(r => r.uf), placeholder: "Todas as UFs" });
  preencherSelectDinamico({ id: "ead-filtro-distancia", values: eadRegistros.map(r => r.classificacao_distancia), placeholder: "Todas as classificações de distância" });
  preencherSelectDinamico({ id: "ead-filtro-potencial", values: eadRegistros.map(r => r.classificacao_potencial), placeholder: "Todas as classificações de potencial" });
}

function obterRegistrosEaDFiltrados() {
  const municipio = normalize($("ead-filtro-municipio")?.value || "");
  const uf = $("ead-filtro-uf")?.value || "";
  const distancia = $("ead-filtro-distancia")?.value || "";
  const potencial = $("ead-filtro-potencial")?.value || "";

  return eadRegistros.filter(r =>
    (!municipio || normalize(r.municipio).includes(municipio)) &&
    (!uf || String(r.uf || "") === uf) &&
    (!distancia || String(r.classificacao_distancia || "") === distancia) &&
    (!potencial || String(r.classificacao_potencial || "") === potencial)
  );
}

// ==================================================
// EaD — MAPA INTERATIVO
// ==================================================

let eadMapa = null;
let eadMapaMarcadoresMunicipios = null;
let eadMapaMarcadoresAtendimento = null;
let eadMapaCamadaSelecao = null;
let eadMapaLinhaConexao = null;
let eadMapaCarregamento = null;
let eadMapaPreparado = false;
let eadMapaUltimaSelecao = "";

const EAD_RAIO_PROXIMIDADE_KM = 50;

const EAD_MAPA_PONTOS = [
  ["SUBSEDE","Curitiba","PR","Curitiba",-25.432956,-49.271848],
  ["POLO","São José dos Pinhais","PR","Curitiba",-25.537702,-49.200082],
  ["POLO","Araucária","PR","Curitiba",-25.591645,-49.401940],
  ["POLO","Campo Largo","PR","Curitiba",-25.459491,-49.528841],
  ["POLO","Paranaguá","PR","Curitiba",-25.506842,-48.524733],
  ["SUBSEDE","Ponta Grossa","PR","Ponta Grossa",-25.092547,-50.161442],
  ["POLO","Carambeí","PR","Ponta Grossa",-24.950873,-50.113092],
  ["POLO","Castro","PR","Ponta Grossa",-24.795418,-50.002811],
  ["POLO","Palmeira","PR","Ponta Grossa",-25.418568,-50.003247],
  ["POLO","Porto Amazonas","PR","Ponta Grossa",-25.541573,-49.889721],
  ["SUBSEDE","Maringá","PR","Maringá",-23.422280,-51.939882],
  ["POLO","Cianorte","PR","Maringá",-23.653813,-52.609151],
  ["POLO","Campo Mourão","PR","Maringá",-24.041223,-52.381115],
  ["POLO","Jandaia do Sul","PR","Maringá",-23.601179,-51.643395],
  ["POLO","Ivatuba","PR","Maringá",-23.618274,-52.217669],
  ["SUBSEDE","Joinville","SC","Joinville",-26.304518,-48.849409],
  ["POLO","Rio Negrinho","SC","Joinville",-26.255325,-49.517295],
  ["POLO","São Bento do Sul","SC","Joinville",-26.249485,-49.386979],
  ["POLO","Jaraguá do Sul","SC","Joinville",-26.490484,-49.076299],
  ["POLO","Itapoá","SC","Joinville",-26.006048,-48.604168],
  ["POLO","Garuva","SC","Joinville",-26.022076,-48.849842],
  ["POLO","Araquari","SC","Joinville",-26.375952,-48.692707],
  ["POLO","Itajaí","SC","Joinville",-26.907426,-48.657023],
  ["POLO","Navegantes","SC","Joinville",-26.897439,-48.649183],
  ["POLO","Luiz Alves","SC","Joinville",-26.721111,-48.926047],
  ["SUBSEDE","Cascavel","PR","Cascavel",-24.953798,-53.459722],
  ["POLO","Foz do Iguaçu","PR","Cascavel",-25.542493,-54.587102],
  ["POLO","Toledo","PR","Cascavel",-24.732077,-53.741411],
  ["POLO","Palotina","PR","Cascavel",-24.279409,-53.838772],
  ["POLO","Assis Chateaubriand","PR","Cascavel",-24.408530,-53.521237],
  ["POLO","Umuarama","PR","Cascavel",-23.763950,-53.308460],
  ["POLO","Marechal Cândido Rondon","PR","Cascavel",-24.559255,-54.060008],
  ["POLO","Terra Roxa","PR","Cascavel",-24.167484,-54.098514],
  ["POLO","Maripá","PR","Cascavel",-24.417209,-53.833478],
  ["SUBSEDE","Florianópolis","SC","Florianópolis",-27.587796,-48.547638],
  ["POLO","São José","SC","Florianópolis",-27.590312,-48.616023],
  ["POLO","Criciúma","SC","Florianópolis",-28.673573,-49.365940],
  ["POLO","Tubarão","SC","Florianópolis",-28.480034,-49.005268],
  ["POLO","Palhoça","SC","Florianópolis",-27.647044,-48.670288],
  ["SUBSEDE","Londrina","PR","Londrina",-23.312156,-51.162773],
  ["POLO","Rolândia","PR","Londrina",-23.313592,-51.362781],
  ["SUBSEDE","Blumenau","SC","Blumenau",-26.916108,-49.057631],
  ["POLO","Brusque","SC","Blumenau",-27.098310,-48.915163],
  ["POLO","Gaspar","SC","Blumenau",-26.918369,-48.967707],
  ["POLO","Indaial","SC","Blumenau",-26.906256,-49.240140],
  ["POLO","Pomerode","SC","Blumenau",-26.744827,-49.174197],
  ["SUBSEDE","Guarapuava","PR","Guarapuava",-25.393592,-51.463431],
  ["POLO","Pato Branco","PR","Guarapuava",-26.229958,-52.677362],
  ["POLO","Francisco Beltrão","PR","Guarapuava",-26.078450,-53.056136]
];

// ==================================================
// PREPARAÇÃO DO MAPA
// ==================================================

function eadMapaPrepararElemento() {
  const section = $("ead-section");
  if (!section) return null;

  let painel = $("ead-mapa-painel");
  if (painel) return painel;

  painel = document.createElement("section");
  painel.id = "ead-mapa-painel";
  painel.className = "ead-mapa-painel";
  painel.style.cssText = [
    "margin:20px 0",
    "padding:20px",
    "border:1px solid #d8e5f3",
    "border-radius:16px",
    "background:#ffffff",
    "box-shadow:0 8px 24px rgba(20,65,110,.07)"
  ].join(";");

  const titulo = document.createElement("h3");
  titulo.textContent = "Mapa geográfico — EaD";
  titulo.style.cssText = "margin:0 0 6px;font-size:20px;font-weight:700;color:#174a7e";

  const descricao = document.createElement("p");
  descricao.id = "ead-mapa-descricao";
  descricao.textContent = "Selecione um município para consultar cursos validados, protocolos e municípios próximos.";
  descricao.style.cssText = "margin:0 0 14px;color:#60758b;font-size:13px;line-height:1.6";

  const legenda = document.createElement("div");
  legenda.style.cssText = "display:flex;gap:16px;flex-wrap:wrap;margin:0 0 14px;font-size:12px;color:#334e68";
  legenda.innerHTML = [
    '<span><span style="color:#2474c7;font-size:16px">●</span> Município analisado</span>',
    '<span><span style="color:#16835b;font-size:16px">●</span> Subsede</span>',
    '<span><span style="color:#e58a22;font-size:16px">●</span> Polo</span>',
    '<span><span style="color:#159b83;font-size:16px">●</span> Município próximo com curso validado</span>',
    '<span><span style="color:#174a7e;font-size:16px">●</span> Município selecionado</span>'
  ].join("");

  const conteudo = document.createElement("div");
  conteudo.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr);gap:14px";

  const mapa = document.createElement("div");
  mapa.id = "ead-mapa-canvas";
  mapa.setAttribute("role", "application");
  mapa.setAttribute("aria-label", "Mapa interativo da análise geográfica EaD");
  mapa.style.cssText = "width:100%;height:480px;min-height:320px;border:1px solid #dce7f2;border-radius:12px;background:#eef5fb;z-index:1;overflow:hidden";

  const detalhes = document.createElement("aside");
  detalhes.id = "ead-mapa-detalhes";
  detalhes.style.cssText = [
    "padding:16px",
    "border:1px solid #dce7f2",
    "border-radius:12px",
    "background:#f7fbff",
    "color:#243b53",
    "min-height:80px"
  ].join(";");

  detalhes.innerHTML = `
    <h4 style="margin:0 0 8px;color:#174a7e;font-size:15px">Detalhes do município</h4>
    <p style="margin:0;color:#60758b;font-size:13px;line-height:1.6">
      Digite o nome de um município no filtro acima para localizá-lo no mapa.
    </p>
  `;

  const aviso = document.createElement("p");
  aviso.id = "ead-mapa-aviso";
  aviso.textContent = "Carregando mapa...";
  aviso.style.cssText = "font-size:12px;color:#60758b;margin:10px 0 0;line-height:1.5";

  conteudo.append(mapa, detalhes);
  painel.append(titulo, descricao, legenda, conteudo, aviso);

  const tabela = section.querySelector(".ead-tabela");
  if (tabela) section.insertBefore(painel, tabela);
  else section.appendChild(painel);

  if (!eadMapaPreparado) {
    const style = document.createElement("style");
    style.id = "ead-mapa-estilos";
    style.textContent = `
      #ead-mapa-painel .leaflet-container {
        font-family: Arial, sans-serif;
      }

      #ead-mapa-canvas .leaflet-popup-content {
        line-height: 1.5;
        color: #243b53;
      }

      #ead-mapa-canvas .ead-popup-titulo {
        font-weight: 700;
        font-size: 14px;
        color: #174a7e;
        margin-bottom: 7px;
      }

      #ead-mapa-canvas .ead-popup-linha {
        margin: 3px 0;
      }

      #ead-mapa-detalhes .ead-detalhe-grade {
        display: grid;
        grid-template-columns: repeat(auto-fit,minmax(145px,1fr));
        gap: 10px;
        margin-top: 12px;
      }

      #ead-mapa-detalhes .ead-detalhe-item {
        background: #fff;
        border: 1px solid #e0eaf4;
        border-radius: 9px;
        padding: 10px;
        min-width: 0;
      }

      #ead-mapa-detalhes .ead-detalhe-label {
        display: block;
        font-size: 11px;
        color: #60758b;
        margin-bottom: 5px;
      }

      #ead-mapa-detalhes .ead-detalhe-valor {
        display: block;
        font-size: 13px;
        font-weight: 700;
        color: #174a7e;
        overflow-wrap: anywhere;
      }

      #ead-mapa-painel .ead-mapa-botao {
        border: 1px solid #c6dbef;
        border-radius: 8px;
        background: #fff;
        color: #174a7e;
        padding: 8px 12px;
        font-weight: 600;
        cursor: pointer;
      }

      #ead-mapa-painel .ead-mapa-botao:hover {
        background: #eaf4ff;
      }

      #ead-mapa-detalhes .ead-proximo-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        padding: 12px;
        margin-top: 9px;
        border: 1px solid #dce7f2;
        border-radius: 10px;
        background: #fff;
      }

      #ead-mapa-detalhes .ead-proximo-item strong {
        display: block;
        color: #174a7e;
        font-size: 13px;
      }

      #ead-mapa-detalhes .ead-proximo-item small {
        display: block;
        margin-top: 4px;
        color: #60758b;
        line-height: 1.5;
      }

      #ead-mapa-detalhes .ead-proximo-item button {
        border: 1px solid #159b83;
        border-radius: 8px;
        padding: 7px 10px;
        background: #e9faf6;
        color: #087963;
        font-weight: 700;
        cursor: pointer;
      }

      #ead-mapa-detalhes .ead-proximo-item button:hover {
        background: #d2f4eb;
      }

      @media (max-width: 600px) {
        #ead-mapa-canvas {
          height: 380px !important;
        }

        #ead-mapa-painel {
          padding: 12px !important;
        }
      }
    `;

    document.head.appendChild(style);
    eadMapaPreparado = true;
  }

  return painel;
}

function eadMapaCarregarLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (eadMapaCarregamento) return eadMapaCarregamento;

  eadMapaCarregamento = new Promise((resolve, reject) => {
    const cssId = "ead-leaflet-css";
    const jsId = "ead-leaflet-js";

    if (!document.getElementById(cssId)) {
      const css = document.createElement("link");
      css.id = cssId;
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(css);
    }

    const existente = document.getElementById(jsId);

    if (existente) {
      if (window.L) return resolve(window.L);

      existente.addEventListener("load", () => {
        if (window.L) resolve(window.L);
        else reject(new Error("A biblioteca do mapa não ficou disponível."));
      }, { once: true });

      existente.addEventListener("error", () => {
        eadMapaCarregamento = null;
        reject(new Error("Não foi possível carregar a biblioteca do mapa."));
      }, { once: true });

      return;
    }

    const script = document.createElement("script");
    script.id = jsId;
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;

    script.onload = () => {
      if (window.L) resolve(window.L);
      else reject(new Error("A biblioteca Leaflet não foi inicializada."));
    };

    script.onerror = () => {
      eadMapaCarregamento = null;
      reject(new Error("Não foi possível carregar o mapa. Verifique sua conexão."));
    };

    document.head.appendChild(script);
  });

  return eadMapaCarregamento;
}

function eadMapaIcone(cor, selecionado = false) {
  const tamanho = selecionado ? 22 : 14;
  const borda = selecionado ? 4 : 2;

  return window.L.divIcon({
    className: "ead-mapa-icone",
    html: `
      <div style="
        width:${tamanho}px;
        height:${tamanho}px;
        border:${borda}px solid #ffffff;
        border-radius:50%;
        background:${cor};
        box-shadow:0 2px 9px rgba(15,45,75,.4);
        ${selecionado ? "outline:3px solid rgba(36,116,199,.22);" : ""}
      "></div>
    `,
    iconSize: [tamanho + borda * 2, tamanho + borda * 2],
    iconAnchor: [(tamanho + borda * 2) / 2, (tamanho + borda * 2) / 2],
    popupAnchor: [0, -(tamanho + borda * 2) / 2]
  });
}

function eadMapaPopupMunicipio(r) {
  const distancia = numeroSeguro(r.distancia_km);
  const potencial = numeroSeguro(r.potencial_cota);

  const distanciaTexto = distancia === null
    ? "Não informada"
    : `${distancia.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`;

  const potencialTexto = potencial === null
    ? valorTexto(r.potencial_cota)
    : potencial.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

  const itens = [
    ["UF", valorTexto(r.uf)],
    ["Potencial de cota", potencialTexto],
    ["Ponto mais próximo", valorTexto(r.ponto_mais_proximo)],
    ["UF do ponto", valorTexto(r.uf_ponto)],
    ["Tipo do ponto", valorTexto(r.tipo_ponto)],
    ["Subsede responsável", valorTexto(r.subsede_responsavel)],
    ["Distância registrada", distanciaTexto],
    ["Classificação de distância", valorTexto(r.classificacao_distancia)],
    ["Classificação de potencial", valorTexto(r.classificacao_potencial)],
    ["Status do cálculo", valorTexto(r.status_calculo)]
  ];

  return `<div class="ead-popup-titulo">${escaparHTML(valorTexto(r.municipio))} - ${escaparHTML(valorTexto(r.uf))}</div>` +
    itens.map(([label, value]) =>
      `<div class="ead-popup-linha"><strong>${escaparHTML(label)}:</strong> ${escaparHTML(value)}</div>`
    ).join("") +
    `<div style="margin-top:7px;font-size:11px;color:#667085">A distância exibida é a que consta na base do sistema; não significa necessariamente distância por estrada.</div>`;
}

function escaparHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

// ==================================================
// EaD — CURSOS, PROTOCOLOS E DADOS DE DETALHES
// ==================================================

function eadConverterLista(valor) {
  if (Array.isArray(valor)) return valor;

  if (valor && typeof valor === "object") {
    return [valor];
  }

  if (typeof valor === "string" && valor.trim()) {
    try {
      const convertido = JSON.parse(valor);

      if (Array.isArray(convertido)) return convertido;
      if (convertido && typeof convertido === "object") return [convertido];

      return convertido ? [convertido] : [];
    } catch {
      return [valor.trim()];
    }
  }

  return [];
}

function eadRotuloCampo(campo) {
  const rotulos = {
    curso: "Curso",
    nome_curso: "Nome do curso",
    curso_nome: "Nome do curso",
    modalidade: "Modalidade",
    carga_horaria: "Carga horária",
    status: "Status",
    situacao: "Situação",
    protocolo: "Protocolo",
    numero_protocolo: "Número do protocolo",
    numero: "Número",
    portaria: "Portaria",
    cbo: "CBO",
    codigo_cbo: "Código CBO",
    faixa_etaria: "Faixa etária",
    data_protocolo: "Data do protocolo",
    data_validacao: "Data da validação",
    data_validacao_curso: "Data da validação",
    data_aprovacao: "Data da aprovação",
    data_inicio_validade: "Início da validade",
    data_fim_validade: "Fim da validade",
    data_validade: "Validade",
    validade: "Validade",
    inicio_validade: "Início da validade",
    fim_validade: "Fim da validade",
    observacao: "Observação",
    observacao_protocolo: "Observação do protocolo",
    municipio: "Município",
    uf: "UF"
  };

  const chave = String(campo ?? "");
  const chaveNormalizada = normalize(chave).replace(/[\s-]+/g, "_");

  if (rotulos[chaveNormalizada]) return rotulos[chaveNormalizada];

  return chave
    .replace(/_/g, " ")
    .replace(/\b\w/g, letra => letra.toUpperCase());
}

function eadFormatarValorDetalhe(campo, valor) {
  if (valor === null || valor === undefined || valor === "") {
    return "Não informado";
  }

  if (typeof valor === "boolean") {
    return valor ? "Sim" : "Não";
  }

  if (Array.isArray(valor)) {
    return valor
      .map(item => eadFormatarValorDetalhe(campo, item))
      .filter(Boolean)
      .join(", ") || "Não informado";
  }

  if (typeof valor === "object") {
    return Object.entries(valor)
      .map(([chave, conteudo]) =>
        `${eadRotuloCampo(chave)}: ${eadFormatarValorDetalhe(chave, conteudo)}`
      )
      .join(" · ") || "Não informado";
  }

  const texto = String(valor).trim();
  if (!texto) return "Não informado";

  const campoNormalizado = normalize(campo);
  const pareceData =
    campoNormalizado.includes("data") ||
    campoNormalizado.includes("validade") ||
    campoNormalizado.includes("inicio") ||
    campoNormalizado.includes("fim");

  if (pareceData && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(texto)) {
    const partes = texto.slice(0, 10).split("-");

    if (partes.length === 3) {
      return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }
  }

  return texto;
}

function eadRegistroTemInformacao(registro) {
  if (registro === null || registro === undefined) return false;

  if (typeof registro !== "object") {
    return String(registro).trim() !== "";
  }

  return Object.values(registro).some(valor => {
    if (valor === null || valor === undefined) return false;
    if (typeof valor === "string" && !valor.trim()) return false;
    if (Array.isArray(valor)) return valor.length > 0;
    return true;
  });
}

function eadHtmlCartoesInformacoes(registro) {
  if (registro === null || registro === undefined) return "";

  if (typeof registro !== "object") {
    return `
      <div class="ead-detalhe-item">
        <span class="ead-detalhe-valor">
          ${escaparHTML(eadFormatarValorDetalhe("", registro))}
        </span>
      </div>
    `;
  }

  return Object.entries(registro)
    .filter(([, valor]) =>
      valor !== null &&
      valor !== undefined &&
      valor !== "" &&
      !(Array.isArray(valor) && valor.length === 0)
    )
    .map(([campo, valor]) => `
      <div class="ead-detalhe-item">
        <span class="ead-detalhe-label">${escaparHTML(eadRotuloCampo(campo))}</span>
        <span class="ead-detalhe-valor">${escaparHTML(eadFormatarValorDetalhe(campo, valor))}</span>
      </div>
    `)
    .join("");
}

function eadHtmlSecaoRegistros(titulo, registros, tipo) {
  const listaOriginal = eadConverterLista(registros).filter(eadRegistroTemInformacao);
  const vistos = new Set();

  const lista = listaOriginal.filter(registro => {
    let chave;

    try {
      chave = JSON.stringify(registro);
    } catch {
      chave = String(registro);
    }

    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });

  const cards = lista.map((registro, indice) => {
    const numero = lista.length > 1 ? ` ${indice + 1}` : "";

    return `
      <article style="
        background:#ffffff;
        border:1px solid #dce7f2;
        border-radius:10px;
        padding:13px;
        margin-top:10px
      ">
        <h5 style="margin:0 0 10px;color:#174a7e;font-size:13px">
          ${escaparHTML(tipo)}${numero}
        </h5>
        <div class="ead-detalhe-grade">
          ${eadHtmlCartoesInformacoes(registro)}
        </div>
      </article>
    `;
  }).join("");

  return `
    <section style="margin-top:22px">
      <div style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        flex-wrap:wrap;
        border-bottom:1px solid #dce7f2;
        padding-bottom:9px
      ">
        <h4 style="margin:0;color:#174a7e;font-size:15px">
          ${escaparHTML(titulo)}
        </h4>
        <span style="
          background:#eaf4ff;
          color:#174a7e;
          padding:5px 9px;
          border-radius:20px;
          font-size:12px;
          font-weight:700
        ">
          ${lista.length} ${lista.length === 1 ? "registro" : "registros"}
        </span>
      </div>

      ${cards || `
        <p style="margin:10px 0 0;color:#60758b;font-size:13px;line-height:1.6">
          Nenhum registro de ${escaparHTML(titulo.toLowerCase())}
          foi encontrado para este município.
        </p>
      `}
    </section>
  `;
}

// ==================================================
// EaD — CÁLCULO DE PROXIMIDADE GEOGRÁFICA
// ==================================================

function eadMapaCoordenadasValidas(r) {
  const lat = numeroSeguro(r?.latitude_municipio);
  const lng = numeroSeguro(r?.longitude_municipio);

  return lat !== null && lng !== null &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0);
}

function eadDistanciaGeograficaKm(a, b) {
  if (!eadMapaCoordenadasValidas(a) || !eadMapaCoordenadasValidas(b)) {
    return null;
  }

  const lat1 = numeroSeguro(a.latitude_municipio) * Math.PI / 180;
  const lat2 = numeroSeguro(b.latitude_municipio) * Math.PI / 180;
  const deltaLat = lat2 - lat1;

  const lng1 = numeroSeguro(a.longitude_municipio) * Math.PI / 180;
  const lng2 = numeroSeguro(b.longitude_municipio) * Math.PI / 180;
  const deltaLng = lng2 - lng1;

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(deltaLng / 2) ** 2;

  const arco = 2 * Math.atan2(
    Math.sqrt(Math.max(0, h)),
    Math.sqrt(Math.max(0, 1 - h))
  );

  return 6371 * arco;
}

function eadChaveMunicipio(r) {
  return `${normalize(r?.municipio)}|${normalize(r?.uf)}`;
}

function eadCursosValidados(r) {
  return eadConverterLista(r?.cursos_validados)
    .filter(eadRegistroTemInformacao);
}

function eadTemCursosValidados(r) {
  return eadCursosValidados(r).length > 0;
}

function eadMapaObterMunicipiosProximos(selecionado) {
  if (!selecionado || !eadMapaCoordenadasValidas(selecionado)) {
    return [];
  }

  const chaveSelecionada = eadChaveMunicipio(selecionado);

  return eadRegistros
    .filter(r =>
      eadChaveMunicipio(r) !== chaveSelecionada &&
      eadMapaCoordenadasValidas(r) &&
      eadTemCursosValidados(r)
    )
    .map(r => ({
      registro: r,
      distanciaProximidadeKm: eadDistanciaGeograficaKm(selecionado, r)
    }))
    .filter(item =>
      item.distanciaProximidadeKm !== null &&
      item.distanciaProximidadeKm <= EAD_RAIO_PROXIMIDADE_KM
    )
    .sort((a, b) => a.distanciaProximidadeKm - b.distanciaProximidadeKm);
}

// ==================================================
// EaD — PONTOS DE ATENDIMENTO
// ==================================================

function eadMapaAdicionarPontosAtendimento() {
  if (!eadMapa || !eadMapaMarcadoresAtendimento) return;

  eadMapaMarcadoresAtendimento.clearLayers();

  EAD_MAPA_PONTOS.forEach(p => {
    const [tipo, municipio, uf, subsede, lat, lng] = p;
    const cor = tipo === "SUBSEDE" ? "#16835b" : "#e58a22";

    const marcador = window.L.marker([lat, lng], {
      icon: eadMapaIcone(cor),
      title: `${tipo}: ${municipio} - ${uf}`
    });

    marcador.bindPopup(
      `<div class="ead-popup-titulo">${escaparHTML(municipio)} - ${escaparHTML(uf)}</div>` +
      `<div class="ead-popup-linha"><strong>Tipo:</strong> ${escaparHTML(tipo)}</div>` +
      `<div class="ead-popup-linha"><strong>Subsede responsável:</strong> ${escaparHTML(subsede)}</div>` +
      `<div style="font-size:11px;color:#667085;margin-top:6px">Coordenada aproximada do município; não representa necessariamente o endereço físico.</div>`
    );

    marcador.addTo(eadMapaMarcadoresAtendimento);
  });
}

function eadMapaEncontrarPonto(r) {
  const nomePonto = normalize(r.ponto_mais_proximo);
  const ufPonto = normalize(r.uf_ponto);
  const subsede = normalize(r.subsede_responsavel);
  const tipoPonto = normalize(r.tipo_ponto);

  if (!nomePonto) return null;

  const candidatos = EAD_MAPA_PONTOS.filter(p => {
    const nome = normalize(p[1]);
    const uf = normalize(p[2]);
    const subsedePonto = normalize(p[3]);
    const tipo = normalize(p[0]);

    const nomeCompativel =
      nome === nomePonto ||
      nome.includes(nomePonto) ||
      nomePonto.includes(nome);

    const ufCompativel = !ufPonto || uf === ufPonto;
    const tipoCompativel = !tipoPonto || tipo.includes(tipoPonto) || tipoPonto.includes(tipo);
    const subsedeCompativel = !subsede || subsedePonto === subsede ||
      subsedePonto.includes(subsede) || subsede.includes(subsedePonto);

    return nomeCompativel && ufCompativel && tipoCompativel && subsedeCompativel;
  });

  if (candidatos.length) return candidatos[0];

  const alternativas = EAD_MAPA_PONTOS.filter(p =>
    normalize(p[1]) === nomePonto &&
    (!ufPonto || normalize(p[2]) === ufPonto)
  );

  return alternativas.length === 1 ? alternativas[0] : null;
}

// ==================================================
// EaD — LISTA DE MUNICÍPIOS PRÓXIMOS
// ==================================================

function eadHtmlMunicipiosProximos(selecionado) {
  const proximos = eadMapaObterMunicipiosProximos(selecionado);

  const conteudo = proximos.length
    ? proximos.map(item => {
        const r = item.registro;
        const distancia = item.distanciaProximidadeKm.toLocaleString("pt-BR", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 2
        });

        const quantidadeCursos = eadCursosValidados(r).length;

        return `
          <article class="ead-proximo-item">
            <div>
              <strong>${escaparHTML(valorTexto(r.municipio))} - ${escaparHTML(valorTexto(r.uf))}</strong>
              <small>
                ${distancia} km em linha reta ·
                ${quantidadeCursos} ${quantidadeCursos === 1 ? "curso validado" : "cursos validados"}
              </small>
            </div>
            <button
              type="button"
              data-ead-proximo="${escaparHTML(eadChaveMunicipio(r))}"
            >
              Consultar
            </button>
          </article>
        `;
      }).join("")
    : `
      <p style="margin:10px 0 0;color:#60758b;font-size:13px;line-height:1.6">
        Nenhum outro município com cursos validados foi encontrado em um raio de
        ${EAD_RAIO_PROXIMIDADE_KM} km com as coordenadas disponíveis na base.
      </p>
    `;

  return `
    <section style="margin-top:22px">
      <div style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        flex-wrap:wrap;
        border-bottom:1px solid #dce7f2;
        padding-bottom:9px
      ">
        <h4 style="margin:0;color:#174a7e;font-size:15px">
          Municípios próximos com cursos validados
        </h4>
        <span style="
          background:#e9faf6;
          color:#087963;
          padding:5px 9px;
          border-radius:20px;
          font-size:12px;
          font-weight:700
        ">
          ${proximos.length} encontrados
        </span>
      </div>

      <p style="margin:10px 0 0;color:#60758b;font-size:12px;line-height:1.6">
        Distâncias calculadas em linha reta pelas coordenadas dos municípios,
        considerando o limite de ${EAD_RAIO_PROXIMIDADE_KM} km.
      </p>

      ${conteudo}
    </section>
  `;
}

function eadMapaVincularBotoesProximos() {
  const container = $("ead-mapa-detalhes");
  if (!container) return;

  container.querySelectorAll("[data-ead-proximo]").forEach(botao => {
    botao.addEventListener("click", () => {
      const chave = botao.dataset.eadProximo;

      const registro = eadRegistros.find(r =>
        eadChaveMunicipio(r) === chave
      );

      if (!registro) return;

      const filtroMunicipio = $("ead-filtro-municipio");
      if (filtroMunicipio) filtroMunicipio.value = registro.municipio || "";

      // Limpa os outros filtros para permitir consultar o município clicado.
      ["ead-filtro-uf", "ead-filtro-distancia", "ead-filtro-potencial"].forEach(id => {
        if ($(id)) $(id).value = "";
      });

      eadPaginaAtual = 1;
      renderizarAnaliseEaD();

      $("ead-mapa-painel")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  });
}

// ==================================================
// EaD — DETALHES DO MUNICÍPIO SELECIONADO
// ==================================================

function eadMapaRenderizarDetalhes(r, ponto = null) {
  const container = $("ead-mapa-detalhes");
  if (!container) return;

  if (!r) {
    container.innerHTML = `
      <h4 style="margin:0 0 8px;color:#174a7e;font-size:15px">Visão geral</h4>
      <p style="margin:0;color:#60758b;font-size:13px;line-height:1.6">
        Selecione um município no mapa ou na tabela para consultar seus dados,
        cursos validados, protocolos e municípios próximos em um raio de 50 km.
      </p>
    `;
    return;
  }

  const distancia = numeroSeguro(r.distancia_km);
  const potencial = numeroSeguro(r.potencial_cota);

  const distanciaTexto = distancia === null
    ? "Não informada"
    : `${distancia.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`;

  const potencialTexto = potencial === null
    ? valorTexto(r.potencial_cota)
    : potencial.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

  const itens = [
    ["Município", `${valorTexto(r.municipio)} - ${valorTexto(r.uf)}`],
    ["Potencial de cota", potencialTexto],
    ["Ponto mais próximo", valorTexto(r.ponto_mais_proximo)],
    ["UF do ponto", valorTexto(r.uf_ponto)],
    ["Tipo de ponto", valorTexto(r.tipo_ponto)],
    ["Subsede responsável", valorTexto(r.subsede_responsavel)],
    ["Distância registrada", distanciaTexto],
    ["Classificação de distância", valorTexto(r.classificacao_distancia)],
    ["Classificação de potencial", valorTexto(r.classificacao_potencial)],
    ["Status do cálculo", valorTexto(r.status_calculo)],
    ["Última atualização", r.atualizado_em ? formatarDataEaD(r.atualizado_em) : "—"]
  ];

  const avisoPonto = ponto
    ? `Ponto localizado no mapa: ${ponto[1]} - ${ponto[2]}.`
    : "Não foi possível localizar uma coordenada correspondente ao ponto informado. A conexão não foi desenhada para evitar indicar um local incorreto.";

  const secaoCursos = eadHtmlSecaoRegistros(
    "Cursos validados",
    r.cursos_validados,
    "Curso"
  );

  const secaoProtocolos = eadHtmlSecaoRegistros(
    "Protocolos",
    r.protocolos,
    "Protocolo"
  );

  const secaoProximos = eadHtmlMunicipiosProximos(r);

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div>
        <h4 style="margin:0 0 5px;color:#174a7e;font-size:16px">
          ${escaparHTML(valorTexto(r.municipio))} - ${escaparHTML(valorTexto(r.uf))}
        </h4>
        <p style="margin:0;color:#60758b;font-size:12px">
          Detalhes do município selecionado
        </p>
      </div>

      <button type="button" id="ead-mapa-limpar-selecao" class="ead-mapa-botao">
        Ver mapa geral
      </button>
    </div>

    <div class="ead-detalhe-grade">
      ${itens.map(([label, value]) => `
        <div class="ead-detalhe-item">
          <span class="ead-detalhe-label">${escaparHTML(label)}</span>
          <span class="ead-detalhe-valor">${escaparHTML(value)}</span>
        </div>
      `).join("")}
    </div>

    <p style="font-size:12px;line-height:1.5;color:#60758b;margin:12px 0 0">
      ${escaparHTML(avisoPonto)}
      A distância apresentada é a registrada na base e não representa necessariamente uma distância rodoviária.
    </p>

    ${secaoCursos}
    ${secaoProtocolos}
    ${secaoProximos}
  `;

  const limpar = $("ead-mapa-limpar-selecao");

  if (limpar) {
    limpar.addEventListener("click", () => {
      if ($("ead-filtro-municipio")) {
        $("ead-filtro-municipio").value = "";
      }

      eadPaginaAtual = 1;
      renderizarAnaliseEaD();
    });
  }

  eadMapaVincularBotoesProximos();
}

// ==================================================
// EaD — SELEÇÃO E DESTAQUE NO MAPA
// ==================================================

function eadMapaLimparSelecao() {
  if (eadMapaCamadaSelecao) eadMapaCamadaSelecao.clearLayers();

  if (eadMapaLinhaConexao && eadMapa) {
    eadMapa.removeLayer(eadMapaLinhaConexao);
    eadMapaLinhaConexao = null;
  }
}

function eadMapaSelecionarMunicipio(r, ajustarEnquadramento = true) {
  if (!eadMapa || !eadMapaCamadaSelecao) return;

  eadMapaLimparSelecao();

  if (!r || !eadMapaCoordenadasValidas(r)) {
    eadMapaRenderizarDetalhes(r, null);
    return;
  }

  const lat = numeroSeguro(r.latitude_municipio);
  const lng = numeroSeguro(r.longitude_municipio);
  const coordenadaMunicipio = [lat, lng];
  const ponto = eadMapaEncontrarPonto(r);

  const coordenadasEnquadramento = [coordenadaMunicipio];

  // Marcador do município selecionado.
  const marcadorMunicipio = window.L.marker(coordenadaMunicipio, {
    icon: eadMapaIcone("#174a7e", true),
    zIndexOffset: 1200,
    title: `Selecionado: ${r.municipio} - ${r.uf}`
  });

  marcadorMunicipio.bindPopup(eadMapaPopupMunicipio(r));
  marcadorMunicipio.addTo(eadMapaCamadaSelecao);

  // Marca todos os municípios próximos com cursos validados.
  const proximos = eadMapaObterMunicipiosProximos(r);

  proximos.forEach(item => {
    const vizinho = item.registro;

    const coordenadaVizinho = [
      numeroSeguro(vizinho.latitude_municipio),
      numeroSeguro(vizinho.longitude_municipio)
    ];

    const distanciaTexto = item.distanciaProximidadeKm.toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2
    });

    const quantidadeCursos = eadCursosValidados(vizinho).length;

    const marcadorVizinho = window.L.marker(coordenadaVizinho, {
      icon: eadMapaIcone("#159b83"),
      zIndexOffset: 700,
      title: `${vizinho.municipio} - ${vizinho.uf}: ${distanciaTexto} km`
    });

    marcadorVizinho.bindPopup(`
      <div class="ead-popup-titulo">
        ${escaparHTML(vizinho.municipio)} - ${escaparHTML(vizinho.uf)}
      </div>
      <div class="ead-popup-linha">
        <strong>Distância em linha reta:</strong> ${distanciaTexto} km
      </div>
      <div class="ead-popup-linha">
        <strong>Cursos validados:</strong> ${quantidadeCursos}
      </div>
      <button
        type="button"
        class="ead-mapa-botao"
        data-ead-mapa-vizinho="${escaparHTML(eadChaveMunicipio(vizinho))}"
        style="margin-top:8px"
      >
        Consultar município
      </button>
    `);

    marcadorVizinho.on("popupopen", evento => {
      const popupElement = evento.popup.getElement();
      const botao = popupElement?.querySelector("[data-ead-mapa-vizinho]");

      if (!botao || botao.dataset.eventoVinculado === "sim") return;
      botao.dataset.eventoVinculado = "sim";

      botao.addEventListener("click", () => {
        const chave = botao.dataset.eadMapaVizinho;
        const registro = eadRegistros.find(x => eadChaveMunicipio(x) === chave);
        if (!registro) return;

        if ($("ead-filtro-municipio")) {
          $("ead-filtro-municipio").value = registro.municipio || "";
        }

        ["ead-filtro-uf", "ead-filtro-distancia", "ead-filtro-potencial"].forEach(id => {
          if ($(id)) $(id).value = "";
        });

        eadPaginaAtual = 1;
        renderizarAnaliseEaD();
      });
    });

    marcadorVizinho.addTo(eadMapaCamadaSelecao);
    coordenadasEnquadramento.push(coordenadaVizinho);
  });

  // Destaca o ponto de atendimento registrado, se for possível identificá-lo.
  if (ponto) {
    const coordenadaPonto = [ponto[4], ponto[5]];
    const corPonto = ponto[0] === "SUBSEDE" ? "#16835b" : "#e58a22";

    const marcadorPonto = window.L.marker(coordenadaPonto, {
      icon: eadMapaIcone(corPonto, true),
      zIndexOffset: 900,
      title: `${ponto[0]} mais próximo: ${ponto[1]} - ${ponto[2]}`
    });

    marcadorPonto.bindPopup(`
      <div class="ead-popup-titulo">${escaparHTML(ponto[1])} - ${escaparHTML(ponto[2])}</div>
      <div class="ead-popup-linha"><strong>Tipo:</strong> ${escaparHTML(ponto[0])}</div>
      <div class="ead-popup-linha"><strong>Subsede:</strong> ${escaparHTML(ponto[3])}</div>
      <div style="margin-top:6px;font-size:11px;color:#60758b">
        Coordenada aproximada do município do ponto de atendimento.
      </div>
    `);

    marcadorPonto.addTo(eadMapaCamadaSelecao);

    eadMapaLinhaConexao = window.L.polyline(
      [coordenadaMunicipio, coordenadaPonto],
      {
        color: "#174a7e",
        weight: 3,
        opacity: 0.9,
        dashArray: "8 7",
        lineCap: "round"
      }
    ).addTo(eadMapa);

    coordenadasEnquadramento.push(coordenadaPonto);
  }

  eadMapaRenderizarDetalhes(r, ponto);
  eadMapaUltimaSelecao = eadChaveMunicipio(r);

  if (ajustarEnquadramento) {
    const bounds = window.L.latLngBounds(coordenadasEnquadramento);

    if (bounds.isValid()) {
      eadMapa.fitBounds(bounds.pad(0.18), {
        maxZoom: proximos.length ? 9 : (ponto ? 9 : 10),
        animate: true
      });
    }

    if (coordenadasEnquadramento.length === 1) {
      eadMapa.setView(coordenadaMunicipio, 8, { animate: true });
    }
  }

  marcadorMunicipio.openPopup();
}

function eadMapaObterSelecao(registros) {
  const texto = normalize($("ead-filtro-municipio")?.value || "");
  if (!texto) return null;

  const todos = eadRegistros.length ? eadRegistros : registros;

  const exatos = todos.filter(r => normalize(r.municipio) === texto);

  if (exatos.length === 1) return exatos[0];

  const correspondencias = todos.filter(r =>
    normalize(r.municipio).includes(texto)
  );

  if (correspondencias.length === 1) return correspondencias[0];

  return null;
}

// ==================================================
// EaD — ATUALIZAÇÃO DO MAPA
// ==================================================

async function atualizarMapaEaD(registros) {
  const painel = eadMapaPrepararElemento();
  if (!painel) return;

  const aviso = $("ead-mapa-aviso");

  try {
    await eadMapaCarregarLeaflet();

    const container = $("ead-mapa-canvas");
    if (!container) return;

    if (!eadMapa) {
      eadMapa = window.L.map(container, {
        scrollWheelZoom: false
      }).setView([-25.5, -50.5], 6);

      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
      }).addTo(eadMapa);

      eadMapaMarcadoresMunicipios = window.L.featureGroup().addTo(eadMapa);
      eadMapaMarcadoresAtendimento = window.L.featureGroup().addTo(eadMapa);
      eadMapaCamadaSelecao = window.L.featureGroup().addTo(eadMapa);

      eadMapaAdicionarPontosAtendimento();

      setTimeout(() => eadMapa?.invalidateSize(), 150);
    }

    eadMapaMarcadoresMunicipios.clearLayers();

    const selecao = eadMapaObterSelecao(registros);
    const proximos = selecao ? eadMapaObterMunicipiosProximos(selecao) : [];

    // Com um município selecionado, mantemos no mapa os municípios filtrados,
    // o município selecionado e os municípios próximos com cursos validados.
    const mapaPorChave = new Map();

    registros.forEach(r => mapaPorChave.set(eadChaveMunicipio(r), r));

    if (selecao) {
      mapaPorChave.set(eadChaveMunicipio(selecao), selecao);

      proximos.forEach(item => {
        mapaPorChave.set(eadChaveMunicipio(item.registro), item.registro);
      });
    }

    const registrosMapa = [...mapaPorChave.values()];
    let validos = 0;

    registrosMapa.forEach(r => {
      if (!eadMapaCoordenadasValidas(r)) return;

      const lat = numeroSeguro(r.latitude_municipio);
      const lng = numeroSeguro(r.longitude_municipio);
      const chave = eadChaveMunicipio(r);
      const ehSelecionado = selecao && chave === eadChaveMunicipio(selecao);
      const ehProximoComCurso = selecao && proximos.some(
        item => eadChaveMunicipio(item.registro) === chave
      );

      const cor = ehSelecionado
        ? "#174a7e"
        : ehProximoComCurso
          ? "#159b83"
          : "#2474c7";

      const marcador = window.L.marker([lat, lng], {
        icon: eadMapaIcone(cor, Boolean(ehSelecionado)),
        title: `${r.municipio || "Município"} - ${r.uf || ""}`
      });

      marcador.bindPopup(eadMapaPopupMunicipio(r));

      marcador.on("click", () => {
        if ($("ead-filtro-municipio")) {
          $("ead-filtro-municipio").value = r.municipio || "";
        }

        ["ead-filtro-uf", "ead-filtro-distancia", "ead-filtro-potencial"].forEach(id => {
          if ($(id)) $(id).value = "";
        });

        eadPaginaAtual = 1;
        renderizarAnaliseEaD();
      });

      marcador.addTo(eadMapaMarcadoresMunicipios);
      validos++;
    });

    if (selecao) {
      eadMapaSelecionarMunicipio(selecao, true);

      if (aviso) {
        aviso.textContent =
          `Selecionado: ${selecao.municipio} - ${selecao.uf}. ` +
          `${proximos.length} município(s) com cursos validados encontrados em até ` +
          `${EAD_RAIO_PROXIMIDADE_KM} km em linha reta. ` +
          "Clique nos marcadores ou nos botões de consulta para abrir os detalhes.";
      }
    } else {
      eadMapaLimparSelecao();
      eadMapaUltimaSelecao = "";
      eadMapaRenderizarDetalhes(null);

      const pontosVisiveis = eadMapaMarcadoresMunicipios.getLayers().length;
      const todosPontos = eadMapaMarcadoresAtendimento.getLayers().length;

      if (pontosVisiveis > 0) {
        const bounds = eadMapaMarcadoresMunicipios.getBounds();

        if (bounds.isValid()) {
          eadMapa.fitBounds(bounds.pad(0.08), {
            maxZoom: 7,
            animate: true
          });
        }
      } else if (todosPontos > 0) {
        const bounds = eadMapaMarcadoresAtendimento.getBounds();

        if (bounds.isValid()) {
          eadMapa.fitBounds(bounds.pad(0.08), {
            maxZoom: 7,
            animate: true
          });
        }
      } else {
        eadMapa.setView([-25.5, -50.5], 6);
      }

      if (aviso) {
        aviso.textContent =
          `${validos.toLocaleString("pt-BR")} municípios com coordenadas válidas no mapa. ` +
          `${todosPontos} pontos de atendimento aproximados. ` +
          "Digite ou selecione um município para consultar os cursos, protocolos e municípios próximos.";
      }
    }

    setTimeout(() => eadMapa?.invalidateSize(), 100);
  } catch (error) {
    console.error("Erro ao carregar mapa EaD:", error);

    if (aviso) {
      aviso.textContent = "Não foi possível carregar o mapa. Confira a conexão e tente atualizar a página.";
    }
  }
}

function destruirMapaEaD() {
  if (eadMapa) {
    eadMapa.remove();
  }

  eadMapa = null;
  eadMapaMarcadoresMunicipios = null;
  eadMapaMarcadoresAtendimento = null;
  eadMapaCamadaSelecao = null;
  eadMapaLinhaConexao = null;
  eadMapaCarregamento = null;
  eadMapaPreparado = false;
  eadMapaUltimaSelecao = "";

  const painel = $("ead-mapa-painel");
  if (painel) painel.remove();

  const style = $("ead-mapa-estilos");
  if (style) style.remove();
}

// ==================================================
// EaD — INDICADORES, MAPA E TABELA
// ==================================================

function renderizarAnaliseEaD() {
  const registros = obterRegistrosEaDFiltrados();

  const total = registros.length;

  const ate70 = registros.filter(r => {
    const d = numeroSeguro(r.distancia_km);
    return d !== null && d <= 70;
  }).length;

  const acima70 = registros.filter(r => {
    const d = numeroSeguro(r.distancia_km);
    return d !== null && d > 70;
  }).length;

  const potencialAte99 = registros.filter(r => {
    const p = numeroSeguro(r.potencial_cota);
    return p !== null && p <= 99;
  }).length;

  const indicadores = {
    "ead-total": total,
    "ead-ate70": ate70,
    "ead-acima70": acima70,
    "ead-potencial99": potencialAte99
  };

  Object.entries(indicadores).forEach(([id, valor]) => {
    if ($(id)) $(id).textContent = valor.toLocaleString("pt-BR");
  });

  renderizarTabelaEaD(registros);
  atualizarMapaEaD(registros);
}

// ==================================================
// EaD — TABELA
// ==================================================

function renderizarTabelaEaD(registros) {
  const tbody = $("ead-tabela-corpo");
  if (!tbody) return;

  tbody.replaceChildren();

  const ordenados = [...registros].sort((a, b) =>
    String(a.municipio || "").localeCompare(String(b.municipio || ""), "pt-BR")
  );

  const total = ordenados.length;
  const totalPaginas = Math.max(1, Math.ceil(total / EAD_PAGE_SIZE));

  if (eadPaginaAtual > totalPaginas) eadPaginaAtual = totalPaginas;
  if (eadPaginaAtual < 1) eadPaginaAtual = 1;

  if (!total) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 11;
    td.textContent = "Nenhum município encontrado para os filtros selecionados.";

    tr.appendChild(td);
    tbody.appendChild(tr);

    atualizarPaginacaoEaD(0, 0, 0, 1);
    return;
  }

  const inicio = (eadPaginaAtual - 1) * EAD_PAGE_SIZE;
  const fim = Math.min(inicio + EAD_PAGE_SIZE, total);

  ordenados.slice(inicio, fim).forEach(r => {
    const tr = document.createElement("tr");

    const distancia = numeroSeguro(r.distancia_km);
    const potencial = numeroSeguro(r.potencial_cota);

    const distanciaFormatada = distancia === null
      ? "—"
      : `${distancia.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} km`;

    const potencialFormatado = potencial === null
      ? valorTexto(r.potencial_cota)
      : potencial.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

    const atualizado = r.atualizado_em ? formatarDataEaD(r.atualizado_em) : "—";

    [
      r.municipio,
      r.uf,
      potencialFormatado,
      r.ponto_mais_proximo,
      r.uf_ponto,
      r.tipo_ponto,
      r.subsede_responsavel,
      distanciaFormatada,
      r.classificacao_distancia,
      r.classificacao_potencial,
      r.status_calculo
    ].forEach(valor => {
      const td = document.createElement("td");
      td.textContent = valorTexto(valor);
      tr.appendChild(td);
    });

    tr.title = `Última atualização: ${atualizado}`;
    tr.style.cursor = "pointer";

    tr.addEventListener("click", () => {
      const filtroMunicipio = $("ead-filtro-municipio");

      if (filtroMunicipio) {
        filtroMunicipio.value = r.municipio || "";
      }

      // Evita que filtros de outros campos escondam o município selecionado.
      ["ead-filtro-uf", "ead-filtro-distancia", "ead-filtro-potencial"].forEach(id => {
        if ($(id)) $(id).value = "";
      });

      eadPaginaAtual = 1;
      renderizarAnaliseEaD();

      $("ead-mapa-painel")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });

    tbody.appendChild(tr);
  });

  atualizarPaginacaoEaD(total, inicio + 1, fim, totalPaginas);
}

function formatarDataEaD(value) {
  const data = new Date(value);
  if (Number.isNaN(data.getTime())) return String(value);
  return data.toLocaleString("pt-BR");
}

function atualizarPaginacaoEaD(total, primeiro, ultimo, totalPaginas) {
  const info = $("ead-paginacao-info");
  const anterior = $("ead-pagina-anterior");
  const proxima = $("ead-pagina-proxima");

  if (info) {
    info.textContent = total
      ? `Exibindo ${primeiro}–${ultimo} de ${total.toLocaleString("pt-BR")} municípios · Página ${eadPaginaAtual} de ${totalPaginas}`
      : "Nenhum município para exibir.";
  }

  if (anterior) anterior.disabled = eadPaginaAtual <= 1;
  if (proxima) proxima.disabled = eadPaginaAtual >= totalPaginas || total === 0;
}

// ==========================================================
// PORTAL BI GERAR — MÓDULOS APRENDIZ, ESTÁGIO E CARTEIRAS
// ==========================================================

(() => {
  "use strict";

  const MODULOS_BI = {
    aprendizHistorico: "bi_aprendiz_historico",
    aprendizCarteira: "bi_aprendiz_carteira",
    aprendizDetalhado: "bi_aprendiz_detalhado",
    estagioHistorico: "bi_estagio_historico"
  };

  const MODULO_PAGE_SIZE = 1000;
  const MODULO_TABELA_PAGE_SIZE = 25;

  const moduloBIState = {
    inicializado: false,
    carregando: false,
    aprendizHistorico: [],
    aprendizCarteira: [],
    aprendizDetalhado: [],
    estagioHistorico: [],
    filtros: {
      aprendizAno: "",
      aprendizMes: "",
      aprendizSubsede: "",
      aprendizAngariador: "",
      detalheBusca: "",
      detalheSubsede: "",
      detalheCartao: "",
      estagioAno: "",
      estagioMes: "",
      estagioSubsede: ""
    },
    paginas: {
      aprendiz: 1,
      carteira: 1,
      detalhado: 1,
      estagio: 1
    },
    graficos: {}
  };

  const moduloBI$ = id => document.getElementById(id);

  function moduloBIEscapar(valor) {
    return String(valor ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function moduloBINumero(valor) {
    if (valor === null || valor === undefined || valor === "") return 0;
    if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;

    let texto = String(valor)
      .replace(/R\$/gi, "")
      .replace(/\s/g, "")
      .replace(/%/g, "");

    if (texto.includes(",") && texto.includes(".")) {
      texto = texto.replace(/\./g, "").replace(",", ".");
    } else if (texto.includes(",")) {
      texto = texto.replace(",", ".");
    }

    const n = Number(texto);
    return Number.isFinite(n) ? n : 0;
  }

  function moduloBIMoeda(valor) {
    return moduloBINumero(valor).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });
  }

  function moduloBINumeroFormatado(valor, casas = 0) {
    return moduloBINumero(valor).toLocaleString("pt-BR", {
      minimumFractionDigits: casas,
      maximumFractionDigits: casas
    });
  }

  function moduloBIDataTexto(valor) {
    if (!valor) return "—";

    const texto = String(valor);

    if (/^\d{4}-\d{2}-\d{2}/.test(texto)) {
      const [ano, mes, dia] = texto.slice(0, 10).split("-");
      return `${dia}/${mes}/${ano}`;
    }

    return texto;
  }

  function moduloBIAno(registro) {
    if (registro.ano !== null && registro.ano !== undefined && registro.ano !== "") {
      return String(registro.ano);
    }

    const data = String(registro.data_referencia || "");
    return /^\d{4}/.test(data) ? data.slice(0, 4) : "";
  }

  function moduloBIMes(registro) {
    const mes = Number(registro.mes);

    if (Number.isFinite(mes) && mes >= 1 && mes <= 12) {
      return mes;
    }

    const data = String(registro.data_referencia || "");
    if (/^\d{4}-\d{2}/.test(data)) return Number(data.slice(5, 7));

    return 0;
  }

  function moduloBIMesNome(mes) {
    const nomes = [
      "Janeiro", "Fevereiro", "Março", "Abril",
      "Maio", "Junho", "Julho", "Agosto",
      "Setembro", "Outubro", "Novembro", "Dezembro"
    ];

    return nomes[Number(mes) - 1] || "Não informado";
  }

  function moduloBIChaveMes(registro) {
    return `${moduloBIAno(registro)}-${String(moduloBIMes(registro)).padStart(2, "0")}`;
  }

  function moduloBISortMes(a, b) {
    return moduloBIChaveMes(a).localeCompare(moduloBIChaveMes(b));
  }

  function moduloBILerCampo(registro, campos) {
    for (const campo of campos) {
      const valor = registro?.[campo];

      if (valor !== null && valor !== undefined && String(valor).trim() !== "") {
        return valor;
      }
    }

    return "";
  }

  function moduloBIValorSimNao(valor) {
    const texto = String(valor ?? "").trim().toLowerCase();

    return [
      "sim", "true", "1", "yes", "cartão futuro",
      "cartao futuro", "cartao_futuro"
    ].includes(texto);
  }

  function moduloBIEhCartaoFuturo(registro) {
    const campos = [
      registro.cartao_futuro,
      registro.cartao,
      registro.tipo
    ];

    return campos.some(valor => {
      const texto = String(valor ?? "").trim().toLowerCase();

      return (
        moduloBIValorSimNao(valor) ||
        texto.includes("cartão futuro") ||
        texto.includes("cartao futuro") ||
        texto.includes("cartao_futuro")
      );
    });
  }

  function moduloBIRegistroAgregado(registro) {
    const campos = [
      registro.local_atendimento,
      registro.subsede,
      registro.tipo
    ];

    return campos.some(valor => {
      const texto = String(valor ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();

      return texto === "total" ||
        texto.startsWith("total geral") ||
        texto === "consolidado geral";
    });
  }

  function moduloBIUnicos(valores) {
    return [...new Set(
      valores
        .filter(v => v !== null && v !== undefined && String(v).trim() !== "")
        .map(v => String(v).trim())
    )].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }

  function moduloBIOptions(id, valores, textoPadrao) {
    const select = moduloBI$(id);
    if (!select) return;

    const valorAtual = select.value;

    select.replaceChildren();

    const opcaoInicial = document.createElement("option");
    opcaoInicial.value = "";
    opcaoInicial.textContent = textoPadrao;
    select.appendChild(opcaoInicial);

    valores.forEach(valor => {
      const opcao = document.createElement("option");
      opcao.value = valor;
      opcao.textContent = valor;
      select.appendChild(opcao);
    });

    if (valores.includes(valorAtual)) {
      select.value = valorAtual;
    }
  }

  async function moduloBIBuscarTabela(nomeTabela) {
    const todos = [];

    for (let inicio = 0; ; inicio += MODULO_PAGE_SIZE) {
      const fim = inicio + MODULO_PAGE_SIZE - 1;

      const { data, error } = await sb
        .from(nomeTabela)
        .select("*")
        .range(inicio, fim);

      if (error) {
        throw new Error(
          `Erro ao consultar ${nomeTabela}: ${error.message}`
        );
      }

      const lote = data || [];
      todos.push(...lote);

      if (lote.length < MODULO_PAGE_SIZE) break;
    }

    return todos;
  }

  function moduloBIMensagem(texto, erro = false) {
    const el = moduloBI$("modulos-bi-mensagem");
    if (!el) return;

    el.textContent = texto;
    el.style.color = erro ? "#b42318" : "#18794e";
  }

  function moduloBICriarInterface() {
    if (moduloBIState.inicializado) return;

    const sidebar = document.querySelector(".sidebar");
    const main = document.querySelector(".main-content");
    const footer = main?.querySelector(".page-footer");

    if (!sidebar || !main || !footer) return;

    const navBase = sidebar.querySelector(".sidebar-bottom");

    const nav = document.createElement("div");
    nav.id = "modulos-bi-nav";
    nav.innerHTML = `
      <a class="nav-link" href="#bi-aprendiz-section" id="bi-aprendiz-nav">
        <span class="nav-icon">▥</span> BI Aprendiz
      </a>
      <a class="nav-link" href="#bi-estagio-section" id="bi-estagio-nav">
        <span class="nav-icon">▤</span> BI Estágio
      </a>
      <a class="nav-link" href="#bi-carteiras-section" id="bi-carteiras-nav">
        <span class="nav-icon">↗</span> Carteiras dos Consultores
      </a>
    `;

    if (navBase) sidebar.insertBefore(nav, navBase);
    else sidebar.appendChild(nav);

    const style = document.createElement("style");
    style.id = "modulos-bi-estilos";
    style.textContent = `
      .modulo-bi-section { margin: 24px 0; }
      .modulo-bi-filtros {
        display:grid;
        grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
        gap:14px;
        margin:20px 0;
      }
      .modulo-bi-filtros label {
        display:flex; flex-direction:column; gap:7px;
        min-width:0; font-size:13px; font-weight:600;
      }
      .modulo-bi-filtros input,
      .modulo-bi-filtros select {
        box-sizing:border-box; width:100%; min-width:0;
        padding:10px 12px; border:1px solid #dce3ec;
        border-radius:8px; background:#fff; color:#182538;
        font:inherit;
      }
      .modulo-bi-kpis {
        display:grid; grid-template-columns:repeat(4,minmax(0,1fr));
        gap:14px; margin:18px 0;
      }
      .modulo-bi-card {
        min-width:0; padding:18px; border:1px solid #e3e8f0;
        border-radius:12px; background:#fff;
        box-shadow:0 5px 20px rgba(20,42,72,.04);
      }
      .modulo-bi-card span {
        display:block; color:#778397; font-size:12px; line-height:1.5;
      }
      .modulo-bi-card strong {
        display:block; margin-top:8px; color:#17365d;
        font-size:clamp(20px,2.3vw,29px); overflow-wrap:anywhere;
      }
      .modulo-bi-paineis {
        display:grid; grid-template-columns:repeat(2,minmax(0,1fr));
        gap:16px; margin:20px 0;
      }
      .modulo-bi-grafico {
        min-width:0; padding:18px; border:1px solid #e3e8f0;
        border-radius:12px; background:#fff;
      }
      .modulo-bi-grafico h3 { margin:0 0 14px; font-size:15px; }
      .modulo-bi-grafico canvas { max-height:310px; }
      .modulo-bi-tabela {
        padding:18px; margin-top:20px; border:1px solid #e3e8f0;
        border-radius:12px; background:#fff; min-width:0;
      }
      .modulo-bi-tabela-scroll { width:100%; overflow-x:auto; }
      .modulo-bi-tabela table {
        width:100%; min-width:850px; border-collapse:collapse;
        font-size:13px;
      }
      .modulo-bi-tabela th, .modulo-bi-tabela td {
        padding:11px; border-bottom:1px solid #e3e8f0;
        text-align:left; vertical-align:top;
      }
      .modulo-bi-tabela th {
        background:#f4f6fa; color:#17365d; white-space:nowrap;
      }
      .modulo-bi-tabela td { overflow-wrap:anywhere; }
      .modulo-bi-tabela-topo, .modulo-bi-paginacao {
        display:flex; justify-content:space-between; align-items:center;
        gap:12px; flex-wrap:wrap; margin-bottom:14px;
      }
      .modulo-bi-paginacao { margin-top:16px; }
      .modulo-bi-paginacao button, .modulo-bi-acao {
        padding:9px 12px; border:1px solid #dce3ec;
        border-radius:8px; background:#fff; cursor:pointer;
      }
      .modulo-bi-paginacao button:disabled { opacity:.5; cursor:not-allowed; }
      .modulo-bi-aviso { color:#667085; font-size:12px; line-height:1.6; }
      .modulo-bi-badge {
        display:inline-block; padding:4px 8px; border-radius:20px;
        background:#eaf4ff; color:#174a7e; font-weight:600; font-size:11px;
      }
      #modulos-bi-mensagem { margin:14px 0; font-size:13px; }
      @media(max-width:850px) {
        .modulo-bi-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .modulo-bi-paineis { grid-template-columns:1fr; }
      }
      @media(max-width:480px) {
        .modulo-bi-kpis { grid-template-columns:1fr; }
        .modulo-bi-card, .modulo-bi-tabela { padding:12px; }
      }
    `;
    document.head.appendChild(style);

    const secao = document.createElement("section");
    secao.id = "modulos-bi-container";
    secao.className = "dashboard-section";
    secao.innerHTML = `
      <p id="modulos-bi-mensagem" role="status" aria-live="polite">
        Os módulos serão carregados ao acessar o portal.
      </p>

      <section id="bi-aprendiz-section" class="modulo-bi-section" hidden>
        <div class="section-heading">
          <div>
            <p class="section-kicker">INDICADORES E RESULTADOS</p>
            <h2>BI Aprendiz</h2>
            <p class="muted">Histórico mensal, metas e relatório detalhado.</p>
          </div>
          <button type="button" class="modulo-bi-acao" id="bi-aprendiz-atualizar">
            ↻ Atualizar dados
          </button>
        </div>

        <div class="modulo-bi-filtros">
          <label>Ano
            <select id="bi-aprendiz-ano"><option value="">Todos os anos</option></select>
          </label>
          <label>Mês
            <select id="bi-aprendiz-mes"><option value="">Todos os meses</option></select>
          </label>
          <label>Subsede
            <select id="bi-aprendiz-subsede"><option value="">Todas as subsedes</option></select>
          </label>
        </div>

        <div class="modulo-bi-kpis">
          <article class="modulo-bi-card"><span>Faturamento histórico</span><strong id="bi-aprendiz-faturamento">—</strong></article>
          <article class="modulo-bi-card"><span>Jovens registrados no histórico</span><strong id="bi-aprendiz-jovens">—</strong></article>
          <article class="modulo-bi-card"><span>TKM médio calculado</span><strong id="bi-aprendiz-tkm">—</strong></article>
          <article class="modulo-bi-card"><span>Empresas registradas</span><strong id="bi-aprendiz-empresas">—</strong></article>
        </div>

        <div class="modulo-bi-paineis">
          <article class="modulo-bi-grafico">
            <h3>Faturamento por mês</h3>
            <canvas id="bi-aprendiz-grafico-faturamento"></canvas>
          </article>
          <article class="modulo-bi-grafico">
            <h3>Jovens por mês</h3>
            <canvas id="bi-aprendiz-grafico-jovens"></canvas>
          </article>
        </div>

        <article class="modulo-bi-tabela">
          <div class="modulo-bi-tabela-topo">
            <div>
              <h3>Histórico de Aprendiz</h3>
              <p class="muted">Valores conforme os registros importados.</p>
            </div>
            <span id="bi-aprendiz-contagem" class="modulo-bi-badge">0 registros</span>
          </div>
          <div class="modulo-bi-tabela-scroll">
            <table>
              <thead><tr>
                <th>Referência</th><th>Local de atendimento</th><th>Subsede</th>
                <th>Tipo</th><th>Faturamento</th><th>Jovens</th><th>TKM</th>
                <th>Empresas</th><th>Meta jovens</th><th>Meta faturamento</th>
              </tr></thead>
              <tbody id="bi-aprendiz-tabela"></tbody>
            </table>
          </div>
          <div class="modulo-bi-paginacao">
            <span id="bi-aprendiz-pagina-info">Página 1</span>
            <div>
              <button id="bi-aprendiz-anterior" type="button">← Anterior</button>
              <button id="bi-aprendiz-proxima" type="button">Próxima →</button>
            </div>
          </div>
        </article>

        <article class="modulo-bi-tabela">
          <div class="modulo-bi-tabela-topo">
            <div>
              <h3>Relatório detalhado de Aprendiz</h3>
              <p class="muted">Consulta por empresa, aprendiz, cidade, subsede e Cartão Futuro.</p>
            </div>
            <span id="bi-detalhado-contagem" class="modulo-bi-badge">0 registros</span>
          </div>
          <div class="modulo-bi-filtros">
            <label>Buscar empresa, CNPJ ou aprendiz
              <input id="bi-detalhado-busca" type="search" placeholder="Digite para pesquisar...">
            </label>
            <label>Subsede
              <select id="bi-detalhado-subsede"><option value="">Todas as subsedes</option></select>
            </label>
            <label>Cartão Futuro
              <select id="bi-detalhado-cartao">
                <option value="">Todos os registros</option>
                <option value="sim">Somente Cartão Futuro</option>
                <option value="nao">Sem Cartão Futuro</option>
              </select>
            </label>
          </div>
          <p id="bi-detalhado-resumo" class="modulo-bi-aviso"></p>
          <div class="modulo-bi-tabela-scroll">
            <table>
              <thead><tr>
                <th>Período</th><th>Empresa</th><th>CNPJ</th><th>Aprendiz</th>
                <th>Angariador</th><th>Cidade</th><th>Subsede</th>
                <th>Início</th><th>Fim</th><th>Tipo</th><th>Cartão Futuro</th>
              </tr></thead>
              <tbody id="bi-detalhado-tabela"></tbody>
            </table>
          </div>
          <div class="modulo-bi-paginacao">
            <span id="bi-detalhado-pagina-info">Página 1</span>
            <div>
              <button id="bi-detalhado-anterior" type="button">← Anterior</button>
              <button id="bi-detalhado-proxima" type="button">Próxima →</button>
            </div>
          </div>
        </article>
      </section>

      <section id="bi-estagio-section" class="modulo-bi-section" hidden>
        <div class="section-heading">
          <div>
            <p class="section-kicker">INDICADORES E METAS</p>
            <h2>BI Estágio</h2>
            <p class="muted">Faturamento, jovens, TKM e evolução mensal por subsede.</p>
          </div>
          <button type="button" class="modulo-bi-acao" id="bi-estagio-atualizar">
            ↻ Atualizar dados
          </button>
        </div>

        <div class="modulo-bi-filtros">
          <label>Ano
            <select id="bi-estagio-ano"><option value="">Todos os anos</option></select>
          </label>
          <label>Mês
            <select id="bi-estagio-mes"><option value="">Todos os meses</option></select>
          </label>
          <label>Subsede
            <select id="bi-estagio-subsede"><option value="">Todas as subsedes</option></select>
          </label>
        </div>

        <div class="modulo-bi-kpis">
          <article class="modulo-bi-card"><span>Faturamento</span><strong id="bi-estagio-faturamento">—</strong></article>
          <article class="modulo-bi-card"><span>Jovens registrados</span><strong id="bi-estagio-jovens">—</strong></article>
          <article class="modulo-bi-card"><span>TKM médio calculado</span><strong id="bi-estagio-tkm">—</strong></article>
          <article class="modulo-bi-card"><span>Atingimento da meta de faturamento</span><strong id="bi-estagio-atingimento">—</strong></article>
        </div>

        <div class="modulo-bi-paineis">
          <article class="modulo-bi-grafico">
            <h3>Faturamento por mês</h3>
            <canvas id="bi-estagio-grafico-faturamento"></canvas>
          </article>
          <article class="modulo-bi-grafico">
            <h3>Jovens por mês</h3>
            <canvas id="bi-estagio-grafico-jovens"></canvas>
          </article>
        </div>

        <article class="modulo-bi-tabela">
          <div class="modulo-bi-tabela-topo">
            <div><h3>Histórico e metas de Estágio</h3></div>
            <span id="bi-estagio-contagem" class="modulo-bi-badge">0 registros</span>
          </div>
          <div class="modulo-bi-tabela-scroll">
            <table>
              <thead><tr>
                <th>Referência</th><th>Subsede</th><th>Faturamento</th>
                <th>Meta faturamento</th><th>Atingimento</th><th>Jovens</th>
                <th>Meta jovens</th><th>TKM</th>
              </tr></thead>
              <tbody id="bi-estagio-tabela"></tbody>
            </table>
          </div>
          <div class="modulo-bi-paginacao">
            <span id="bi-estagio-pagina-info">Página 1</span>
            <div>
              <button id="bi-estagio-anterior" type="button">← Anterior</button>
              <button id="bi-estagio-proxima" type="button">Próxima →</button>
            </div>
          </div>
        </article>
      </section>

      <section id="bi-carteiras-section" class="modulo-bi-section" hidden>
        <div class="section-heading">
          <div>
            <p class="section-kicker">DESEMPENHO COMERCIAL</p>
            <h2>Carteiras dos Consultores</h2>
            <p class="muted">Histórico de janeiro a agosto, faturamento, jovens ativos, TKM e crescimento.</p>
          </div>
          <button type="button" class="modulo-bi-acao" id="bi-carteiras-atualizar">
            ↻ Atualizar dados
          </button>
        </div>

        <div class="modulo-bi-filtros">
          <label>Ano
            <select id="bi-carteira-ano"><option value="">Todos os anos</option></select>
          </label>
          <label>Mês
            <select id="bi-carteira-mes"><option value="">Todos os meses</option></select>
          </label>
          <label>Subsede
            <select id="bi-carteira-subsede"><option value="">Todas as subsedes</option></select>
          </label>
          <label>Angariador
            <select id="bi-carteira-angariador"><option value="">Todos os angariadores</option></select>
          </label>
        </div>

        <div class="modulo-bi-kpis">
          <article class="modulo-bi-card"><span>Faturamento da carteira</span><strong id="bi-carteira-faturamento">—</strong></article>
          <article class="modulo-bi-card"><span>Jovens ativos registrados</span><strong id="bi-carteira-jovens">—</strong></article>
          <article class="modulo-bi-card"><span>TKM médio calculado</span><strong id="bi-carteira-tkm">—</strong></article>
          <article class="modulo-bi-card"><span>Crescimento médio registrado</span><strong id="bi-carteira-crescimento">—</strong></article>
        </div>

        <div class="modulo-bi-paineis">
          <article class="modulo-bi-grafico">
            <h3>Faturamento mensal da carteira</h3>
            <canvas id="bi-carteira-grafico-faturamento"></canvas>
          </article>
          <article class="modulo-bi-grafico">
            <h3>Ranking de faturamento por angariador</h3>
            <canvas id="bi-carteira-grafico-ranking"></canvas>
          </article>
        </div>

        <article class="modulo-bi-tabela">
          <div class="modulo-bi-tabela-topo">
            <div><h3>Histórico das carteiras</h3></div>
            <span id="bi-carteira-contagem" class="modulo-bi-badge">0 registros</span>
          </div>
          <div class="modulo-bi-tabela-scroll">
            <table>
              <thead><tr>
                <th>Referência</th><th>Subsede</th><th>Angariador</th>
                <th>Faturamento</th><th>Jovens ativos</th><th>TKM</th>
                <th>Crescimento</th><th>Data de início</th>
              </tr></thead>
              <tbody id="bi-carteira-tabela"></tbody>
            </table>
          </div>
          <div class="modulo-bi-paginacao">
            <span id="bi-carteira-pagina-info">Página 1</span>
            <div>
              <button id="bi-carteira-anterior" type="button">← Anterior</button>
              <button id="bi-carteira-proxima" type="button">Próxima →</button>
            </div>
          </div>
        </article>
      </section>
    `;

    main.insertBefore(secao, footer);
    moduloBIState.inicializado = true;

    moduloBIConfigurarEventos();
  }

  // ========================================================
  // EVENTOS E NAVEGAÇÃO
  // ========================================================

  function moduloBIConfigurarEventos() {
    const navegacao = [
      ["bi-aprendiz-nav", "bi-aprendiz-section"],
      ["bi-estagio-nav", "bi-estagio-section"],
      ["bi-carteiras-nav", "bi-carteiras-section"]
    ];

    navegacao.forEach(([linkId, secaoId]) => {
      moduloBI$(linkId)?.addEventListener("click", evento => {
        evento.preventDefault();

        const secao = moduloBI$(secaoId);
        if (!secao) return;

        secao.hidden = false;

        document.querySelectorAll(
          "#bi-aprendiz-section, #bi-estagio-section, #bi-carteiras-section"
        ).forEach(item => {
          if (item !== secao) item.hidden = true;
        });

        document.querySelectorAll("#modulos-bi-nav .nav-link").forEach(link => {
          link.classList.toggle("active", link.id === linkId);
        });

        secao.scrollIntoView({ behavior: "smooth", block: "start" });

        if (window.Chart) {
          setTimeout(() => {
            Object.values(moduloBIState.graficos).forEach(grafico => {
              if (grafico && typeof grafico.resize === "function") {
                grafico.resize();
              }
            });
          }, 150);
        }
      });
    });

    const eventosFiltro = {
      "bi-aprendiz-ano": ["aprendizAno", renderizarAprendiz],
      "bi-aprendiz-mes": ["aprendizMes", renderizarAprendiz],
      "bi-aprendiz-subsede": ["aprendizSubsede", renderizarAprendiz],
      "bi-detalhado-busca": ["detalheBusca", renderizarDetalhado],
      "bi-detalhado-subsede": ["detalheSubsede", renderizarDetalhado],
      "bi-detalhado-cartao": ["detalheCartao", renderizarDetalhado],
      "bi-estagio-ano": ["estagioAno", renderizarEstagio],
      "bi-estagio-mes": ["estagioMes", renderizarEstagio],
      "bi-estagio-subsede": ["estagioSubsede", renderizarEstagio],
      "bi-carteira-ano": ["carteiraAno", renderizarCarteiras],
      "bi-carteira-mes": ["carteiraMes", renderizarCarteiras],
      "bi-carteira-subsede": ["carteiraSubsede", renderizarCarteiras],
      "bi-carteira-angariador": ["aprendizAngariador", renderizarCarteiras]
    };

    Object.entries(eventosFiltro).forEach(([id, [chave, renderizar]]) => {
      moduloBI$(id)?.addEventListener("input", evento => {
        moduloBIState.filtros[chave] = evento.target.value;
        moduloBIState.paginas.detalhado = 1;
        moduloBIState.paginas.aprendiz = 1;
        moduloBIState.paginas.carteira = 1;
        moduloBIState.paginas.estagio = 1;
        renderizar();
      });

      moduloBI$(id)?.addEventListener("change", evento => {
        moduloBIState.filtros[chave] = evento.target.value;
        moduloBIState.paginas.detalhado = 1;
        moduloBIState.paginas.aprendiz = 1;
        moduloBIState.paginas.carteira = 1;
        moduloBIState.paginas.estagio = 1;
        renderizar();
      });
    });

    const botoesAtualizar = [
      ["bi-aprendiz-atualizar", carregarModulosBI],
      ["bi-estagio-atualizar", carregarModulosBI],
      ["bi-carteiras-atualizar", carregarModulosBI]
    ];

    botoesAtualizar.forEach(([id, callback]) => {
      moduloBI$(id)?.addEventListener("click", callback);
    });

    moduloBIConfigurarPaginacao(
      "aprendiz",
      "bi-aprendiz-anterior",
      "bi-aprendiz-proxima",
      renderizarAprendiz
    );

    moduloBIConfigurarPaginacao(
      "detalhado",
      "bi-detalhado-anterior",
      "bi-detalhado-proxima",
      renderizarDetalhado
    );

    moduloBIConfigurarPaginacao(
      "estagio",
      "bi-estagio-anterior",
      "bi-estagio-proxima",
      renderizarEstagio
    );

    moduloBIConfigurarPaginacao(
      "carteira",
      "bi-carteira-anterior",
      "bi-carteira-proxima",
      renderizarCarteiras
    );
  }

  function moduloBIConfigurarPaginacao(chave, idAnterior, idProxima, renderizar) {
    moduloBI$(idAnterior)?.addEventListener("click", () => {
      if (moduloBIState.paginas[chave] > 1) {
        moduloBIState.paginas[chave]--;
        renderizar();
      }
    });

    moduloBI$(idProxima)?.addEventListener("click", () => {
      moduloBIState.paginas[chave]++;
      renderizar();
    });
  }

  // ========================================================
  // CONSULTA E CARREGAMENTO DOS DADOS
  // ========================================================

  async function carregarModulosBI() {
    if (moduloBIState.carregando) return;

    if (typeof sb === "undefined" || !sb) {
      moduloBIMensagem(
        "A conexão com o Supabase não está disponível. Confira o config.js.",
        true
      );
      return;
    }

    moduloBIState.carregando = true;
    moduloBIMensagem("Consultando as tabelas do Supabase...");

    [
      "bi-aprendiz-atualizar",
      "bi-estagio-atualizar",
      "bi-carteiras-atualizar"
    ].forEach(id => {
      const botao = moduloBI$(id);
      if (botao) botao.disabled = true;
    });

    try {
      const resultados = await Promise.all([
        moduloBIBuscarTabela(MODULOS_BI.aprendizHistorico),
        moduloBIBuscarTabela(MODULOS_BI.aprendizCarteira),
        moduloBIBuscarTabela(MODULOS_BI.aprendizDetalhado),
        moduloBIBuscarTabela(MODULOS_BI.estagioHistorico)
      ]);

      moduloBIState.aprendizHistorico = resultados[0];
      moduloBIState.aprendizCarteira = resultados[1];
      moduloBIState.aprendizDetalhado = resultados[2];
      moduloBIState.estagioHistorico = resultados[3];

      moduloBIPreencherFiltros();

      renderizarAprendiz();
      renderizarDetalhado();
      renderizarEstagio();
      renderizarCarteiras();

      moduloBIMensagem(
        "Dados carregados. Os indicadores refletem os registros disponíveis nas tabelas do Supabase."
      );
    } catch (erro) {
      console.error("Erro ao carregar os módulos BI:", erro);

      moduloBIMensagem(
        erro?.message ||
          "Não foi possível carregar os dados. Verifique as tabelas, as permissões RLS e a conexão com o Supabase.",
        true
      );
    } finally {
      moduloBIState.carregando = false;

      [
        "bi-aprendiz-atualizar",
        "bi-estagio-atualizar",
        "bi-carteiras-atualizar"
      ].forEach(id => {
        const botao = moduloBI$(id);
        if (botao) botao.disabled = false;
      });
    }
  }

  function moduloBIPreencherFiltros() {
    const aprendiz = moduloBIState.aprendizHistorico;
    const carteira = moduloBIState.aprendizCarteira;
    const detalhado = moduloBIState.aprendizDetalhado;
    const estagio = moduloBIState.estagioHistorico;

    moduloBIOptions(
      "bi-aprendiz-ano",
      moduloBIUnicos(aprendiz.map(moduloBIAno)),
      "Todos os anos"
    );

    moduloBIOptions(
      "bi-aprendiz-mes",
      [...new Set(aprendiz.map(moduloBIMes).filter(Boolean))]
        .sort((a, b) => a - b)
        .map(String),
      "Todos os meses"
    );

    moduloBIOptions(
      "bi-aprendiz-subsede",
      moduloBIUnicos(aprendiz.map(r => r.subsede)),
      "Todas as subsedes"
    );

    moduloBIOptions(
      "bi-detalhado-subsede",
      moduloBIUnicos(detalhado.map(r => r.subsede)),
      "Todas as subsedes"
    );

    moduloBIOptions(
      "bi-estagio-ano",
      moduloBIUnicos(estagio.map(moduloBIAno)),
      "Todos os anos"
    );

    moduloBIOptions(
      "bi-estagio-mes",
      [...new Set(estagio.map(moduloBIMes).filter(Boolean))]
        .sort((a, b) => a - b)
        .map(String),
      "Todos os meses"
    );

    moduloBIOptions(
      "bi-estagio-subsede",
      moduloBIUnicos(estagio.map(r => r.subsede)),
      "Todas as subsedes"
    );

    moduloBIOptions(
      "bi-carteira-ano",
      moduloBIUnicos(carteira.map(moduloBIAno)),
      "Todos os anos"
    );

    moduloBIOptions(
      "bi-carteira-mes",
      [...new Set(carteira.map(moduloBIMes).filter(Boolean))]
        .sort((a, b) => a - b)
        .map(String),
      "Todos os meses"
    );

    moduloBIOptions(
      "bi-carteira-subsede",
      moduloBIUnicos(carteira.map(r => r.subsede)),
      "Todas as subsedes"
    );

    moduloBIOptions(
      "bi-carteira-angariador",
      moduloBIUnicos(carteira.map(r => r.angariador)),
      "Todos os angariadores"
    );
  }

  function moduloBIFiltrarHistorico(registros, prefixo) {
    const ano = moduloBIState.filtros[`${prefixo}Ano`];
    const mes = moduloBIState.filtros[`${prefixo}Mes`];
    const subsede = moduloBIState.filtros[`${prefixo}Subsede`];

    return registros.filter(r => {
      if (ano && moduloBIAno(r) !== ano) return false;
      if (mes && String(moduloBIMes(r)) !== mes) return false;
      if (subsede && String(r.subsede || "") !== subsede) return false;
      return true;
    });
  }

  // Linhas consolidadas podem coexistir com linhas por unidade.
  // Para KPIs, gráficos e somas, removemos as linhas explicitamente
  // identificadas como TOTAL/CONSOLIDADO para evitar somá-las novamente.
  function moduloBIRegistrosParaSomar(registros) {
    return registros.filter(r => !moduloBIRegistroAgregado(r));
  }

  // ========================================================
  // GRÁFICOS
  // ========================================================

  function moduloBIRenderizarGrafico(idCanvas, chave, labels, datasets, tipo = "bar") {
    const canvas = moduloBI$(idCanvas);
    if (!canvas || !window.Chart) return;

    if (moduloBIState.graficos[chave]) {
      moduloBIState.graficos[chave].destroy();
    }

    moduloBIState.graficos[chave] = new Chart(canvas, {
      type: tipo,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { display: datasets.length > 1 },
          tooltip: {
            callbacks: {
              label(contexto) {
                const valor = contexto.parsed?.y ?? contexto.parsed;
                const titulo = contexto.dataset?.label || "";

                return `${titulo}: ${
                  typeof valor === "number"
                    ? valor.toLocaleString("pt-BR", {
                        maximumFractionDigits: 2
                      })
                    : valor
                }`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback(valor) {
                return Number(valor).toLocaleString("pt-BR");
              }
            }
          }
        }
      }
    });
  }

  function moduloBIAgruparPorMes(registros, campo) {
    const mapa = new Map();

    registros.forEach(r => {
      const ano = moduloBIAno(r);
      const mes = moduloBIMes(r);

      if (!ano || !mes) return;

      const chave = `${ano}-${String(mes).padStart(2, "0")}`;
      mapa.set(chave, (mapa.get(chave) || 0) + moduloBINumero(r[campo]));
    });

    const entradas = [...mapa.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    );

    return {
      labels: entradas.map(([chave]) => {
        const [ano, mes] = chave.split("-");
        return `${moduloBIMesNome(mes).slice(0, 3)}/${ano}`;
      }),
      valores: entradas.map(([, valor]) => valor)
    };
  }

  function moduloBIAtualizarTexto(id, valor) {
    const el = moduloBI$(id);
    if (el) el.textContent = valor;
  }

  function moduloBITotal(registros, campo) {
    return registros.reduce((total, r) => total + moduloBINumero(r[campo]), 0);
  }

  function moduloBITKM(faturamento, jovens) {
    return jovens > 0 ? faturamento / jovens : 0;
  }

  function moduloBIPaginar(registros, chave, idInfo, idAnterior, idProxima) {
    const total = registros.length;
    const paginas = Math.max(1, Math.ceil(total / MODULO_TABELA_PAGE_SIZE));

    moduloBIState.paginas[chave] = Math.min(
      Math.max(1, moduloBIState.paginas[chave]),
      paginas
    );

    const pagina = moduloBIState.paginas[chave];
    const inicio = (pagina - 1) * MODULO_TABELA_PAGE_SIZE;
    const fim = Math.min(inicio + MODULO_TABELA_PAGE_SIZE, total);

    moduloBIAtualizarTexto(
      idInfo,
      total
        ? `Exibindo ${inicio + 1}–${fim} de ${total.toLocaleString("pt-BR")} · Página ${pagina} de ${paginas}`
        : "Nenhum registro para exibir."
    );

    const anterior = moduloBI$(idAnterior);
    const proxima = moduloBI$(idProxima);

    if (anterior) anterior.disabled = pagina <= 1;
    if (proxima) proxima.disabled = pagina >= paginas;

    return registros.slice(inicio, fim);
  }

  // ========================================================
  // BI APRENDIZ — HISTÓRICO
  // ========================================================

  function renderizarAprendiz() {
    const filtrados = moduloBIFiltrarHistorico(
      moduloBIState.aprendizHistorico,
      "aprendiz"
    );

    const paraSomar = moduloBIRegistrosParaSomar(filtrados);

    const faturamento = moduloBITotal(paraSomar, "faturado");
    const jovens = moduloBITotal(paraSomar, "numero_jovens");
    const empresas = moduloBITotal(paraSomar, "quantidade_empresas");

    moduloBIAtualizarTexto("bi-aprendiz-faturamento", moduloBIMoeda(faturamento));
    moduloBIAtualizarTexto("bi-aprendiz-jovens", moduloBINumeroFormatado(jovens));
    moduloBIAtualizarTexto(
      "bi-aprendiz-tkm",
      moduloBIMoeda(moduloBITKM(faturamento, jovens))
    );
    moduloBIAtualizarTexto(
      "bi-aprendiz-empresas",
      moduloBINumeroFormatado(empresas)
    );
    moduloBIAtualizarTexto(
      "bi-aprendiz-contagem",
      `${filtrados.length.toLocaleString("pt-BR")} registros`
    );

    const graficoFaturamento = moduloBIAgruparPorMes(
      paraSomar,
      "faturado"
    );

    const graficoJovens = moduloBIAgruparPorMes(
      paraSomar,
      "numero_jovens"
    );

    moduloBIRenderizarGrafico(
      "bi-aprendiz-grafico-faturamento",
      "aprendizFaturamento",
      graficoFaturamento.labels,
      [{
        label: "Faturamento",
        data: graficoFaturamento.valores,
        backgroundColor: "#2474c7"
      }]
    );

    moduloBIRenderizarGrafico(
      "bi-aprendiz-grafico-jovens",
      "aprendizJovens",
      graficoJovens.labels,
      [{
        label: "Jovens",
        data: graficoJovens.valores,
        backgroundColor: "#16835b"
      }]
    );

    const pagina = moduloBIPaginar(
      filtrados,
      "aprendiz",
      "bi-aprendiz-pagina-info",
      "bi-aprendiz-anterior",
      "bi-aprendiz-proxima"
    );

    const tbody = moduloBI$("bi-aprendiz-tabela");
    if (!tbody) return;

    tbody.innerHTML = pagina.map(r => `
      <tr>
        <td>${moduloBIEscapar(moduloBIMesNome(moduloBIMes(r)) + "/" + moduloBIAno(r))}</td>
        <td>${moduloBIEscapar(r.local_atendimento || "—")}</td>
        <td>${moduloBIEscapar(r.subsede || "—")}</td>
        <td>${moduloBIEscapar(r.tipo || "—")}</td>
        <td>${moduloBIEscapar(moduloBIMoeda(r.faturado))}</td>
        <td>${moduloBIEscapar(moduloBINumeroFormatado(r.numero_jovens))}</td>
        <td>${moduloBIEscapar(moduloBIMoeda(r.ticket_medio))}</td>
        <td>${moduloBIEscapar(moduloBINumeroFormatado(r.quantidade_empresas))}</td>
        <td>${moduloBIEscapar(moduloBINumeroFormatado(r.meta_numero_jovens))}</td>
        <td>${moduloBIEscapar(moduloBIMoeda(r.meta_faturamento))}</td>
      </tr>
    `).join("");

    if (!pagina.length) {
      tbody.innerHTML = `<tr><td colspan="10">Nenhum registro encontrado.</td></tr>`;
    }
  }

  // ========================================================
  // BI APRENDIZ — RELATÓRIO DETALHADO
  // ========================================================

  function renderizarDetalhado() {
    const busca = String(moduloBIState.filtros.detalheBusca || "")
      .trim()
      .toLowerCase();

    const subsede = moduloBIState.filtros.detalheSubsede;
    const cartao = moduloBIState.filtros.detalheCartao;

    const filtrados = moduloBIState.aprendizDetalhado.filter(r => {
      if (subsede && String(r.subsede || "") !== subsede) return false;

      const ehCartao = moduloBIEhCartaoFuturo(r);

      if (cartao === "sim" && !ehCartao) return false;
      if (cartao === "nao" && ehCartao) return false;

      if (busca) {
        const texto = [
          r.empresa, r.cnpj, r.aprendiz, r.angariador,
          r.cidade, r.subsede, r.tipo, r.periodo
        ].join(" ").toLowerCase();

        if (!texto.includes(busca)) return false;
      }

      return true;
    });

    const cartoesFuturos = filtrados.filter(m => moduloBIEhCartaoFuturo(m));
    const demais = filtrados.filter(m => !moduloBIEhCartaoFuturo(m));

    moduloBIAtualizarTexto(
      "bi-detalhado-contagem",
      `${filtrados.length.toLocaleString("pt-BR")} registros`
    );

    moduloBIAtualizarTexto(
      "bi-detalhado-resumo",
      `${filtrados.length.toLocaleString("pt-BR")} registros filtrados · ` +
      `${demais.length.toLocaleString("pt-BR")} sem identificação de Cartão Futuro · ` +
      `${cartoesFuturos.length.toLocaleString("pt-BR")} identificados como Cartão Futuro. ` +
      "Essas categorias são exibidas separadamente e não são adicionadas ao faturamento histórico."
    );

    const pagina = moduloBIPaginar(
      filtrados,
      "detalhado",
      "bi-detalhado-pagina-info",
      "bi-detalhado-anterior",
      "bi-detalhado-proxima"
    );

    const tbody = moduloBI$("bi-detalhado-tabela");
    if (!tbody) return;

    tbody.innerHTML = pagina.map(r => `
      <tr>
        <td>${moduloBIEscapar(r.periodo || "—")}</td>
        <td>${moduloBIEscapar(r.empresa || "—")}</td>
        <td>${moduloBIEscapar(r.cnpj || "—")}</td>
        <td>${moduloBIEscapar(r.aprendiz || "—")}</td>
        <td>${moduloBIEscapar(r.angariador || "—")}</td>
        <td>${moduloBIEscapar(r.cidade || "—")}</td>
        <td>${moduloBIEscapar(r.subsede || "—")}</td>
        <td>${moduloBIEscapar(moduloBIDataTexto(r.data_inicio))}</td>
        <td>${moduloBIEscapar(moduloBIDataTexto(r.data_fim))}</td>
        <td>${moduloBIEscapar(r.tipo || "—")}</td>
        <td>${moduloBIEhCartaoFuturo(r) ? "Sim" : "Não identificado"}</td>
      </tr>
    `).join("");

    if (!pagina.length) {
      tbody.innerHTML = `<tr><td colspan="11">Nenhum registro encontrado.</td></tr>`;
    }
  }

  // ========================================================
  // BI ESTÁGIO
  // ========================================================

  function renderizarEstagio() {
    const filtrados = moduloBIFiltrarHistorico(
      moduloBIState.estagioHistorico,
      "estagio"
    );

    const paraSomar = moduloBIRegistrosParaSomar(filtrados);

    const faturamento = moduloBITotal(paraSomar, "faturado");
    const jovens = moduloBITotal(paraSomar, "numero_jovens");
    const metaFaturamento = moduloBITotal(paraSomar, "meta_faturamento");
    const metaJovens = moduloBITotal(paraSomar, "meta_numero_jovens");

    const atingimento = metaFaturamento > 0
      ? faturamento / metaFaturamento * 100
      : 0;

    moduloBIAtualizarTexto("bi-estagio-faturamento", moduloBIMoeda(faturamento));
    moduloBIAtualizarTexto("bi-estagio-jovens", moduloBINumeroFormatado(jovens));
    moduloBIAtualizarTexto(
      "bi-estagio-tkm",
      moduloBIMoeda(moduloBITKM(faturamento, jovens))
    );
    moduloBIAtualizarTexto(
      "bi-estagio-atingimento",
      metaFaturamento > 0 ? `${moduloBINumeroFormatado(atingimento, 1)}%` : "Sem meta"
    );
    moduloBIAtualizarTexto(
      "bi-estagio-contagem",
      `${filtrados.length.toLocaleString("pt-BR")} registros`
    );

    const faturamentoMes = moduloBIAgruparPorMes(paraSomar, "faturado");
    const jovensMes = moduloBIAgruparPorMes(paraSomar, "numero_jovens");

    moduloBIRenderizarGrafico(
      "bi-estagio-grafico-faturamento",
      "estagioFaturamento",
      faturamentoMes.labels,
      [{
        label: "Faturamento",
        data: faturamentoMes.valores,
        backgroundColor: "#2474c7"
      }]
    );

    moduloBIRenderizarGrafico(
      "bi-estagio-grafico-jovens",
      "estagioJovens",
      jovensMes.labels,
      [{
        label: "Jovens",
        data: jovensMes.valores,
        backgroundColor: "#16835b"
      }]
    );

    const pagina = moduloBIPaginar(
      filtrados,
      "estagio",
      "bi-estagio-pagina-info",
      "bi-estagio-anterior",
      "bi-estagio-proxima"
    );

    const tbody = moduloBI$("bi-estagio-tabela");
    if (!tbody) return;

    tbody.innerHTML = pagina.map(r => {
      const meta = moduloBINumero(r.meta_faturamento);
      const atual = moduloBINumero(r.faturado);
      const percentual = meta > 0 ? atual / meta * 100 : null;

      return `
        <tr>
          <td>${moduloBIEscapar(moduloBIMesNome(moduloBIMes(r)) + "/" + moduloBIAno(r))}</td>
          <td>${moduloBIEscapar(r.subsede || "—")}</td>
          <td>${moduloBIEscapar(moduloBIMoeda(r.faturado))}</td>
          <td>${moduloBIEscapar(moduloBIMoeda(meta))}</td>
          <td>${percentual === null ? "Sem meta" : `${moduloBINumeroFormatado(percentual, 1)}%`}</td>
          <td>${moduloBIEscapar(moduloBINumeroFormatado(r.numero_jovens))}</td>
          <td>${moduloBIEscapar(moduloBINumeroFormatado(r.meta_numero_jovens))}</td>
          <td>${moduloBIEscapar(moduloBIMoeda(r.ticket_medio))}</td>
        </tr>
      `;
    }).join("");

    if (!pagina.length) {
      tbody.innerHTML = `<tr><td colspan="8">Nenhum registro encontrado.</td></tr>`;
    }
  }

  // ========================================================
  // CARTEIRAS DOS CONSULTORES
  // ========================================================

  function renderizarCarteiras() {
    const ano = moduloBIState.filtros.carteiraAno;
    const mes = moduloBIState.filtros.carteiraMes;
    const subsede = moduloBIState.filtros.carteiraSubsede;
    const angariador = moduloBIState.filtros.aprendizAngariador;

    const filtrados = moduloBIState.aprendizCarteira.filter(r => {
      if (ano && moduloBIAno(r) !== ano) return false;
      if (mes && String(moduloBIMes(r)) !== mes) return false;
      if (subsede && String(r.subsede || "") !== subsede) return false;
      if (angariador && String(r.angariador || "") !== angariador) return false;
      return true;
    });

    const paraSomar = moduloBIRegistrosParaSomar(filtrados);

    const faturamento = moduloBITotal(paraSomar, "faturamento");
    const jovens = moduloBITotal(paraSomar, "jovens_ativos");

    const tkmMedio = moduloBITKM(faturamento, jovens);

    const crescimentoValores = paraSomar
      .map(r => r.crescimento_percentual)
      .filter(v => v !== null && v !== undefined && v !== "")
      .map(moduloBINumero);

    const crescimentoMedio = crescimentoValores.length
      ? crescimentoValores.reduce((soma, valor) => soma + valor, 0) /
        crescimentoValores.length
      : null;

    moduloBIAtualizarTexto("bi-carteira-faturamento", moduloBIMoeda(faturamento));
    moduloBIAtualizarTexto("bi-carteira-jovens", moduloBINumeroFormatado(jovens));
    moduloBIAtualizarTexto("bi-carteira-tkm", moduloBIMoeda(tkmMedio));
    moduloBIAtualizarTexto(
      "bi-carteira-crescimento",
      crescimentoMedio === null
        ? "—"
        : `${moduloBINumeroFormatado(crescimentoMedio, 2)}%`
    );

    moduloBIAtualizarTexto(
      "bi-carteira-contagem",
      `${filtrados.length.toLocaleString("pt-BR")} registros`
    );

    const mensal = moduloBIAgruparPorMes(paraSomar, "faturamento");

    moduloBIRenderizarGrafico(
      "bi-carteira-grafico-faturamento",
      "carteiraFaturamento",
      mensal.labels,
      [{
        label: "Faturamento",
        data: mensal.valores,
        backgroundColor: "#2474c7"
      }]
    );

    const rankingMap = new Map();

    paraSomar.forEach(r => {
      const nome = String(r.angariador || "Não informado");
      rankingMap.set(
        nome,
        (rankingMap.get(nome) || 0) + moduloBINumero(r.faturamento)
      );
    });

    const ranking = [...rankingMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    moduloBIRenderizarGrafico(
      "bi-carteira-grafico-ranking",
      "carteiraRanking",
      ranking.map(([nome]) => nome),
      [{
        label: "Faturamento",
        data: ranking.map(([, valor]) => valor),
        backgroundColor: "#16835b"
      }],
      "bar"
    );

    const pagina = moduloBIPaginar(
      filtrados,
      "carteira",
      "bi-carteira-pagina-info",
      "bi-carteira-anterior",
      "bi-carteira-proxima"
    );

    const tbody = moduloBI$("bi-carteira-tabela");
    if (!tbody) return;

    tbody.innerHTML = pagina.map(r => `
      <tr>
        <td>${moduloBIEscapar(moduloBIMesNome(moduloBIMes(r)) + "/" + moduloBIAno(r))}</td>
        <td>${moduloBIEscapar(r.subsede || "—")}</td>
        <td>${moduloBIEscapar(r.angariador || "—")}</td>
        <td>${moduloBIEscapar(moduloBIMoeda(r.faturamento))}</td>
        <td>${moduloBIEscapar(moduloBINumeroFormatado(r.jovens_ativos))}</td>
        <td>${moduloBIEscapar(moduloBIMoeda(r.tkm))}</td>
        <td>${r.crescimento_percentual === null || r.crescimento_percentual === undefined
          ? "—"
          : `${moduloBIEscapar(moduloBINumeroFormatado(r.crescimento_percentual, 2))}%`}</td>
        <td>${moduloBIEscapar(moduloBIDataTexto(r.data_inicio))}</td>
      </tr>
    `).join("");

    if (!pagina.length) {
      tbody.innerHTML = `<tr><td colspan="8">Nenhum registro encontrado.</td></tr>`;
    }
  }

  // ========================================================
  // INICIALIZAÇÃO APÓS O LOGIN
  // ========================================================

  function moduloBIObservarPortal() {
    moduloBICriarInterface();

    const portal = moduloBI$("portal-section");

    if (!portal) {
      moduloBIMensagem("Não foi encontrado o contêiner do portal.");
      return;
    }

    const observarVisibilidade = () => {
      if (!portal.hidden && !moduloBIState.inicializado) {
        moduloBICriarInterface();
        carregarModulosBI();
      }
    };

    observarVisibilidade();

    const observador = new MutationObserver(observarVisibilidade);
    observador.observe(portal, {
      attributes: true,
      attributeFilter: ["hidden", "class", "style"]
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", moduloBIObservarPortal, {
      once: true
    });
  } else {
    moduloBIObservarPortal();
  }
})();
