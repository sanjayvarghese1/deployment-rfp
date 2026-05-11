import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

function readEnv(){ const raw=fs.readFileSync('.env.local','utf8'); const lines=raw.split(/\r?\n/); const env={}; for(const line of lines){ if(!line||line.startsWith('#')) continue; const i=line.indexOf('='); if(i<=0) continue; env[line.slice(0,i)]=line.slice(i+1).replace(/^"|"$/g,''); } return env; }
const env = readEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{ persistSession:false, autoRefreshToken:false } });

// Extract currency amount from text (same logic as UI - efficient)
function extractCurrency(text) {
  if (!text) return '';
  const match = text.match(/(?:USD\s*)?\$?\s*[\d,]+(?:\.\d+)?(?:\s*(?:k|m|million|billion))?/i);
  return match?.[0]?.trim() || '';
}

// Extract timeline duration from text (same logic as UI - efficient)
function extractTimeline(text) {
  if (!text) return '';
  const match = text.match(/\b(?:\d+\s*(?:days?|weeks?|months?|years?)|Q\d\s*\d{4}|[A-Za-z]+\s+\d{4})\b/i);
  return match?.[0]?.trim() || '';
}

async function findUpdatedProposals(){
  const since = new Date(Date.now()-1000*60*60).toISOString();
  const { data, error } = await supabase.from('proposals').select('id,contract_id,vendor_name,price,timeline,experience,proposal_data,extracted_text').eq('proposal_type','uploaded_pdf').gt('updated_at', since).order('updated_at',{ascending:false});
  if(error) throw error;
  return data || [];
}

async function callAnalyzeApi(payload){
  const url = 'http://localhost:3000/api/ai/analyze-proposal';
  try{
    const res = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload), timeout: 5*60*1000 });
    if(!res.ok){ const body = await res.text().catch(()=>null); return { ok:false, status: res.status, body }; }
    const j = await res.json(); return { ok:true, json:j };
  }catch(err){ return { ok:false, error: String(err) }; }
}

async function ensureServerAvailable(){
  try{
    const r = await fetch('http://localhost:3000/').catch(()=>null);
    if(r && (r.status===200 || r.status===302 || r.status===304)) return true;
  }catch(e){}
  return false;
}

(async()=>{
  const proposals = await findUpdatedProposals();
  if(!proposals.length){ console.log('No recently-updated proposals found to re-analyze.'); process.exit(0); }
  console.log('Found', proposals.length, 'recent proposals to analyze.');

  let serverOk = await ensureServerAvailable();
  if(!serverOk){
    console.log('Local Next dev server not responding at http://localhost:3000.\nPlease start it with:');
    console.log('\n    npm run dev\n');
    process.exit(1);
  }

  for(const p of proposals){
    console.log('\nAnalyzing proposal id=', p.id, 'vendor=', p.vendor_name);
    
    // Fetch contract
    const { data: contract, error: cErr } = await supabase.from('contracts').select('id,title,description,budget,deadline,required_certifications').eq('id', p.contract_id).maybeSingle();
    if(cErr) console.warn('Contract fetch error:', cErr);
    const contractData = contract || { title: '', description: '', budget: '', deadline: '', required_certifications: '' };
    
    // Extract source for price/timeline (prefer extracted_text if available - saves tokens)
    const sourceText = p.extracted_text || p.proposal_data || '';
    
    // Pre-extract price and timeline client-side to avoid sending raw data unnecessarily (saves tokens)
    const preExtractedPrice = extractCurrency(sourceText);
    const preExtractedTimeline = extractTimeline(sourceText);
    
    // Token-efficient payload: send only extracted values, not raw full text
    const payload = {
      mode: 'score_single',
      contract_title: contractData.title || '',
      contract_description: contractData.description || '',
      contract_budget: contractData.budget || '',
      contract_deadline: contractData.deadline || '',
      contract_certifications: contractData.required_certifications || '',
      vendor_name: p.vendor_name,
      vendor_price: preExtractedPrice || p.price || '',
      vendor_timeline: preExtractedTimeline || p.timeline || '',
      vendor_experience: p.experience || '',
      proposal_data: p.proposal_data || '',
    };

    console.log('Sending payload - price:', payload.vendor_price.slice(0, 50), 'timeline:', payload.vendor_timeline.slice(0, 50));
    const result = await callAnalyzeApi(payload);
    if(!result.ok){ 
      console.error('API call failed:', result.error || result.status);
      if(result.body) console.error('Response body:', result.body.slice ? result.body.slice(0, 500) : result.body);
      continue; 
    }
    
    const analysis = result.json;
    const score = analysis?.analysis?.overall_score ?? null;
    console.log('API returned score:', score);
    
    if(score !== null && !isNaN(score)){
      // Extract clean price/timeline from analysis response or use pre-extracted
      const cleanPrice = analysis?.analysis?.extracted_price || preExtractedPrice || null;
      const cleanTimeline = analysis?.analysis?.extracted_timeline || preExtractedTimeline || null;
      
      const updateData = { ai_score: score };
      
      // Only update if we have clean extracted values (not corrupted raw data)
      if (cleanPrice && cleanPrice.length < 200) {
        updateData.price = cleanPrice;
        console.log('Updating price to:', cleanPrice);
      }
      if (cleanTimeline && cleanTimeline.length < 200) {
        updateData.timeline = cleanTimeline;
        console.log('Updating timeline to:', cleanTimeline);
      }
      
      const { error: updErr } = await supabase.from('proposals').update(updateData).eq('id', p.id);
      if(updErr) console.error('Failed to update proposal', p.id, updErr);
      else console.log('Updated ai_score=' + score + (cleanPrice ? ' + price' : '') + (cleanTimeline ? ' + timeline' : '') + ' for', p.id);
    } else {
      console.log('No valid score returned. Score=', score);
    }
  }
  console.log('\nAnalysis complete.');
})();