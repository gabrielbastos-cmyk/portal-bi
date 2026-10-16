const SUPABASE_URL = "https://oigqmmkaqbpzgaeztajx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "SUA_CHAVE_PUBLICA_EXISTENTE";

if (!window.supabase) {
  console.error("A biblioteca do Supabase não foi carregada.");
} else {
  window.sb = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );
}
