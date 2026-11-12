import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('assets/vendor', { recursive: true });
await copyFile('node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'assets/vendor/supabase.js');
await copyFile('node_modules/@supabase/supabase-js/LICENSE', 'assets/vendor/LICENSE-supabase');

await copyFile('node_modules/jspdf/dist/jspdf.umd.min.js', 'assets/vendor/jspdf.js');
await copyFile('node_modules/jspdf/LICENSE', 'assets/vendor/LICENSE-jspdf');
const fontSource = 'https://raw.githubusercontent.com/notofonts/noto-fonts/ffebf8c1ee449e544955a7e813c54f9b73848eac/';
const { writeFile } = await import('node:fs/promises');
for (const [source, target] of [['hinted/ttf/NotoSans/NotoSans-Regular.ttf', 'NotoSans-Regular.ttf'], ['LICENSE', 'LICENSE-NotoSans']]) {
  const response = await fetch(fontSource + source);
  if (!response.ok) throw new Error(`Font download failed: ${response.status}`);
  await writeFile('assets/vendor/' + target, new Uint8Array(await response.arrayBuffer()));
}
