const SUPABASE_URL = "URL_REAL_DO_SEU_PROJETO";
const SUPABASE_PUBLISHABLE_KEY = "CHAVE_PUBLICA_REAL";

if (!window.supabase) {
  console.error("A biblioteca do Supabase não foi carregada.");
} else {
  window.sb = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );
}
