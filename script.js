
"use strict";

const sb = window.sb;

const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let allDashboards = [];
let adminUsers = [];

// ==================================================
// MENSAGENS E FUNÇÕES AUXILIARES
// ==================================================

function showMessage(id, message, type = "error") {
  const element = $(id);
  if (!element) return;

  element.textContent = message;
  element.className =
    type === "success" ? "message-success" : "message-error";
}

function clearMessage(id) {
  const element = $(id);

  if (element) {
    element.textContent = "";
    element.className = "";
  }
}

function setLoading(button, loading, loadingText = "Aguarde...") {
  if (!button) return;

  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    button.textContent =
      button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function friendlyError(error) {
  const message = error?.message || "";

  if (/invalid login credentials/i.test(message)) {
    return "E-mail ou senha incorretos.";
  }

  if (/email not confirmed/i.test(message)) {
    return "Seu e-mail ainda não foi confirmado.";
  }

  if (/failed to fetch|networkerror/i.test(message)) {
    return "Não foi possível conectar. Confira a internet e a configuração do Supabase.";
  }

  return message || "Ocorreu um erro inesperado.";
}

function isSafeDashboardUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// ==================================================
// INICIALIZAÇÃO E SESSÃO
// ==================================================

if (!sb) {
  showMessage(
    "login-message",
    "O Supabase não foi configurado. Confira o arquivo config.js."
  );
} else {
  iniciarPortal();
}

async function iniciarPortal() {
  try {
    const { data, error } = await sb.auth.getSession();

    if (error) throw error;

    if (data.session) {
      await atualizarPortal();
    } else {
      mostrarLogin();
    }
  } catch (error) {
    console.error("Erro ao iniciar portal:", error);
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
      mostrarLogin();
    }
  });
}

function mostrarLogin() {
  const loginSection = $("login-section");
  const portalSection = $("portal-section");
  const adminSection = $("admin-section");
  const adminNavLink = $("admin-nav-link");
  const userEmail = $("user-email");

  if (loginSection) loginSection.hidden = false;
  if (portalSection) portalSection.hidden = true;
  if (adminSection) adminSection.hidden = true;
  if (adminNavLink) adminNavLink.hidden = true;
  if (userEmail) userEmail.textContent = "";
}

function mostrarPortal() {
  const loginSection = $("login-section");
  const portalSection = $("portal-section");
  const userEmail = $("user-email");

  if (loginSection) loginSection.hidden = true;
  if (portalSection) portalSection.hidden = false;

  if (userEmail) {
    userEmail.textContent = currentUser?.email || "";
  }
}

// ==================================================
// LOGIN
// ==================================================

const loginForm = $("login-form");

if (loginForm) {
  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    clearMessage("login-message");

    const button = event.submitter;
    setLoading(button, true, "Entrando...");

    try {
      const email = $("email")?.value.trim();
      const password = $("password")?.value;

      if (!email || !password) {
        throw new Error("Informe seu e-mail e sua senha.");
      }

      const { error } = await sb.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      await atualizarPortal();
    } catch (error) {
      console.error("Erro no login:", error);
      showMessage("login-message", friendlyError(error));
    } finally {
      setLoading(button, false);
    }
  });
}

// ==================================================
// SAIR
// ==================================================

const logoutButton = $("logout-btn");

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    try {
      const { error } = await sb.auth.signOut();

      if (error) throw error;

      mostrarLogin();
    } catch (error) {
      console.error("Erro ao sair:", error);
      showMessage("dashboard-message", friendlyError(error));
    }
  });
}

// ==================================================
// ATUALIZAR PORTAL E PERFIL
// ==================================================

async function atualizarPortal() {
  try {
    const {
      data: { user },
      error: userError
    } = await sb.auth.getUser();

    if (userError) throw userError;

    if (!user) {
      mostrarLogin();
      return;
    }

    currentUser = user;

    const { data: profile, error: profileError } = await sb
      .from("profiles")
      .select("id, email, role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) {
      throw new Error(
        "Seu perfil não foi encontrado. Peça ao administrador para verificar a tabela profiles."
      );
    }

    currentProfile = profile;

    mostrarPortal();

    const isAdmin = profile.role === "admin";

    const adminSection = $("admin-section");
    const adminNavLink = $("admin-nav-link");

    if (adminSection) adminSection.hidden = !isAdmin;
    if (adminNavLink) adminNavLink.hidden = !isAdmin;

    await carregarDashboards();

    if (isAdmin) {
      await carregarAdministracao();
    }
  } catch (error) {
    console.error("Erro ao atualizar portal:", error);
    showMessage("dashboard-message", friendlyError(error));
  }
}

