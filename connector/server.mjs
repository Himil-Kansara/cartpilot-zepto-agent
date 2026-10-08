import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { exactCandidate, selectSearchTool, selectAddTool, searchArgs, addArgs, cartConfirmed, unitEligible } from "./core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8787);
const ADDRESS = "127.0.0.1";
const token=randomBytes(24).toString("hex");
let client=null, transport=null, toolList=[], connected=false, connecting=null;
const selections=new Map();
async function connect(){
  if(connected) return {connected:true};
  if(connecting) return connecting;
  connecting=(async()=>{
    try {
      // mcp-remote handles Zepto's supported desktop/localhost OAuth flow.
      transport=new StdioClientTransport({command:process.platform==="win32"?"npx.cmd":"npx",args:["-y","mcp-remote","https://mcp.zepto.co.in/mcp","--transport","http-first"],stderr:"inherit"});
      client=new Client({name:"cartpilot-local",version:"1.0.0"},{capabilities:{}});
      await client.connect(transport);
      const found=await client.listTools();
      toolList=found.tools || [];
      connected=true;
      return {connected:true,searchTool:selectSearchTool(toolList)?.name||null,cartTool:selectAddTool(toolList)?.name||null};
    }catch(e){connected=false;toolList=[];try{await client?.close()}catch{}client=null;transport=null;throw e;}
    finally{connecting=null;}
  })();
  return connecting;
}
async function lookup({name,url}){
  if(!connected) throw Error("Connect Zepto first.");
  const tool=selectSearchTool(toolList);
  if(!tool) return {status:"needs_review",message:"Search tool was not found. See /api/tools."};
  const input=String(name||"").trim().slice(0,200);
  if(input.length<3) return {status:"needs_review",message:"Enter the full product name including pack size. A URL alone cannot safely identify the product."};
  const response=await client.callTool({name:tool.name,arguments:searchArgs(tool,input)});
  const verdict=exactCandidate(response,input);
  if(verdict.status==="found"){
    const reference=randomBytes(18).toString("hex");
    selections.set(reference,{product:verdict.product,query:input,created:Date.now()});
    return {...verdict,reference};
  }
  return verdict;
}
async function addToCart({reference,quantity,confirm}){
  if(confirm!==true) throw Error("Explicit user confirmation is required.");
  if(!connected) throw Error("Connect Zepto first.");
  const qty=Number(quantity);
  if(!Number.isInteger(qty)||qty<1||qty>20) throw Error("Quantity must be an integer from 1 to 20.");
  const data=selections.get(String(reference));
  if(!data || Date.now()-data.created>5*60*1000) throw Error("Product verification expired. Fetch live price again.");
  selections.delete(String(reference)); // One-time use; avoids duplicate additions if retried.
  const refreshed=await lookup({name:data.query});
  if(refreshed.status!=="found"||refreshed.product.id!==data.product.id) throw Error("Product changed or is no longer uniquely available. No cart change attempted.");
  if(!unitEligible(refreshed.product.price)) return {status:"skipped",price:refreshed.product.price,message:"Unit price exceeds ₹100. Skipped."};
  const tool=selectAddTool(toolList);
  if(!tool) throw Error("Zepto MCP cart-add tool unavailable. No cart change attempted.");
  const args=addArgs(tool,refreshed.product.id,qty);
  const response=await client.callTool({name:tool.name,arguments:args});
  return {status:cartConfirmed(response)?"added":"unconfirmed",price:refreshed.product.price,quantity:qty,message:cartConfirmed(response)?"Zepto confirmed cart update.":"Cart action returned an ambiguous response. Check your Zepto cart manually before retrying."};
}
async function readBody(req){let s="";for await(const chunk of req){s+=chunk;if(s.length>16000)throw Error("Request too large.");}try{return JSON.parse(s||"{}")}catch{throw Error("Invalid JSON")}}
function respond(res,code,data){res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});res.end(JSON.stringify(data))}
const server=http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,"http://localhost");
  const origin=req.headers.origin;
  if(origin && origin!=="http://127.0.0.1:"+PORT && origin!=="http://localhost:"+PORT) return respond(res,403,{error:"Invalid origin"});
  if(u.pathname==="/api/status"&&req.method==="GET")return respond(res,200,{connected,mode:"localhost",searchTool:selectSearchTool(toolList)?.name||null,cartTool:selectAddTool(toolList)?.name||null});
  if(u.pathname==="/api/token"&&req.method==="GET")return respond(res,200,{token});
  if(u.pathname.startsWith("/api/")){
    if(req.method!=="POST")return respond(res,405,{error:"Method not allowed"});
    if(req.headers["x-cartpilot-token"]!==token)return respond(res,403,{error:"Invalid session token"});
    const input=await readBody(req);
    if(u.pathname==="/api/connect")return respond(res,200,await connect());
    if(u.pathname==="/api/lookup")return respond(res,200,await lookup(input));
    if(u.pathname==="/api/cart/add")return respond(res,200,await addToCart(input));
    if(u.pathname==="/api/tools")return respond(res,200,{tools:toolList.map(t=>({name:t.name,description:t.description||"",inputSchema:t.inputSchema}))});
    return respond(res,404,{error:"Unknown endpoint"});
  }
  if(req.method!=="GET"&&req.method!=="HEAD")return respond(res,405,{error:"Method not allowed"});
  const relative=u.pathname==="/"?"index.html":u.pathname.slice(1);
  const file=path.resolve(root,"public",relative);
  if(!file.startsWith(path.resolve(root,"public")+path.sep) && file!==path.resolve(root,"public","index.html"))return respond(res,403,{error:"Forbidden"});
  const bytes=await fs.readFile(file);
  res.writeHead(200,{"content-type":file.endsWith(".html")?"text/html; charset=utf-8":file.endsWith(".csv")?"text/csv; charset=utf-8":"application/octet-stream","cache-control":"no-store","x-content-type-options":"nosniff"});
  res.end(req.method==="HEAD"?undefined:bytes);
 }catch(e){respond(res,e?.code==="ENOENT"?404:400,{error:String(e.message||e)})}
});
server.listen(PORT,ADDRESS,()=>{console.log("CartPilot local: http://127.0.0.1:"+PORT);console.log("Open this URL on your Windows laptop, not your Netlify site.");});
