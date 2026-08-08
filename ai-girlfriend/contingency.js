/* v13 contingency.js · T5b lean · optional | R-C1冷落/R-C2热情/R-C3矛盾 | 挂 presence.pacingOf
   （texturePass 后·engine 零 diff）；门禁 tex.t≥30＋日配额2，新档静默故 #122-6 透明 */
(function(E){"use strict";if(!E||typeof E.use!=="function")return;
const O=E.safeObj,A=E.safeArr,PW=E.pickWith,N=(v,d)=>typeof v==="number"&&isFinite(v)?v:d;
const MS=[["好久不见了呀，你还好吧","这些天没消息，怪想你的"],["有点想你了","刚还在想你呢"]];
const WM=["看你这么带劲，我也高兴","嘿嘿，你今天话多，我爱听"];
const HOT=/(哈哈|嘿嘿|太好了|开心|激动|爽|耶|[!！]{2,})/;
const cf=(t,s)=>{const D=E.mod("memory"),p=D&&D.extractFacts(t,s,{});
 for(const f of A(O(p).facts))for(const o of A(O(s.mem).facts))
  if(o&&o.key===f.key&&o.value&&!o.negatedAt&&o.value!=f.value&&o.conf>=.6&&t.indexOf(o.value)<0)
   return"咦，我这儿记的是"+o.value+"…是我记岔了吗";
 return"";};
function contingencePass(reply,replies,ctx){try{
 const c=O(ctx),s=O(c.st),rs=A(replies),t=String(reply||""),n=Date.now(),q=O(s.ctg),d=n/864e5|0,
  un=N(q.d,-1)===d?N(q.n,0):0,u=String(c.text||"");
 if(t.length<4||c.crisis||un>1||N(O(s.tex).t,0)<30||E.flagOn(s,"contingency")===false||
  (c.lv||E.getLevel(N(s.affection,0)).lv)<2)return null;
 const r=E.rngOf(c.rng?c:s),l=Number(s.lastVisit),g=l>0?(n-l)/36e5:0;
 let a=cf(u,s),k="c3";
 if(!a&&E.chanceWith(.55,r)){
  if(g>=12){a=PW(MS[g>=72?0:1],r);k="c1";}
  else if(HOT.test(u)||u.length>19){a=PW(WM,r);k="c2";}}
 if(!a)return null;
 const o=t.replace(/[。！？…]$/,"")+"，"+a;
 if(o.length>90||E.PERSONA_BREAK_RE.test(o)||E.GUILT_TRIP_RE.test(o))return null;
 s.ctg={d,n:un+1,k};if(rs.length)rs[0]=o;
 return o;}catch(x){return null;}}
E.use("contingency",{contingencePass});
})(typeof Engine!=="undefined"?Engine:null);
