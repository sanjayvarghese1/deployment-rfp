import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
function readEnv(){ const raw=fs.readFileSync('.env.local','utf8'); const lines=raw.split(/\r?\n/); const env={}; for(const line of lines){ if(!line||line.startsWith('#')) continue; const i=line.indexOf('='); if(i<=0) continue; env[line.slice(0,i)]=line.slice(i+1).replace(/^"|"$/g,''); } return env; }
const env = readEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{ persistSession:false, autoRefreshToken:false } });
(async()=>{
  const since = new Date(Date.now()-1000*60*60).toISOString();
  const { data, error } = await supabase.from('proposals').select('id,contract_id,vendor_name,proposal_file,proposal_data,updated_at').eq('proposal_type','uploaded_pdf').gt('updated_at', since).order('updated_at',{ascending:false});
  if(error){ console.error('Supabase error', error); process.exit(1); }
  if(!data || data.length===0){ console.log('No recently-updated uploaded_pdf proposals found (within 1h).'); process.exit(0); }
  for(const r of data){
    console.log('\nID:', r.id);
    console.log('Vendor:', r.vendor_name);
    console.log('File:', r.proposal_file);
    console.log('Updated at:', r.updated_at);
    const len = r.proposal_data ? r.proposal_data.length : 0;
    console.log('Text length:', len);
    console.log('Preview:\n', (r.proposal_data||'').slice(0,800));
  }
})();