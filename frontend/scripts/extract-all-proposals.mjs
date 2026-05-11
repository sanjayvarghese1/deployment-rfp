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

let pdfParse;
try{
  pdfParse = await import('pdf-parse/lib/pdf-parse.js').then(m=>m.default||m);
}catch(e){
  try{ pdfParse = await import('pdf-parse').then(m=>m.default||m); }catch(err){ console.error('pdf-parse import failed', err); process.exit(1); }
}

async function fetchCandidates(){
  const { data, error } = await supabase.from('proposals').select('id,proposal_file,proposal_data,vendor_name').eq('proposal_type','uploaded_pdf').limit(1000);
  if(error){ console.error('Supabase select error', error); process.exit(1); }
  return data || [];
}

function isPlaceholder(pd){ if(!pd) return true; const p = (pd||'').trim(); if(p.length<50) return true; if(p.startsWith('[PDF extraction failed:')) return true; return false; }

(async()=>{
  const rows = await fetchCandidates();
  const candidates = rows.filter(r=> r.proposal_file && isPlaceholder(r.proposal_data));
  console.log('Found', candidates.length, 'candidates for extraction');
  let updated = 0;
  for(const r of candidates){
    console.log('\nProcessing id=', r.id, 'vendor=', r.vendor_name);
    try{
      const res = await fetch(r.proposal_file);
      if(!res.ok){ console.error('Failed to fetch:', res.status); continue; }
      const ab = await res.arrayBuffer();
      const buffer = Buffer.from(ab);
      const parsed = await pdfParse(buffer);
      const text = (parsed && parsed.text) ? parsed.text : '';
      if(!text || text.trim().length < 20){
        console.error('Parsed text too short, skipping update');
        continue;
      }
      // sanitize control characters that break Postgres text encoding
      const safeText = text.replace(/[\u0000-\u001F\u007F]/g, '');
      let upd = await supabase.from('proposals').update({ proposal_data: safeText }).eq('id', r.id);
      if(upd.error) {
        console.error('Update error for id', r.id, upd.error, '-> retrying with stricter sanitize');
        const safer = safeText.replace(/\\0/g, '');
        upd = await supabase.from('proposals').update({ proposal_data: safer }).eq('id', r.id);
      }
      if(upd.error) {
        console.error('Update error for id', r.id, upd.error);
      } else {
        console.log('Updated id', r.id, 'len=', (safeText||'').length);
        updated++;
      }
      // small delay
      await new Promise(res=>setTimeout(res, 400));
    }catch(err){
      console.error('Error processing id', r.id, err);
    }
  }
  console.log('\nDone. Updated', updated, 'rows.');
})();