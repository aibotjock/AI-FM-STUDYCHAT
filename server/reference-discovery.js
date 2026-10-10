const MAX_XML_BYTES = 256 * 1024;
const CACHE_MS = 12 * 60 * 60 * 1000;
const providerStates = new WeakMap();
const CONTENT_NAMES = new Set(['title', 'organizationName', 'altTitle', 'FullSummary', 'fullSummary', 'mesh', 'groupName', 'snippet']);

export class ReferenceDiscoveryError extends Error {
  constructor(status, message) { super(message);this.status=status; }
}
const reject = () => { throw new ReferenceDiscoveryError(502, 'The reference provider returned an unsupported response.'); };

// Parse the documented, shallow NLM response shape. Clinical content nodes are
// skipped as opaque payloads; only topic URLs, titles and publisher names escape.
function elements(input) {
  const result=[];let offset=0;
  while (offset < input.length) {
    const whitespace=/^\s*/.exec(input.slice(offset))[0];offset+=whitespace.length;
    if (offset===input.length) break;
    const opening=/^<([A-Za-z][A-Za-z0-9]*)(\s[^<>]*?)?\s*(\/?>)/.exec(input.slice(offset));
    if (!opening) reject();
    const [,name,rawAttributes='',ending]=opening;const attributes={};let remainder=rawAttributes.trim();
    while(remainder) {
      const attribute=/^([A-Za-z][A-Za-z0-9]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')\s*/.exec(remainder);
      if(!attribute || Object.hasOwn(attributes,attribute[1])) reject();
      attributes[attribute[1]]=attribute[2]??attribute[3];remainder=remainder.slice(attribute[0].length);
    }
    offset+=opening[0].length;
    if(ending==='/>') { result.push({name,attributes,body:''});continue; }
    const closing=`</${name}>`,end=input.indexOf(closing,offset);
    if(end<0) reject();
    result.push({name,attributes,body:input.slice(offset,end)});offset=end+closing.length;
  }
  return result;
}
function onlyAttributes(node,names) { if(Object.keys(node.attributes).some(name=>!names.includes(name))) reject(); }
function scalar(input,max) {
  // The brief response uses spans solely to highlight matched query words.
  let depth=0;
  const stripped=input.replace(/<[^>]*>/g,tag=> {
    if(/^<span class=["']qt\d+["']>$/.test(tag)) { depth++;return ''; }
    if(tag==='</span>' && depth>0) { depth--;return ''; }
    reject();
  });
  if(depth || /[<>]/.test(stripped)) reject();
  const decoded=stripped.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(match,entity)=> {
    const literals={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    if(Object.hasOwn(literals,entity)) return literals[entity];
    const code=entity[1]?.toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);
    if(!Number.isInteger(code) || code<32 || code>0x10ffff || code>=0xd800 && code<=0xdfff) reject();
    return String.fromCodePoint(code);
  });
  if(/&[^\s&;]+;/.test(decoded) || /[\u0000-\u001f\u007f<>]/.test(decoded)) reject();
  const value=decoded.replace(/\s+/g,' ').trim();
  if(!value || value.length>max) reject();
  return value;
}
function topicUrl(input) {
  try {
    const url=new URL(input);
    if(url.protocol!=='https:' || url.hostname!=='medlineplus.gov' || url.port || url.username || url.password || url.search || url.hash || !/^\/[a-z][a-z0-9]*\.html$/.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
export function parseReferenceDiscoveryXml(xml) {
  if(typeof xml!=='string' || Buffer.byteLength(xml)>MAX_XML_BYTES || /<!|<\?(?!xml\s)/i.test(xml)) reject();
  const withoutDeclaration=xml.trim().replace(/^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>/i,'').trim();
  if(/<\?/.test(withoutDeclaration)) reject();
  const roots=elements(withoutDeclaration);
  if(roots.length!==1 || roots[0].name!=='nlmSearchResult') reject();
  onlyAttributes(roots[0],[]);
  const rootChildren=elements(roots[0].body),allowedRoot=new Set(['term','file','server','count','retstart','retmax','spellingCorrection','list']);
  if(rootChildren.some(node=>!allowedRoot.has(node.name))) reject();
  const lists=rootChildren.filter(node=>node.name==='list');
  if(lists.length!==1) reject();
  for(const node of rootChildren.filter(node=>node.name!=='list')) { onlyAttributes(node,[]);if(/[<>]/.test(node.body)) reject(); }
  onlyAttributes(lists[0],['num','start','end']);
  const documents=elements(lists[0].body);
  if(documents.length>6 || documents.some(node=>node.name!=='document')) reject();
  const sources=[];
  for(const document of documents) {
    onlyAttributes(document,['rank','url']);
    const contents=elements(document.body);
    if(contents.some(node=>node.name!=='content' || !CONTENT_NAMES.has(node.attributes.name))) reject();
    for(const node of contents) {
      onlyAttributes(node,['name']);
      if(/<\/?(?:content|document|list|nlmSearchResult)\b/.test(node.body)) reject();
    }
    const titleNodes=contents.filter(node=>node.attributes.name==='title'),organizationNodes=contents.filter(node=>node.attributes.name==='organizationName');
    if(titleNodes.length!==1 || organizationNodes.length!==1) reject();
    const url=topicUrl(document.attributes.url);
    if(!url) continue;
    const title=scalar(titleNodes[0].body,260),organization=scalar(organizationNodes[0].body,120);
    if(organization!=='National Library of Medicine') reject();
    if(!sources.some(source=>source.url===url)) sources.push({ title,url,organization,publishedDate:null });
  }
  return sources;
}
async function boundedXml(response,signal) {
  if(!/^(?:application|text)\/xml\b/i.test(response.headers.get('content-type')||'') || Number(response.headers.get('content-length'))>MAX_XML_BYTES || !response.body) reject();
  const reader=response.body.getReader(),chunks=[];let size=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try {
    while(true) {
      if(signal.aborted) throw signal.reason;
      const {done,value}=await reader.read();if(done) break;
      size+=value.byteLength;if(size>MAX_XML_BYTES) { await reader.cancel();reject(); }
      chunks.push(value);
    }
    return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  } finally { signal.removeEventListener('abort',abort);reader.releaseLock(); }
}

export function createReferenceDiscovery({ fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=6000 }={}) {
  let state=providerStates.get(fetchImpl);
  if(!state) { state={cache:new Map(),inflight:new Map(),starts:[]};providerStates.set(fetchImpl,state); }
  return {
    async search(query) {
      if(typeof query!=='string' || !query.trim() || query.length>120 || /[\u0000-\u001f\u007f]/.test(query)) throw new ReferenceDiscoveryError(400,'Enter a study topic of 1 to 120 characters. Do not include patient details.');
      const term=query.trim().replace(/\s+/g,' '),key=term.toLowerCase(),time=now();
      for(const [cachedKey,entry] of state.cache) if(entry.expiresAt<=time) state.cache.delete(cachedKey);
      const cached=state.cache.get(key);
      if(cached) return {...cached.result,cached:true};
      if(state.inflight.has(key)) return state.inflight.get(key);
      state.starts=state.starts.filter(start=>start>time-60000);
      if(state.starts.length>=30 || state.inflight.size>=30) throw new ReferenceDiscoveryError(429,'Reference search is busy. Please wait before trying another topic.');
      state.starts.push(time);
      const request=(async()=>{
        const url=new URL('https://wsearch.nlm.nih.gov/ws/query');
        for(const [name,value] of Object.entries({db:'healthTopics',term,retmax:'6',rettype:'brief',tool:'AI-FM-STUDYCHAT'})) url.searchParams.set(name,value);
        const controller=new AbortController();let timer;
        const deadline=new Promise((_,rejectDeadline)=>{ timer=setTimeout(()=>{const error=new ReferenceDiscoveryError(504,'The reference provider did not respond in time. You can try again.');controller.abort(error);rejectDeadline(error);},Math.max(1,Math.min(timeoutMs,6000))); });
        try {
          const operation=(async()=>{
            const response=await fetchImpl(url.href,{method:'GET',headers:{Accept:'application/xml, text/xml'},redirect:'error',signal:controller.signal});
            if(!response.ok || response.redirected) throw new ReferenceDiscoveryError(response.status===429?503:502,'The reference provider is temporarily unavailable. No medical content was added.');
            return parseReferenceDiscoveryXml(await boundedXml(response,controller.signal));
          })();
          const sources=await Promise.race([operation,deadline]),fetchedAt=now(),expiresAt=fetchedAt+CACHE_MS;
          const result={sources,fetchedAt:new Date(fetchedAt).toISOString(),cacheExpiresAt:new Date(expiresAt).toISOString(),cached:false,
            provider:'MedlinePlus.gov / National Library of Medicine',purpose:'External topic links only. These results do not authorize tutor answers or practice questions.'};
          if(state.cache.size>=100) state.cache.delete(state.cache.keys().next().value);
          state.cache.set(key,{expiresAt,result});return result;
        } catch(error) {
          if(error instanceof ReferenceDiscoveryError) throw error;
          throw new ReferenceDiscoveryError(502,'Reference search could not reach the provider. You can try again.');
        } finally {clearTimeout(timer);state.inflight.delete(key);}
      })();
      state.inflight.set(key,request);return request;
    }
  };
}
