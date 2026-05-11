import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
let pdfParse;
try{
  pdfParse = await import('pdf-parse/lib/pdf-parse.js').then(m=>m.default||m);
}catch(e){
  try{
    pdfParse = await import('pdf-parse').then(m=>m.default||m);
  }catch(err){
    console.error('pdf-parse import failed',err);
    process.exit(1);
  }
}

function readEnv(filePath) {
  const raw = fs.readFileSync(filePath,'utf8');
  const lines = raw.split(/\r?\n/);
  const env = {};
  for(const line of lines){ if(!line||line.startsWith('#')) continue; const i=line.indexOf('='); if(i<=0) continue; env[line.slice(0,i)]=line.slice(i+1).replace(/^"|"$/g,''); }
  return env;
}

const env = readEnv('.env.local');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{ persistSession:false, autoRefreshToken:false } });

(async()=>{
  const { data, error } = await supabase.from('proposals').select('id,vendor_name,proposal_file').eq('proposal_type','uploaded_pdf').order('created_at',{ascending:false}).limit(1).single();
  if(error||!data){ console.error('No proposal found', error); process.exit(1); }
  console.log('Parsing PDF for:', data.vendor_name);
  console.log('URL:', data.proposal_file);

  const res = await fetch(data.proposal_file);
  if(!res.ok){ console.error('Failed to fetch PDF', res.status); process.exit(1); }
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  try{
    const parsed = await pdfParse(buffer);
    console.log('Pages:', parsed.numpages);
    console.log('Text length:', (parsed.text||'').length);
    console.log('\n---- Extract preview ----\n');
    console.log((parsed.text||'').slice(0,2000));
  }catch(err){
    console.error('Parsing error:', err);
    process.exit(1);
  }
})();