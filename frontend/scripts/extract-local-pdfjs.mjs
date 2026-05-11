import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

function readEnv(filePath) {
  const raw = fs.readFileSync(filePath,'utf8');
  const lines = raw.split(/\r?\n/);
  const env = {};
  for(const line of lines){ if(!line||line.startsWith('#')) continue; const i=line.indexOf('='); if(i<=0) continue; env[line.slice(0,i)]=line.slice(i+1).replace(/^"|"$/g,''); }
  return env;
}

const env = readEnv('.env.local');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{ persistSession:false, autoRefreshToken:false } });

// Minimal DOM polyfills required by pdfjs
globalThis.DOMMatrix = globalThis.DOMMatrix || class DOMMatrix{};
globalThis.ImageData = globalThis.ImageData || class ImageData{ constructor(){}};
globalThis.Path2D = globalThis.Path2D || function Path2D(){};

let pdfjs;
try{
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs').then(m=>m.default||m);
}catch(e){
  try{
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.js').then(m=>m.default||m);
  }catch(err){
    console.error('pdfjs import failed', err);
    process.exit(1);
  }
}
pdfjs.GlobalWorkerOptions.workerSrc = '';

(async()=>{
  const { data, error } = await supabase.from('proposals').select('id,vendor_name,proposal_file').eq('proposal_type','uploaded_pdf').order('created_at',{ascending:false}).limit(1).single();
  if(error||!data){ console.error('No proposal found', error); process.exit(1); }
  console.log('Parsing PDF for:', data.vendor_name);
  console.log('URL:', data.proposal_file);

  const res = await fetch(data.proposal_file);
  if(!res.ok){ console.error('Failed to fetch PDF', res.status); process.exit(1); }
  const arrayBuffer = await res.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  try{
    const loadingTask = pdfjs.getDocument({ data: uint8, disableWorker: true });
    const doc = await loadingTask.promise;
    console.log('numPages', doc.numPages);
    let fullText = '';
    for(let i=1;i<=doc.numPages;i++){
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map(s=>s.str);
      fullText += strings.join(' ') + '\n\n';
    }
    console.log('Extracted length:', fullText.length);
    console.log('\n---- preview ----\n', fullText.slice(0,2000));
  }catch(err){
    console.error('pdfjs parse error:', err);
    process.exit(1);
  }
})();