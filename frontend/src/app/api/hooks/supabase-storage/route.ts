import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/services/supabase';
import { extractCurrencyLikeText, extractTimelineLikeText, formatCurrency } from '@/lib/formatters/number';
import { createClient } from '@supabase/supabase-js';

function normalizeCurrencyWithSuffix(text: string){
  if(!text) return '';
  // remove currency labels
  const cleaned = String(text).replace(/(?:USD|usd)\s*/i, '').trim();
  // match number and optional suffix (k,m,b,million,billion,thousand)
  const m = cleaned.match(/([\d,.]+)\s*(k|m|b|thousand|million|billion)?/i);
  if(!m) return cleaned;
  const numStr = m[1].replace(/,/g,'');
  const val = parseFloat(numStr);
  if(!Number.isFinite(val)) return cleaned;
  const suffix = (m[2] || '').toLowerCase();
  let multiplier = 1;
  if(suffix === 'k' || suffix === 'thousand') multiplier = 1e3;
  if(suffix === 'm' || suffix === 'million') multiplier = 1e6;
  if(suffix === 'b' || suffix === 'billion') multiplier = 1e9;
  const scaled = val * multiplier;
  return formatCurrency(scaled);
}

// Use the same parser used in scripts
let pdfParse: any;
try{
  // Try to import the library's internal module to avoid test-run side effects
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  pdfParse = require('pdf-parse/lib/pdf-parse.js');
}catch(e){
  try{ pdfParse = require('pdf-parse'); }catch(err){ pdfParse = null; }
}

function sanitizeText(t: string){
  if(!t) return t;
  return t.replace(/[\u0000-\u001F\u007F]/g, '');
}

function buildAbsoluteUrl(origin: string, path: string) {
  return new URL(path, origin).toString();
}

