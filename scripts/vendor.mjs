import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('assets/vendor', { recursive: true });
await copyFile('node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'assets/vendor/supabase.js');
await copyFile('node_modules/@supabase/supabase-js/LICENSE', 'assets/vendor/LICENSE-supabase');
