// Safe matching and cart-schema helpers for Zepto MCP (no network access here).
export const LIMIT = 100;
export function normalizeName(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/(\d+)\s+(ml|gm|g|kg|ltr|l|pcs|pc)\b/g, "$1$2").replace(/\s+/g, " ").trim();
}
export function numberPrice(v) {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/[,₹\s]/g, "");
  return /^\d+(?:\.\d{1,2})?$/.test(s) ? Number(s) : null;
}
function pricedObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of ["sellingPrice","selling_price","discountedPrice","discounted_price","currentPrice","current_price","finalPrice","final_price","offerPrice","offer_price","price"]) {
    const v = obj[key];
    if (typeof v === "object" && v !== null) {
      const nested = pricedObject(v); if (nested !== null) return nested;
    }
    const amount = numberPrice(v);
    if (amount !== null) return amount;
  }
  for (const key of ["pricing","priceDetails","price_details"]) {
    const v = pricedObject(obj[key]); if (v !== null) return v;
  }
  for (const key of ["sellingPriceInPaise","selling_price_paise","priceInPaise","price_in_paise"]) {
    const v = numberPrice(obj[key]); if (v !== null) return v / 100;
  }
  return null; // Never use MRP/list price as selling price.
}
function resultPayloads(response) {
  const data = [];
  if (response?.structuredContent !== undefined) data.push(response.structuredContent);
  for (const entry of response?.content || []) {
    if (entry.type !== "text" || typeof entry.text !== "string") continue;
    try { data.push(JSON.parse(entry.text)); } catch { /* plain text cannot verify product identity and price */ }
  }
  return data;
}
export function extractCandidates(result) {
  const queue = [...resultPayloads(result)], found = [], seen = new Set();
  for (let i = 0; queue.length && i < 150; i++) {
    const v = queue.shift();
    if (!v || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) { queue.push(...v.slice(0,60)); continue; }
    if (Object.keys(v).some(k => ["name","productName","product_name","title"].includes(k)) &&
        Object.keys(v).some(k => ["id","productId","product_id","sku","skuId","sku_id","variantId","variant_id"].includes(k))) found.push(v);
    for (const key of ["products","items","results","data","response","list","catalog","product","item","hits"]) {
      if (v[key] && typeof v[key] === "object") queue.push(v[key]);
    }
  }
  return found.slice(0,60);
}
export function candidateFor(raw) {
  const name = raw.name ?? raw.productName ?? raw.product_name ?? raw.title;
  const id = raw.productId ?? raw.product_id ?? raw.skuId ?? raw.sku_id ?? raw.variantId ?? raw.variant_id ?? raw.id ?? raw.sku;
  const price = pricedObject(raw);
  const availability = raw.available ?? raw.isAvailable ?? raw.inStock ?? raw.in_stock;
  const status = String(raw.availability ?? raw.stockStatus ?? "").toLowerCase();
  const available = availability === false || /out.of.stock|unavailable|sold.out/.test(status) ? false : true;
  return { name: typeof name === "string" ? name : "", id: typeof id === "string" || typeof id === "number" ? String(id) : "", price, available };
}
export function exactCandidate(result, desiredName, expectedId) {
  if (result?.isError) return {status:"needs_review",message:"Zepto search returned an error."};
  const requested = normalizeName(desiredName);
  if (!requested || requested.length < 3) return {status:"needs_review",message:"Product name is too short for safe matching."};
  const all = extractCandidates(result).map(candidateFor).filter(x => x.id && x.name);
  const exact = all.filter(x => normalizeName(x.name) === requested && (!expectedId || x.id === expectedId));
  const ids = new Set(exact.map(x => x.id));
  if (ids.size !== 1) return {status:"needs_review",message:ids.size > 1 ? "Several exact-name variants found; review product IDs." : "No uniquely identifiable exact product match. Check brand and pack size."};
  const item = exact[0];
  if (item.price === null) return {status:"needs_review",message:"Zepto did not return a verifiable current selling price."};
  if (!item.available) return {status:"unavailable",message:"Matching Zepto item is unavailable."};
  return {status:"found",product:item};
}
export function selectSearchTool(tools) {
  return (tools || []).find(t => /search/i.test(t.name) && /product|catalog|item/i.test(t.name+" "+(t.description||"")) && !/order|history/i.test(t.name)) || null;
}
export function selectAddTool(tools) {
  return (tools || []).find(t => /add/i.test(t.name) && /cart/i.test(t.name+" "+(t.description||"")) && !/checkout|order|payment|place/i.test(t.name)) || null;
}
function propertyFor(properties, options) {
  for (const key of options) if (properties[key] && (properties[key].type === "string" || properties[key].type === undefined)) return key;
  return null;
}
export function searchArgs(tool, query) {
  const schema=tool?.inputSchema || {}, properties=schema.properties || {};
  const key=propertyFor(properties,["query","search_query","searchQuery","searchTerm","search_term","keyword","search","text","productName","product_name","name"]);
  if (!key) throw Error("Search tool argument schema is not yet mapped. Check /api/tools.");
  const args = {[key]:query};
  const required = schema.required || [];
  const extra=required.filter(k=>!(k in args));
  if (extra.length) throw Error("Search tool requires extra parameters ("+extra.join(", ")+"); no values will be guessed.");
  return args;
}
export function addArgs(tool, productId, quantity) {
  const schema=tool?.inputSchema || {}, properties=schema.properties || {};
  const id=propertyFor(properties,["productId","product_id","skuId","sku_id","itemId","item_id","variantId","variant_id","productCode","product_code","sku","product","id"]);
  const qty=Object.keys(properties).find(k=>["quantity","qty","count"].includes(k) && ["number","integer",undefined].includes(properties[k]?.type));
  if (!id || !qty) throw Error("Cart-add schema is not safely mapped; no cart change attempted. See /api/tools.");
  const args = {[id]:String(productId),[qty]:quantity};
  const extra=(schema.required || []).filter(k=>!(k in args));
  if (extra.length) throw Error("Cart-add tool requires extra parameters ("+extra.join(", ")+"); no values will be guessed.");
  return args;
}
export function cartConfirmed(result) {
  if (result?.isError) return false;
  const obj = result?.structuredContent;
  if (obj && typeof obj === "object") {
    if (obj.success === true || obj.added === true || obj.status === "success" || obj.status === "added") return true;
    if (obj.success === false || obj.error) return false;
  }
  return (result?.content || []).some(x => x.type === "text" && /\b(added to (the |your )?cart|successfully added|cart updated)\b/i.test(x.text||""));
}
export function unitEligible(price) {return Number.isFinite(price) && price >= 0 && price <= LIMIT;}