// ==================================================
// CARREGAR DASHBOARDS
// A POLÍTICA RLS PRECISA FILTRAR OS ACESSOS
// ==================================================

async function carregarDashboards() {
  clearMessage("dashboard-message");

  const grid = $("dashboard-grid");

  if (!grid) {
    console.error("Elemento dashboard-grid não encontrado.");
    return;
  }

  grid.replaceChildren();

  const { data, error } = await sb
    .from("dashboards")
    .select("id, name, description, category, url")
    .order("name");

  if (error) throw error;

  allDashboards = data || [];

  if (!allDashboards.length) {
    showMessage(
      "dashboard-message",
      "Nenhum dashboard foi liberado para sua conta.",
      "success"
    );

    atualizarResumo();
    atualizarListaAdministrativa();
    return;
  }

  allDashboards.forEach(dashboard => {
    const card = document.createElement("article");
    card.className = "dashboard-card";

    const title = document.createElement("h3");
    title.textContent = dashboard.name || "Dashboard sem nome";

    const description = document.createElement("p");
    description.textContent = dashboard.description || "";

    const category = document.createElement("p");
    category.className = "card-category";
    category.dataset.category = dashboard.category || "outros";
    category.textContent =
      "Categoria: " + (dashboard.category || "Outros");

    card.append(title, description, category);

    if (isSafeDashboardUrl(dashboard.url)) {
      const link = document.createElement("a");

      link.href = dashboard.url;
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

  atualizarResumo();
  aplicarFiltrosDashboards();
  renderizarDashboardsAdministrativos();
}

// ==================================================
// BUSCA, FILTRO E RESUMO
// ==================================================

function atualizarResumo() {
  const summaryTotal = $("summary-total");
  const summaryCategories = $("summary-categories");

  if (summaryTotal) {
    summaryTotal.textContent = String(allDashboards.length);
  }

  const categories = new Set(
    allDashboards.map(d => normalize(d.category || "outros"))
  );

  if (summaryCategories) {
    summaryCategories.textContent = String(categories.size);
  }
}

function aplicarFiltrosDashboards() {
  const grid = $("dashboard-grid");

  if (!grid) return;

  const searchInput = $("dashboard-search");
  const categoryFilter = $("category-filter");

  const term = normalize(searchInput?.value || "");
  const selectedCategory = normalize(categoryFilter?.value || "");

  const cards = [
    ...grid.querySelectorAll(".dashboard-card")
  ];

  let visible = 0;

  cards.forEach(card => {
    const category = normalize(
      card.querySelector(".card-category")?.dataset.category
    );

    const matchesSearch = normalize(card.innerText).includes(term);

    const matchesCategory =
      !selectedCategory || category === selectedCategory;

    const show = matchesSearch && matchesCategory;

    card.hidden = !show;

    if (show) visible++;
  });

  const filterEmpty = $("filter-empty");

  if (filterEmpty) {
    filterEmpty.hidden = visible > 0 || cards.length === 0;
  }
}

const searchInput = $("dashboard-search");
const categoryFilter = $("category-filter");

if (searchInput) {
  searchInput.addEventListener("input", aplicarFiltrosDashboards);
}

if (categoryFilter) {
  categoryFilter.addEventListener("change", aplicarFiltrosDashboards);
}

// ==================================================
// CHAMAR EDGE FUNCTION portal-admin
// ==================================================

async function adminCall(action, payload = {}) {
  const { data, error } = await sb.functions.invoke("portal-admin", {
    body: {
      action,
      ...payload
    }
  });

  if (error) {
    console.error("Erro na função portal-admin:", error);

    throw new Error(
      "Não foi possível executar a operação administrativa. Confira a publicação da função e o perfil da sua conta."
    );
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}

// ==================================================
// ADMINISTRAÇÃO
// ==================================================

async function carregarAdministracao() {
  try {
    const result = await adminCall("list_users");

    adminUsers = result.users || [];

    preencherListaUsuarios();
    renderizarDashboardsAdministrativos();
  } catch (error) {
    console.error("Erro ao carregar administração:", error);
    showMessage("permission-message", friendlyError(error));
  }
}

function preencherListaUsuarios() {
  const select = $("permission-user");

  if (!select) return;

  const previousValue = select.value;

  select.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Selecione um usuário";

  select.appendChild(placeholder);

  adminUsers.forEach(user => {
    const option = document.createElement("option");

    option.value = user.id;
    option.textContent =
      `${user.email || "Sem e-mail"} — ${user.role || "user"}`;

    select.appendChild(option);
  });

  if (adminUsers.some(user => user.id === previousValue)) {
    select.value = previousValue;
  }

  if (select.value) {
    carregarPermissoesUsuario();
  } else {
    clearMessage("permission-message");

    const container = $("permission-dashboard-list");
    if (container) container.replaceChildren();
  }
}

// ==================================================
// CRIAR USUÁRIO
// ==================================================

const userCreateForm = $("user-create-form");

if (userCreateForm) {
  userCreateForm.addEventListener("submit", async event => {
    event.preventDefault();
    clearMessage("user-create-message");

    const button = event.submitter;

    setLoading(button, true, "Criando usuário...");

    try {
      const email = $("new-user-email")?.value.trim();
      const password = $("new-user-password")?.value;
      const role = $("new-user-role")?.value;

      if (!email || !password || !role) {
        throw new Error("Preencha todos os campos do usuário.");
      }

      await adminCall("create_user", {
        email,
        password,
        role
      });

      userCreateForm.reset();

      showMessage(
        "user-create-message",
        "Usuário criado com sucesso!",
        "success"
      );

      await carregarAdministracao();
    } catch (error) {
      console.error("Erro ao criar usuário:", error);
      showMessage("user-create-message", friendlyError(error));
    } finally {
      setLoading(button, false);
    }
  });
}

// ==================================================
// PERMISSÕES
// ==================================================

const permissionUserSelect = $("permission-user");

if (permissionUserSelect) {
  permissionUserSelect.addEventListener(
    "change",
    carregarPermissoesUsuario
  );
}

async function carregarPermissoesUsuario() {
  clearMessage("permission-message");

  const userId = $("permission-user")?.value;
  const container = $("permission-dashboard-list");

  if (!container) return;

  container.replaceChildren();

  if (!userId) return;

  const selectedUser = adminUsers.find(user => user.id === userId);

  if (!selectedUser) return;

  if (selectedUser.role === "admin") {
    showMessage(
      "permission-message",
      "Administradores possuem acesso a todos os dashboards.",
      "success"
    );

    return;
  }

  try {
    const { data, error } = await sb
      .from("dashboard_permissions")
      .select("dashboard_id")
      .eq("user_id", userId);

    if (error) throw error;

    const permittedIds = new Set(
      (data || []).map(item => item.dashboard_id)
    );

    // Carrega a lista completa de dashboards para configurar permissões.
    if (!allDashboards.length) {
      const {
        data: dashboards,
        error: dashboardsError
      } = await sb
        .from("dashboards")
        .select("id, name, description, category, url")
        .order("name");

      if (dashboardsError) throw dashboardsError;

      allDashboards = dashboards || [];
    }

    // CORREÇÃO: informa quando não há dashboards cadastrados.
    if (!allDashboards.length) {
      showMessage(
        "permission-message",
        "Cadastre pelo menos um dashboard antes de configurar acessos."
      );

      return;
    }

    allDashboards.forEach(dashboard => {
      const label = document.createElement("label");
      label.className = "permission-option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = dashboard.id;
      checkbox.checked = permittedIds.has(dashboard.id);

      const text = document.createElement("span");
      text.textContent = dashboard.name || "Dashboard sem nome";

      label.append(checkbox, text);
      container.appendChild(label);
    });
  } catch (error) {
    console.error("Erro ao carregar permissões:", error);
    showMessage("permission-message", friendlyError(error));
  }
}

const savePermissionsButton = $("save-permissions-btn");

if (savePermissionsButton) {
  savePermissionsButton.addEventListener("click", async () => {
    clearMessage("permission-message");

    const userId = $("permission-user")?.value;

    if (!userId) {
      showMessage(
        "permission-message",
        "Selecione um usuário primeiro."
      );

      return;
    }

    const selectedUser = adminUsers.find(user => user.id === userId);

    if (!selectedUser) {
      showMessage("permission-message", "Usuário inválido.");
      return;
    }

    if (selectedUser.role === "admin") {
      showMessage(
        "permission-message",
        "Administradores já possuem acesso a todos os dashboards."
      );

      return;
    }

    const button = $("save-permissions-btn");

    setLoading(button, true, "Salvando...");

    try {
      const dashboardIds = Array.from(
        $("permission-dashboard-list").querySelectorAll(
          'input[type="checkbox"]:checked'
        )
      ).map(checkbox => checkbox.value);

      await adminCall("set_permissions", {
        user_id: userId,
        dashboard_ids: dashboardIds
      });

      showMessage(
        "permission-message",
        "Permissões salvas com sucesso!",
        "success"
      );
    } catch (error) {
      console.error("Erro ao salvar permissões:", error);
      showMessage("permission-message", friendlyError(error));
    } finally {
      setLoading(button, false);
    }
  });
}

// ==================================================
// LISTA ADMINISTRATIVA DE DASHBOARDS
// ==================================================

function atualizarListaAdministrativa() {
  renderizarDashboardsAdministrativos();
}

function renderizarDashboardsAdministrativos() {
  const container = $("admin-dashboard-list");

  if (!container) return;

  container.replaceChildren();

  allDashboards.forEach(dashboard => {
    const item = document.createElement("article");
    item.className = "admin-dashboard-item";

    const title = document.createElement("strong");
    title.textContent = dashboard.name || "Dashboard sem nome";

    const description = document.createElement("p");
    description.textContent =
      `${dashboard.category || "outros"} — ID: ${dashboard.id}`;

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Editar";

    editButton.addEventListener("click", () => {
      preencherFormularioDashboard(dashboard);
    });

    item.append(title, description, editButton);
    container.appendChild(item);
  });

  if (!allDashboards.length) {
    const empty = document.createElement("p");
    empty.textContent = "Nenhum dashboard cadastrado.";

    container.appendChild(empty);
  }
}

function preencherFormularioDashboard(dashboard) {
  $("dashboard-id").value = dashboard.id;
  $("dashboard-name").value = dashboard.name;
  $("dashboard-description").value = dashboard.description || "";
  $("dashboard-category").value = dashboard.category || "outros";
  $("dashboard-url").value = dashboard.url || "";

  $("dashboard-form").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

// ==================================================
// CADASTRAR OU ATUALIZAR DASHBOARD
// ==================================================

const dashboardForm = $("dashboard-form");

if (dashboardForm) {
  dashboardForm.addEventListener("submit", async event => {
    event.preventDefault();
    clearMessage("dashboard-form-message");

    const button = event.submitter;

    setLoading(button, true, "Salvando...");

    try {
      const dashboard = {
        id: $("dashboard-id").value.trim(),
        name: $("dashboard-name").value.trim(),
        description: $("dashboard-description").value.trim(),
        category: $("dashboard-category").value,
        url: $("dashboard-url").value.trim()
      };

      if (
        !dashboard.id ||
        !dashboard.name ||
        !dashboard.description ||
        !isSafeDashboardUrl(dashboard.url)
      ) {
        throw new Error(
          "Preencha todos os campos e informe uma URL válida."
        );
      }

      const { error } = await sb
        .from("dashboards")
        .upsert(dashboard, { onConflict: "id" });

      if (error) throw error;

      showMessage(
        "dashboard-form-message",
        "Dashboard salvo com sucesso!",
        "success"
      );

      dashboardForm.reset();

      await carregarDashboards();

      if (currentProfile?.role === "admin") {
        await carregarAdministracao();
      }
    } catch (error) {
      console.error("Erro ao salvar dashboard:", error);
      showMessage("dashboard-form-message", friendlyError(error));
    } finally {
      setLoading(button, false);
    }
  });
}
