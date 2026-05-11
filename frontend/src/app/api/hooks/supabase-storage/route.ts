import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/services/supabase';

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

    // Find proposal(s) that reference this file
    const { data: proposals, error } = await supabase.from('proposals').select('id').or(`proposal_file.eq.${fileUrl},proposal_file.ilike.%${name}%`);
    if(error) console.warn('proposal lookup error', error);

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
        await supabase.from('proposals').update({ proposal_data: safe }).eq('id', p.id);
        // Fetch proposal + contract info to trigger analysis
        const { data: proposal } = await supabase.from('proposals').select('id,contract_id,vendor_name,price,timeline,experience').eq('id', p.id).single();
        const { data: contract } = await supabase.from('contracts').select('id,title,description,budget,deadline,required_certifications').eq('id', proposal?.contract_id).single();
        
        if(proposal && contract){
          // Call analyze-proposal API to score this proposal
          try{
            const analysisUrl = buildAbsoluteUrl(req.nextUrl.origin, '/api/ai/analyze-proposal');
            const payload = {
              mode: 'score_single',
              contract_title: contract.title || '',
              contract_description: contract.description || '',
              contract_budget: contract.budget || '',
              contract_deadline: contract.deadline || '',
              contract_certifications: contract.required_certifications || '',
              vendor_name: proposal.vendor_name,
              vendor_price: proposal.price || '',
              vendor_timeline: proposal.timeline || '',
              vendor_experience: proposal.experience || '',
              proposal_data: safe,
            };
            const analysisRes = await fetch(analysisUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if(analysisRes.ok){
              const analysis = await analysisRes.json();
              const score = analysis?.analysis?.overall_score ?? null;
              if(score !== null){
                await supabase.from('proposals').update({ ai_score: score }).eq('id', p.id);
                results.push({ id: p.id, extraction: true, analysis: true, score });
              } else {
                results.push({ id: p.id, extraction: true, analysis: false, error: 'no score returned' });
              }
            } else {
              results.push({ id: p.id, extraction: true, analysis: false, error: `API ${analysisRes.status}` });
            }
          }catch(err){
            results.push({ id: p.id, extraction: true, analysis: false, error: String(err) });
          }
        }
      }
      return NextResponse.json({ updated: proposals.length, results });
    }

    return NextResponse.json({ message: 'No matching proposal row found', preview: safe.slice(0,200) });
  }catch(err){
    console.error('webhook error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
