// Estos dos valores son públicos. Los permisos se aplican en la base de datos.
// Usa la clave publishable (sb_publishable_...) o la clave anon heredada.
// Nunca pongas aquí una contraseña, una clave secret ni service_role.
window.PROJECTFLOW_CONFIG = Object.freeze({
  pushPublicKey: "BG9xDlWXelbdRd0qZKbQ6Dfl56884E2E-jZQjjhgdam_3LftRCBO6l2qh7BAKY_b7d1GdpjIgzx3U44KbOg7W3E", // Clave VAPID pública; nunca la privada.
  supabaseUrl: "https://vhpvyebzypqikozzimmw.supabase.co",
  supabasePublishableKey: "sb_publishable_zM8C3eF1ujFHtAYcqO_6eg_SKuSljRL"
});
