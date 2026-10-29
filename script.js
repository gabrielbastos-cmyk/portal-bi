"use strict";

let sb = window.sb; // Atualizado novamente nos carregamentos para evitar falha se Supabase iniciar depois do script.
const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let allDashboards = [];
let adminUsers = [];
let supervisorPermissionsReady = false;
let currentAccess = { module_keys: [], subsedes: [], dashboard_ids: [] };

function usuarioTemModulo(moduleKey) {
  if (currentProfile?.role === "admin") return true;
  if (currentProfile?.role === "supervisor") return currentAccess.module_keys.includes(moduleKey);
  return true; // Mantém o comportamento atual dos usuários comuns.
}

function dashboardEstaAutorizado(dashboard) {
  if (currentProfile?.role === "admin") return true;
  return currentAccess.dashboard_ids.map(String).includes(String(dashboard?.id));
}

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
    "ead-section", "ead-nav-link", "metas-aprendiz-section", "metas-aprendiz-nav-link", "metas-estagio-section", "metas-estagio-nav-link", "carteira-consultores-section", "carteira-consultores-nav-link"
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
  if (typeof window.inicializarCarteiraConsultores === "function") window.inicializarCarteiraConsultores();
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
    currentAccess = { module_keys: [], subsedes: [], dashboard_ids: [] };
    if (profile.role !== "admin") {
      const access = await adminCall("get_my_access");
      currentAccess = {
        module_keys: Array.isArray(access.module_keys) ? access.module_keys : [],
        subsedes: Array.isArray(access.subsedes) ? access.subsedes : [],
        dashboard_ids: Array.isArray(access.dashboard_ids) ? access.dashboard_ids.map(String) : []
      };
    }
    mostrarPortal();

    const isAdmin = profile.role === "admin";
    const vagasAllowed = isAdmin || profile.role !== "supervisor" || usuarioTemModulo("vagas_aprendiz");
    if ($("vagas-aprendiz-section")) $("vagas-aprendiz-section").hidden = !vagasAllowed;
    if ($("vagas-aprendiz-nav-link")) $("vagas-aprendiz-nav-link").hidden = !vagasAllowed;

    if ($("admin-section")) $("admin-section").hidden = !isAdmin;
    if ($("admin-nav-link")) {
      const adminLink = $("admin-nav-link");
      adminLink.hidden = !isAdmin;
      // Mantém Administração como o último item do menu principal.
      // O link continua dentro do mesmo contêiner de navegação.
      if (adminLink.parentElement) {
        adminLink.parentElement.appendChild(adminLink);
      }
    }

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

  const dashboardsVisiveis = allDashboards.filter(dashboardEstaAutorizado);
  dashboardsVisiveis.forEach(d => {
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

  if ($("summary-total")) $("summary-total").textContent = String(dashboardsVisiveis.length);

  if ($("summary-categories")) {
    $("summary-categories").textContent = String(
      new Set(dashboardsVisiveis.map(d => normalize(d.category || "outros"))).size
    );
  }

  aplicarFiltrosDashboards();
  renderizarDashboardsAdministrativos();
  configurarAcessoSubstituicoes();
  configurarAcessoEaD();
  configurarAcessoMetasAprendiz();
  configurarAcessoMetasEstagio();
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

  if (error) {
    const status = error.context?.status ? ` (HTTP ${error.context.status})` : "";
    throw new Error(`Falha na operação portal-admin${status}: ${error.message || "verifique a implantação e os logs da Edge Function."}`);
  }
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

const SUPERVISOR_MODULES = [
  { key: "ead", label: "Análise Geográfica EaD" },
  { key: "metas_aprendiz", label: "Metas Aprendiz" },
  { key: "metas_estagio", label: "Metas Estágio" },
  { key: "carteira_consultores", label: "Carteira de Consultores" },
  { key: "vagas_aprendiz", label: "Vagas Aprendiz" },
  { key: "substituicoes", label: "Controle de Substituições" },
  { key: "dashboards", label: "Dashboards" }
];

const KNOWN_SUBSEDES = [
  "Ambiente Digital", "Blumenau", "Campos Gerais", "Cascavel", "Chapecó",
  "Curitiba", "EAD - SÃO PAULO", "EAD GLOBAL Estados", "Florianópolis",
  "Foz do Iguaçu", "Foz do Itajaí", "Grande Florianópolis", "Grande Floripa",
  "Guarapuava", "Joinville", "Joinville e Itajai", "Joinville+Itajaí",
  "Londrina", "Maringá", "Oeste do Paraná", "Polos Curitiba", "Ponta Grossa"
];

function criarOpcaoPermissao(container, name, value, checked = false) {
  const label = document.createElement("label");
  label.className = "permission-option";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = name;
  input.value = value;
  input.checked = checked;
  const span = document.createElement("span");
  span.textContent = value.label || value;
  label.append(input, span);
  container.appendChild(label);
}

function renderizarOpcoesSupervisor(moduleKeys = [], subsedes = []) {
  const moduleList = $("permission-module-list");
  const subsedeList = $("permission-subsede-list");
  if (!moduleList || !subsedeList) return;

  moduleList.replaceChildren();
  SUPERVISOR_MODULES.forEach(module => {
    const label = document.createElement("label");
    label.className = "permission-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "supervisor-module";
    input.value = module.key;
    input.checked = moduleKeys.includes(module.key);
    const span = document.createElement("span");
    span.textContent = module.label;
    label.append(input, span);
    moduleList.appendChild(label);
  });

  subsedeList.replaceChildren();
  KNOWN_SUBSEDES.forEach(subsede => {
    const label = document.createElement("label");
    label.className = "permission-option";
    label.dataset.subsede = subsede.toLocaleLowerCase("pt-BR");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "supervisor-subsede";
    input.value = subsede;
    input.checked = subsedes.includes(subsede);
    const span = document.createElement("span");
    span.textContent = subsede;
    label.append(input, span);
    subsedeList.appendChild(label);
  });
  filtrarSubsedes();
}

function filtrarSubsedes() {
  const term = ($("permission-subsede-search")?.value || "").trim().toLocaleLowerCase("pt-BR");
  $("permission-subsede-list")?.querySelectorAll(".permission-option").forEach(item => {
    item.hidden = !item.dataset.subsede.includes(term);
  });
}

if ($("permission-subsede-search")) {
  $("permission-subsede-search").addEventListener("input", filtrarSubsedes);
}
if ($("select-visible-subsedes")) {
  $("select-visible-subsedes").addEventListener("click", () => {
    $("permission-subsede-list")?.querySelectorAll(".permission-option:not([hidden]) input").forEach(input => input.checked = true);
  });
}
if ($("clear-subsedes")) {
  $("clear-subsedes").addEventListener("click", () => {
    $("permission-subsede-list")?.querySelectorAll('input[name="supervisor-subsede"]').forEach(input => input.checked = false);
  });
}

function renderizarPermissoesDashboards(dashboards, idsAutorizados) {
  const container = $("permission-dashboard-list");
  if (!container) return;
  container.replaceChildren();
  const heading = document.createElement("h4");
  heading.textContent = "Dashboards autorizados";
  container.appendChild(heading);
  (dashboards || []).forEach(d => {
    const label = document.createElement("label");
    label.className = "permission-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(d.id);
    input.checked = idsAutorizados.has(String(d.id));
    const span = document.createElement("span");
    span.textContent = d.name || "Dashboard sem nome";
    label.append(input, span);
    container.appendChild(label);
  });
}

async function carregarPermissoesUsuario() {
  clearMessage("permission-message");
  supervisorPermissionsReady = false;

  const userId = $("permission-user")?.value;
  const dashboardContainer = $("permission-dashboard-list");
  const supervisorContainer = $("permission-supervisor-settings");
  const saveButton = $("save-permissions-btn");
  if (!dashboardContainer) return;

  dashboardContainer.replaceChildren();
  if (supervisorContainer) supervisorContainer.hidden = true;
  if (saveButton) saveButton.disabled = false;
  if (!userId) return;

  const user = adminUsers.find(u => u.id === userId);
  if (!user) return;

  if (user.role === "admin") {
    showMessage("permission-message", "Administradores possuem acesso a todos os dashboards.", "success");
    return;
  }

  if (user.role === "supervisor") {
    dashboardContainer.hidden = false;
    if (supervisorContainer) supervisorContainer.hidden = false;

    // Mostra as opções imediatamente, mas não permite salvar até confirmar
    // que as permissões atuais foram lidas do Supabase.
    renderizarOpcoesSupervisor([], []);
    if (saveButton) saveButton.disabled = true;

    try {
      if (!sb) throw new Error("O Supabase ainda não foi inicializado. Atualize a página e tente novamente.");
      // Lê as permissões pela Edge Function administrativa, que usa supabaseAdmin
      // e não depende das políticas RLS do navegador para essas tabelas.
      const result = await adminCall("get_supervisor_access", { user_id: userId });
      renderizarOpcoesSupervisor(
        Array.isArray(result.module_keys) ? result.module_keys : [],
        Array.isArray(result.subsedes) ? result.subsedes : []
      );
      const dashboardIds = new Set((result.dashboard_ids || []).map(String));
      const { data: dashboards, error: dashboardsError } = await sb
        .from("dashboards")
        .select("id, name, description, category, url")
        .order("name");
      if (dashboardsError) throw dashboardsError;
      renderizarPermissoesDashboards(dashboards || [], dashboardIds);
      supervisorPermissionsReady = true;
      if (saveButton) saveButton.disabled = false;
    } catch (error) {
      showMessage("permission-message", `${friendlyError(error)} As opções foram exibidas, mas o salvamento fica bloqueado para não substituir permissões que não foram carregadas.`, "error");
    }
    return;
  }

  dashboardContainer.hidden = false;
  try {
    const { data: permissions, error } = await sb
      .from("dashboard_permissions")
      .select("dashboard_id")
      .eq("user_id", userId);
    if (error) throw error;
    const ids = new Set((permissions || []).map(p => String(p.dashboard_id)));

    const { data: dashboards, error: dError } = await sb
      .from("dashboards")
      .select("id, name, description, category, url")
      .order("name");
    if (dError) throw dError;

    renderizarPermissoesDashboards(dashboards || [], ids);
  } catch (error) {
    showMessage("permission-message", friendlyError(error));
  }
}

if ($("save-permissions-btn")) {
  $("save-permissions-btn").addEventListener("click", async () => {
    const userId = $("permission-user")?.value;
    if (!userId) return showMessage("permission-message", "Selecione um usuário primeiro.");

    const user = adminUsers.find(u => u.id === userId);
    if (user?.role === "admin") {
      return showMessage("permission-message", "Administradores já possuem acesso a todos os dashboards.");
    }

    const button = $("save-permissions-btn");
    setLoading(button, true, "Salvando...");
    try {
      if (user?.role === "supervisor") {
        if (!supervisorPermissionsReady) {
          throw new Error("As permissões atuais do supervisor ainda não foram carregadas. Atualize a página e tente novamente antes de salvar.");
        }
        const module_keys = [...$("permission-module-list").querySelectorAll('input[name="supervisor-module"]:checked')].map(i => i.value);
        const subsedes = [...$("permission-subsede-list").querySelectorAll('input[name="supervisor-subsede"]:checked')].map(i => i.value);
        if (!module_keys.length) throw new Error("Selecione pelo menos um módulo para o supervisor.");
        if (!subsedes.length) throw new Error("Selecione pelo menos uma subsede para o supervisor.");
        const dashboard_ids = [...$("permission-dashboard-list").querySelectorAll('input[type="checkbox"]:checked')].map(i => i.value);
        await adminCall("set_supervisor_access", { user_id: userId, module_keys, subsedes });
        await adminCall("set_permissions", { user_id: userId, dashboard_ids });
        showMessage("permission-message", "Módulos, subsedes e dashboards do supervisor salvos com sucesso!", "success");
      } else {
        const ids = [...$("permission-dashboard-list").querySelectorAll('input[type="checkbox"]:checked')].map(i => i.value);
        await adminCall("set_permissions", { user_id: userId, dashboard_ids: ids });
        showMessage("permission-message", "Permissões salvas com sucesso!", "success");
      }
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

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Editar";
    editButton.addEventListener("click", () => editarDashboard(d.id));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "Excluir";
    deleteButton.addEventListener("click", () => excluirDashboard(d.id));

    item.append(title, desc, editButton, deleteButton);
    container.appendChild(item);
  });
}

function editarDashboard(id) {
  const d = allDashboards.find(item => String(item.id) === String(id));
  if (!d) return;

  $("dashboard-id").value = d.id ?? "";
  $("dashboard-name").value = d.name ?? "";
  $("dashboard-description").value = d.description ?? "";
  $("dashboard-category").value = d.category || "outros";
  $("dashboard-url").value = d.url ?? "";

  const submitButton = $("dashboard-form")?.querySelector('button[type="submit"]');
  if (submitButton) submitButton.textContent = "Salvar alterações";

  let cancelButton = $("dashboard-cancel-edit");
  if (!cancelButton && $("dashboard-form")) {
    cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.id = "dashboard-cancel-edit";
    cancelButton.textContent = "Cancelar edição";
    cancelButton.addEventListener("click", limparFormularioDashboard);
    const submit = $("dashboard-form").querySelector('button[type="submit"]');
    submit?.parentElement?.appendChild(cancelButton);
  }
  if (cancelButton) cancelButton.hidden = false;

  showMessage("dashboard-form-message", `Editando: ${d.name || d.id}`, "success");
  $("dashboard-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  $("dashboard-name")?.focus();
}

function limparFormularioDashboard() {
  $("dashboard-form")?.reset();
  const submitButton = $("dashboard-form")?.querySelector('button[type="submit"]');
  if (submitButton) submitButton.textContent = "Salvar dashboard";
  const cancelButton = $("dashboard-cancel-edit");
  if (cancelButton) cancelButton.hidden = true;
  clearMessage("dashboard-form-message");
}

async function excluirDashboard(id) {
  const d = allDashboards.find(item => String(item.id) === String(id));
  if (!d) return;

  const confirmed = window.confirm(
    `Tem certeza que deseja excluir o dashboard "${d.name || d.id}" do portal? Essa ação não pode ser desfeita.`
  );
  if (!confirmed) return;

  try {
    // Remove primeiro as permissões vinculadas para evitar falha por chave estrangeira.
    const { error: permissionsError } = await sb
      .from("dashboard_permissions")
      .delete()
      .eq("dashboard_id", d.id);
    if (permissionsError) throw permissionsError;

    const { error } = await sb.from("dashboards").delete().eq("id", d.id);
    if (error) throw error;

    if (String($("dashboard-id")?.value || "") === String(d.id)) {
      limparFormularioDashboard();
    }

    showMessage("dashboard-form-message", "Dashboard excluído do portal.", "success");
    await carregarDashboards();
    if (currentProfile?.role === "admin") await carregarAdministracao();
  } catch (error) {
    showMessage(
      "dashboard-form-message",
      `Não foi possível excluir o dashboard. Verifique as permissões de exclusão no Supabase. ${friendlyError(error)}`
    );
  }
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
      limparFormularioDashboard();
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

  const allowed = currentProfile?.role === "supervisor"
    ? usuarioTemModulo("substituicoes")
    : currentProfile?.role === "admin" || allDashboards.some(dashboardEhSubstituicoes);
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

  const substituicoesNormalizadas = all.map(normalizarRegistroSubstituicao);
  subRegistros = currentProfile?.role === "supervisor"
    ? substituicoesNormalizadas.filter(r => currentAccess.subsedes.some(subsede => normalize(subsede) === normalize(r.subsede)))
    : substituicoesNormalizadas;
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

  const allowed = currentProfile?.role === "supervisor"
    ? usuarioTemModulo("ead")
    : currentProfile?.role === "admin" || allDashboards.some(dashboardEhEaD);
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

  eadRegistros = currentProfile?.role === "supervisor"
    ? registros.filter(r => currentAccess.subsedes.some(subsede => normalize(subsede) === normalize(r.subsede_responsavel)))
    : registros;
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

/* BI APRENDIZ, BI ESTÁGIO e CARTEIRA SUBSEDE removidos temporariamente.
   Serão reconstruídos individualmente em etapas futuras. */

/* CONTROLE DE VAGAS APRENDIZ integrado ao Portal BI GERAR.
   IIFE isola variáveis e IDs do restante do portal. */
(() => {

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
  const elemento = $("vagas-mensagem");

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
  const busca = normalizar($("vagas-busca")?.value);
  const subsede = $("vagas-filtroSubsede")?.value || "";
  const status = $("vagas-filtroStatus")?.value || "";
  const curso = $("vagas-filtroCurso")?.value || "";
  const empresa = $("vagas-filtroEmpresa")?.value || "";
  const solicitante = $("vagas-filtroSolicitante")?.value || "";
  const inicial = $("vagas-dataInicial")?.value || "";
  const final = $("vagas-dataFinal")?.value || "";

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
      onClick: (_event, elementos) => {
        if (!elementos?.length) return;
        const indice = elementos[0].index;
        const rotulo = labels[indice];
        const filtroPorGrafico = {
          "vagas-graficoStatus": ["vagas-filtroStatus", rotulo],
          "vagas-graficoSubsede": ["vagas-filtroSubsede", rotulo]
        };
        const destino = filtroPorGrafico[id];
        if (!destino) return;
        const select = $(destino[0]);
        if (!select) return;
        const opcao = [...select.options].find(o => o.value === rotulo || o.textContent === rotulo);
        if (!opcao) return;
        select.value = opcao.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        $( "vagas-aprendiz-section" )?.scrollIntoView({ behavior: "smooth", block: "start" });
      },

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
    "vagas-graficoStatus",
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
    "vagas-graficoSubsede",
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
    "vagas-graficoMensal",
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

  if ($("vagas-totalVagas")) {
    $("vagas-totalVagas").textContent =
      formatarNumero(lista.length);
  }

  if ($("vagas-vagasAbertas")) {
    $("vagas-vagasAbertas").textContent =
      formatarNumero(abertas.length);
  }

  if ($("vagas-vagasAndamento")) {
    $("vagas-vagasAndamento").textContent =
      formatarNumero(andamento.length);
  }

  if ($("vagas-totalUnidades")) {
    $("vagas-totalUnidades").textContent =
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
  let controles = $("vagas-paginacaoTabela");

  if (controles) return controles;

  const corpo = $("vagas-corpoTabela");
  const tabela = corpo?.closest("table");
  const areaTabela = tabela?.closest(".table-scroll");

  if (!areaTabela) return null;

  controles = document.createElement("div");
  controles.id = "vagas-paginacaoTabela";

  controles.style.display = "flex";
  controles.style.alignItems = "center";
  controles.style.justifyContent = "space-between";
  controles.style.flexWrap = "wrap";
  controles.style.gap = "10px";
  controles.style.padding = "12px 0 2px";
  controles.style.marginTop = "8px";

  const informacao = document.createElement("span");
  informacao.id = "vagas-informacaoPaginacao";

  informacao.style.fontSize = "13px";
  informacao.style.color = "#64748b";

  const botoes = document.createElement("div");

  botoes.style.display = "flex";
  botoes.style.alignItems = "center";
  botoes.style.gap = "8px";

  const anterior = document.createElement("button");
  anterior.id = "vagas-paginaAnterior";
  anterior.type = "button";
  anterior.textContent = "← Anterior";

  const proximo = document.createElement("button");
  proximo.id = "vagas-paginaProxima";
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
  const corpo = $("vagas-corpoTabela");

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
  if ($("vagas-contadorTabela")) {
    if (total === 0) {
      $("vagas-contadorTabela").textContent = "0 registros";
    } else {
      $("vagas-contadorTabela").textContent =
        `Exibindo ${formatarNumero(inicio + 1)}–${formatarNumero(fim)} de ${formatarNumero(total)} registros`;
    }
  }

  /*
   * Controles de navegação criados automaticamente.
   */
  const controles = obterControlesPaginacao();

  if (controles) {
    const informacao = $("vagas-informacaoPaginacao");
    const anterior = $("vagas-paginaAnterior");
    const proximo = $("vagas-paginaProxima");

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
    ["vagas-busca", "input"],
    ["vagas-filtroSubsede", "change"],
    ["vagas-filtroStatus", "change"],
    ["vagas-filtroCurso", "change"],
    ["vagas-filtroEmpresa", "change"],
    ["vagas-filtroSolicitante", "change"],
    ["vagas-dataInicial", "change"],
    ["vagas-dataFinal", "change"]
  ].forEach(([id, evento]) => {
    const elemento = $(id);

    if (elemento) {
      elemento.addEventListener(evento, atualizarPainel);
    }
  });

  [
    "vagas-btnAtualizar",
    "vagas-atualizarBtn",
    "vagas-btnRecarregar",
    "vagas-atualizar-topo"
  ].forEach(id => {
    const botao = $(id);

    if (botao) {
      botao.addEventListener("click", iniciarCarregamento);
    }
  });

  [
    "vagas-btnExportarCSV",
    "vagas-exportarCSV",
    "vagas-btnExportar"
  ].forEach(id => {
    const botao = $(id);

    if (botao) {
      botao.addEventListener("click", exportarCSV);
    }
  });

  const botaoLimpar = $("vagas-btnLimpar");

  if (botaoLimpar) {
    botaoLimpar.addEventListener("click", () => {
      [
        "vagas-busca",
        "vagas-filtroSubsede",
        "vagas-filtroStatus",
        "vagas-filtroCurso",
        "vagas-filtroEmpresa",
        "vagas-filtroSolicitante",
        "vagas-dataInicial",
        "vagas-dataFinal"
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

  const botaoAtualizar = $("vagas-btnAtualizar") || $("vagas-atualizar-topo");

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
      "vagas-filtroSubsede",
      registros.map(r => r.subsede),
      "Todas as subsedes"
    );

    preencherFiltro(
      "vagas-filtroStatus",
      registros.map(statusRegistro),
      "Todos os status"
    );

    preencherFiltro(
      "vagas-filtroCurso",
      registros.map(cursoRegistro),
      "Todas as áreas"
    );

    preencherFiltro(
      "vagas-filtroEmpresa",
      registros.map(empresaRegistro),
      "Todas as empresas"
    );

    preencherFiltro(
      "vagas-filtroSolicitante",
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
})();



// ==================================================
// METAS DO APRENDIZ — tabela bi_aprendiz_historico
// Usa a conexão sb e as permissões existentes do portal.
// ==================================================
let metasAprendizRegistros = [];
let metasGraficos = {};
let metasAprendizInicializado = false;
let metasAprendizCargaId = 0;
const METAS_APRENDIZ_TABELA = "bi_aprendiz_historico";

function dashboardEhMetasAprendiz(d) {
  const nome = normalize(d?.name || "");
  const id = normalize(d?.id || "");
  return nome.includes("metas do aprendiz") || nome.includes("metas aprendiz") || id === "metas_aprendiz" || id === "metas-aprendiz" || id === "bi_aprendiz_metas";
}

function configurarAcessoMetasAprendiz() {
  const section = $("metas-aprendiz-section");
  const nav = $("metas-aprendiz-nav-link");
  if (!section || !nav) return;
  const allowed = currentProfile?.role === "supervisor" ? usuarioTemModulo("metas_aprendiz") : Boolean(currentUser);
  section.hidden = !allowed; nav.hidden = !allowed;
  if (allowed && !metasAprendizInicializado) {
    metasAprendizInicializado = true;
    $("metas-tipo")?.addEventListener("change", carregarMetasAprendiz);
    $("metas-mes")?.addEventListener("change", renderizarMetasAprendiz);
    $("metas-subsede")?.addEventListener("change", () => { metasAtualizarFiltroUnidade(); renderizarMetasAprendiz(); });
    $("metas-unidade")?.addEventListener("change", renderizarMetasAprendiz);
    $("metas-aprendiz-atualizar")?.addEventListener("click", carregarMetasAprendiz);
    $("metas-ranking-modo")?.addEventListener("change", renderizarMetasAprendiz);
    document.querySelectorAll("[data-modo-ranking]").forEach(botao => {
      botao.addEventListener("click", () => {
        const modo = botao.dataset.modoRanking || "faturamento";
        const campo = $("metas-ranking-modo");
        if (campo) campo.value = modo;
        document.querySelectorAll("[data-modo-ranking]").forEach(outro => {
          const ativo = outro === botao;
          outro.classList.toggle("ativo", ativo);
          outro.setAttribute("aria-pressed", String(ativo));
        });
        renderizarMetasAprendiz();
      });
    });
    carregarMetasAprendiz();
  }
}

function metasMoeda(v) { return new Intl.NumberFormat("pt-BR", {style:"currency",currency:"BRL",maximumFractionDigits:2}).format(Number(v)||0); }
function metasNumero(v) { return new Intl.NumberFormat("pt-BR", {maximumFractionDigits:1}).format(Number(v)||0); }
function metasPercentual(real, meta) { return meta > 0 ? (real/meta)*100 : 0; }
function metasEscapar(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function metasMostrarMensagem(msg, erro=false) { const el=$("metas-aprendiz-message"); if(el){el.textContent=msg;el.style.color=erro?"#b42318":"";} }

async function carregarMetasAprendiz() {
  sb = window.sb || sb;
  const cargaId = ++metasAprendizCargaId;
  if (!sb) { metasMostrarMensagem("Conexão com Supabase não encontrada (window.sb).", true); return; }
  metasMostrarMensagem("Carregando dados das metas...");
  const btn=$("metas-aprendiz-atualizar"); if(btn) btn.disabled=true;
  try {
    let todos=[]; let inicio=0; const tamanho=1000;
    while(true) {
      const {data,error}=await sb.from(METAS_APRENDIZ_TABELA).select("data_referencia,tipo,subsede,local_atendimento,faturado,numero_jovens,ticket_medio,qt_empresas,meta_numero_jovens,meta_faturamento").eq("tipo",$("metas-tipo")?.value || "Matriz").order("data_referencia",{ascending:true}).range(inicio,inicio+tamanho-1);
      if(error) throw error; todos=todos.concat(data||[]); if(!data || data.length<tamanho) break; inicio+=tamanho;
    }
    if (cargaId !== metasAprendizCargaId) return; // ignora resposta antiga que terminou depois da mais recente
    metasAprendizRegistros=todos;
    const meses=[...new Set(todos.map(r=>String(r.data_referencia).slice(0,10)))].sort();
    const sel=$("metas-mes"); if(sel){const anterior=sel.value;sel.replaceChildren();meses.slice().reverse().forEach(m=>{const o=document.createElement("option");o.value=m;o.textContent=new Date(m+"T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"});sel.appendChild(o);});if(meses.includes(anterior))sel.value=anterior;else if(meses.length)sel.value=meses[meses.length-1];}
    const subsedes=[...new Set(todos.map(r=>r.subsede).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR")); const sub=$("metas-subsede"); if(sub){const old=sub.value;sub.replaceChildren(new Option("Todas as subsedes",""));subsedes.forEach(s=>sub.add(new Option(s,s)));sub.value=subsedes.includes(old)?old:"";}
    metasAtualizarFiltroUnidade();
    renderizarMetasAprendiz();
    if (todos.length === 0) {
      metasMostrarMensagem(
        "Nenhum registro foi retornado pelo Supabase. Verifique se há dados em public.bi_aprendiz_historico e se existe uma política SELECT (RLS) permitindo a leitura para este usuário autenticado. Se os dados existem no Table Editor, a causa mais provável é a política de leitura.",
        true
      );
    } else {
      metasMostrarMensagem(`${todos.length} registros carregados para ${$("metas-tipo")?.value || "Matriz"}.`);
    }
  } catch(e) {
    if (cargaId !== metasAprendizCargaId) return;
    console.error("Metas do Aprendiz:",e);
    metasMostrarMensagem("Falha ao consultar bi_aprendiz_historico: "+(e.message||"erro desconhecido")+". Confira a conexão, a política SELECT (RLS) e as permissões do usuário.",true);
  }
  finally {if(btn)btn.disabled=false;}
}

function metasAtualizarFiltroUnidade() {
  const tipo = $("metas-tipo")?.value || "Matriz";
  const wrap = $("metas-unidade-wrap"), sel = $("metas-unidade");
  if (!wrap || !sel) return;
  const ehPolo = tipo === "Polos";
  wrap.hidden = !ehPolo;
  if (!ehPolo) { sel.replaceChildren(new Option("Todas as unidades da subsede", "")); return; }
  const subsede = $("metas-subsede")?.value || "";
  const unidades = [...new Set(metasAprendizRegistros.filter(r => !subsede || r.subsede === subsede).map(r => r.local_atendimento).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
  const anterior = sel.value;
  sel.replaceChildren(new Option("Todas as unidades da subsede", ""));
  unidades.forEach(u => sel.add(new Option(u, u)));
  sel.value = unidades.includes(anterior) ? anterior : "";
}

// No painel Matriz, o registro "Polos Curitiba" compõe o consolidado de Curitiba.
// Ao filtrar Curitiba, considera os dois registros; no total geral, cada registro
// entra uma única vez. No ranking da Matriz, os dois ficam agrupados em Curitiba.
function metasRegistroNaSubsede(r, subsede, tipo) {
  if (!subsede) return true;

  const subsedeRegistro = normalize(r?.subsede || "");
  const subsedeFiltro = normalize(subsede);

  if (tipo === "Matriz" && subsedeFiltro === "curitiba") {
    return subsedeRegistro === "curitiba" || subsedeRegistro === "polos curitiba";
  }

  return r?.subsede === subsede;
}

function aplicarCorBarraMeta(elemento, percentual) {
  if (!elemento) return;

  const p = Number(percentual) || 0;
  const cor = p > 100
    ? "#16835b"  // Verde: meta superada
    : p >= 90
      ? "#eab308" // Amarelo: de 90% até 100%
      : "#dc4242"; // Vermelho: abaixo de 90%

  elemento.style.width = Math.max(0, Math.min(100, p)) + "%";
  elemento.style.backgroundColor = cor;
  elemento.style.transition = "width .35s ease, background-color .25s ease";
}

function renderizarMetasAprendiz() {
  const mes = $("metas-mes")?.value || "";
  const subsede = $("metas-subsede")?.value || "";
  const unidade = $("metas-unidade")?.value || "";
  const tipo = $("metas-tipo")?.value || "Matriz";

  const registrosDoMes = metasAprendizRegistros.filter(r =>
    String(r.data_referencia).slice(0, 10) === mes &&
    metasRegistroNaSubsede(r, subsede, tipo) &&
    (!unidade || r.local_atendimento === unidade)
  );

  const agregado = registrosDoMes.reduce((a, r) => {
    a.faturado += Number(r.faturado) || 0;
    a.jovens += Number(r.numero_jovens) || 0;
    a.empresas += Number(r.qt_empresas) || 0;
    a.metaF += Number(r.meta_faturamento) || 0;
    a.metaJ += Number(r.meta_numero_jovens) || 0;
    a.ticketNumerador += Number(r.ticket_medio) || 0;
    a.n++;
    return a;
  }, { faturado: 0, jovens: 0, empresas: 0, metaF: 0, metaJ: 0, ticketNumerador: 0, n: 0 });

  const ticket = agregado.n ? agregado.ticketNumerador / agregado.n : 0;
  const set = (id, v) => {
    const e = $(id);
    if (e) e.textContent = v;
  };

  set("metas-faturado", metasMoeda(agregado.faturado));
  set("metas-faturamento-meta", "Meta: " + metasMoeda(agregado.metaF));
  set("metas-jovens", metasNumero(agregado.jovens));
  set("metas-jovens-meta", "Meta: " + metasNumero(agregado.metaJ));
  set("metas-empresas", metasNumero(agregado.empresas));
  set("metas-ticket", metasMoeda(ticket));

  const pF = metasPercentual(agregado.faturado, agregado.metaF);
  const pJ = metasPercentual(agregado.jovens, agregado.metaJ);
  set("metas-faturamento-percentual", pF.toFixed(1) + "% da meta" + (agregado.metaF > 0 ? " · faltam " + metasMoeda(Math.max(0, agregado.metaF - agregado.faturado)) : ""));
  set("metas-jovens-percentual", pJ.toFixed(1) + "% da meta" + (agregado.metaJ > 0 ? " · faltam " + metasNumero(Math.max(0, agregado.metaJ - agregado.jovens)) : ""));

  aplicarCorBarraMeta($("metas-faturamento-barra"), pF);
  aplicarCorBarraMeta($("metas-jovens-barra"), pJ);

  // Os gráficos usam a mesma regra do cartão: Curitiba Matriz inclui Polos Curitiba.
  const meses = [...new Set(metasAprendizRegistros.map(r => String(r.data_referencia).slice(0, 10)))].sort();
  const historico = meses.map(m => {
    const rows = metasAprendizRegistros.filter(r =>
      String(r.data_referencia).slice(0, 10) === m &&
      metasRegistroNaSubsede(r, subsede, tipo) &&
      (!unidade || r.local_atendimento === unidade)
    );
    return {
      m,
      f: rows.reduce((s, r) => s + (Number(r.faturado) || 0), 0),
      mf: rows.reduce((s, r) => s + (Number(r.meta_faturamento) || 0), 0),
      j: rows.reduce((s, r) => s + (Number(r.numero_jovens) || 0), 0),
      mj: rows.reduce((s, r) => s + (Number(r.meta_numero_jovens) || 0), 0)
    };
  });

  metasDesenharGrafico(
    "metas-grafico-faturamento",
    "faturamento",
    historico.map(x => x.m),
    [{ label: "Faturado", data: historico.map(x => x.f) }, { label: "Meta", data: historico.map(x => x.mf) }],
    true
  );
  metasDesenharGrafico(
    "metas-grafico-jovens",
    "jovens",
    historico.map(x => x.m),
    [{ label: "Jovens", data: historico.map(x => x.j) }, { label: "Meta", data: historico.map(x => x.mj) }],
    false
  );

  const dimensaoRanking = tipo === "Polos" ? "Unidade / Polo" : "Subsede";
  const thRanking = $("metas-ranking-dimensao");
  if (thRanking) thRanking.textContent = dimensaoRanking;
  const thTicket = $("metas-ranking-ticket-dimensao");
  if (thTicket) thTicket.textContent = dimensaoRanking;

  // O botão alterna o mesmo ranking entre faturamento e atingimento de jovens.
  const modoRanking = $("metas-ranking-modo")?.value || "faturamento";
  const tituloRanking = $("metas-ranking-titulo");
  const tabelaRanking = $("metas-ranking-faturamento");
  const cabecalhoRanking = $("metas-ranking-cabecalho");
  if (tituloRanking) {
    tituloRanking.textContent = modoRanking === "aprendiz"
      ? "Ranking de subsedes — atingimento de aprendizes"
      : "Ranking de subsedes — atingimento de faturamento";
  }
  if (cabecalhoRanking) {
    cabecalhoRanking.innerHTML = modoRanking === "aprendiz"
      ? `<th id="metas-ranking-dimensao">${dimensaoRanking}</th><th>Jovens realizados</th><th>Meta de jovens</th><th>Atingimento</th>`
      : `<th id="metas-ranking-dimensao">${dimensaoRanking}</th><th>Faturado</th><th>Meta</th><th>Atingimento</th>`;
  }

  // Agrupa "Polos Curitiba" dentro de "Curitiba" apenas na visão Matriz.
  // Assim, o total geral continua somando cada linha original uma única vez.
  const porSubsede = {};
  registrosDoMes.forEach(r => {
    let chave = (tipo === "Polos" ? r.local_atendimento : r.subsede) || "Sem identificação";
    if (tipo === "Matriz" && normalize(chave) === "polos curitiba") chave = "Curitiba";

    const a = porSubsede[chave] || (porSubsede[chave] = { s: chave, f: 0, mf: 0, j: 0, mj: 0, t: 0, n: 0 });
    a.f += Number(r.faturado) || 0;
    a.mf += Number(r.meta_faturamento) || 0;
    a.j += Number(r.numero_jovens) || 0;
    a.mj += Number(r.meta_numero_jovens) || 0;
    a.t += Number(r.ticket_medio) || 0;
    a.n++;
  });

  const ranking = Object.values(porSubsede);
  const modoRankingAtual = $("metas-ranking-modo")?.value || "faturamento";
  ranking.sort((a, b) => modoRankingAtual === "aprendiz"
    ? metasPercentual(b.j, b.mj) - metasPercentual(a.j, a.mj)
    : metasPercentual(b.f, b.mf) - metasPercentual(a.f, a.mf));
  const rf = $("metas-ranking-faturamento");
  if (rf) {
    rf.innerHTML = modoRankingAtual === "aprendiz"
      ? ranking.map(r =>
          `<tr><td>${metasEscapar(r.s)}</td><td>${metasNumero(r.j)}</td><td>${metasNumero(r.mj)}</td><td>${metasPercentual(r.j, r.mj).toFixed(1)}%</td></tr>`
        ).join("") || '<tr><td colspan="4">Sem dados para os filtros selecionados.</td></tr>'
      : ranking.map(r =>
          `<tr><td>${metasEscapar(r.s)}</td><td>${metasMoeda(r.f)}</td><td>${metasMoeda(r.mf)}</td><td>${metasPercentual(r.f, r.mf).toFixed(1)}%</td></tr>`
        ).join("") || '<tr><td colspan="4">Sem dados para os filtros selecionados.</td></tr>';
  }

  ranking.sort((a, b) => (b.t / Math.max(1, b.n)) - (a.t / Math.max(1, a.n)));
  const rt = $("metas-ranking-ticket");
  if (rt) {
    rt.innerHTML = ranking.map(r =>
      `<tr><td>${metasEscapar(r.s)}</td><td>${metasMoeda(r.t / Math.max(1, r.n))}</td><td>${metasNumero(r.j)}</td></tr>`
    ).join("") || '<tr><td colspan="3">Sem dados para os filtros selecionados.</td></tr>';
  }
}

function metasDesenharGrafico(id, chave, labels, datasets, moeda) {
  const canvas = $(id);
  if (!canvas || !window.Chart) return;

  if (metasGraficos[chave]) metasGraficos[chave].destroy();

  // Rótulos compactos para não se sobreporem em gráficos com vários meses.
  // O tooltip continua mostrando o valor completo e preciso.
  const formatarRotulo = valor => {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return "";
    if (moeda) {
      return new Intl.NumberFormat("pt-BR", {
        style: "currency", currency: "BRL", notation: "compact",
        maximumFractionDigits: 1, minimumFractionDigits: 0
      }).format(numero);
    }
    if (Math.abs(numero) >= 1000) {
      return new Intl.NumberFormat("pt-BR", {
        notation: "compact", maximumFractionDigits: 1
      }).format(numero);
    }
    return metasNumero(numero);
  };

  const rotulosVisiveis = {
    id: "metasRotulosVisiveis",
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = "600 9px Manrope, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";

      chart.data.datasets.forEach((dataset, di) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;

        meta.data.forEach((bar, i) => {
          const valor = Number(dataset.data[i]);
          if (!Number.isFinite(valor)) return;
          const texto = formatarRotulo(valor);
          if (!texto) return;

          // Usa a posição real da barra, em vez do tooltipPosition(),
          // para manter os rótulos dentro da área visível do gráfico.
          const horizontal = chart.options.indexAxis === "y";
          const x = horizontal
            ? Math.min(chart.width - 8, bar.x + 7)
            : Math.max(26, Math.min(chart.width - 26, bar.x));
          const y = horizontal
            ? Math.max(12, Math.min(chart.height - 8, bar.y + 3))
            : Math.max(14, bar.y - (di === 0 ? 7 : 19));
          ctx.textAlign = horizontal ? "left" : "center";
          ctx.textBaseline = horizontal ? "middle" : "bottom";
          ctx.fillStyle = di === 0 ? "#17365d" : "#527ba7";
          ctx.fillText(texto, x, y, horizontal ? 120 : 58);
        });
      });
      ctx.restore();
    }
  };

  metasGraficos[chave] = new Chart(canvas, {
    type: "bar",
    data: {
      labels: labels.map(m => new Date(m + "T12:00:00").toLocaleDateString("pt-BR", {
        month: "short", year: "2-digit"
      })),
      datasets: datasets.map((d, i) => ({
        ...d,
        backgroundColor: i === 0 ? "#17365d" : "#8db6df",
        borderColor: i === 0 ? "#102744" : "#6f9bc8",
        borderWidth: 1,
        borderRadius: 7,
        maxBarThickness: 34,
        categoryPercentage: .72,
        barPercentage: .78
      }))
    },
    plugins: [rotulosVisiveis],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 34, right: 8, left: 4, bottom: 0 } },
      plugins: {
        // Evita rótulos duplicados no meio das barras. Os valores compactos
        // continuam sendo desenhados pelo plugin personalizado rotulosVisiveis.
        datalabels: { display: false },
        legend: {
          position: "bottom",
          labels: {
            usePointStyle: true,
            pointStyle: "circle",
            padding: 20,
            boxWidth: 8,
            font: { family: "Manrope", size: 12, weight: "600" },
            color: "#34445a"
          }
        },
        tooltip: {
          backgroundColor: "#102744",
          titleFont: { family: "Manrope", weight: "700" },
          bodyFont: { family: "DM Sans" },
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: c => c.dataset.label + ": " + (moeda ? metasMoeda(c.raw) : metasNumero(c.raw))
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: "#66758a",
            font: { family: "DM Sans", size: 11, weight: "600" },
            maxRotation: 0,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12
          }
        },
        y: {
          beginAtZero: true,
          grace: "20%",
          grid: { color: "#edf1f6", drawBorder: false },
          border: { display: false },
          ticks: {
            color: "#778397",
            padding: 8,
            font: { family: "DM Sans", size: 10 },
            callback: v => moeda
              ? new Intl.NumberFormat("pt-BR", {
                  notation: "compact", style: "currency", currency: "BRL", maximumFractionDigits: 1
                }).format(v)
              : metasNumero(v)
          }
        }
      }
    }
  });
}
// ==================================================
// NAVEGAÇÃO LATERAL — item ativo em todas as seções
// ==================================================
function configurarNavegacaoLateral() {
  const links = [...document.querySelectorAll(".sidebar .nav-link")];
  if (!links.length) return;

  const normalizarHash = value => {
    const hash = String(value || "").replace(/^#/, "");
    if (!hash) return "inicio";
    // O link "Meus dashboards" aponta para uma seção dentro da visão geral.
    return hash;
  };

  const definirAtivo = hash => {
    const alvo = normalizarHash(hash);
    links.forEach(link => {
      const ativo = normalizarHash(link.getAttribute("href")) === alvo ||
        (alvo === "dashboards" && link.getAttribute("href") === "#inicio");
      link.classList.toggle("active", ativo);
      if (ativo) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  };

  links.forEach(link => link.addEventListener("click", () => {
    const href = link.getAttribute("href");
    if (href?.startsWith("#")) definirAtivo(href);
  }));

  window.addEventListener("hashchange", () => definirAtivo(location.hash));

  // Também atualiza o menu conforme a seção visível durante a rolagem.
  if ("IntersectionObserver" in window) {
    const ids = links.map(link => normalizarHash(link.getAttribute("href")))
      .filter(id => id && id !== "inicio")
      .map(id => document.getElementById(id))
      .filter(Boolean);
    const observer = new IntersectionObserver(entries => {
      const visiveis = entries.filter(e => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visiveis[0]?.target?.id) definirAtivo("#" + visiveis[0].target.id);
    }, { rootMargin: "-15% 0px -65% 0px", threshold: [0, .15, .35, .6] });
    [...new Set(ids)].forEach(el => observer.observe(el));
  }

  definirAtivo(location.hash || "#inicio");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", configurarNavegacaoLateral, { once: true });
} else {
  configurarNavegacaoLateral();
}


// ==================================================
// METAS ESTÁGIO — usa o último registro disponível de cada mês
// ==================================================
let metasEstagioRegistros = [];
let metasEstagioGraficos = {};
let metasEstagioInicializado = false;
let metasEstagioCargaId = 0;
const METAS_ESTAGIO_TABELA = "metas_estagio";

function configurarAcessoMetasEstagio() {
  const section = $("metas-estagio-section");
  const nav = $("metas-estagio-nav-link");
  if (!section || !nav) return;
  const allowed = currentProfile?.role === "supervisor" ? usuarioTemModulo("metas_estagio") : Boolean(currentUser);
  section.hidden = !allowed;
  nav.hidden = !allowed;
  if (!allowed || metasEstagioInicializado) return;
  metasEstagioInicializado = true;
  $("estagio-mes")?.addEventListener("change", renderizarMetasEstagio);
  $("estagio-unidade")?.addEventListener("change", renderizarMetasEstagio);
  $("metas-estagio-atualizar")?.addEventListener("click", carregarMetasEstagio);
  $("estagio-exportar")?.addEventListener("click", exportarMetasEstagio);
  carregarMetasEstagio();
}

function estagioMoeda(v) {
  return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:2}).format(Number(v)||0);
}
function estagioNumero(v) {
  return new Intl.NumberFormat("pt-BR",{maximumFractionDigits:1}).format(Number(v)||0);
}
function estagioPct(v,meta) { return Number(meta)>0 ? Number(v)/Number(meta)*100 : 0; }
function estagioDataBR(v) {
  if (!v) return "—";
  const d = new Date(String(v).slice(0,10)+"T12:00:00");
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("pt-BR");
}
function estagioMesLabel(m) {
  const d = new Date(m+"-15T12:00:00");
  return d.toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
}
function estagioMensagem(msg, erro=false) {
  const el=$("metas-estagio-message");
  if(el){el.textContent=msg;el.style.color=erro?"#b42318":"";}
}
async function carregarMetasEstagio() {
  sb = window.sb || sb;
  const cargaId = ++metasEstagioCargaId;
  if (!sb) return estagioMensagem("Conexão com Supabase não encontrada.",true);
  const btn=$("metas-estagio-atualizar"); if(btn) btn.disabled=true;
  estagioMensagem("Carregando dados de Metas Estágio...");
  try {
    let rows=[], offset=0; const size=1000;
    while(true) {
      const {data,error}=await sb.from(METAS_ESTAGIO_TABELA)
        .select("id,unidade,faturado,numero_jovens,ticket_medio,meta_numero_jovens,meta_faturamento,data")
        .order("data",{ascending:true}).range(offset,offset+size-1);
      if(error) throw error;
      rows.push(...(data||[]));
      if(!data||data.length<size) break;
      offset+=size;
    }
    if (cargaId !== metasEstagioCargaId) return; // impede uma consulta antiga de sobrescrever os dados atuais
    // Descobre a data máxima em cada mês e usa somente o snapshot daquela data.
    const ultimaDataMes={};
    rows.forEach(r=>{
      const data=String(r.data||"").slice(0,10), mes=data.slice(0,7);
      if(data && (!ultimaDataMes[mes] || data>ultimaDataMes[mes])) ultimaDataMes[mes]=data;
    });
    metasEstagioRegistros=rows.filter(r=>{
      const data=String(r.data||"").slice(0,10);
      return data && ultimaDataMes[data.slice(0,7)]===data;
    });
    const meses=[...new Set(metasEstagioRegistros.map(r=>String(r.data).slice(0,7)))].sort();
    const mesSel=$("estagio-mes"), mesAnterior=mesSel?.value;
    if(mesSel){
      mesSel.replaceChildren();
      meses.slice().reverse().forEach(m=>mesSel.add(new Option(estagioMesLabel(m),m)));
      mesSel.value=meses.includes(mesAnterior)?mesAnterior:(meses.at(-1)||"");
    }
    const unidades=[...new Set(metasEstagioRegistros.map(r=>String(r.unidade||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
    const unSel=$("estagio-unidade"), unAnterior=unSel?.value;
    if(unSel){
      unSel.replaceChildren(new Option("Todas as unidades",""));
      unidades.forEach(u=>unSel.add(new Option(u,u)));
      unSel.value=unidades.includes(unAnterior)?unAnterior:"";
    }
    renderizarMetasEstagio();
    estagioMensagem(metasEstagioRegistros.length
      ? `${metasEstagioRegistros.length.toLocaleString("pt-BR")} registros de fechamento mensal carregados. O painel seleciona automaticamente a última data disponível de cada mês.`
      : "Nenhum registro encontrado em public.metas_estagio. Confira os dados e a política SELECT (RLS).",!metasEstagioRegistros.length);
  } catch(e) {
    if (cargaId !== metasEstagioCargaId) return;
    console.error("Metas Estágio:",e);
    estagioMensagem("Falha ao consultar metas_estagio: "+(e.message||"erro desconhecido")+". Confira a tabela e a política SELECT (RLS).",true);
  } finally {if(btn)btn.disabled=false;}
}
function renderizarMetasEstagio() {
  const mes=$("estagio-mes")?.value||"", unidade=$("estagio-unidade")?.value||"";
  const doMes=metasEstagioRegistros.filter(r=>String(r.data||"").slice(0,7)===mes);
  const rows=doMes.filter(r=>!unidade||String(r.unidade||"").trim()===unidade);
  const sum=(arr,k)=>arr.reduce((s,r)=>s+(Number(r[k])||0),0);
  const f=sum(rows,"faturado"), mf=sum(rows,"meta_faturamento"), j=sum(rows,"numero_jovens"), mj=sum(rows,"meta_numero_jovens");
  // TKM calculado a partir do faturamento e da quantidade de jovens/estagiários.
  // O campo ticket_medio armazenado não é usado como fonte do cálculo.
  const totalFaturado=sum(rows,"faturado");
  const totalEstagiarios=sum(rows,"numero_jovens");
  const ticket=totalEstagiarios>0?totalFaturado/totalEstagiarios:0;
  const set=(id,v)=>{const el=$(id);if(el)el.textContent=v;};
  set("estagio-faturado",estagioMoeda(f));set("estagio-faturamento-meta","Meta: "+estagioMoeda(mf));
  set("estagio-jovens",estagioNumero(j));set("estagio-jovens-meta","Meta: "+estagioNumero(mj));
  set("estagio-unidades",estagioNumero(new Set(rows.map(r=>r.unidade).filter(Boolean)).size));set("estagio-ticket",estagioMoeda(ticket));
  const pf=estagioPct(f,mf), pj=estagioPct(j,mj);
  set("estagio-faturamento-percentual",estagioNumero(pf)+"% da meta");set("estagio-jovens-percentual",estagioNumero(pj)+"% da meta");
  const bf=$("estagio-faturamento-barra"), bj=$("estagio-jovens-barra");
  aplicarCorBarraMeta(bf, pf);
  aplicarCorBarraMeta(bj, pj);
  const tbody=$("estagio-tabela-corpo");
  if(tbody){
    tbody.replaceChildren();
    if(!rows.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=7;td.textContent="Nenhum registro para os filtros selecionados.";tr.appendChild(td);tbody.appendChild(tr);}
    rows.slice().sort((a,b)=>String(a.unidade).localeCompare(String(b.unidade),"pt-BR")).forEach(r=>{
      const tr=document.createElement("tr");
      [r.unidade,estagioDataBR(r.data),estagioMoeda(r.faturado),estagioMoeda(r.meta_faturamento),estagioNumero(r.numero_jovens),estagioNumero(r.meta_numero_jovens),estagioMoeda((Number(r.numero_jovens)||0)>0?(Number(r.faturado)||0)/Number(r.numero_jovens):0)].forEach(v=>{const td=document.createElement("td");td.textContent=v??"—";tr.appendChild(td);});
      tbody.appendChild(tr);
    });
  }
  const meses=[...new Set(metasEstagioRegistros.map(r=>String(r.data).slice(0,7)))].sort();
  const historico=meses.map(m=>{
    const rr=metasEstagioRegistros.filter(r=>String(r.data).slice(0,7)===m&&(!unidade||String(r.unidade||"").trim()===unidade));
    return {m:estagioMesLabel(m),f:sum(rr,"faturado"),mf:sum(rr,"meta_faturamento"),j:sum(rr,"numero_jovens"),mj:sum(rr,"meta_numero_jovens")};
  });
  desenharGraficoEstagio("estagio-grafico-faturamento","f",historico.map(x=>x.m),[{label:"Faturado",data:historico.map(x=>x.f)},{label:"Meta",data:historico.map(x=>x.mf)}],"currency");
  desenharGraficoEstagio("estagio-grafico-jovens","j",historico.map(x=>x.m),[{label:"Jovens",data:historico.map(x=>x.j)},{label:"Meta",data:historico.map(x=>x.mj)}],"number");

  // Ranking de ticket médio por unidade para o mês selecionado.
  const rankingTicket = rows.slice()
    .filter(r=>String(r.unidade||"").trim())
    .map(r=>({...r, tkm:(Number(r.numero_jovens)||0)>0?(Number(r.faturado)||0)/Number(r.numero_jovens):0}))
    .sort((a,b)=>b.tkm-a.tkm);
  desenharGraficoEstagio(
    "estagio-grafico-ticket",
    "tkm",
    rankingTicket.map((r,i)=>`${i+1}º — ${String(r.unidade||"")}`),
    [{label:"Ticket médio",data:rankingTicket.map(r=>r.tkm)}],
    "currency",
    true
  );
}
function desenharGraficoEstagio(id,key,labels,datasets,tipo,ranking=false) {
  const canvas=$(id);
  if(!canvas || !window.Chart) return;

  if(metasEstagioGraficos[key]) {
    metasEstagioGraficos[key].destroy();
    delete metasEstagioGraficos[key];
  }
  if(!labels.length) {
    const ctx=canvas.getContext("2d");
    if(ctx) {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.save(); ctx.fillStyle="#778397"; ctx.font="14px DM Sans, Arial, sans-serif";
      ctx.textAlign="center"; ctx.fillText(ranking?"Sem dados para o mês/unidade selecionado":"Sem dados para exibir",canvas.width/2,Math.max(30,canvas.height/2)); ctx.restore();
    }
    return;
  }

  if(ranking && canvas.parentElement) {
    canvas.parentElement.style.height=Math.min(680,Math.max(280,labels.length*38))+"px";
  } else if(canvas.parentElement) {
    canvas.parentElement.style.height="350px";
  }

  const fmt=v=>tipo==="currency"?estagioMoeda(v):estagioNumero(v);
  const compacto=v=>tipo==="currency"
    ? new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",notation:"compact",maximumFractionDigits:1}).format(Number(v)||0)
    : estagioNumero(v);
  const horizontal=ranking;

  const rotulosEstagio = {
    id:"rotulosEstagioGerar",
    afterDatasetsDraw(chart) {
      const ctx=chart.ctx;
      ctx.save();
      ctx.font=`700 ${horizontal ? 11 : 10}px DM Sans, Arial, sans-serif`;
      ctx.fillStyle="#17365d";
      chart.data.datasets.forEach((dataset,di)=>{
        const meta=chart.getDatasetMeta(di);
        if(meta.hidden) return;
        meta.data.forEach((element,index)=>{
          const value=Number(dataset.data[index]);
          if(!Number.isFinite(value) || value===0) return;
          const text=tipo==="currency"
            ? new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",notation:"compact",maximumFractionDigits:1}).format(value)
            : estagioNumero(value);
          if(!text) return;

          if(horizontal) {
            ctx.textAlign="left";
            ctx.textBaseline="middle";
            ctx.fillText(text,Math.min(chart.width-4,element.x+7),element.y,130);
          } else {
            ctx.textAlign="center";
            ctx.textBaseline="bottom";
            ctx.fillText(text,element.x,Math.max(13,element.y-(di===0?7:19)),78);
          }
        });
      });
      ctx.restore();
    }
  };

  metasEstagioGraficos[key]=new Chart(canvas,{
    type:"bar",
    data:{labels,datasets:datasets.map((ds,i)=>({
      ...ds,
      backgroundColor:ds.backgroundColor || (i===0 ? "#91c9ee" : "#ffabc0"),
      borderColor:ds.borderColor || (i===0 ? "#559bc9" : "#df829b"),
      borderWidth:1,
      borderRadius:5,
      barPercentage:0.72,
      categoryPercentage:0.78
    }))},
    plugins:[rotulosEstagio],
    options:{
      indexAxis:horizontal?"y":"x",
      responsive:true,
      maintainAspectRatio:false,
      animation:false,
      layout:{padding:{top:horizontal?12:38,right:horizontal?145:12,left:8,bottom:8}},
      plugins:{
        legend:{position:"bottom"},
        tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${fmt(ctx.raw)}`}},
        datalabels:{display:false}
      },
      scales:{
        x:{
          type:horizontal?"linear":"category",
          beginAtZero:horizontal,
          grid:{display:!horizontal},
          ticks:horizontal
            ? {callback:value=>compacto(value)}
            : {autoSkip:true,maxTicksLimit:9,maxRotation:0,minRotation:0}
        },
        y:{
          type:horizontal?"category":"linear",
          beginAtZero:!horizontal,
          grid:{display:horizontal},
          ticks:horizontal
            ? {autoSkip:false}
            : {callback:value=>compacto(value),maxTicksLimit:6}
        }
      }
    }
  });
}

function exportarMetasEstagio() {
  const mes=$("estagio-mes")?.value||"", unidade=$("estagio-unidade")?.value||"";
  const rows=metasEstagioRegistros.filter(r=>String(r.data||"").slice(0,7)===mes&&(!unidade||String(r.unidade||"").trim()===unidade));
  const cols=["unidade","data","faturado","meta_faturamento","numero_jovens","meta_numero_jovens","ticket_medio"];
  const csv=[cols.join(";"),...rows.map(r=>cols.map(k=>`"${String(r[k]??"").replace(/"/g,'""')}"`).join(";"))].join("\r\n");
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob), a=document.createElement("a");a.href=url;a.download=`metas-estagio-${mes||"dados"}.csv`;a.click();URL.revokeObjectURL(url);
}

// ==================================================
// CARTEIRA DOS CONSULTORES — public.bi_carteira_consultores
// Atualização: mês mais recente automático, evolução histórica,
// crescimento mensal, ranking completo de consultores e todas as subsedes.
// ==================================================
(() => {
  "use strict";
  const TABLE = "bi_carteira_consultores";
  let dados = [];
  let inicializado = false;
  let carregando = false;
  let graficos = {};
  const el = id => document.getElementById(id);
  // O plugin é carregado no HTML, mas precisa ser registrado no Chart.js para
  // que os rótulos configurados nos gráficos apareçam sem passar o mouse.
  if (window.Chart && window.ChartDataLabels && !window.__ccDataLabelsRegistered) {
    window.Chart.register(window.ChartDataLabels);
    window.__ccDataLabelsRegistered = true;
  }
  const txt = v => v == null ? "" : String(v).trim();
  const moeda = v => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(Number(v) || 0);
  const inteiro = v => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(v) || 0);
  const escape = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const periodoKey = v => {
    const s = txt(v);
    const m = s.match(/(\d{4})[-/](\d{1,2})/);
    if (m) return `${m[1]}-${String(Number(m[2])).padStart(2,"0")}`;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  };
  const periodoLabel = p => {
    if (!p) return "Sem período";
    const [a,m] = p.split("-").map(Number);
    return new Date(a,m-1,1,12).toLocaleDateString("pt-BR",{month:"short",year:"numeric"}).replace(".","");
  };
  const ativo = r => [true,1,"1","true","t","sim","ativo"].includes(typeof r.ativo_no_mes === "string" ? r.ativo_no_mes.toLowerCase().trim() : r.ativo_no_mes);
  const valor = v => Number(v) || 0;
  // Classifica pela coluna carga_horaria; usa os campos de texto como alternativa.
  // Na planilha, os contratos de 6h aparecem como "30-18h".
  function cargaHoraria(r) {
    const t = [r.carga_horaria, r.tipo_contrato, r.aprendiz]
      .map(v => txt(v).toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
      .filter(Boolean).join(" ");

    // Reconhece o formato real da base antes das regras genéricas.
    if (/\b30\s*[-–]\s*18\s*h\b/.test(t)) return "6h";
    if (/\b20\s*[-–]\s*24\s*h\b/.test(t)) return "4h";
    if (/\b30\s*[-–]\s*36\s*h\b/.test(t)) return "6h";

    if (/\b4\s*h\b/.test(t)) return "4h";
    if (/\b6\s*h\b/.test(t)) return "6h";

    const faixa = t.match(/(\d{1,2})\s*(?:-|–|a|ate|à)\s*(\d{1,2})\s*(?:h|hora|horas)?/);
    if (faixa) {
      const a = Number(faixa[1]), b = Number(faixa[2]);
      if (a === 20 && b === 24) return "4h";
      if (a === 30 && (b === 18 || b === 36)) return "6h";
    }

    return "Não identificada";
  }
  const pct = (atual, anterior) => anterior > 0 ? ((atual-anterior)/anterior)*100 : null;
  const pctLabel = p => p == null ? "Sem histórico para comparar" : `${p > 0 ? "+" : ""}${p.toLocaleString("pt-BR",{maximumFractionDigits:1,minimumFractionDigits:1})}% vs. mês anterior`;

  async function buscarTodos() {
    const conexao = window.sb || sb;
    if (!conexao) throw new Error("Conexão com Supabase não encontrada.");
    const campos = "id,chave_origem,periodo_referencia,empresa,cnpj,consultor,cidade,subsede,regiao,aprendiz,data_inicio,data_fim,tipo_contrato,carga_horaria,cartao_futuro,contribuicao_mensal,contribuicao_unica,contribuicao_adm_folha,ativo_no_mes,origem";
    const todos = [], tamanho = 1000;
    for (let inicio = 0; ; inicio += tamanho) {
      const { data, error } = await conexao.from(TABLE).select(campos).order("periodo_referencia", { ascending: true }).range(inicio, inicio + tamanho - 1);
      if (error) throw error;
      todos.push(...(data || []));
      if (!data || data.length < tamanho) break;
    }
    return todos;
  }

  function preencherSelect(id, valores, todosLabel, selecionarMaisRecente=false) {
    const select = el(id); if (!select) return;
    const anterior = select.value;
    const unicos = [...new Set(valores.map(txt).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
    select.replaceChildren(new Option(todosLabel, ""));
    unicos.forEach(v => select.add(new Option(v, v)));
    if (selecionarMaisRecente) {
      const meses = [...new Set(valores.map(periodoKey).filter(Boolean))].sort();
      const ultimo = meses.at(-1) || "";
      // O filtro guarda o valor original da coluna, mesmo se ela vier como data completa.
      const valorUltimo = unicos.filter(v=>periodoKey(v)===ultimo).sort().at(-1) || "";
      select.value = unicos.includes(anterior) && periodoKey(anterior)===ultimo ? anterior : valorUltimo;
    } else if (unicos.includes(anterior)) select.value = anterior;
  }

  function periodoSelecionado() { return periodoKey(el("cc-filtro-periodo")?.value || ""); }
  function filtros() {
    const periodo=periodoSelecionado();
    const consultor=el("cc-filtro-consultor")?.value || "";
    const subsede=el("cc-filtro-subsede")?.value || "";
    const cidade=el("cc-filtro-cidade")?.value || "";
    const empresa=(el("cc-filtro-empresa")?.value || "").toLocaleLowerCase("pt-BR");
    const status=el("cc-filtro-status")?.value || "";
    return dados.filter(r => (!periodo || periodoKey(r.periodo_referencia)===periodo) && (!consultor || txt(r.consultor)===consultor) && (!subsede || txt(r.subsede)===subsede) && (!cidade || txt(r.cidade)===cidade) && (!empresa || [r.empresa,r.cnpj,r.aprendiz,r.consultor].some(v=>txt(v).toLocaleLowerCase("pt-BR").includes(empresa))) && (!status || String(ativo(r))===status));
  }

  function montarFiltros() {
    preencherSelect("cc-filtro-periodo", dados.map(r=>r.periodo_referencia), "Todos os períodos", true);
    preencherSelect("cc-filtro-consultor", dados.map(r=>r.consultor), "Todos os consultores");
    preencherSelect("cc-filtro-subsede", dados.map(r=>r.subsede), "Todas as subsedes");
    preencherSelect("cc-filtro-cidade", dados.map(r=>r.cidade), "Todas as cidades");
  }

  function agregarMensal(lista) {
    const mapa = new Map();
    lista.forEach(r=>{
      const p=periodoKey(r.periodo_referencia); if(!p) return;
      if(!mapa.has(p)) mapa.set(p,{contratos:0,ativos:0,empresas:new Set(),consultores:new Set(),faturamento:0,comCartao:0,semCartao:0});
      const x=mapa.get(p); x.contratos++; if(ativo(r))x.ativos++;
      if(txt(r.empresa))x.empresas.add(txt(r.empresa)); if(txt(r.consultor))x.consultores.add(txt(r.consultor));
      x.faturamento+=valor(r.contribuicao_mensal);
      const cf=txt(r.cartao_futuro).toLocaleLowerCase("pt-BR");
      if(["sim","true","1","yes","com cartão futuro","com cartao futuro"].includes(cf))x.comCartao++; else if(cf)x.semCartao++;
    });
    return [...mapa.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([periodo,x])=>({...x,periodo,empresas:x.empresas.size,consultores:x.consultores.size}));
  }

  function atualizarKpis(lista) {
    const ativos=lista.filter(ativo).length;
    const empresas=new Set(lista.map(r=>txt(r.empresa)).filter(Boolean)).size;
    const consultores=new Set(lista.map(r=>txt(r.consultor)).filter(Boolean)).size;
    const soma=lista.reduce((a,r)=>a+valor(r.contribuicao_mensal),0);
    if(el("cc-kpi-total")) el("cc-kpi-total").textContent=inteiro(lista.length);
    if(el("cc-kpi-ativos")) el("cc-kpi-ativos").textContent=inteiro(ativos);
    if(el("cc-kpi-empresas")) el("cc-kpi-empresas").textContent=inteiro(empresas);
    if(el("cc-kpi-consultores")) el("cc-kpi-consultores").textContent=inteiro(consultores);
    if(el("cc-kpi-mensal")) el("cc-kpi-mensal").textContent=moeda(soma);
    if(el("cc-kpi-tkm")) el("cc-kpi-tkm").textContent=moeda(lista.length ? soma / lista.length : 0);
    if(el("cc-kpi-4h")) el("cc-kpi-4h").textContent=inteiro(lista.filter(r=>cargaHoraria(r)==="4h").length);
    if(el("cc-kpi-6h")) el("cc-kpi-6h").textContent=inteiro(lista.filter(r=>cargaHoraria(r)==="6h").length);
    const historico=agregarMensal(dados), p=periodoSelecionado() || historico.at(-1)?.periodo;
    const i=historico.findIndex(x=>x.periodo===p), atual=historico[i], anterior=historico[i-1];
    const elC=el("cc-kpi-crescimento"), elF=el("cc-kpi-faturamento-crescimento"), elA=el("cc-kpi-ativos-crescimento");
    if(elC)elC.textContent=pctLabel(pct(atual?.contratos||0,anterior?.contratos||0));
    if(elF)elF.textContent=pctLabel(pct(atual?.faturamento||0,anterior?.faturamento||0));
    if(elA)elA.textContent=pctLabel(pct(atual?.ativos||0,anterior?.ativos||0));
    if(el("cc-periodo-atual")) el("cc-periodo-atual").textContent=atual?`Referência: ${periodoLabel(atual.periodo)}`:"Sem período disponível";
  }

  function destruirGraficos(){ Object.values(graficos).forEach(g=>{try{g.destroy()}catch(_){}}); graficos={}; }
  function grafico(id, config){ const canvas=el(id); if(!canvas || !window.Chart) return; if(graficos[id]) graficos[id].destroy(); graficos[id]=new Chart(canvas,config); }
  function opcoesBarra(horizontal=true) {
    return {indexAxis:horizontal?"y":"x",responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label||"Contratos"}: ${inteiro(ctx.raw)}`}},
        datalabels:{display:true,anchor:"end",align:"end",clamp:true,color:"#34445b",font:{weight:"600",size:10},formatter:v=>inteiro(v)}},
      layout:{padding:{top:8,right:horizontal?45:12,bottom:4,left:4}},
      scales:horizontal?{x:{beginAtZero:true,grace:"12%",ticks:{precision:0}},y:{ticks:{autoSkip:false}}}:{y:{beginAtZero:true,grace:"12%",ticks:{precision:0}},x:{ticks:{autoSkip:true,maxRotation:0}}}};
  }
  function atualizarGraficos(lista) {
    if(!window.Chart) return;
    const mensal=agregarMensal(dados), labels=mensal.map(x=>periodoLabel(x.periodo));
    const cfgLinha=(label,serie,cor,formatarMoeda=false)=>({type:"line",data:{labels,datasets:[{label,data:mensal.map(serie),borderColor:cor,backgroundColor:cor+"22",fill:true,tension:.28,pointRadius:4,pointHoverRadius:6}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:true,position:"bottom"},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${formatarMoeda?moeda(ctx.raw):inteiro(ctx.raw)}`}},datalabels:{display:true,align:"top",anchor:"end",color:"#34445b",font:{weight:"600",size:10},formatter:v=>formatarMoeda?moeda(v):inteiro(v)}},scales:{y:{beginAtZero:true,grace:"12%"},x:{ticks:{maxRotation:0,autoSkip:false}}}}});
    grafico("cc-grafico-periodo",cfgLinha("Contratos",x=>x.contratos,"#245b91"));
    grafico("cc-grafico-faturamento",cfgLinha("Contribuição mensal",x=>x.faturamento,"#16835b",true));
    const crescimento=mensal.map((x,i)=>i===0?null:pct(x.contratos,mensal[i-1].contratos));
    grafico("cc-grafico-crescimento", {
      type: "bar",
      data: { labels, datasets: [{ label: "Crescimento de contratos (%)", data: crescimento, backgroundColor: crescimento.map(v => v == null ? "#cbd5e1" : v >= 0 ? "#16835b" : "#c2413b"), borderRadius: 5 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ctx.raw == null ? "Sem mês anterior" : `${ctx.raw > 0 ? "+" : ""}${ctx.raw.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` } },
          datalabels: { display: true, anchor: "end", align: "end", formatter: v => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`, color: "#34445b", font: { weight: "600", size: 10 } }
        },
        scales: { y: { beginAtZero: false, grace: "15%", ticks: { callback: v => `${v}%` } }, x: { ticks: { maxRotation: 0, autoSkip: false } } }
      }
    });

    // Ranking de TKM: contribuição mensal somada dividida pela quantidade de contratos
    // de cada consultor dentro da lista já filtrada.
    const tkmPorConsultor = new Map();
    lista.forEach(r => {
      const nome = txt(r.consultor) || "Sem consultor";
      if (!tkmPorConsultor.has(nome)) tkmPorConsultor.set(nome, { total: 0, contratos: 0 });
      const item = tkmPorConsultor.get(nome);
      item.total += valor(r.contribuicao_mensal);
      item.contratos++;
    });
    const rankingTkm = [...tkmPorConsultor.entries()]
      .map(([nome, x]) => ({ nome, tkm: x.contratos ? x.total / x.contratos : 0, contratos: x.contratos }))
      .sort((a,b) => b.tkm-a.tkm || a.nome.localeCompare(b.nome,"pt-BR"));
    grafico("cc-grafico-tkm", {
      type: "bar",
      data: { labels: rankingTkm.map(x=>x.nome), datasets: [{ label: "TKM médio", data: rankingTkm.map(x=>x.tkm), backgroundColor: "#3678c8", borderRadius: 5 }] },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { right: 86, left: 4, top: 8, bottom: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `TKM médio: ${moeda(ctx.raw)} · ${inteiro(rankingTkm[ctx.dataIndex]?.contratos)} contratos` } },
          datalabels: { display: true, anchor: "end", align: "end", clamp: true, color: "#34445b", font: { weight: "700", size: 11 }, formatter: v => moeda(v) }
        },
        scales: { x: { beginAtZero: true, grace: "18%", ticks: { callback: v => moeda(v) } }, y: { ticks: { autoSkip: false } } }
      }
    });
    const areaTkm = el("cc-area-ranking-tkm");
    if (areaTkm) areaTkm.style.height = `${Math.max(320, rankingTkm.length * 31)}px`;

    const faixas = ["4h", "6h", "Não identificada"];
    const contagemFaixas = faixas.map(f => lista.filter(r => cargaHoraria(r) === f).length);
    grafico("cc-grafico-carga-horaria", {
      type: "bar",
      data: { labels: ["4h (20–24h)", "6h (30–18h)", "Não identificada"], datasets: [{ label: "Contratos", data: contagemFaixas, backgroundColor: ["#16835b", "#3678c8", "#cbd5e1"], borderRadius: 5 }] },
      options: {
        ...opcoesBarra(false),
        layout: { padding: { top: 28, right: 12, bottom: 4, left: 4 } },
        plugins: {
          ...opcoesBarra(false).plugins,
          datalabels: {
            display: true,
            anchor: "end",
            align: "end",
            clamp: true,
            color: "#182538",
            font: { weight: "700", size: 12 },
            formatter: v => inteiro(v)
          },
          tooltip: { callbacks: { label: ctx => `Contratos: ${inteiro(ctx.raw)}` } }
        }
      }
    });

    // Top 5 empresas com aprendizes ativos no conjunto filtrado.
    // Como o filtro de período seleciona o mês mais recente por padrão,
    // a contagem representa os contratos ativos daquele período, sem somar
    // repetidamente o histórico de meses anteriores.
    const porEmpresaAtiva = new Map();
    lista.filter(ativo).forEach(r => {
      const nome = txt(r.empresa) || "Empresa não identificada";
      porEmpresaAtiva.set(nome, (porEmpresaAtiva.get(nome) || 0) + 1);
    });
    const topEmpresasAtivas = [...porEmpresaAtiva.entries()]
      .sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
      .slice(0, 5);
    renderizarRankingEmpresasAtivas(topEmpresasAtivas);

    const porConsultor={}; lista.forEach(r=>{const n=txt(r.consultor)||"Sem consultor";porConsultor[n]=(porConsultor[n]||0)+1;});
    const todosConsultores=Object.entries(porConsultor).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"pt-BR"));
    grafico("cc-grafico-consultores-todos",{type:"bar",data:{labels:todosConsultores.map(x=>x[0]),datasets:[{label:"Contratos",data:todosConsultores.map(x=>x[1]),backgroundColor:"#3b82a0",borderRadius:4}]},options:opcoesBarra(true)});
    const porSubsede={}; lista.forEach(r=>{const n=txt(r.subsede)||"Sem subsede";porSubsede[n]=(porSubsede[n]||0)+1;});
    const todasSubsedes=Object.entries(porSubsede).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"pt-BR"));
    grafico("cc-grafico-subsede",{type:"bar",data:{labels:todasSubsedes.map(x=>x[0]),datasets:[{label:"Contratos",data:todasSubsedes.map(x=>x[1]),backgroundColor:"#4c8b67",borderRadius:4}]},options:opcoesBarra(true)});
    const cartao=lista.reduce((a,r)=>{const v=txt(r.cartao_futuro).toLocaleLowerCase("pt-BR");if(["sim","true","1","yes","com cartão futuro","com cartao futuro"].includes(v))a.sim++;else if(v && ["não","nao","false","0","no","sem cartão futuro","sem cartao futuro"].includes(v))a.nao++;return a;},{sim:0,nao:0});
    grafico("cc-grafico-cartao",{type:"doughnut",data:{labels:["Com Cartão Futuro","Sem Cartão Futuro"],datasets:[{data:[cartao.sim,cartao.nao],backgroundColor:["#3678c8","#d7e0eb"],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom"},datalabels:{display:true,color:"#182538",font:{weight:"600"},formatter:v=>inteiro(v)},tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${inteiro(ctx.raw)}`}}}}});
    const alturaTodos=el("cc-grafico-consultores-todos")?.parentElement; if(alturaTodos)alturaTodos.style.height=`${Math.max(320,todosConsultores.length*30)}px`;
    const alturaSubs=el("cc-grafico-subsede")?.parentElement; if(alturaSubs)alturaSubs.style.height=`${Math.max(320,todasSubsedes.length*32)}px`;
    graficos["cc-grafico-consultores-todos"]?.resize(); graficos["cc-grafico-subsede"]?.resize(); graficos["cc-grafico-tkm"]?.resize();
  }

  function renderizarRankingEmpresasAtivas(ranking) {
    const container = el("cc-ranking-empresas");
    if (!container) return;

    if (!ranking.length) {
      container.innerHTML = '<p class="cc-ranking-vazio">Nenhuma empresa com aprendizes ativos foi encontrada para os filtros selecionados.</p>';
      return;
    }

    const maximo = Math.max(...ranking.map(item => item[1]), 1);
    container.innerHTML = ranking.map(([nome, quantidade], indice) => {
      const largura = Math.max(2, (quantidade / maximo) * 100);
      const rotulo = quantidade === 1 ? "aprendiz ativo" : "aprendizes ativos";
      return `
        <div class="cc-ranking-empresa">
          <div class="cc-ranking-empresa-topo">
            <span class="cc-ranking-posicao">${indice + 1}º</span>
            <span class="cc-ranking-nome" title="${escape(nome)}">${escape(nome)}</span>
            <span class="cc-ranking-valor">${inteiro(quantidade)} ${rotulo}</span>
          </div>
          <div class="cc-ranking-trilho" role="img" aria-label="${escape(nome)}: ${inteiro(quantidade)} ${rotulo}">
            <div class="cc-ranking-barra" style="width:${largura}%"></div>
          </div>
        </div>`;
    }).join("");
  }

  function atualizarTabela(lista) {
    const corpo=el("cc-tabela-corpo"); if(!corpo) return;
    const busca=(el("cc-busca")?.value||"").toLocaleLowerCase("pt-BR");
    const filtrados=lista.filter(r=>!busca || [r.empresa,r.cnpj,r.consultor,r.cidade,r.subsede,r.aprendiz,r.tipo_contrato].some(v=>txt(v).toLocaleLowerCase("pt-BR").includes(busca)));
    const pagina=Math.max(1,Number(el("cc-pagina")?.value)||1), tamanho=50, totalPaginas=Math.max(1,Math.ceil(filtrados.length/tamanho)), p=Math.min(pagina,totalPaginas);
    if(el("cc-pagina")) el("cc-pagina").value=String(p);
    const inicio=(p-1)*tamanho, paginaDados=filtrados.slice(inicio,inicio+tamanho);
    corpo.innerHTML=paginaDados.length?paginaDados.map(r=>`<tr><td>${escape(periodoLabel(periodoKey(r.periodo_referencia)))}</td><td>${escape(r.consultor||"—")}</td><td>${escape(r.subsede||"—")}</td><td>${escape(r.empresa||"—")}</td><td>${escape(r.cnpj||"—")}</td><td>${escape(r.aprendiz||"—")}</td><td>${escape(r.cidade||"—")}</td><td>${escape(r.tipo_contrato||"—")}</td><td>${ativo(r)?"Ativo":"Inativo"}</td><td>${moeda(r.contribuicao_mensal)}</td></tr>`).join(""):`<tr><td colspan="10">Nenhum contrato encontrado com os filtros selecionados.</td></tr>`;
    if(el("cc-contador")) el("cc-contador").textContent=filtrados.length?`Exibindo ${inicio+1}–${Math.min(inicio+tamanho,filtrados.length)} de ${inteiro(filtrados.length)} contratos · Página ${p} de ${totalPaginas}`:"Nenhum contrato encontrado.";
    if(el("cc-anterior")) el("cc-anterior").disabled=p<=1;
    if(el("cc-proxima")) el("cc-proxima").disabled=p>=totalPaginas;
  }
  function renderizar() { const lista=filtros(); atualizarKpis(lista); atualizarGraficos(lista); if(el("cc-pagina"))el("cc-pagina").value="1"; atualizarTabela(lista); }
  function mensagem(texto,tipo="info"){const m=el("cc-mensagem");if(m){m.textContent=texto;m.dataset.tipo=tipo;}}
  async function carregar() {
    if(carregando) return; carregando=true; const botao=el("cc-atualizar"); if(botao)botao.disabled=true; mensagem("Carregando contratos do Supabase…");
    try { const novos=await buscarTodos(); dados=novos; montarFiltros(); renderizar(); mensagem(`${inteiro(dados.length)} contratos carregados. Mês mais recente selecionado automaticamente; os gráficos históricos mostram todos os períodos disponíveis.`,"success"); }
    catch(e){ console.error("Carteira dos Consultores:",e); mensagem("Não foi possível carregar a Carteira dos Consultores: "+(e.message||"erro desconhecido")+". Confira as permissões SELECT da tabela bi_carteira_consultores no Supabase.","error"); }
    finally{carregando=false;if(botao)botao.disabled=false;}
  }
  function configurarEventos(){
    ["cc-filtro-periodo","cc-filtro-consultor","cc-filtro-subsede","cc-filtro-cidade","cc-filtro-status"].forEach(id=>el(id)?.addEventListener("change",renderizar));
    el("cc-filtro-empresa")?.addEventListener("input",renderizar); el("cc-busca")?.addEventListener("input",()=>atualizarTabela(filtros()));
    el("cc-atualizar")?.addEventListener("click",carregar);
    el("cc-limpar")?.addEventListener("click",()=>{["cc-filtro-consultor","cc-filtro-subsede","cc-filtro-cidade","cc-filtro-status","cc-filtro-empresa","cc-busca"].forEach(id=>{if(el(id))el(id).value="";}); const sel=el("cc-filtro-periodo");if(sel){const vals=[...sel.options].map(o=>o.value).filter(Boolean);sel.value=vals.sort((a,b)=>periodoKey(a).localeCompare(periodoKey(b))).at(-1)||"";}renderizar();});
    el("cc-anterior")?.addEventListener("click",()=>{if(el("cc-pagina"))el("cc-pagina").value=String(Math.max(1,Number(el("cc-pagina").value)-1));atualizarTabela(filtros());});
    el("cc-proxima")?.addEventListener("click",()=>{if(el("cc-pagina"))el("cc-pagina").value=String((Number(el("cc-pagina").value)||1)+1);atualizarTabela(filtros());});
    el("cc-exportar")?.addEventListener("click",()=>{const lista=filtros();const headers=["Período","Consultor","Subsede","Empresa","CNPJ","Aprendiz","Cidade","Tipo de contrato","Ativo","Contribuição mensal"];const linhas=lista.map(r=>[periodoKey(r.periodo_referencia),r.consultor,r.subsede,r.empresa,r.cnpj,r.aprendiz,r.cidade,r.tipo_contrato,ativo(r)?"Ativo":"Inativo",r.contribuicao_mensal].map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";"));const blob=new Blob(["\uFEFF"+[headers.join(";"),...linhas].join("\r\n")],{type:"text/csv;charset=utf-8;"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="carteira-consultores.csv";a.click();URL.revokeObjectURL(url);});
  }
  window.inicializarCarteiraConsultores=function(){
    const section=el("carteira-consultores-section"),nav=el("carteira-consultores-nav-link");
    if(!section||!nav||!(window.sb||sb))return;
    const allowed = currentProfile?.role === "admin" || (currentProfile?.role === "supervisor" ? usuarioTemModulo("carteira_consultores") : Boolean(currentUser));
    section.hidden=!allowed;nav.hidden=!allowed;
    if(!allowed)return;
    if(!inicializado){configurarEventos();inicializado=true;carregar();}
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{if((window.sb||sb)?.auth)(window.sb||sb).auth.getSession().then(({data})=>{if(data?.session)window.inicializarCarteiraConsultores();});},{once:true});
})();