export async function POST(req: NextRequest){
  // simple shared-secret check to prevent unauthorized calls
  const shared = process.env.EXTRACTOR_WEBHOOK_SECRET;
  if(shared){
    const incoming = req.headers.get('x-extractor-secret') || req.headers.get('x-hook-secret') || req.headers.get('x-supabase-signature');
    if(!incoming || incoming !== shared){
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  try{
    const body = await req.json();
    // Supabase storage event payload varies; common fields: bucket, name, publicURL
    const { bucket, name, url } = body;

    if(!name && !url){
      return NextResponse.json({ error: 'No file name or url provided' }, { status: 400 });
    }

    // Construct public URL if necessary
    let fileUrl = url;
    if(!fileUrl){
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if(!base) return NextResponse.json({ error: 'NEXT_PUBLIC_SUPABASE_URL not configured' }, { status: 500 });
      fileUrl = `${base.replace(/\/+$/,'')}/storage/v1/object/public/${bucket}/${name}`;
    }

    // Build server-side Supabase client (service role) to bypass RLS for background operations
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!supabaseUrl || !supabaseServiceRoleKey) return NextResponse.json({ error: 'Missing Supabase service credentials' }, { status: 500 });
    const svc = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // Find proposal(s) that reference this file using service client
    let { data: proposals, error } = await svc.from('proposals').select('id').or(`proposal_file.eq.'${fileUrl}',proposal_file.ilike.'%${name}%'`);
    if(error) console.warn('proposal lookup error', error);

    // Fallbacks if no match found: try exact eq, then name match
    if((!proposals || proposals.length === 0)){
      const r1 = await svc.from('proposals').select('id').eq('proposal_file', fileUrl);
      if(r1.error) console.warn('proposal exact lookup error', r1.error);
      if(r1.data && r1.data.length) proposals = r1.data;
    }
    if((!proposals || proposals.length === 0)){
      const r2 = await svc.from('proposals').select('id').eq('proposal_file_name', name);
      if(r2.error) console.warn('proposal name lookup error', r2.error);
      if(r2.data && r2.data.length) proposals = r2.data;
    }

    // Fetch file
    const res = await fetch(fileUrl);
    if(!res.ok) return NextResponse.json({ error: 'Failed to fetch file' }, { status: 400 });
    const ab = await res.arrayBuffer();
    const buffer = Buffer.from(ab);

    let parsedText = '';
    if(pdfParse){
      const parsed = await pdfParse(buffer);
      parsedText = parsed?.text || '';
    } else {
      return NextResponse.json({ error: 'PDF parser not available on server' }, { status: 500 });
    }

    const safe = sanitizeText(parsedText);

    if(proposals && proposals.length){
      const results = [];
      for(const p of proposals){
        // Fetch existing proposal to decide whether to write structured fields
        const { data: proposal } = await svc.from('proposals').select('id,contract_id,vendor_name,price,timeline,experience').eq('id', p.id).single();

        // Extract price/timeline from parsed text
        const extractedPrice = extractCurrencyLikeText(safe);
        const extractedTimeline = extractTimelineLikeText(safe);

        // Normalize price (convert 4.8 M -> $4,800,000.00)
        const normalizedPrice = extractedPrice ? normalizeCurrencyWithSuffix(extractedPrice) : '';

        // Prepare update payload: always save extracted text/proposal_data; only set price/timeline if missing
        const updateObj: any = { proposal_data: safe };
        if (!proposal?.price && extractedPrice) updateObj.price = normalizedPrice || extractedPrice;
        if (!proposal?.timeline && extractedTimeline) updateObj.timeline = extractedTimeline;

        const { data: updateData, error: updateError } = await svc.from('proposals').update(updateObj).eq('id', p.id).select();
        if(updateError){
          console.error(`[webhook] Update error for ${p.id}:`, updateError);
        } else {
          console.log(`[webhook] Updated proposal ${p.id}:`, updateObj, 'result:', updateData?.length || 0, 'rows');
        }

        results.push({ id: p.id, extraction: true, updates: updateObj });
      }
      
      // Return response immediately without waiting for analysis (fire-and-forget)
      const responseJson = { updated: proposals.length, results, message: 'Extraction complete; analysis running asynchronously' };
      
      // Trigger analysis in background (do not await)
      (async ()=>{
        try{
          for(const p of proposals){
            const { data: proposal } = await svc.from('proposals').select('id,contract_id,vendor_name,price,timeline,experience').eq('id', p.id).single();
            const { data: contract } = await svc.from('contracts').select('id,title,description,budget,deadline,required_certifications').eq('id', proposal?.contract_id).single();
            
            if(proposal && contract){
              const analysisUrl = buildAbsoluteUrl(req.nextUrl.origin, '/api/ai/analyze-proposal');
              const extractedPrice = extractCurrencyLikeText(safe);
              const extractedTimeline = extractTimelineLikeText(safe);
              const normalizedPrice = extractedPrice ? normalizeCurrencyWithSuffix(extractedPrice) : '';
              
              const payload = {
                mode: 'score_single',
                contract_title: contract.title || '',
                contract_description: contract.description || '',
                contract_budget: contract.budget || '',
                contract_deadline: contract.deadline || '',
                contract_certifications: contract.required_certifications || '',
                vendor_name: proposal.vendor_name,
                vendor_price: proposal.price || normalizedPrice || extractedPrice || '',
                vendor_timeline: proposal.timeline || extractedTimeline || '',
                vendor_experience: proposal.experience || '',
                proposal_data: safe,
              };
              
              console.log(`[webhook-bg] Starting analysis for proposal ${p.id}`);
              const analysisRes = await fetch(analysisUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              
              if(analysisRes.ok){
                const analysis = await analysisRes.json();
                const score = analysis?.analysis?.overall_score ?? null;
                if(score !== null){
                  await svc.from('proposals').update({ ai_score: score }).eq('id', p.id);
                  console.log(`[webhook-bg] Analysis complete for ${p.id}: score=${score}`);
                } else {
                  console.warn(`[webhook-bg] Analysis returned no score for ${p.id}`);
                }
              } else {
                console.warn(`[webhook-bg] Analysis API error for ${p.id}: ${analysisRes.status}`);
              }
            }
          }
        }catch(err){
          console.error('[webhook-bg] Analysis background error:', err);
        }
      })();
      
      return NextResponse.json(responseJson);
    }

    return NextResponse.json({ message: 'No matching proposal row found', preview: safe.slice(0,200) });
  }catch(err){
    console.error('webhook error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
